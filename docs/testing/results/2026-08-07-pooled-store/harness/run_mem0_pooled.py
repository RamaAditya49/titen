"""Mem0 OSS 2.0.15 infer=False, pooled-store condition.

One logical store holding every distinct pooled session, sharded across N
in-process qdrant instances with one ingest thread per shard. qdrant's local
mode is an exact full scan, so merging per-shard hits by descending score is
byte-equivalent to a single exact store — sharding is a concurrency device,
not a retrieval change, and it exists because one in-RAM qdrant instance is
not safe under concurrent Memory.add. Everything else is byte-identical to
the scored per-instance infer=False lane: same embedder, same
one-memory-per-message add, same LLM tripwire, same session aggregation,
same scorer.
"""
import argparse, json, os, sys, threading, time, traceback
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, "/home/ramaaditya/titen-bench-20260804/competitors/mem0")
sys.path.insert(0, "/home/ramaaditya/titen-bench-20260804/harness")
sys.path.insert(0, "/home/ramaaditya/titen-bench-20260804/harness/titen-lane")
import mem0_lib as L
import common
from pooled_common import pooled_sessions

L.install_counters()

from mem0.llms.openai import OpenAILLM


def _no_llm(self, messages, **kw):
    raise AssertionError("LLM call attempted in an infer=False lane")


OpenAILLM.generate_response = _no_llm

from mem0 import Memory

BASE = "/home/ramaaditya/titen-bench-20260804"
SCRATCH = BASE + "/competitors/mem0/scratch/pooled"
RESULTS = BASE + "/results"
LOCK = threading.Lock()


