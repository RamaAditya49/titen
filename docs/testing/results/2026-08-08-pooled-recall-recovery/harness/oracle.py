"""R1 oracle bounds: recall@1 if a perfect re-ranker acted over window W.

Reads only the stored ranked artifacts and the shared fixture. No cell is
scored here; these are reachability bounds, not outcomes.
"""
import json, os, sys
sys.path.insert(0, os.path.expanduser("~/titen-bench-20260804/harness"))
import common

RES = os.path.expanduser("~/titen-bench-20260804/results")
POOLED = os.path.join(RES, "titen-fts-pooled-19829-20260807.ranked.json")
ANCHOR = os.path.join(RES, "titen-fts-anchor-20260807.ranked.json")
OUT = os.path.expanduser("~/titen-bench-20260808r/results/r1-oracle.json")

instances = common.load()


def bounds(path):
    art = json.load(open(path))
    ranked = art["ranked"]
    base = common.score(instances, ranked, art["failures"])
    out = {"baseline": base, "windows": {}, "pack_sessions": {}}
    lens = sorted(len(ranked.get(i["qid"]) or []) for i in instances)
    out["pack_sessions"] = {
        "min": lens[0], "p25": lens[len(lens) // 4], "median": lens[len(lens) // 2],
        "p75": lens[3 * len(lens) // 4], "max": lens[-1],
    }
    for w in (1, 5, 10, 20, 50, 100, 10 ** 9):
        hit = 0
        for inst in instances:
            order = (ranked.get(inst["qid"]) or [])[:w]
            if any(s in inst["gold"] for s in order):
                hit += 1
        out["windows"]["pack" if w > 10 ** 8 else str(w)] = round(hit / len(instances), 4)
    return out


payload = {
    "spec": "2026-08-08-pooled-recall-recovery",
    "phase": "R1 oracle",
    "note": "recall@1 an omniscient re-ranker could reach over the first W distinct "
            "sessions of the shipped order; reachability bound, not an outcome",
    "n": len(instances),
    "pooled": bounds(POOLED),
    "anchor": bounds(ANCHOR),
}
json.dump(payload, open(OUT, "w"), indent=2)
print(json.dumps({
    "pooled_baseline_r1": payload["pooled"]["baseline"]["recall_at_1"],
    "pooled_windows": payload["pooled"]["windows"],
    "pooled_pack_sessions": payload["pooled"]["pack_sessions"],
    "anchor_baseline_r1": payload["anchor"]["baseline"]["recall_at_1"],
    "anchor_windows": payload["anchor"]["windows"],
}, indent=2))
