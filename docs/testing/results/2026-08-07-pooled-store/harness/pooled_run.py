"""Titen pooled-store lane: one subject holds every distinct LongMemEval-S session.

The per-instance condition gives each question its own ~50-session haystack.
This lane ingests each of the 19,829 distinct sessions once under a single
subject and asks all 500 questions against that shared store, which is the
shape a real cumulative memory store has. Store-size prefixes isolate corpus
size: every gold session is ingested first (the benchmark-scale.ts trick), so
the question set is answerable at every prefix and distractor volume is the
only variable that moves.

Per-compile wall-clock latency is recorded client-side over loopback; the
service runs as a separate OS process (see 2026-08-04-scale-and-concurrency.md
for why that separation is load-bearing).
"""
import argparse, hashlib, json, os, sys, time
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, "/home/ramaaditya/titen-bench-20260804/harness")
sys.path.insert(0, "/home/ramaaditya/titen-bench-20260804/harness/titen-lane")
import common
import tclient

from pooled_common import pooled_sessions

RESULTS = os.path.expanduser("~/titen-bench-20260804/results")
SUBJECT = "pooled-v1"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--arm", required=True)
    ap.add_argument("--port", type=int, required=True)
    ap.add_argument("--key", required=True)
    ap.add_argument("--sessions", type=int, default=0, help="store prefix size; 0 = full pool")
    ap.add_argument("--chunk", type=int, default=700)
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--skip-ingest", action="store_true", help="store already loaded; query only")
    ap.add_argument("--drain", action="store_true")
    ap.add_argument("--drain-workers", type=int, default=8)
    ap.add_argument("--tag", default="")
    ap.add_argument("--out", default="")
    ap.add_argument("--meta-extra", default="{}")
    args = ap.parse_args()

    instances, ordered, n_gold = pooled_sessions()
    total = len(ordered)
    if args.sessions:
        if args.sessions < n_gold:
            raise SystemExit("ABORT: prefix %d smaller than gold set %d" % (args.sessions, n_gold))
        ordered = ordered[: args.sessions]
    print("pooled store: %d/%d sessions (gold-first %d)" % (len(ordered), total, n_gold), flush=True)

    client = tclient.Client("127.0.0.1", args.port, args.key)
    status, ready = client.get("/readyz")
    print("readyz", status, json.dumps(ready.get("data", ready))[:600], flush=True)

    stats = {"obs": 0, "claims": 0}
    failures, ingest_errors = {}, {}
    ingest_seconds = 0.0

    if not args.skip_ingest:
        t0 = time.time()

        def ingest(pair):
            sid, text = pair
            inst = {"qid": SUBJECT, "sessions": [(sid, text)]}
            try:
                return sid, tclient.ingest_instance(client, inst, args.chunk, stats), None
            except Exception as error:
                return sid, 0, "%s: %s" % (type(error).__name__, error)

        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            for done, (sid, count, error) in enumerate(pool.map(ingest, ordered), 1):
                if error:
                    ingest_errors[sid] = error
                if done % 500 == 0:
                    print("ingested %d/%d claims=%d %.0fs"
                          % (done, len(ordered), stats["claims"], time.time() - t0), flush=True)
        ingest_seconds = time.time() - t0
        if stats["obs"] == 0:
            raise SystemExit(
                "ABORT: observations_written=0 over %d sessions; every write failed. "
                "First ingest error: %s"
                % (len(ordered), next(iter(ingest_errors.values()), "none")))
        if ingest_errors:
            print("INGEST ERRORS: %d sessions failed" % len(ingest_errors), flush=True)

    embed_calls = 0
    drain_seconds = 0.0
    indexed = remaining = 0
    if args.drain:
        t1 = time.time()
        embed_calls, indexed, remaining = tclient.drain_all(client, workers=args.drain_workers)
        drain_seconds = time.time() - t1
        print("drained embed_calls=%d indexed=%d remaining=%d %.0fs"
              % (embed_calls, indexed, remaining, drain_seconds), flush=True)

    ranked, diagnostics, latencies = {}, {}, {}
    t2 = time.time()

    def query(inst):
        try:
            q0 = time.perf_counter()
            order, info = tclient.compile_ranked(
                client, {"qid": SUBJECT, "question": inst["question"]})
            ms = (time.perf_counter() - q0) * 1000.0
            return inst["qid"], order, info, ms, None if order else "empty pack"
        except Exception as error:
            return inst["qid"], [], None, 0.0, "%s: %s" % (type(error).__name__, error)

    # Queries run at concurrency 1: at and above 10^4 claims one client already
    # saturates the service, and latency percentiles at concurrency 1 are the
    # per-request cost rather than a queueing measurement.
    for inst in instances:
        qid, order, info, ms, error = query(inst)
        ranked[qid] = order
        latencies[qid] = round(ms, 3)
        if info:
            diagnostics[qid] = info
        if error:
            failures[qid] = error
    query_seconds = time.time() - t2

    lat = sorted(latencies.values())

    def pct(p):
        return round(lat[min(len(lat) - 1, int(len(lat) * p))], 2) if lat else 0.0

    result = common.score(instances, ranked, failures)
    meta = {
        "condition": "pooled",
        "subject": SUBJECT,
        "store_sessions": len(ordered) if not args.skip_ingest else args.sessions or total,
        "distinct_sessions_total": total,
        "gold_sessions_first": n_gold,
        "ingest_seconds": round(ingest_seconds, 1),
        "index_drain_seconds": round(drain_seconds, 1),
        "query_seconds": round(query_seconds, 1),
        "embed_calls": embed_calls,
        "llm_calls": 0,
        "observations_written": stats["obs"],
        "claims_written": stats["claims"],
        "vectors_indexed": indexed,
        "outbox_remaining_after_drain": remaining,
        "chunk_chars": args.chunk,
        "compile": {"max_tokens": 32000, "max_candidates": 1000, "top_k": 1000},
        "query_concurrency": 1,
        "compile_ms": {"p50": pct(0.50), "p95": pct(0.95), "p99": pct(0.99)},
        "session_id_carrier": "claim.observer_id (not FTS-indexed)",
        "ingest_errors": len(ingest_errors),
        "failures_detail": failures,
        "tag": args.tag,
    }
    meta.update(json.loads(args.meta_extra))
    print(json.dumps({k: v for k, v in result.items() if k != "by_type"}, indent=2), flush=True)
    print("latency", meta["compile_ms"], flush=True)

    if args.out:
        base = os.path.join(RESULTS, args.out)
        common.emit(base + ".json", "titen", args.arm, result, meta)
        with open(base + ".ranked.json", "w") as fh:
            json.dump({"lane": "titen", "arm": args.arm, "condition": "pooled",
                       "ranked": ranked, "failures": failures,
                       "latency_ms": latencies, "diagnostics": diagnostics}, fh, indent=2)
        print("wrote", base + ".json", flush=True)


if __name__ == "__main__":
    main()
