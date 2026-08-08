"""Capture the ranked candidate list a compile produces, with exact item costs.

Two modes, both against a served store copy:

  --max-tokens 32000    the shipped pack, used to reproduce the published
                        baseline and to license the offline packer simulator
  --max-tokens <large>  the pre-pack ranked order, available only from the
                        instrument build whose LIMITS.maxTokens is raised

Per-item token cost is not recomputed from a re-serialized dict. The server
sends `JSON.stringify(body)` with no indentation, so each item's slice of the
raw response body IS `JSON.stringify(item)` byte for byte, which is exactly what
`estimateJsonTokens` measures. Taking the slice sidesteps every place JavaScript
and Python format the same float differently.
"""
import argparse, hashlib, http.client, json, os, sys, time

sys.path.insert(0, os.path.expanduser("~/titen-bench-20260804/harness"))
sys.path.insert(0, os.path.expanduser("~/titen-bench-20260804/harness/titen-lane"))
import common
from tclient import clean

DECODER = json.JSONDecoder()


def estimate_tokens(text):
    """Mirrors src/core/tokens.ts: ceil(utf8 byte length / 3)."""
    return -(-len(text.encode("utf-8")) // 3)


def item_spans(raw):
    """Exact `JSON.stringify(item)` substrings for every element of data.items."""
    marker = '"items":['
    start = raw.index(marker) + len(marker)
    out, idx = [], start
    if raw[idx] == "]":
        return out
    while True:
        value, end = DECODER.raw_decode(raw, idx)
        out.append((value, raw[idx:end]))
        if raw[end] == "]":
            return out
        idx = end + 1


def compile_once(conn, key, subject, task, max_tokens):
    body = json.dumps({
        "subject_id": subject,
        "task": clean(task)[:4000],
        "max_tokens": max_tokens,
        "max_candidates": 1000,
        "top_k": 1000,
    }).encode()
    t0 = time.perf_counter()
    conn.request("POST", "/v1/context/compile", body, {
        "authorization": "Bearer " + key, "content-type": "application/json"})
    res = conn.getresponse()
    raw = res.read().decode("utf-8")
    ms = (time.perf_counter() - t0) * 1000.0
    if res.status != 200:
        raise RuntimeError("compile %s %s" % (res.status, raw[:300]))
    return raw, ms


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, required=True)
    ap.add_argument("--key", required=True)
    ap.add_argument("--condition", required=True, choices=("pooled", "anchor"))
    ap.add_argument("--max-tokens", type=int, required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    instances = common.load()
    conn = http.client.HTTPConnection("127.0.0.1", args.port, timeout=900)

    captured, ranked, failures, latencies = {}, {}, {}, {}
    t0 = time.time()
    for idx, inst in enumerate(instances, 1):
        subject = "pooled-v1" if args.condition == "pooled" else inst["qid"]
        try:
            raw, ms = compile_once(conn, args.key, subject, inst["question"], args.max_tokens)
        except Exception as error:
            conn.close()
            conn = http.client.HTTPConnection("127.0.0.1", args.port, timeout=900)
            raw, ms = compile_once(conn, args.key, subject, inst["question"], args.max_tokens)
        body = json.loads(raw)
        rows, order, seen = [], [], set()
        for item, text in item_spans(raw):
            sid = item.get("observer_id")
            # The dedupe key is the statement; only equality matters, so it is
            # stored as a digest to keep the instrument capture a readable size.
            rows.append([item["claim_id"], sid, estimate_tokens(text), item["kind"],
                         item["status"],
                         hashlib.sha1(item["claim"].encode()).hexdigest()[:20]
                         if item["status"] == "active" else None])
            if sid and sid not in seen:
                seen.add(sid)
                order.append(sid)
        captured[inst["qid"]] = rows
        ranked[inst["qid"]] = order
        latencies[inst["qid"]] = round(ms, 3)
        if not order:
            failures[inst["qid"]] = "empty pack"
        if idx % 100 == 0:
            print("captured %d/%d %.0fs" % (idx, len(instances), time.time() - t0), flush=True)

    result = common.score(instances, ranked, failures)
    lat = sorted(latencies.values())

    def pct(p):
        return round(lat[min(len(lat) - 1, int(len(lat) * p))], 2) if lat else 0.0

    payload = {
        "spec": "2026-08-08-pooled-recall-recovery",
        "condition": args.condition,
        "max_tokens": args.max_tokens,
        "instrument": args.max_tokens > 32000,
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "compile": {"max_tokens": args.max_tokens, "max_candidates": 1000, "top_k": 1000},
        "query_concurrency": 1,
        "compile_ms": {"p50": pct(0.50), "p95": pct(0.95), "p99": pct(0.99)},
        "score": result,
        "failures": failures,
        "row_schema": ["claim_id", "observer_id", "tokens", "kind", "status", "dedupe_key"],
        "items": captured,
        "ranked": ranked,
        "latency_ms": latencies,
    }
    with open(args.out, "w") as fh:
        json.dump(payload, fh)
    print(json.dumps({k: v for k, v in result.items() if k != "by_type"}, indent=2), flush=True)
    print("latency", payload["compile_ms"], flush=True)
    print("wrote", args.out, flush=True)


if __name__ == "__main__":
    main()
