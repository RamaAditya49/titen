"""Shared pooled-store construction. One definition, or the lanes drift.

sid -> text is unique across the fixture (verified 2026-08-07: 0 of 19,829
sids carry more than one distinct text), so first-seen is the only version.
Gold sessions are ingested first (the benchmark-scale.ts isolation trick), so
the 500-question set is answerable at every prefix and distractor volume is
the only variable that moves between store sizes.
"""
import hashlib
import common

SEED = 20260804


def pooled_sessions():
    """Return (instances, [(sid, text)...] gold-first deterministic, n_gold)."""
    instances = common.load()
    gold = set()
    for inst in instances:
        gold.update(inst["gold"])
    seen = {}
    for inst in instances:
        for sid, text in inst["sessions"]:
            if sid not in seen:
                seen[sid] = text

    def key(sid):
        return hashlib.sha256("{}|{}".format(SEED, sid).encode()).hexdigest()

    gold_sids = sorted((s for s in seen if s in gold), key=key)
    rest_sids = sorted((s for s in seen if s not in gold), key=key)
    ordered = [(s, seen[s]) for s in gold_sids + rest_sids]
    return instances, ordered, len(gold_sids)
