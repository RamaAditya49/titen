"""Build the committed artifact set: slim the captures, checksum what stays behind.

The two instrument captures and the two served captures carry a per-item row for
every candidate, which is tens of megabytes of raw material nobody reads. What a
reader needs from them is the session order and the scores, so those are emitted
slim and the originals are listed by checksum instead of committed.
"""
import hashlib, json, os, sys

R = os.path.expanduser("~/titen-bench-20260808r/results")
OUT = os.path.expanduser("~/titen-bench-20260808r/committed")
os.makedirs(OUT, exist_ok=True)

CAPTURES = ["cap-pooled-32k", "cap-anchor-32k", "cap-anchor-32k-atpinned",
            "cap-pooled-full", "cap-anchor-full"]


def sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as fh:
        for block in iter(lambda: fh.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


preserved = []
for name in CAPTURES:
    path = os.path.join(R, name + ".json")
    payload = json.load(open(path))
    slim = {k: v for k, v in payload.items() if k not in ("items",)}
    slim["items_note"] = (
        "per-item rows omitted from the committed copy; the full capture is "
        "preserved on benchmark-host at ~/titen-bench-20260808r/results/%s.json" % name
    )
    with open(os.path.join(OUT, name + ".slim.json"), "w") as fh:
        json.dump(slim, fh, indent=1)
    preserved.append({
        "file": "~/titen-bench-20260808r/results/%s.json" % name,
        "bytes": os.path.getsize(path),
        "sha256": sha256(path),
        "rows": "500 instances, per-item [claim_id, observer_id, tokens, kind, status, dedupe_digest]",
    })
    print("slimmed", name, "->", os.path.getsize(os.path.join(OUT, name + ".slim.json")))

for name in ["edeep-pooled-w10", "edeep-pooled-w20", "edeep-anchor-w10", "edeep-anchor-w20"]:
    path = os.path.join(R, name + ".ranked.json")
    preserved.append({"file": "~/titen-bench-20260808r/results/%s.ranked.json" % name,
                      "bytes": os.path.getsize(path), "sha256": sha256(path),
                      "rows": "re-ranked session orders at that window"})

with open(os.path.join(OUT, "PRESERVED.json"), "w") as fh:
    json.dump({
        "spec": "2026-08-08-pooled-recall-recovery",
        "host": "benchmark-host",
        "note": "artifacts too large to commit, listed by checksum so a later run can "
                "verify it is reading the same bytes this report was written from",
        "artifacts": preserved,
    }, fh, indent=2)
print("wrote PRESERVED.json with", len(preserved), "entries")
