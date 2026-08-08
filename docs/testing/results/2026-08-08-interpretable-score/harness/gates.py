"""Score AC-INT-001 .. AC-INT-004 from the four run artifacts. No re-querying.

Every gate threshold here is copied from
docs/testing/2026-08-08-interpretable-score-prereg.md, which was committed
before any cell was scored. Nothing in this file may relax one.

Tie counting for AC-INT-002 is reported under three definitions rather than
one, because the pre-registration says "the rate of exact rank-1 score ties"
without fixing the unit, and picking the flattering reading after seeing the
numbers is the failure mode this repository pre-registers against:

  within_pack   a question counts if >= 2 items in the SAME pack share that
                pack's maximum score.
  across_query  a question counts if its rank-1 score equals the modal rank-1
                score of the BEFORE build -- the ceiling the issue names,
                measured against the same constant on both builds so the
                comparison is like for like. This is the reading the gate's own
                sentence describes: the pre-registration demonstrates the
                defect with three DIFFERENT queries all scoring 0.796667.

Both are scored and both verdicts are reported. Choosing between them after
seeing the numbers is exactly the move this repository pre-registers against,
so this file does not choose.
"""
import argparse, collections, json, os, sys

HARNESS = os.path.expanduser("~/titen-bench-20260804/harness")
sys.path.insert(0, HARNESS)
import common

BASELINE = {
    "anchor": {"recall_at_1": 0.880, "recall_at_10": 0.982, "floor_at_1": 0.875},
    "pooled": {"recall_at_1": 0.246, "recall_at_10": 0.508, "floor_at_1": 0.241},
}
RECALL10_MAX_DROP = 0.010  # "neither recall@10 falls by more than 1.0 point"
LATENCY_MAX_RISE = 0.05    # AC-INT-004: "anything above +5%"


def load(path):
    with open(path) as fh:
        return json.load(fh)


