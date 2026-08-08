"""E-DEEP: re-rank the returned pack deeper than the shipped top-10.

Prereg: docs/testing/2026-08-08-pooled-recall-recovery-prereg.md (E-DEEP table).

The window is the variable under test, so D1 and D2 are V5 and V1 with nothing
else changed: D1 keeps V5's model, venv and (question, session_text[:2000])
pair; D2 keeps V1's content-word definition verbatim from erank_lexical.py.
Both are scored at W=10 as well as W=50 in the same pass, so the prior cycle's
numbers are reproduced by this machinery before the wider window is believed.

D0 is a correctness gate, not a cell: passing the shipped order through the same
window machinery must return the shipped order.
"""
import json, os, re, statistics, sys, time

sys.path.insert(0, os.path.expanduser("~/titen-bench-20260804/harness"))
import common

RES04 = os.path.expanduser("~/titen-bench-20260804/results")
OUTDIR = os.path.expanduser("~/titen-bench-20260808r/results")
POOLED = os.path.join(RES04, "titen-fts-pooled-19829-20260807.ranked.json")
ANCHOR = os.path.join(RES04, "titen-fts-anchor-20260807.ranked.json")
WINDOWS = (10, 20, 50)

# Verbatim from erank_lexical.py, which is V1's committed definition.
STOP = set("a an and are as at be but by for from had has have how i if in is "
           "it its of on or that the their them then there these they this to "
           "was we were what when where which who why will with you your".split())


def content_words(t):
    return {w for w in re.findall(r"[a-z0-9']+", t.lower())
            if len(w) >= 3 and w not in STOP}


def coverage(qw, text):
    if not qw:
        return 0.0
    return len(qw & set(re.findall(r"[a-z0-9']+", text.lower()))) / len(qw)


def reorder(shipped, scores, w):
    """Sort the first `w` distinct sessions by score desc; shipped order breaks ties."""
    head, tail = shipped[:w], shipped[w:]
    idx = {sid: i for i, sid in enumerate(head)}
    return sorted(head, key=lambda s: (-scores[s], idx[s])) + tail


def rrf(shipped, scores, w, k=60):
    head, tail = shipped[:w], shipped[w:]
    idx = {sid: i for i, sid in enumerate(head)}
    by_model = {sid: i for i, sid in enumerate(sorted(head, key=lambda s: (-scores[s], idx[s])))}
    fused = {sid: 1.0 / (k + idx[sid] + 1) + 1.0 / (k + by_model[sid] + 1) for sid in head}
    return sorted(head, key=lambda s: (-fused[s], idx[s])) + tail


def pct(xs, p):
    xs = sorted(xs)
    return round(xs[min(len(xs) - 1, int(round(p * (len(xs) - 1))))], 1)


def run_condition(name, path, textmap, encoder, instances):
    art = json.load(open(path))
    shipped = art["ranked"]
    failures = art["failures"]
    base = common.score(instances, shipped, failures)

    ranked = {w: {v: {} for v in ("D0", "D1", "D2", "D3")} for w in WINDOWS}
    # Model time is charged per window: the top-10 pairs are scored first and
    # timed alone, so W=10's cost is measured rather than divided out of W=50's.
    model_ms = {w: [] for w in WINDOWS}
    lex_ms = []
    missing = 0

    for done, inst in enumerate(instances, 1):
        qid = inst["qid"]
        order = shipped.get(qid) or []
        texts = textmap(inst)
        qw = content_words(inst["question"])

        widest = max(WINDOWS)
        head = order[:widest]
        docs = []
        for sid in head:
            body = texts.get(sid)
            if body is None:
                missing += 1
                body = ""
            docs.append(body[:2000])

        xs, elapsed, cut = {}, 0.0, 0
        for w in WINDOWS:
            slice_docs = docs[cut:w]
            if slice_docs:
                t0 = time.perf_counter()
                got = list(encoder.rerank(inst["question"], slice_docs))
                elapsed += (time.perf_counter() - t0) * 1000.0
                for sid, score in zip(head[cut:w], got):
                    xs[sid] = score
            model_ms[w].append(elapsed)
            cut = w

        t0 = time.perf_counter()
        cov = {sid: coverage(qw, texts.get(sid, "")) for sid in head}
        lex_ms.append((time.perf_counter() - t0) * 1000.0)

        for w in WINDOWS:
            ranked[w]["D0"][qid] = order[:w] + order[w:]
            ranked[w]["D1"][qid] = reorder(order, xs, w)
            ranked[w]["D2"][qid] = reorder(order, cov, w)
            ranked[w]["D3"][qid] = rrf(order, xs, w)
        if done % 50 == 0:
            print("%s %d/%d" % (name, done, len(instances)), flush=True)

    out = {"baseline": base, "missing_texts": missing, "windows": {}}
    for w in WINDOWS:
        cell = {"model_ms_per_instance": {"p50": pct(model_ms[w], 0.50),
                                          "p95": pct(model_ms[w], 0.95),
                                          "mean": round(statistics.mean(model_ms[w]), 1)},
                "lexical_ms_per_instance": {"p50": pct(lex_ms, 0.50), "p95": pct(lex_ms, 0.95)},
                "variants": {}}
        for v in ("D0", "D1", "D2", "D3"):
            res = common.score(instances, ranked[w][v], failures)
            st = common.sign_test(instances, ranked[w][v], shipped, k=1)
            cell["variants"][v] = {
                "score": res,
                "delta_recall_at_1_points": round((res["recall_at_1"] - base["recall_at_1"]) * 100, 2),
                "sign_test_vs_shipped_k1": st,
            }
        out["windows"][str(w)] = cell
        with open(os.path.join(OUTDIR, "edeep-%s-w%d.ranked.json" % (name, w)), "w") as fh:
            json.dump({"condition": name, "window": w, "ranked": ranked[w]}, fh)
    return out, ranked


