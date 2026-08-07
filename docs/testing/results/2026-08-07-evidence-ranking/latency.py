"""Compile latency for one build, serial, over a fixed instance list.

Kill criterion 3 in the pre-registration says the signal does not ship if it
costs measurable latency without a significant recall gain. The recall gain is
zero, so the cost has to be measured rather than argued.

`top_k` is the parameter that matters: the sources query moved from the packed
top-k to the whole candidate set, so a caller asking for a small pack out of a
large candidate set is the worst case and is measured directly.

usage: latency.py --port N --key-file PATH --top-k K [--repeats R] [--n N]
"""
import argparse, json, os, statistics, sys, time

sys.path.insert(0, os.path.expanduser("~/titen-bench-20260804/harness"))
sys.path.insert(0, os.path.expanduser("~/titen-bench-20260804/harness/titen-lane"))
import common
import tclient


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, required=True)
    ap.add_argument("--key-file", required=True)
    ap.add_argument("--top-k", type=int, default=5)
    ap.add_argument("--max-candidates", type=int, default=200)
    ap.add_argument("--repeats", type=int, default=3)
    ap.add_argument("--n", type=int, default=100)
    ap.add_argument("--label", default="")
    args = ap.parse_args()

    with open(os.path.expanduser(args.key_file)) as fh:
        key = next(l[len("api_key: "):].strip() for l in fh if l.startswith("api_key: "))
    client = tclient.Client("127.0.0.1", args.port, key)
    # A fixed prefix of the corpus order, so both builds see the same queries in
    # the same sequence.
    instances = common.load()[: args.n]

    # Warm the page cache and the prepared statements before anything is timed.
    for inst in instances[:20]:
        client.post("/v1/context/compile", {
            "subject_id": inst["qid"], "task": tclient.clean(inst["question"])[:4000],
            "max_tokens": 8000, "max_candidates": args.max_candidates, "top_k": args.top_k})

    samples = []
    for _ in range(args.repeats):
        for inst in instances:
            body = {"subject_id": inst["qid"], "task": tclient.clean(inst["question"])[:4000],
                    "max_tokens": 8000, "max_candidates": args.max_candidates,
                    "top_k": args.top_k}
            start = time.perf_counter()
            status, _ = client.post("/v1/context/compile", body)
            samples.append((time.perf_counter() - start) * 1000.0)
            if status != 200:
                raise SystemExit("compile %s" % status)

    samples.sort()
    out = {
        "label": args.label, "top_k": args.top_k, "max_candidates": args.max_candidates,
        "samples": len(samples),
        "p50_ms": round(samples[len(samples) // 2], 2),
        "p95_ms": round(samples[int(len(samples) * 0.95)], 2),
        "p99_ms": round(samples[int(len(samples) * 0.99)], 2),
        "mean_ms": round(statistics.fmean(samples), 2),
    }
    print(json.dumps(out))


if __name__ == "__main__":
    main()
