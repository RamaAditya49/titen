"""MemPalace published-benchmark shape, pooled-store condition.

Same shape as repro_mempalace.py — bare chromadb, one document per session
built from USER TURNS ONLY, default MiniLM embeddings, ranked by vector
distance; no drawers, no BM25, no mempalace import (their own
benchmarks/longmemeval_bench.py raw mode) — but over ONE collection holding
every distinct pooled session instead of a per-instance ephemeral collection.

Documents are embedded once through the collection's own default embedding
function and added with precomputed embeddings per store prefix, so every
prefix ranks from byte-identical vectors. Queries still embed through the
same function via query_texts, exactly as the per-instance lane did.
"""
import argparse, json, os, sys, time

sys.path.insert(0, "/home/ramaaditya/titen-bench-20260804/harness")
sys.path.insert(0, "/home/ramaaditya/titen-bench-20260804/harness/titen-lane")
import common
from pooled_common import pooled_sessions

sys.path.insert(0, os.path.expanduser("~/titen-bench-20260804/lanes/mempalace"))
from run_mempalace import dedup  # noqa: E402

RESULTS = os.path.expanduser("~/titen-bench-20260804/results")
FIXTURE = os.path.expanduser("~/titen-bench-20260804/fixtures/longmemeval_s")


def user_only_pool():
    """sid -> user-turns-only text for every distinct session, first-seen."""
    with open(FIXTURE) as fh:
        raw = json.load(fh)
    out = {}
    for inst in raw:
        for sid, sess in zip(inst["haystack_session_ids"], inst["haystack_sessions"]):
            if sid in out:
                continue
            turns = [t["content"] for t in sess if t.get("role") == "user"]
            if turns:
                out[sid] = "\n".join(turns)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sessions", type=int, default=0, help="store prefix; 0 = full pool")
    ap.add_argument("--tag", required=True)
    ap.add_argument("--n-results", type=int, default=100)
    args = ap.parse_args()

    import chromadb
    from chromadb.utils import embedding_functions

    instances, ordered, n_gold = pooled_sessions()
    total = len(ordered)
    if args.sessions:
        if args.sessions < n_gold:
            raise SystemExit("ABORT: prefix %d smaller than gold set %d" % (args.sessions, n_gold))
        ordered = ordered[: args.sessions]

    user_texts = user_only_pool()
    docs = [(sid, user_texts[sid]) for sid, _ in ordered if sid in user_texts]
    dropped = len(ordered) - len(docs)
    print("pooled store: %d/%d sessions (gold-first %d, %d without user turns)"
          % (len(docs), total, n_gold, dropped), flush=True)

    ef = embedding_functions.DefaultEmbeddingFunction()
    t0 = time.time()
    embeds = []
    for start in range(0, len(docs), 256):
        embeds.extend(ef([d for _, d in docs[start:start + 256]]))
        if (start // 256) % 8 == 0:
            print("  embedded %d/%d  %.0fs" % (min(start + 256, len(docs)), len(docs),
                                               time.time() - t0), flush=True)
    embed_seconds = time.time() - t0

    client = chromadb.EphemeralClient()
    col = client.create_collection("pooled", embedding_function=ef)
    t1 = time.time()
    for start in range(0, len(docs), 1000):
        chunk = docs[start:start + 1000]
        col.add(
            documents=[d for _, d in chunk],
            embeddings=embeds[start:start + 1000],
            ids=["doc_%d" % i for i in range(start, start + len(chunk))],
            metadatas=[{"corpus_id": sid} for sid, _ in chunk],
        )
    add_seconds = time.time() - t1
    print("ingest: embed %.0fs + add %.0fs" % (embed_seconds, add_seconds), flush=True)

    ranked, failures, latencies = {}, {}, {}
    t2 = time.time()
    for idx, inst in enumerate(instances, 1):
        qid = inst["qid"]
        try:
            q0 = time.perf_counter()
            res = col.query(
                query_texts=[inst["question"]],
                n_results=min(args.n_results, len(docs)),
                include=["distances", "metadatas"],
            )
            latencies[qid] = round((time.perf_counter() - q0) * 1000.0, 3)
            ranked[qid] = dedup(m.get("corpus_id") for m in res["metadatas"][0])
        except Exception as exc:  # noqa: BLE001
            failures[qid] = "%s: %s" % (type(exc).__name__, exc)
            ranked[qid] = []
            latencies[qid] = 0.0
        if idx % 100 == 0:
            print("  queried %d/%d  %.0fs" % (idx, len(instances), time.time() - t2), flush=True)
    query_seconds = time.time() - t2

    lat = sorted(latencies.values())

    def pct(p):
        return round(lat[min(len(lat) - 1, int(len(lat) * p))], 2) if lat else 0.0

    result = common.score(instances, ranked, failures)
    meta = {
        "condition": "pooled",
        "approach": "MemPalace published-benchmark raw shape: bare chromadb, "
                    "user-turns-only documents, default MiniLM embeddings, vector "
                    "distance ranking; NOT the mempalace product path",
        "store_sessions": len(docs),
        "sessions_without_user_turns": dropped,
        "distinct_sessions_total": total,
        "gold_sessions_first": n_gold,
        "embed_model": "chromadb DefaultEmbeddingFunction (all-MiniLM-L6-v2 ONNX)",
        "llm_calls": 0,
        "embed_api_calls": 0,
        "ingest_seconds": round(embed_seconds + add_seconds, 1),
        "embed_seconds": round(embed_seconds, 1),
        "query_seconds": round(query_seconds, 2),
        "query_concurrency": 1,
        "query_latency_includes_embedding": True,
        "query_ms": {"p50": pct(0.50), "p95": pct(0.95), "p99": pct(0.99)},
        "n_results": args.n_results,
        "host": "rama-tuf",
    }
    print(json.dumps({k: v for k, v in result.items() if k != "by_type"}, indent=2), flush=True)
    print("latency", meta["query_ms"], flush=True)

    base = os.path.join(RESULTS, "mempalace-%s" % args.tag)
    common.emit(base + ".json", "mempalace", "useronly-minilm", result, meta)
    with open(base + ".ranked.json", "w") as fh:
        json.dump({"lane": "mempalace", "arm": "useronly-minilm", "condition": "pooled",
                   "ranked": ranked, "failures": failures, "latency_ms": latencies}, fh, indent=2)
    print("wrote", base + ".json", flush=True)


if __name__ == "__main__":
    main()
