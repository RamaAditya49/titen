"""Dump the pooled session order + question set for the Node MCP driver."""
import sys, json

sys.path.insert(0, "/home/ramaaditya/titen-bench-20260804/harness")
sys.path.insert(0, "/home/ramaaditya/titen-bench-20260804/harness/titen-lane")
import common
from pooled_common import pooled_sessions

n_questions = int(sys.argv[1])          # 60 or 500
pool_out, questions_out = sys.argv[2], sys.argv[3]

instances, ordered, n_gold = pooled_sessions()
with open(pool_out, "w") as fh:
    for sid, text in ordered:
        fh.write(json.dumps({"sid": sid, "text": text}) + "\n")

qs = common.load(subsample=10) if n_questions == 60 else instances
with open(questions_out, "w") as fh:
    json.dump([{"qid": i["qid"], "question": i["question"]} for i in qs], fh)
print("pool %d sessions (gold-first %d); questions %d" % (len(ordered), n_gold, len(qs)))