def main():
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
        qid = inst["qid"]
        if qid not in percache:
            percache[qid] = dict(inst["sessions"])
        return percache[qid]

    pooled, pooled_ranked = run_condition("pooled", POOLED, lambda i: sid_text, encoder, instances)
    anchor, anchor_ranked = run_condition("anchor", ANCHOR, per_inst, encoder, instances)

    # D0 must be the shipped order itself, or the window machinery is wrong.
    shipped_pooled = json.load(open(POOLED))["ranked"]
    shipped_anchor = json.load(open(ANCHOR))["ranked"]
    d0_ok = all(
        pooled_ranked[w]["D0"][i["qid"]] == (shipped_pooled.get(i["qid"]) or [])
        and anchor_ranked[w]["D0"][i["qid"]] == (shipped_anchor.get(i["qid"]) or [])
        for w in WINDOWS for i in instances
    )

    gates = {}
    for w in WINDOWS:
        for v in ("D1", "D2", "D3"):
            p = pooled["windows"][str(w)]["variants"][v]
            a = anchor["windows"][str(w)]["variants"][v]
            gates["%s@W%d" % (v, w)] = {
                "pooled_delta_points": p["delta_recall_at_1_points"],
                "pooled_p_value": p["sign_test_vs_shipped_k1"]["p_value"],
                "anchor_delta_points": a["delta_recall_at_1_points"],
                "gain_ok": p["delta_recall_at_1_points"] >= 5.0,
                "p_ok": p["sign_test_vs_shipped_k1"]["p_value"] < 0.05,
                "anchor_ok": a["delta_recall_at_1_points"] > -0.5,
                "verdict": "PASS" if (p["delta_recall_at_1_points"] >= 5.0
                                      and p["sign_test_vs_shipped_k1"]["p_value"] < 0.05
                                      and a["delta_recall_at_1_points"] > -0.5) else "FAIL",
            }

    payload = {
        "spec": "2026-08-08-pooled-recall-recovery",
        "phase": "R2 E-DEEP",
        "prereg": "docs/testing/2026-08-08-pooled-recall-recovery-prereg.md#e-deep",
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "model": model,
        "runtime": "fastembed 0.8.0 TextCrossEncoder, ONNX CPU, control venv, default threads",
        "definitions": {
            "D0": "identity control through the window machinery",
            "D1": "cross-encoder over (question, session_text[:2000]); session score = model score; sort window desc, shipped order breaks ties",
            "D2": "V1 term coverage over session text; sort window desc, shipped order breaks ties",
            "D3": "RRF k=60 of shipped rank and D1 rank within the window",
            "window": "first W distinct sessions of the shipped order; positions W+1 and below unchanged",
        },
        "d0_identity_holds": d0_ok,
        "gate_rule": ">=5.0 points pooled recall@1 AND p<0.05 AND anchor loss <0.5 points",
        "gate": gates,
        "pooled": pooled,
        "anchor": anchor,
    }
    with open(os.path.join(OUTDIR, "r2-edeep.json"), "w") as fh:
        json.dump(payload, fh, indent=2)
    print(json.dumps({"d0_identity_holds": d0_ok, "gate": gates}, indent=2))


if __name__ == "__main__":
    main()
