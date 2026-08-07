"""How much of the ranking is decided by the arbitrary tie-break?

An evidence tie-break can only ever change an answer where the weighted score
already ties, so the headroom is not a matter of opinion: it is the number of
instances whose rank-1 claim shares its score with a claim from a different
session. Measured, not argued.

usage: tie_probe.py --port N --key-file PATH [--workers N]
"""
import argparse, collections, json, os, sys
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, os.path.expanduser("~/titen-bench-20260804/harness"))
sys.path.insert(0, os.path.expanduser("~/titen-bench-20260804/harness/titen-lane"))
import common
import tclient


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, required=True)
    ap.add_argument("--key-file", required=True)
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--out", default=os.path.expanduser(
        "~/titen-evidence-rank/bench/results/tie-probe.json"))
    args = ap.parse_args()

    with open(os.path.expanduser(args.key_file)) as fh:
        key = next(l[len("api_key: "):].strip() for l in fh if l.startswith("api_key: "))
    client = tclient.Client("127.0.0.1", args.port, key)
    instances = common.load()

    def probe(inst):
        status, body = client.post("/v1/context/compile", {
            "subject_id": inst["qid"],
            "task": tclient.clean(inst["question"])[:4000],
            "max_tokens": 32000, "max_candidates": 1000, "top_k": 1000,
        })
        if status != 200:
            raise RuntimeError("compile %s" % status)
        items = body["data"]["items"]
        if not items:
            return inst["qid"], None
        top = items[0]["score"]
        tied = [i for i in items if i["score"] == top]
        sessions = {i["observer_id"] for i in tied}
        gold_in_tie = bool(sessions & inst["gold"])
        return inst["qid"], {
            "qtype": inst["qtype"],
            "top_score": top,
            "tied_claims": len(tied),
            "tied_sessions": len(sessions),
            "gold_in_tie": gold_in_tie,
            "rank1_is_gold": items[0]["observer_id"] in inst["gold"],
            "distinct_scores": len({i["score"] for i in items}),
            "items": len(items),
        }

    out = {}
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        for qid, info in pool.map(probe, instances):
            if info:
                out[qid] = info

    contested = [v for v in out.values() if v["tied_sessions"] > 1]
    winnable = [v for v in contested if v["gold_in_tie"] and not v["rank1_is_gold"]]
    losable = [v for v in contested if v["rank1_is_gold"]]
    by_type = collections.Counter(v["qtype"] for v in contested)
    summary = {
        "instances": len(out),
        "rank1_tie_across_sessions": len(contested),
        "tie_contains_gold_but_rank1_is_not_gold": len(winnable),
        "rank1_is_gold_and_contested": len(losable),
        "contested_by_type": dict(by_type),
        "top_scores_observed": sorted({round(v["top_score"], 6) for v in out.values()}),
    }
    print(json.dumps(summary, indent=2))
    with open(args.out, "w") as fh:
        json.dump({"summary": summary, "per_instance": out}, fh, indent=2)
    print("wrote", args.out)


if __name__ == "__main__":
    main()
