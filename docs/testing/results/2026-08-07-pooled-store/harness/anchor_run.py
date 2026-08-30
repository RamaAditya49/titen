"""Subject-scoped anchor arm: re-query a COPY of the 2026-08-04 per-instance
store (fts-500.db, 424,168 claims, one subject per instance) with the 0.7.0
npm tarball. No ingest. This is falsifier 1's anchor gate and the measured
"scope by user_id" row in one run.
"""
import argparse, json, os, sys, time

sys.path.insert(0, "/srv/titen-workspace/titen-bench-20260804/harness")
sys.path.insert(0, "/srv/titen-workspace/titen-bench-20260804/harness/titen-lane")
import common
import tclient

RESULTS = os.path.expanduser("~/titen-bench-20260804/results")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, required=True)
    ap.add_argument("--key", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    instances = common.load()
    client = tclient.Client("127.0.0.1", args.port, args.key)
    status, ready = client.get("/readyz")
    print("readyz", status, json.dumps(ready.get("data", ready))[:400], flush=True)

    ranked, failures, latencies, diagnostics = {}, {}, {}, {}
    t0 = time.time()
    for idx, inst in enumerate(instances, 1):
        try:
            q0 = time.perf_counter()
            order, info = tclient.compile_ranked(client, inst)
            latencies[inst["qid"]] = round((time.perf_counter() - q0) * 1000.0, 3)
            ranked[inst["qid"]] = order
            if info:
                diagnostics[inst["qid"]] = info
            if not order:
                failures[inst["qid"]] = "empty pack"
        except Exception as error:
            ranked[inst["qid"]] = []
            latencies[inst["qid"]] = 0.0
            failures[inst["qid"]] = "%s: %s" % (type(error).__name__, error)
        if idx % 100 == 0:
            print("queried %d/%d %.0fs" % (idx, len(instances), time.time() - t0), flush=True)
    query_seconds = time.time() - t0

    lat = sorted(latencies.values())

    def pct(p):
        return round(lat[min(len(lat) - 1, int(len(lat) * p))], 2) if lat else 0.0

    result = common.score(instances, ranked, failures)
    meta = {
        "condition": "subject-scoped-anchor",
        "store": "copy of 2026-08-04 fts-500.db (424,168 claims, one subject per instance)",
        "package": "titen-memory@0.7.0 npm tarball",
        "dist_shasum": "620af9a392b13c9bef91a215cf96eee2569e8f3e",
        "published_reference": {"recall_at_1": 0.880, "mrr_at_10": 0.9147},
        "anchor_gate": "recall@1 within +/-0.002 of 0.880 or nothing else is reported",
        "llm_calls": 0,
        "embed_calls": 0,
        "query_concurrency": 1,
        "compile_ms": {"p50": pct(0.50), "p95": pct(0.95), "p99": pct(0.99)},
        "query_seconds": round(query_seconds, 1),
        "compile": {"max_tokens": 32000, "max_candidates": 1000, "top_k": 1000},
        "failures_detail": failures,
    }
    print(json.dumps({k: v for k, v in result.items() if k != "by_type"}, indent=2), flush=True)
    print("latency", meta["compile_ms"], flush=True)
    gate = abs(result["recall_at_1"] - 0.880) <= 0.002
    print("ANCHOR GATE:", "PASS" if gate else "FAIL", flush=True)

    base = os.path.join(RESULTS, args.out)
    common.emit(base + ".json", "titen", "fts-anchor", result, meta)
    with open(base + ".ranked.json", "w") as fh:
        json.dump({"lane": "titen", "arm": "fts-anchor", "condition": "subject-scoped-anchor",
                   "ranked": ranked, "failures": failures, "latency_ms": latencies,
                   "diagnostics": diagnostics}, fh, indent=2)
    print("wrote", base + ".json", flush=True)
    sys.exit(0 if gate else 2)


if __name__ == "__main__":
    main()
