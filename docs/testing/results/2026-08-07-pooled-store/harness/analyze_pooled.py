"""Post-run analysis for the pooled-store measurement: paired sign tests,
curve assembly, k-saturation re-check, and the falsifier verdicts.

Reads only committed artifacts under results/; writes one summary JSON whose
numbers the report quotes verbatim.
"""
import json, os, sys

sys.path.insert(0, "/home/ramaaditya/titen-bench-20260804/harness")
sys.path.insert(0, "/home/ramaaditya/titen-bench-20260804/harness/titen-lane")
import common

RESULTS = os.path.expanduser("~/titen-bench-20260804/results")


def ranked(path):
    """Both artifact generations: wrapped {"ranked": {...}} and bare qid->list."""
    with open(os.path.join(RESULTS, path)) as fh:
        d = json.load(fh)
    return d["ranked"] if "ranked" in d else d


def summary(path):
    with open(os.path.join(RESULTS, path)) as fh:
        return json.load(fh)


def main():
    instances = common.load()

    lanes = {
        "titen_anchor": "titen-fts-anchor-20260807",
        "titen_pooled_1000": "titen-fts-pooled-1000-20260807",
        "titen_pooled_5000": "titen-fts-pooled-5000-20260807",
        "titen_pooled_10000": "titen-fts-pooled-10000-20260807",
        "titen_pooled_19829": "titen-fts-pooled-19829-20260807",
        "control_published": "control-fastembed-500",
        "control_pooled_1000": "control-fastembed-pooled-20260807-1000",
        "control_pooled_5000": "control-fastembed-pooled-20260807-5000",
        "control_pooled_10000": "control-fastembed-pooled-20260807-10000",
        "control_pooled_19829": "control-fastembed-pooled-20260807-19829",
        "mempalace_published": "mempalace-vendorrepro-useronly-minilm-500",
        "mempalace_pooled_19829": "mempalace-pooled-19829-20260807",
        "control_router_published": "control-router-500",
        "control_router_pooled_19829": "control-router-pooled-20260807-19829",
        "titen_router_pooled_19829": "titen-router-pooled-19829-20260807",
        "mem0_pooled_19829": "mem0-infer-false-pooled-19829-20260807",
    }

    out = {"scores": {}, "latency": {}, "sign_tests": {}, "k_spread": {},
           "missing": []}
    ranks = {}
    for key, base in lanes.items():
        try:
            s = summary(base + ".json")
            out["scores"][key] = {k: s.get(k) for k in
                                  ("n", "recall_at_1", "recall_at_5", "recall_at_10",
                                   "mrr_at_10", "failures")}
            meta = s.get("meta", {})
            for lk in ("compile_ms", "query_ms"):
                if meta.get(lk):
                    out["latency"][key] = meta[lk]
            for ck in ("ingest_seconds", "query_seconds", "embed_calls",
                       "embed_api_calls", "store_sessions", "claims_written"):
                if meta.get(ck) is not None:
                    out["scores"][key][ck] = meta[ck]
            ranks[key] = ranked(base + ".ranked.json")
        except FileNotFoundError:
            out["missing"].append(key)

    pairs = [
        ("titen_pooled_vs_anchor", "titen_pooled_19829", "titen_anchor"),
        ("control_pooled_vs_published", "control_pooled_19829", "control_published"),
        ("mempalace_pooled_vs_published", "mempalace_pooled_19829", "mempalace_published"),
        ("titen_vs_control_pooled", "titen_pooled_19829", "control_pooled_19829"),
        ("titen_vs_mempalace_pooled", "titen_pooled_19829", "mempalace_pooled_19829"),
        ("control_vs_mempalace_pooled", "control_pooled_19829", "mempalace_pooled_19829"),
        ("ctrl_router_pooled_vs_published", "control_router_pooled_19829", "control_router_published"),
        ("titen_fts_vs_ctrl_router_pooled", "titen_pooled_19829", "control_router_pooled_19829"),
        ("titen_router_vs_titen_fts_pooled", "titen_router_pooled_19829", "titen_pooled_19829"),
        ("titen_router_vs_ctrl_router_pooled", "titen_router_pooled_19829", "control_router_pooled_19829"),
        ("mem0_vs_ctrl_router_pooled", "mem0_pooled_19829", "control_router_pooled_19829"),
        ("mem0_vs_titen_fts_pooled", "mem0_pooled_19829", "titen_pooled_19829"),
        ("mem0_vs_titen_router_pooled", "mem0_pooled_19829", "titen_router_pooled_19829"),
    ]
    for name, a, b in pairs:
        if a in ranks and b in ranks:
            out["sign_tests"][name] = common.sign_test(instances, ranks[a], ranks[b], k=1)

    # k-saturation re-check at the full pool across serious lanes present.
    serious = [k for k in ("titen_pooled_19829", "titen_router_pooled_19829",
                           "control_pooled_19829", "control_router_pooled_19829",
                           "mempalace_pooled_19829", "mem0_pooled_19829")
               if k in out["scores"]]
    for kk in ("recall_at_1", "recall_at_5", "recall_at_10"):
        vals = [out["scores"][s][kk] for s in serious if out["scores"][s].get(kk) is not None]
        if vals:
            out["k_spread"][kk] = round((max(vals) - min(vals)) * 100, 1)

    # Falsifier verdicts, mechanical where mechanical.
    v = {}
    sc = out["scores"]
    if "titen_anchor" in sc:
        v["1_anchor_gate"] = "PASS" if abs(sc["titen_anchor"]["recall_at_1"] - 0.880) <= 0.002 else "FAIL"
    taxes = {}
    for lane, pooled, pub in (("titen", "titen_pooled_19829", "titen_anchor"),
                              ("control", "control_pooled_19829", "control_published"),
                              ("mempalace", "mempalace_pooled_19829", "mempalace_published"),
                              ("control_router", "control_router_pooled_19829", "control_router_published")):
        if pooled in sc and pub in sc:
            taxes[lane] = round((sc[pub]["recall_at_1"] - sc[pooled]["recall_at_1"]) * 100, 1)
    v["taxes_points_lost"] = taxes
    if taxes:
        v["2_axis_existence"] = ("AXIS EXISTS (some serious lane loses >= 2 points)"
                                 if any(t >= 2.0 for t in taxes.values())
                                 else "FIRED: no serious lane loses >= 2 points")
    if "titen_pooled_19829" in sc and "control_pooled_19829" in sc:
        gap = (sc["control_pooled_19829"]["recall_at_1"] - sc["titen_pooled_19829"]["recall_at_1"]) * 100
        v["3_frontier_floor_gap_points"] = round(gap, 1)
        v["3_frontier"] = "FIRED: >10 points below best zero-LLM control" if gap > 10 else "HOLDS on the floor test"
    lat = out["latency"].get("titen_pooled_19829", {})
    if lat:
        v["5_latency_p95_ms"] = lat.get("p95")
        v["5_latency"] = "FIRED: p95 > 250 ms" if (lat.get("p95") or 0) > 250 else "HOLDS"
    out["falsifiers"] = v

    path = os.path.join(RESULTS, "pooled-20260807-analysis.json")
    with open(path, "w") as fh:
        json.dump(out, fh, indent=2)
    print(json.dumps(out, indent=2))
    print("wrote", path)


if __name__ == "__main__":
    main()
