"""Query-only pass over an already-ingested Titen store.

The 2026-08-04 lane runner always ingests before it queries, which would put a
fresh ingest between the two arms of an A/B whose whole point is that only the
ranker differs. This runs the query half alone, against a store that already
exists, so pass A and pass B see byte-identical canonical rows.

Nothing here is a new scorer: `common.py` is imported unmodified, and the
per-instance query is `tclient.compile_ranked`, also unmodified.

usage: query_pass.py --port N --key-file PATH --out NAME [--workers N]
"""
import argparse, json, os, sys, time
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, os.path.expanduser("~/titen-bench-20260804/harness"))
sys.path.insert(0, os.path.expanduser("~/titen-bench-20260804/harness/titen-lane"))
import common
import tclient

RESULTS = os.path.expanduser("~/titen-evidence-rank/bench/results")


def read_key(path):
    """The bootstrap log is the only copy of the key; never echo it."""
    with open(os.path.expanduser(path)) as fh:
        for line in fh:
            if line.startswith("api_key: "):
                return line[len("api_key: "):].strip()
    raise SystemExit("no api_key line in %s" % path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, required=True)
    ap.add_argument("--key-file", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--label", default="")
    args = ap.parse_args()

    instances = common.load()
    client = tclient.Client("127.0.0.1", args.port, read_key(args.key_file))

    status, ready = client.get("/readyz")
    print("readyz", status, flush=True)

    ranked, diagnostics, failures = {}, {}, {}
    t0 = time.time()

    def query(inst):
        try:
            order, info = tclient.compile_ranked(client, inst)
            return inst["qid"], order, info, None if order else "empty pack"
        except Exception as error:
            return inst["qid"], [], None, "%s: %s" % (type(error).__name__, error)

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        for done, (qid, order, info, error) in enumerate(pool.map(query, instances), 1):
            ranked[qid] = order
            if info:
                diagnostics[qid] = info
            if error:
                failures[qid] = error
            if done % 100 == 0:
                print("queried %d/%d %.0fs" % (done, len(instances), time.time() - t0), flush=True)
    query_seconds = time.time() - t0

    # An authentication or routing mistake answers every request identically and
    # produces a full set of scored zeroes that reads exactly like a real null.
    if not any(ranked.values()):
        raise SystemExit("ABORT: every instance returned an empty pack; first failure: %s"
                         % next(iter(failures.values()), "none"))

    result = common.score(instances, ranked, failures)
    print(json.dumps({k: v for k, v in result.items() if k != "by_type"}, indent=2), flush=True)

    os.makedirs(RESULTS, exist_ok=True)
    base = os.path.join(RESULTS, args.out)
    common.emit(base + ".json", "titen", "fts", result, {
        "pass": args.label or args.out,
        "query_seconds": round(query_seconds, 1),
        "llm_calls": 0,
        "embed_calls": 0,
        "compile": {"max_tokens": 32000, "max_candidates": 1000, "top_k": 1000},
        "store": "copy of ~/titen-bench-20260804/lanes/titen/fts-500.db (2026-08-04)",
        "ingest": "not repeated; store reused",
        "failures_detail": failures,
    })
    with open(base + ".ranked.json", "w") as fh:
        json.dump({"lane": "titen", "arm": "fts", "ranked": ranked,
                   "failures": failures, "diagnostics": diagnostics}, fh, indent=2)
    print("wrote", base + ".json", flush=True)


if __name__ == "__main__":
    main()
