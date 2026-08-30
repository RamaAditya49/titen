"""Verbatim RAG control, pooled-store condition: one matrix of all distinct
sessions, every question ranked against the whole pool by exact cosine.

Same embedders, truncation rule, and scorer as control.py — the only change is
the candidate set: the full pool instead of the instance's ~50-session
haystack. Store prefixes reuse the gold-first deterministic order defined in
pooled_run.py so every lane sees byte-identical store contents at each size.
"""
import argparse, hashlib, json, os, sys, time

sys.path.insert(0, "/srv/titen-workspace/titen-bench-20260804/harness")
sys.path.insert(0, "/srv/titen-workspace/titen-bench-20260804/harness/titen-lane")
import common
import numpy as np
from control import (FastembedEmbedder, RouterEmbedder, TRUNC_CHARS, truncate,
                     unit, embed_cached)
from pooled_common import pooled_sessions

RESULTS = os.path.expanduser("~/titen-bench-20260804/results")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--arm", required=True, choices=["router", "fastembed"])
    ap.add_argument("--sizes", default="1000,5000,10000,19829",
                    help="comma-separated store prefixes; the full pool is embedded "
                         "once and every prefix ranks from a slice of one matrix")
    ap.add_argument("--tag", required=True)
    args = ap.parse_args()

    instances, ordered, n_gold = pooled_sessions()
    total = len(ordered)
    sizes = sorted({min(int(s), total) for s in args.sizes.split(",")})
    if sizes[0] < n_gold:
        raise SystemExit("ABORT: prefix %d smaller than gold set %d" % (sizes[0], n_gold))
    print("pooled store: %d sessions (gold-first %d), sizes %s"
          % (total, n_gold, sizes), flush=True)

    embedder = RouterEmbedder() if args.arm == "router" else FastembedEmbedder()
    cache = {}

    t0 = time.time()
    texts = [truncate(t) for _, t in ordered]
    empty_sessions = sum(1 for t in texts if not t.strip())
    unique_embedded = 0
    for start in range(0, len(texts), 512):
        unique_embedded += embed_cached(embedder, texts[start:start + 512], cache)
        if (start // 512) % 8 == 0:
            print("  ingest %d/%d  %.0fs" % (min(start + 512, len(texts)), len(texts),
                                             time.time() - t0), flush=True)
    ingest_seconds = time.time() - t0

    zero = np.zeros(embedder.dims, dtype=np.float32)
    sids = [s for s, _ in ordered]
    full_mat = unit(np.array(
        [cache.get(hashlib.sha256(t.encode()).hexdigest(), zero) for t in texts],
        dtype=np.float32))

    # Question embeddings once; per-prefix latency measures the dot+sort only,
    # with the measured single-question embed cost reported beside it.
    tq = time.time()
    qvecs = unit(embedder.embed([i["question"] for i in instances]))
    embed_query_ms_mean = round((time.time() - tq) * 1000.0 / len(instances), 3)

    for size in sizes:
        mat = full_mat[:size]
        ranked, failures, latencies = {}, {}, {}
        t1 = time.time()
        for inst, qv in zip(instances, qvecs):
            q0 = time.perf_counter()
            if not np.any(qv):
                failures[inst["qid"]] = "question embedding empty"
                ranked[inst["qid"]] = []
                latencies[inst["qid"]] = 0.0
                continue
            order = np.argsort(-(mat @ qv))[:100]
            ranked[inst["qid"]] = [sids[j] for j in order]
            latencies[inst["qid"]] = round((time.perf_counter() - q0) * 1000.0, 3)
        query_seconds = time.time() - t1

        lat = sorted(latencies.values())

        def pct(p):
            return round(lat[min(len(lat) - 1, int(len(lat) * p))], 2) if lat else 0.0

        result = common.score(instances, ranked, failures)
        meta = {
            "condition": "pooled",
            "approach": "verbatim RAG control: one vector per whole session, exact "
                        "brute-force cosine over the pooled store prefix, no ANN, "
                        "no reranker, no chunking",
            "store_sessions": size,
            "distinct_sessions_total": total,
            "gold_sessions_first": n_gold,
            "embed_model": embedder.model_id if args.arm == "fastembed" else embedder.model,
            "embed_dims": int(embedder.dims),
            "llm_calls": 0,
            "embed_api_calls": embedder.api_calls,
            "unique_texts_embedded": unique_embedded + len(instances),
            "empty_session_texts": empty_sessions,
            "failed_embedding_batches": embedder.failed_batches,
            "truncation_rule": "identical to control.py: text[:%d] chars, then "
                               "model-internal truncation" % TRUNC_CHARS,
            "similarity": "cosine on L2-normalised float32 vectors (numpy dot)",
            "query_concurrency": 1,
            "query_latency_includes_embedding": False,
            "query_embed_ms_mean": embed_query_ms_mean,
            "query_ms": {"p50": pct(0.50), "p95": pct(0.95), "p99": pct(0.99)},
            "ingest_seconds": round(ingest_seconds, 1),
            "query_seconds": round(query_seconds, 2),
            "python": sys.version.split()[0],
            "numpy": np.__version__,
            "host": "benchmark-host",
        }
        print(json.dumps({k: v for k, v in result.items() if k != "by_type"}, indent=2), flush=True)
        print("size", size, "latency", meta["query_ms"], flush=True)

        base = os.path.join(RESULTS, "control-{}-{}-{}".format(args.arm, args.tag, size))
        common.emit(base + ".json", "control", args.arm, result, meta)
        with open(base + ".ranked.json", "w") as fh:
            json.dump({"lane": "control", "arm": args.arm, "condition": "pooled",
                       "store_sessions": size, "ranked": ranked,
                       "failures": failures, "latency_ms": latencies}, fh, indent=2)
        print("wrote", base + ".json", flush=True)


if __name__ == "__main__":
    main()
