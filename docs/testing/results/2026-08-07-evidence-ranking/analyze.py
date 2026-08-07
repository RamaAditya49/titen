"""Scoring and analysis for the 2026-08-07 evidence-ranking run.

Read-only over ranked lists already on disk. `common.py` is imported unmodified;
nothing here re-implements the scorer or the sign test.

usage: analyze.py
"""
import collections, json, math, os, sys

sys.path.insert(0, os.path.expanduser("~/titen-bench-20260804/harness"))
import common
import rerank_ceiling as rc  # oracle + the lexical variants that already failed

BENCH = os.path.expanduser("~/titen-bench-20260804/results")
MINE = os.path.expanduser("~/titen-evidence-rank/bench/results")
OUT = os.path.join(MINE, "analysis-evidence-ranking.json")

TOKENIZER = os.path.expanduser(
    "~/titen-bench-20260804/tokenizers/embeddinggemma-300m.json")


def load(path):
    with open(os.path.expanduser(path)) as fh:
        d = json.load(fh)
    return d.get("ranked", d) if isinstance(d, dict) else d


def gold_rank(gold, ranked):
    for i, sid in enumerate(ranked, 1):
        if sid in gold:
            return i
    return None


def tokens_to_answer(instances, ranked, encode):
    """Tokens in the smallest prefix pack of whole sessions that holds the gold.

    An instance whose ranked list never contains a gold session has no finite
    value. It is counted, never imputed and never dropped.
    """
    finite, unreachable = [], 0
    for inst in instances:
        order = ranked.get(inst["qid"]) or []
        r = gold_rank(inst["gold"], order)
        if r is None:
            unreachable += 1
            continue
        text = {sid: t for sid, t in inst["sessions"]}
        finite.append(sum(encode(text.get(sid, "")) for sid in order[:r]))
    finite.sort()
    return {
        "instances": len(instances),
        "finite": len(finite),
        "no_gold_at_any_depth": unreachable,
        "median_tokens": finite[len(finite) // 2] if finite else None,
        "p25_tokens": finite[len(finite) // 4] if finite else None,
        "p75_tokens": finite[3 * len(finite) // 4] if finite else None,
        "min_tokens": finite[0] if finite else None,
        "max_tokens": finite[-1] if finite else None,
    }


def main():
    report = {}
    inst = common.load()
    by_qid = {i["qid"]: i for i in inst}

    a = load(os.path.join(MINE, "titen-fts-500-passA.ranked.json"))
    b = load(os.path.join(MINE, "titen-fts-500-passB.ranked.json"))
    pub = load(os.path.join(BENCH, "titen-fts-500.ranked.json"))

    print("=== PART 1: PASS A vs PASS B ===")
    sa, sb = common.score(inst, a, {}), common.score(inst, b, {})
    st = common.sign_test(inst, b, a, k=1)
    st5 = common.sign_test(inst, b, a, k=5)
    identical_full = sum(1 for i in inst if a.get(i["qid"]) == b.get(i["qid"]))
    identical_top10 = sum(1 for i in inst if (a.get(i["qid"]) or [])[:10] == (b.get(i["qid"]) or [])[:10])
    identical_top1 = sum(1 for i in inst if (a.get(i["qid"]) or [None])[:1] == (b.get(i["qid"]) or [None])[:1])
    for label, s in (("A (no evidence tie-break)", sa), ("B (evidence tie-break)", sb)):
        print("  %-28s r@1=%.4f r@5=%.4f r@10=%.4f mrr=%.4f failures=%d"
              % (label, s["recall_at_1"], s["recall_at_5"], s["recall_at_10"],
                 s["mrr_at_10"], s["failures"]))
    print("  sign test B vs A @1: wins=%d losses=%d ties=%d p=%s"
          % (st["a_wins"], st["b_wins"], st["ties"], st["p_value"]))
    print("  identical full list %d/500, top-10 %d/500, rank-1 %d/500"
          % (identical_full, identical_top10, identical_top1))
    report["pass_a"], report["pass_b"] = sa, sb
    report["sign_test_b_vs_a"] = {"at_1": st, "at_5": st5}
    report["ranking_identity"] = {
        "full_list": identical_full, "top_10": identical_top10, "rank_1": identical_top1,
        "instances": len(inst),
    }

    print("\n=== PART 2: PASS A vs THE PUBLISHED 0.6.0 LIST (cross-build) ===")
    spub = common.score(inst, pub, {})
    same_full = sum(1 for i in inst if a.get(i["qid"]) == pub.get(i["qid"]))
    same_top10 = sum(1 for i in inst if (a.get(i["qid"]) or [])[:10] == (pub.get(i["qid"]) or [])[:10])
    same_top1 = sum(1 for i in inst if (a.get(i["qid"]) or [None])[:1] == (pub.get(i["qid"]) or [None])[:1])
    firstdiff, setdiff = collections.Counter(), 0
    for i in inst:
        x, y = a.get(i["qid"]) or [], pub.get(i["qid"]) or []
        if x == y:
            continue
        if set(x) != set(y):
            setdiff += 1
        for k in range(max(len(x), len(y))):
            if x[k:k + 1] != y[k:k + 1]:
                firstdiff[k + 1] += 1
                break
    print("  published 0.6.0    r@1=%.4f mrr=%.4f" % (spub["recall_at_1"], spub["mrr_at_10"]))
    print("  identical full list %d/500, top-10 %d/500, rank-1 %d/500"
          % (same_full, same_top10, same_top1))
    print("  lists that differ: %d, all of them by candidate-set membership: %s"
          % (sum(firstdiff.values()), setdiff == sum(firstdiff.values())))
    print("  earliest differing rank across all of them: %d" % (min(firstdiff) if firstdiff else 0))
    report["cross_build"] = {
        "published_0_6_0": spub, "identical_full": same_full, "identical_top_10": same_top10,
        "identical_rank_1": same_top1, "differing_lists": sum(firstdiff.values()),
        "all_differences_are_candidate_set": setdiff == sum(firstdiff.values()),
        "earliest_differing_rank": min(firstdiff) if firstdiff else None,
    }

    print("\n=== PART 3: ORACLE CEILING AND WHAT WAS CAPTURED ===")
    oracle10 = common.score(inst, rc.oracle(inst, a, 10), {})
    ceiling = oracle10["recall_at_1"] - sa["recall_at_1"]
    captured = sb["recall_at_1"] - sa["recall_at_1"]
    print("  baseline r@1        %.4f" % sa["recall_at_1"])
    print("  oracle top-10 r@1   %.4f  (ceiling +%.4f = +%.1f points)"
          % (oracle10["recall_at_1"], ceiling, ceiling * 100))
    print("  evidence ranker r@1 %.4f  (captured %+.4f = %.1f%% of the ceiling)"
          % (sb["recall_at_1"], captured, 100.0 * captured / ceiling if ceiling else 0.0))
    report["oracle"] = {
        "baseline_r1": sa["recall_at_1"], "oracle_top10_r1": oracle10["recall_at_1"],
        "ceiling_points": round(ceiling * 100, 2), "captured_points": round(captured * 100, 2),
        "fraction_of_ceiling_captured": round(captured / ceiling, 4) if ceiling else 0.0,
    }

    print("\n=== PART 4: AGAINST THE LEXICAL SIGNALS THAT ALREADY FAILED ===")
    variants = [
        ("evidence depth (this work)", None),
        ("cov (question word coverage)", rc.sig_cov),
        ("idfcov (IDF-weighted coverage)", rc.sig_idfcov),
        ("bm25 (session-level Okapi)", rc.sig_bm25),
        ("rrf(base, idfcov)", rc.rrf(rc.sig_idfcov)),
        ("rrf(base, bm25)", rc.rrf(rc.sig_bm25)),
        ("mempalace recipe 0.6sim+0.4bm25", rc.mempalace_style),
    ]
    rows = []
    print("  %-34s %-7s %-7s  %s" % ("variant", "r@1", "mrr@10", "sign test vs baseline @1"))
    print("  %-34s %.4f  %.4f" % ("BASELINE pass A", sa["recall_at_1"], sa["mrr_at_10"]))
    for name, fn in variants:
        rk = b if fn is None else rc.rerank(inst, a, fn, 10)
        s = common.score(inst, rk, {})
        t = common.sign_test(inst, rk, a, k=1)
        print("  %-34s %.4f  %.4f   wins=%d losses=%d ties=%d p=%s"
              % (name, s["recall_at_1"], s["mrr_at_10"], t["a_wins"], t["b_wins"],
                 t["ties"], t["p_value"]))
        rows.append({"variant": name, "recall_at_1": s["recall_at_1"],
                     "mrr_at_10": s["mrr_at_10"], "sign_test_vs_baseline": t,
                     "by_type_r1": {k: v["recall_at_1"] for k, v in s["by_type"].items()}})
    report["variants"] = rows

    print("\n=== PART 5: PER QUESTION TYPE ===")
    print("  %-30s %4s  %-8s %-8s %s" % ("question_type", "n", "A r@1", "B r@1", "delta"))
    per_type = {}
    for t in common.TYPES:
        va, vb = sa["by_type"][t], sb["by_type"][t]
        print("  %-30s %4d  %.4f   %.4f   %+.4f"
              % (t, va["n"], va["recall_at_1"], vb["recall_at_1"],
                 vb["recall_at_1"] - va["recall_at_1"]))
        per_type[t] = {"n": va["n"], "a_r1": va["recall_at_1"], "b_r1": vb["recall_at_1"],
                       "delta": round(vb["recall_at_1"] - va["recall_at_1"], 4)}
    report["by_type"] = per_type

    print("\n=== PART 6: TOKENS-TO-ANSWER ===")
    try:
        from tokenizers import Tokenizer
        tok = Tokenizer.from_file(TOKENIZER)
        cache = {}

        def encode(text):
            n = cache.get(text)
            if n is None:
                n = len(tok.encode(text, add_special_tokens=False).ids)
                cache[text] = n
            return n
    except Exception as error:
        print("  tokenizer unavailable (%s); skipped" % error)
        encode = None

    if encode:
        lanes = [
            ("titen-fts-500 (pass A)", os.path.join(MINE, "titen-fts-500-passA.ranked.json")),
            ("titen-fts-500 (pass B)", os.path.join(MINE, "titen-fts-500-passB.ranked.json")),
            ("titen-fts-500 (0.6.0)", os.path.join(BENCH, "titen-fts-500.ranked.json")),
            ("titen-router-500", os.path.join(BENCH, "titen-router-500.ranked.json")),
            ("control-router-500", os.path.join(BENCH, "control-router-500.ranked.json")),
            ("control-fastembed-500", os.path.join(BENCH, "control-fastembed-500.ranked.json")),
            ("mempalace-useronly-500", os.path.join(BENCH, "mempalace-vendorrepro-useronly-minilm-500.ranked.json")),
            ("mempalace-fulltext-500", os.path.join(BENCH, "mempalace-vendorrepro-fulltext-minilm-500.ranked.json")),
            ("mcp-reference-500", os.path.join(BENCH, "mcp-memory-none-keyword-500.ranked.json")),
        ]
        tta = {}
        print("  %-26s %6s %7s %8s %8s %8s  %s"
              % ("lane", "r@1", "median", "p25", "p75", "max", "no gold at any depth"))
        for name, path in lanes:
            if not os.path.exists(path):
                print("  %-26s (ranked file absent)" % name)
                continue
            ranked = load(path)
            s = common.score(inst, ranked, {})
            m = tokens_to_answer(inst, ranked, encode)
            tta[name] = {"recall_at_1": s["recall_at_1"], **m}
            print("  %-26s %.4f %7s %8s %8s %8s  %d of %d"
                  % (name, s["recall_at_1"], m["median_tokens"], m["p25_tokens"],
                     m["p75_tokens"], m["max_tokens"], m["no_gold_at_any_depth"], m["instances"]))
        report["tokens_to_answer"] = {
            "tokenizer": "onnx-community/embeddinggemma-300m-ONNX tokenizer.json",
            "unit": "tokens of whole ranked sessions up to and including the first gold session",
            "lanes": tta,
        }

    with open(OUT, "w") as fh:
        json.dump(report, fh, indent=2)
    print("\nwrote", OUT)


if __name__ == "__main__":
    main()
