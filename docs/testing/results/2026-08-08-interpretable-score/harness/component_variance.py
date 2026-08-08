"""How much of `score` can move on this corpus at all.

AC-INT-003 came back with recall identical to the last instance in both
conditions, and a null that clean has to be explained before it is published.

`scoreCandidate` blends six components. Relevance is a strictly monotone
function of `-bm25` under BOTH the old min-max and the new saturating
transform, so the two builds can only rank differently where some OTHER
component varies between candidates and the change in relevance SPACING
flips the blend. This script measures how many distinct non-relevance
component tuples the served packs actually contain.

If the answer is 1, the identical recall is arithmetic, not evidence, and the
report has to say so.
"""
import argparse, json, os, sys

HARNESS = os.path.expanduser("~/titen-bench-20260804/harness")
sys.path.insert(0, HARNESS)
sys.path.insert(0, os.path.join(HARNESS, "titen-lane"))
import common
import tclient

FIELDS = ("trust", "recency", "utility", "conflict", "confidence")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--condition", required=True, choices=["anchor", "pooled"])
    ap.add_argument("--port", type=int, required=True)
    ap.add_argument("--key", required=True)
    ap.add_argument("--at", required=True)
    ap.add_argument("--build", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    client = tclient.Client("127.0.0.1", args.port, args.key)
    instances = common.load()
    tuples = {}
    packs_with_variance = []
    monotone_violations = []
    for inst in instances:
        subject = inst["qid"] if args.condition == "anchor" else "pooled-v1"
        status, body = client.post("/v1/context/compile", {
            "subject_id": subject, "task": tclient.clean(inst["question"])[:4000],
            "at": args.at, "max_tokens": 32000, "max_candidates": 1000, "top_k": 1000,
        })
        if status != 200:
            raise SystemExit("compile %s for %s" % (status, inst["qid"]))
        items = body["data"]["items"]
        local = set()
        for item in items:
            comp = item["score_components"]
            key = tuple(comp[f] for f in FIELDS)
            local.add(key)
            tuples[key] = tuples.get(key, 0) + 1
        if len(local) > 1:
            packs_with_variance.append(inst["qid"])
        # Relevance must be non-increasing down the pack, or `score` is not a
        # monotone function of relevance here and the derivation above is wrong.
        rel = [item["score_components"]["relevance"] for item in items]
        if any(a < b for a, b in zip(rel, rel[1:])):
            monotone_violations.append(inst["qid"])

    out = {
        "condition": args.condition,
        "build": args.build,
        "at_pinned": args.at,
        "questions": len(instances),
        "distinct_non_relevance_tuples": len(tuples),
        "tuples": [{"fields": FIELDS, "value": list(k), "items": v}
                   for k, v in sorted(tuples.items(), key=lambda kv: -kv[1])],
        "packs_with_internal_variance": len(packs_with_variance),
        "packs_with_internal_variance_qids": packs_with_variance[:20],
        "packs_where_relevance_is_not_monotone_down_the_pack": len(monotone_violations),
    }
    with open(args.out, "w") as fh:
        json.dump(out, fh, indent=2)
    print(json.dumps({k: v for k, v in out.items() if k != "tuples"}, indent=2))
    print("tuples:", json.dumps(out["tuples"], indent=2))


if __name__ == "__main__":
    main()