def log(*a):
    with LOCK:
        print("[{}]".format(time.strftime("%H:%M:%S")), *a, flush=True)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--shards", type=int, default=12)
    p.add_argument("--top-k", type=int, default=500, help="message hits per shard")
    p.add_argument("--sessions", type=int, default=0, help="pool prefix; 0 = full")
    p.add_argument("--questions", type=int, default=0, help="0 = all 500")
    p.add_argument("--tag", required=True)
    p.add_argument("--smoke", action="store_true",
                   help="harness validation only: tiny store, never scored as a result")
    args = p.parse_args()

    instances, ordered, n_gold = pooled_sessions()
    if args.sessions:
        ordered = ordered[: args.sessions]
    if args.questions:
        instances = instances[: args.questions]
    log("pooled store: %d sessions (gold-first %d), %d questions, %d shards"
        % (len(ordered), n_gold, len(instances), args.shards))

    qids_all = {i["qid"] for i in common.load()}
    turns = L.raw_turns(qids_all)  # cached qid -> {sid: turns}; flatten to sid -> turns
    sid_turns = {}
    for per_qid in turns.values():
        for sid, t in per_qid.items():
            if sid not in sid_turns:
                sid_turns[sid] = t

    os.makedirs(SCRATCH, exist_ok=True)
    mems = []
    for s in range(args.shards):
        cfg = L.mem0_config("hay_pooled_%d" % s,
                            "%s/hist_%d_%s.db" % (SCRATCH, s, args.tag), 2000)
        mems.append(Memory.from_config(cfg))

    shard_sessions = [[] for _ in range(args.shards)]
    for idx, (sid, _) in enumerate(ordered):
        shard_sessions[idx % args.shards].append(sid)

    add_errors, add_retries, memories = [], [0], [0]
    t0 = time.time()

    def ingest_shard(s):
        m = mems[s]
        done = 0
        for sid in shard_sessions[s]:
            msgs = L.to_messages(sid_turns.get(sid) or [])
            if not msgs:
                continue
            for attempt in range(2):
                try:
                    r = m.add(messages=msgs, user_id="pooled",
                              metadata={"session_id": sid}, infer=False)
                    with LOCK:
                        memories[0] += len(r.get("results", []) if isinstance(r, dict) else r or [])
                    break
                except Exception as e:
                    if attempt == 0:
                        with LOCK:
                            add_retries[0] += 1
                        time.sleep(5)
                        continue
                    with LOCK:
                        add_errors.append({"session_id": sid, "error": repr(e)[:300]})
            done += 1
            if done % 200 == 0:
                log("shard %d: %d/%d sessions, %d memories total"
                    % (s, done, len(shard_sessions[s]), memories[0]))

    with ThreadPoolExecutor(max_workers=args.shards) as pool:
        list(pool.map(ingest_shard, range(args.shards)))
    ingest_seconds = time.time() - t0
    log("ingest done: %d memories, %d errors, %.0fs"
        % (memories[0], len(add_errors), ingest_seconds))
    if memories[0] == 0:
        raise SystemExit("ABORT: zero memories stored")

    ranked, failures, latencies = {}, {}, {}
    t1 = time.time()

    def search_shard(m, question):
        return m.search(question, top_k=args.top_k,
                        filters={"user_id": "pooled"}, threshold=0.0)["results"]

    for n, inst in enumerate(instances, 1):
        q0 = time.perf_counter()
        try:
            with ThreadPoolExecutor(max_workers=args.shards) as pool:
                per_shard = list(pool.map(lambda m: search_shard(m, inst["question"]), mems))
            hits = [h for hs in per_shard for h in hs]
            hits.sort(key=lambda h: -(h.get("score") or 0.0))
            seen, order = set(), []
            for h in hits:
                sid = (h.get("metadata") or {}).get("session_id")
                if sid and sid not in seen:
                    seen.add(sid)
                    order.append(sid)
                if len(order) >= 100:
                    break
            ranked[inst["qid"]] = order
            if not order:
                failures[inst["qid"]] = "empty: %d raw hits" % len(hits)
        except Exception as e:
            ranked[inst["qid"]] = []
            failures[inst["qid"]] = "search: " + repr(e)[:300]
        latencies[inst["qid"]] = round((time.perf_counter() - q0) * 1000.0, 3)
        if n % 50 == 0:
            log("searched %d/%d %.0fs" % (n, len(instances), time.time() - t1))
    query_seconds = time.time() - t1

    lat = sorted(latencies.values())

    def pct(pv):
        return round(lat[min(len(lat) - 1, int(len(lat) * pv))], 2) if lat else 0.0

    result = common.score(instances, ranked, failures)
    meta = {
        "condition": "pooled" + ("-SMOKE-NOT-A-RESULT" if args.smoke else ""),
        "package": "mem0ai==2.0.15 (PyPI, Apache-2.0), qdrant-client==1.18.0",
        "mode": "infer=False - NO LLM extraction; one memory per message",
        "store_sessions": len(ordered),
        "gold_sessions_first": n_gold,
        "shards": args.shards,
        "sharding": "concurrency device only: qdrant local mode is an exact full "
                    "scan, per-shard hits merged by descending score are "
                    "byte-equivalent to one exact store; one ingest thread per "
                    "shard because in-RAM qdrant is not concurrency-safe",
        "embedding_model": L.EMBED_MODEL,
        "embedding_dims": L.EMBED_DIMS,
        "llm_model": "NONE (tripwire raises; LLM base URL closed port)",
        "search": "Memory.search(top_k=%d per shard, threshold=0.0) x %d shards, "
                  "merged by score, dedup by metadata.session_id, cap 100 sessions"
                  % (args.top_k, args.shards),
        "query_concurrency": 1,
        "query_latency_includes_embedding": True,
        "query_ms": {"p50": pct(0.50), "p95": pct(0.95), "p99": pct(0.99)},
        "ingest_seconds_wall": round(ingest_seconds, 1),
        "query_seconds": round(query_seconds, 1),
        "llm_calls": L.COUNTER.llm,
        "embed_calls": L.COUNTER.embed,
        "memories_stored_total": memories[0],
        "add_errors_total": len(add_errors),
        "add_retries_total": add_retries[0],
        "telemetry": "MEM0_TELEMETRY=False",
        "bm25_hybrid": "DISABLED - fastembed not a base dependency, same as every "
                       "prior mem0 lane",
        "host": "rama-tuf",
    }
    print(json.dumps({k: v for k, v in result.items() if k != "by_type"}, indent=2), flush=True)
    log("latency", meta["query_ms"], "embed_calls", L.COUNTER.embed, "llm_calls", L.COUNTER.llm)

    base = os.path.join(RESULTS, "mem0-infer-false-%s" % args.tag)
    common.emit(base + ".json", "mem0-oss-2.0.15-infer-false", "pooled", result, meta)
    with open(base + ".ranked.json", "w") as fh:
        json.dump({"lane": "mem0-oss-2.0.15-infer-false", "arm": "pooled",
                   "condition": meta["condition"], "ranked": ranked,
                   "failures": failures, "latency_ms": latencies,
                   "add_errors": add_errors}, fh, indent=2)
    log("wrote", base + ".json")


if __name__ == "__main__":
    main()
