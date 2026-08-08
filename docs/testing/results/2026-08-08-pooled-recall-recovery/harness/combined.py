"""R4 combined cell: the E-PACK winner's pack, re-ranked over its whole depth.

Prereg: docs/testing/2026-08-08-pooled-recall-recovery-prereg.md.

E-PACK and E-DEEP only interact through the pack's depth. A wider pack does not
change the top-50 window — packing preserves rank order — so the combined cell
re-ranks over `W = pack`, where the extra sessions actually live. Same signal,
same aggregation, same tie-break as the E-DEEP arms; only the pack underneath
has changed.
"""
import argparse, json, os, statistics, sys, time

sys.path.insert(0, os.path.expanduser("~/titen-bench-20260804/harness"))
import common

RES04 = os.path.expanduser("~/titen-bench-20260804/results")
SHIPPED = {
    "pooled": os.path.join(RES04, "titen-fts-pooled-19829-20260807.ranked.json"),
    "anchor": os.path.join(RES04, "titen-fts-anchor-20260807.ranked.json"),
}


def pct(xs, p):
    xs = sorted(xs)
    return round(xs[min(len(xs) - 1, int(round(p * (len(xs) - 1))))], 1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pooled-pack", required=True, help="E-PACK winner ranked file, pooled")
    ap.add_argument("--anchor-pack", required=True, help="E-PACK winner ranked file, anchor")
    ap.add_argument("--variant", required=True, help="E-PACK variant label, e.g. P3")
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    from fastembed.rerank.cross_encoder import TextCrossEncoder
    model = "Xenova/ms-marco-MiniLM-L-6-v2"
    encoder = TextCrossEncoder(model)
    list(encoder.rerank("warmup question", ["warmup document"]))

    instances = common.load()
    sid_text = {}
    for inst in instances:
        for sid, text in inst["sessions"]:
            sid_text.setdefault(sid, text)
    percache = {}

    def per_inst(inst):
        if inst["qid"] not in percache:
            percache[inst["qid"]] = dict(inst["sessions"])
        return percache[inst["qid"]]

    out = {
        "spec": "2026-08-08-pooled-recall-recovery",
        "phase": "R4 combined",
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "model": model,
        "runtime": "fastembed 0.8.0 TextCrossEncoder, ONNX CPU, control venv, default threads",
        "pack_variant": args.variant,
        "window": "whole pack",
        "conditions": {},
    }

    for cond, path in (("pooled", args.pooled_pack), ("anchor", args.anchor_pack)):
        packed = json.load(open(path))["ranked"]
        shipped = json.load(open(SHIPPED[cond]))["ranked"]
        textmap = (lambda i: sid_text) if cond == "pooled" else per_inst
        reranked, lat, depth = {}, [], []
        for done, inst in enumerate(instances, 1):
            order = packed.get(inst["qid"]) or []
            depth.append(len(order))
            texts = textmap(inst)
            docs = [(texts.get(sid) or "")[:2000] for sid in order]
            if not docs:
                reranked[inst["qid"]] = order
                lat.append(0.0)
                continue
            t0 = time.perf_counter()
            scores = list(encoder.rerank(inst["question"], docs))
            lat.append((time.perf_counter() - t0) * 1000.0)
            idx = {sid: i for i, sid in enumerate(order)}
            reranked[inst["qid"]] = sorted(order, key=lambda s: (-scores[idx[s]], idx[s]))
            if done % 50 == 0:
                print("%s %d/%d" % (cond, done, len(instances)), flush=True)

        base = common.score(instances, shipped)
        pack_only = common.score(instances, packed)
        res = common.score(instances, reranked)
        out["conditions"][cond] = {
            "shipped_baseline": base,
            "pack_only": pack_only,
            "pack_plus_rerank": res,
            "delta_recall_at_1_points": round((res["recall_at_1"] - base["recall_at_1"]) * 100, 2),
            "sign_test_vs_shipped_k1": common.sign_test(instances, reranked, shipped, k=1),
            "pack_depth_sessions": {"median": sorted(depth)[len(depth) // 2],
                                    "max": max(depth), "min": min(depth)},
            "model_ms_per_instance": {"p50": pct(lat, 0.50), "p95": pct(lat, 0.95),
                                      "mean": round(statistics.mean(lat), 1)},
        }
        with open(args.out.replace(".json", ".%s.ranked.json" % cond), "w") as fh:
            json.dump({"condition": cond, "variant": "%s+D1@pack" % args.variant,
                       "ranked": reranked}, fh)

    p = out["conditions"]["pooled"]
    a = out["conditions"]["anchor"]
    out["gate"] = {
        "rule": ">=5.0 points pooled recall@1 AND p<0.05 AND anchor loss <0.5 points",
        "pooled_delta_points": p["delta_recall_at_1_points"],
        "pooled_p_value": p["sign_test_vs_shipped_k1"]["p_value"],
        "anchor_delta_points": a["delta_recall_at_1_points"],
        "verdict": "PASS" if (p["delta_recall_at_1_points"] >= 5.0
                              and p["sign_test_vs_shipped_k1"]["p_value"] < 0.05
                              and a["delta_recall_at_1_points"] > -0.5) else "FAIL",
    }
    json.dump(out, open(args.out, "w"), indent=2)
    print(json.dumps(out["gate"], indent=2))


if __name__ == "__main__":
    main()
