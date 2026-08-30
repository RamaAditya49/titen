"""Contamination audit, pre-registered: sample rank-1 misses whose top-1 is a
cross-instance session, check answer containment, publish the raw sample.

Mechanical containment (lowercased answer string in the retrieved session
text), so a third party can re-judge from the published sample without
trusting us. The bias direction is disclosed in the report.
"""
import hashlib, json, os, sys

sys.path.insert(0, "/srv/titen-workspace/titen-bench-20260804/harness")
import common

RESULTS = os.path.expanduser("~/titen-bench-20260804/results")
FIXTURE = os.path.expanduser("~/titen-bench-20260804/fixtures/longmemeval_s")
SEED = 20260804
SAMPLE = 50


def main():
    lane = sys.argv[1] if len(sys.argv) > 1 else "titen-fts-pooled-19829-20260807"
    with open(os.path.join(RESULTS, lane + ".ranked.json")) as fh:
        ranked = json.load(fh)["ranked"]

    raw = json.load(open(FIXTURE))
    answers = {i["question_id"]: str(i.get("answer", "")) for i in raw}
    sid_text = {}
    for inst in raw:
        for sid, sess in zip(inst["haystack_session_ids"], inst["haystack_sessions"]):
            if sid not in sid_text:
                sid_text[sid] = "\n".join(
                    "{}: {}".format(t.get("role", ""), t.get("content", "")) for t in sess)

    instances = common.load()
    own = {i["qid"]: {s for s, _ in i["sessions"]} for i in instances}

    misses = []
    for inst in instances:
        top = (ranked.get(inst["qid"]) or [None])[0]
        if top and top not in inst["gold"]:
            misses.append({
                "qid": inst["qid"],
                "qtype": inst["qtype"],
                "top1": top,
                "cross_instance": top not in own[inst["qid"]],
            })
    cross = [m for m in misses if m["cross_instance"]]
    cross.sort(key=lambda m: hashlib.sha256(
        "{}|{}".format(SEED, m["qid"]).encode()).hexdigest())
    sample = cross[:SAMPLE]

    contained = 0
    for m in sample:
        ans = answers.get(m["qid"], "").strip().lower()
        text = sid_text.get(m["top1"], "").lower()
        m["answer_contained"] = bool(ans) and ans in text
        contained += m["answer_contained"]

    out = {
        "lane": lane,
        "rank1_misses": len(misses),
        "cross_instance_misses": len(cross),
        "own_haystack_misses": len(misses) - len(cross),
        "sample_n": len(sample),
        "answer_contained_in_top1": contained,
        "containment_fraction": round(contained / len(sample), 3) if sample else None,
        "note": "mechanical containment: lowercased fixture answer string in the "
                "retrieved session text; multi-part or paraphrased answers can "
                "read as false negatives, so this is a lower bound",
        "sample": sample,
    }
    path = os.path.join(RESULTS, lane + ".audit.json")
    with open(path, "w") as fh:
        json.dump(out, fh, indent=2)
    print(json.dumps({k: v for k, v in out.items() if k != "sample"}, indent=2))
    print("wrote", path)


if __name__ == "__main__":
    main()
