import json, re, sys
sys.path.insert(0, "/srv/titen-workspace/titen-bench-20260804/harness")
sys.path.insert(0, "/srv/titen-workspace/titen-bench-20260804/harness/titen-lane")
import common
from pooled_common import pooled_sessions

STOP = set("a an and are as at be but by for from had has have how i if in is "
           "it its of on or that the their them then there these they this to "
           "was we were what when where which who why will with you your".split())


def words(t):
    return {w for w in re.findall(r"[a-z0-9']+", t.lower())
            if len(w) >= 3 and w not in STOP}


instances, ordered, n_gold = pooled_sessions()
sess_words = {sid: words(t) for sid, t in ordered}
counts = []
for inst in instances:
    qw = words(inst["question"])
    if not qw:
        continue
    n_all = sum(1 for sw in sess_words.values() if qw <= sw)
    counts.append(n_all)
counts.sort()
n = len(counts)
print(json.dumps({
    "questions": n,
    "sessions_containing_all_question_content_words": {
        "min": counts[0], "p25": counts[n // 4], "median": counts[n // 2],
        "p75": counts[3 * n // 4], "p90": counts[int(n * 0.9)],
        "max": counts[-1],
    },
    "zero_or_one_competition_questions": sum(1 for c in counts if c <= 1),
}, indent=1))