def tie_stats(scores, ceiling=None):
    top_ties = 0
    rank1 = []
    items = collisions = 0
    for values in scores.values():
        if not values:
            continue
        best = max(values)
        rank1.append(values[0])
        if sum(1 for v in values if v == best) >= 2:
            top_ties += 1
        items += len(values)
        collisions += len(values) - len(set(values))
    n = len(scores)
    modal = collections.Counter(rank1).most_common(1)[0][0] if rank1 else None
    at_ceiling = sum(1 for v in rank1 if ceiling is not None and v == ceiling)
    return {
        "n": n,
        "within_pack_ties": top_ties,
        "within_pack_tie_rate": round(top_ties / n, 4) if n else 0.0,
        "pack_items": items,
        "pack_score_collisions": collisions,
        "pack_score_collision_rate": round(collisions / items, 4) if items else 0.0,
        "distinct_rank1": len(set(rank1)),
        "modal_rank1": modal,
        "rank1_min": min(rank1) if rank1 else None,
        "rank1_max": max(rank1) if rank1 else None,
        "rank1_spread": round(max(rank1) - min(rank1), 6) if rank1 else None,
        "across_query_ceiling_ties": at_ceiling,
        "across_query_ceiling_tie_rate": round(at_ceiling / n, 4) if n else 0.0,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--artifacts", required=True)
    ap.add_argument("--probe-before", required=True)
    ap.add_argument("--probe-after", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    instances = common.load()
    report = {"gates": {}, "conditions": {}, "sign_tests": {}, "ties": {}}
    d = args.artifacts

    for cond in ("anchor", "pooled"):
        before = load(os.path.join(d, "before-%s.json" % cond))
        after = load(os.path.join(d, "after-%s.json" % cond))
        before_r = load(os.path.join(d, "before-%s.ranked.json" % cond))
        after_r = load(os.path.join(d, "after-%s.ranked.json" % cond))

        report["conditions"][cond] = {
            "before": {k: before[k] for k in
                       ("n", "recall_at_1", "recall_at_5", "recall_at_10",
                        "mrr_at_10", "failures")},
            "after": {k: after[k] for k in
                      ("n", "recall_at_1", "recall_at_5", "recall_at_10",
                       "mrr_at_10", "failures")},
            "by_type_before": before["by_type"],
            "by_type_after": after["by_type"],
            "compile_ms_before": before["meta"]["passes"],
            "compile_ms_after": after["meta"]["passes"],
            "ranked_lists_changed": sum(
                1 for q in before_r["ranked"] if before_r["ranked"][q] != after_r["ranked"][q]),
            "top10_changed": sum(
                1 for q in before_r["ranked"]
                if before_r["ranked"][q][:10] != after_r["ranked"][q][:10]),
            "rank1_changed": sum(
                1 for q in before_r["ranked"]
                if before_r["ranked"][q][:1] != after_r["ranked"][q][:1]),
        }

        for k in (1, 10):
            report["sign_tests"]["%s@%d" % (cond, k)] = common.sign_test(
                instances, before_r["ranked"], after_r["ranked"], k=k)

        b_ties = tie_stats(before_r["scores"])
        a_ties = tie_stats(after_r["scores"], ceiling=b_ties["modal_rank1"])
        b_ties = tie_stats(before_r["scores"], ceiling=b_ties["modal_rank1"])
        report["ties"][cond] = {"before": b_ties, "after": a_ties}

    # ---- AC-INT-001: rank-1 score separates a strong from a weak match -------
    probe_b, probe_a = load(args.probe_before), load(args.probe_after)
    anchor_ties = report["ties"]["anchor"]
    served_spread = anchor_ties["after"]["rank1_spread"]
    report["gates"]["AC-INT-001"] = {
        "requirement": "rank-1 score differs by >= 0.05 between a strong-match "
                       "and a weak-match query on the anchor store",
        "unit_probe_before_spread": probe_b["spread_strong_minus_weak"],
        "unit_probe_after_spread": probe_a["spread_strong_minus_weak"],
        "served_anchor_rank1_spread_before": anchor_ties["before"]["rank1_spread"],
        "served_anchor_rank1_spread_after": served_spread,
        "pass": (probe_a["spread_strong_minus_weak"] >= 0.05
                 and served_spread is not None and served_spread >= 0.05),
    }

    # ---- AC-INT-002: rank-1 ties fall ---------------------------------------
    b, a = anchor_ties["before"], anchor_ties["after"]
    readings = {
        "across_query": {
            "before": b["across_query_ceiling_tie_rate"],
            "after": a["across_query_ceiling_tie_rate"],
            "distinct_rank1_before": b["distinct_rank1"],
            "distinct_rank1_after": a["distinct_rank1"],
            "pass": a["across_query_ceiling_tie_rate"] < b["across_query_ceiling_tie_rate"],
        },
        "within_pack": {
            "before": b["within_pack_tie_rate"],
            "after": a["within_pack_tie_rate"],
            "pack_collision_rate_before": b["pack_score_collision_rate"],
            "pack_collision_rate_after": a["pack_score_collision_rate"],
            "pass": a["within_pack_tie_rate"] < b["within_pack_tie_rate"],
        },
    }
    report["gates"]["AC-INT-002"] = {
        "requirement": "on the anchor store, the rate of exact rank-1 score ties "
                       "across the 500 questions falls below the current rate",
        "readings": readings,
        "pass": all(r["pass"] for r in readings.values()),
        "split": len({r["pass"] for r in readings.values()}) > 1,
    }

    # ---- AC-INT-003: retrieval quality does not regress ---------------------
    clauses = {}
    for cond in ("anchor", "pooled"):
        c = report["conditions"][cond]
        base = BASELINE[cond]
        clauses["%s recall@1 >= %.3f" % (cond, base["floor_at_1"])] = {
            "value": c["after"]["recall_at_1"],
            "pass": c["after"]["recall_at_1"] >= base["floor_at_1"],
        }
        drop = round(base["recall_at_10"] - c["after"]["recall_at_10"], 4)
        clauses["%s recall@10 drop <= 1.0 pt" % cond] = {
            "value": drop, "pass": drop <= RECALL10_MAX_DROP,
        }
        st = report["sign_tests"]["%s@1" % cond]
        losing = st["b_wins"] < st["a_wins"]  # a = before, b = after
        clauses["%s sign test not significant against the change" % cond] = {
            "value": st,
            "pass": not (losing and st["p_value"] < 0.05),
        }
    report["gates"]["AC-INT-003"] = {
        "requirement": "no regression on both conditions against the published baselines",
        "baseline_reproduced": {
            cond: report["conditions"][cond]["before"]["recall_at_1"] == BASELINE[cond]["recall_at_1"]
            for cond in ("anchor", "pooled")},
        "clauses": clauses,
        "pass": all(c["pass"] for c in clauses.values()),
    }

    # ---- AC-INT-004: compile p95 does not rise ------------------------------
    lat = {}
    for cond in ("anchor", "pooled"):
        c = report["conditions"][cond]
        # Warm pass only. A first pass over a freshly copied 2.2 GB store pays
        # page-cache misses the later ones do not, and that alone moves the
        # anchor p95 by 4.2x (2026-08-08-pooled-recall-recovery.md). Comparing
        # a cold before-pass to a warm after-pass would report a 4x speedup
        # that is the file cache, not the change.
        pb = c["compile_ms_before"][-1]["compile_ms"]["p95"]
        pa = c["compile_ms_after"][-1]["compile_ms"]["p95"]
        lat[cond] = {"warm_p95_before": pb, "warm_p95_after": pa,
                     "delta_pct": round((pa - pb) / pb * 100.0, 2),
                     "pass": (pa - pb) / pb <= LATENCY_MAX_RISE}
    report["gates"]["AC-INT-004"] = {
        "requirement": "compile p95 does not rise more than 5%",
        "note": "warm-pass comparison; the cold pass over a freshly copied store "
                "is page-cache bound and not comparable across builds",
        "conditions": lat,
        "pass": all(v["pass"] for v in lat.values()),
    }

    report["verdict"] = {
        "AC-INT-003_ships": report["gates"]["AC-INT-003"]["pass"],
        "all_gates_pass": all(g["pass"] for g in report["gates"].values()),
    }
    with open(args.out, "w") as fh:
        json.dump(report, fh, indent=2)
    print(json.dumps({"gates": {k: v["pass"] for k, v in report["gates"].items()},
                      **report["verdict"]}, indent=2))
    print("wrote", args.out)


if __name__ == "__main__":
    main()
