"""Paired analysis of the #291 authorization fix against its pre-fix baseline.

Both arms queried the same frozen store; the only difference is the commit under
`src/core/`. The prediction registered before the run was an exact tie, because
the corpus holds zero contradicting sources, so the interesting output here is
the count of instances that disagree — not the aggregate.

usage: analyze291.py [--out PATH]
"""
import argparse, hashlib, json, os, sys

sys.path.insert(0, os.path.expanduser("~/titen-bench-20260804/harness"))
import common

RESULTS = os.path.expanduser("~/titen-evidence-rank/bench/results")


def load_ranked(name):
    with open(os.path.join(RESULTS, name + ".ranked.json")) as fh:
        return json.load(fh)


def sha256(name):
    with open(os.path.join(RESULTS, name + ".ranked.json"), "rb") as fh:
        return hashlib.sha256(fh.read()).hexdigest()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(RESULTS, "analysis-291.json"))
    args = ap.parse_args()

    instances = common.load()
    base, fix = load_ranked("titen-291-base"), load_ranked("titen-291-fix")
    base_r, fix_r = base["ranked"], fix["ranked"]

    scored = {
        "base": common.score(instances, base_r, base.get("failures")),
        "fix": common.score(instances, fix_r, fix.get("failures")),
    }
    # Order-sensitive, not just recall-sensitive: two rankings can score the same
    # and still differ, and on a corpus that cannot exercise the fix even one
    # differing instance is a defect rather than noise.
    differing = sorted(
        inst["qid"] for inst in instances
        if base_r.get(inst["qid"]) != fix_r.get(inst["qid"])
    )
    out = {
        "instances": len(instances),
        "ranked_sha256": {"base": sha256("titen-291-base"), "fix": sha256("titen-291-fix")},
        "ranked_identical": sha256("titen-291-base") == sha256("titen-291-fix"),
        "instances_with_a_different_ranked_list": len(differing),
        "differing_qids": differing[:20],
        "recall_at_1": {"base": scored["base"]["recall_at_1"], "fix": scored["fix"]["recall_at_1"]},
        "mrr_at_10": {"base": scored["base"]["mrr_at_10"], "fix": scored["fix"]["mrr_at_10"]},
        "recall_at_5_saturated": {"base": scored["base"]["recall_at_5"], "fix": scored["fix"]["recall_at_5"]},
        "recall_at_10_saturated": {"base": scored["base"]["recall_at_10"], "fix": scored["fix"]["recall_at_10"]},
        "failures": {"base": scored["base"]["failures"], "fix": scored["fix"]["failures"]},
        "sign_test_recall_at_1": common.sign_test(instances, base_r, fix_r, k=1),
        "sign_test_recall_at_10": common.sign_test(instances, base_r, fix_r, k=10),
        "by_type": {
            qtype: {
                "n": scored["base"]["by_type"][qtype]["n"],
                "base_recall_at_1": scored["base"]["by_type"][qtype]["recall_at_1"],
                "fix_recall_at_1": scored["fix"]["by_type"][qtype]["recall_at_1"],
            }
            for qtype in sorted(scored["base"]["by_type"])
        },
    }
    print(json.dumps(out, indent=2))
    with open(args.out, "w") as fh:
        json.dump(out, fh, indent=2)
    print("wrote", args.out)


if __name__ == "__main__":
    main()
