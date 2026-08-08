"""Query one served store for all 500 LongMemEval-S questions at a pinned `at`.

Used for both conditions and both builds in the #227 interpretable-score gate.
Differs from anchor_run.py / pooled_run.py in exactly two ways, and both are
load-bearing here:

  * `at` is pinned on every request. `rankCandidates` takes recency from the
    request's `as_of`, which defaults to wall-clock, and a run on a later day
    reorders the pack tail (43 of 500 anchor packs on 2026-08-07, see
    docs/testing/2026-08-08-pooled-recall-recovery.md). Pinning removes the
    calendar as a difference between the before and after builds.
  * every item's `score` is recorded, because AC-INT-002 is a tie count and a
    session-id-only artifact cannot answer it.

No ingest: both stores are pre-built copies. Failures are recorded and stay in
the denominator -- `common.score` enforces that, this file does not get a vote.
"""
import argparse, json, os, sys, time

HARNESS = os.path.expanduser("~/titen-bench-20260804/harness")
sys.path.insert(0, HARNESS)
sys.path.insert(0, os.path.join(HARNESS, "titen-lane"))
import common
import tclient

POOLED_SUBJECT = "pooled-v1"


def compile_one(client, subject, question, at, max_tokens, max_candidates, top_k):
    """Return (distinct session ids best-first, item scores in pack order, diagnostics)."""
    status, body = client.post("/v1/context/compile", {
        "subject_id": subject,
        "task": tclient.clean(question)[:4000],
        "at": at,
        "max_tokens": max_tokens,
        "max_candidates": max_candidates,
        "top_k": top_k,
    })
    if status != 200:
        raise RuntimeError("compile %s %s" % (status, json.dumps(body)[:300]))
    items = body["data"]["items"]
    seen, order = set(), []
    for item in items:
        sid = item.get("observer_id")
        if sid and sid not in seen:
            seen.add(sid)
            order.append(sid)
    scores = [item["score"] for item in items]
    return order, scores, {
        "items": len(items),
        "candidates": body["meta"]["candidates"],
        "omitted": body["data"]["budget"]["omitted_items"],
        "degraded": body["meta"]["degraded"],
    }


def percentiles(values):
    lat = sorted(values)
    if not lat:
        return {"p50": 0.0, "p95": 0.0, "p99": 0.0}
    return {p: round(lat[min(len(lat) - 1, int(len(lat) * f))], 2)
            for p, f in (("p50", 0.50), ("p95", 0.95), ("p99", 0.99))}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--condition", required=True, choices=["anchor", "pooled"])
    ap.add_argument("--build", required=True, help="commit sha under test, for the artifact")
    ap.add_argument("--port", type=int, required=True)
    ap.add_argument("--key", required=True)
    ap.add_argument("--at", required=True, help="pinned as_of timestamp, ISO-8601")
    ap.add_argument("--out", required=True, help="artifact path prefix")
    ap.add_argument("--passes", type=int, default=2,
                    help="repeat the query loop; pass 1 is cold, later passes are warm")
    ap.add_argument("--max-tokens", type=int, default=32000)
    ap.add_argument("--max-candidates", type=int, default=1000)
    ap.add_argument("--top-k", type=int, default=1000)
    args = ap.parse_args()

    instances = common.load()
    client = tclient.Client("127.0.0.1", args.port, args.key)
    status, ready = client.get("/readyz")
    print("readyz", status, json.dumps(ready.get("data", ready))[:400], flush=True)

    passes = []
    ranked = scores = diagnostics = failures = None
    for p in range(1, args.passes + 1):
        r, sc, diag, fail, lat = {}, {}, {}, {}, {}
        t0 = time.time()
        for idx, inst in enumerate(instances, 1):
            subject = inst["qid"] if args.condition == "anchor" else POOLED_SUBJECT
            try:
                q0 = time.perf_counter()
                order, item_scores, info = compile_one(
                    client, subject, inst["question"], args.at,
                    args.max_tokens, args.max_candidates, args.top_k)
                lat[inst["qid"]] = round((time.perf_counter() - q0) * 1000.0, 3)
                r[inst["qid"]] = order
                sc[inst["qid"]] = item_scores
                diag[inst["qid"]] = info
                if not order:
                    fail[inst["qid"]] = "empty pack"
            except Exception as error:
                r[inst["qid"]] = []
                sc[inst["qid"]] = []
                lat[inst["qid"]] = 0.0
                fail[inst["qid"]] = "%s: %s" % (type(error).__name__, error)
            if idx % 100 == 0:
                print("pass %d queried %d/%d %.0fs"
                      % (p, idx, len(instances), time.time() - t0), flush=True)
        elapsed = time.time() - t0
        passes.append({"pass": p, "query_seconds": round(elapsed, 1),
                       "compile_ms": percentiles(lat.values()),
                       "latency_ms": lat})
        print("pass %d %.0fs %s" % (p, elapsed, passes[-1]["compile_ms"]), flush=True)
        if ranked is None:
            ranked, scores, diagnostics, failures = r, sc, diag, fail
        else:
            # Same store, same build, same pinned `at`: identical output or the
            # measurement is not a measurement.
            stable = (r == ranked and sc == scores)
            passes[-1]["identical_to_pass_1"] = stable
            print("pass %d identical to pass 1:" % p, stable, flush=True)

    result = common.score(instances, ranked, failures)
    meta = {
        "condition": args.condition,
        "build": args.build,
        "served_from": "source checkout (bun src/runtime/bun/cli.ts serve)",
        "at_pinned": args.at,
        "compile": {"max_tokens": args.max_tokens,
                    "max_candidates": args.max_candidates, "top_k": args.top_k},
        "query_concurrency": 1,
        "llm_calls": 0,
        "embed_calls": 0,
        "passes": [{k: v for k, v in p.items() if k != "latency_ms"} for p in passes],
        "compile_ms": passes[0]["compile_ms"],
        "compile_ms_warm": passes[-1]["compile_ms"] if len(passes) > 1 else None,
        "failures_detail": failures,
    }
    print(json.dumps({k: v for k, v in result.items() if k != "by_type"}, indent=2), flush=True)

    common.emit(args.out + ".json", "titen", "fts-" + args.condition, result, meta)
    with open(args.out + ".ranked.json", "w") as fh:
        json.dump({"lane": "titen", "arm": "fts-" + args.condition,
                   "condition": args.condition, "build": args.build,
                   "at_pinned": args.at, "ranked": ranked, "scores": scores,
                   "failures": failures, "diagnostics": diagnostics,
                   "latency_ms": {p["pass"]: p["latency_ms"] for p in passes}}, fh, indent=2)
    print("wrote", args.out + ".json", flush=True)


if __name__ == "__main__":
    main()
