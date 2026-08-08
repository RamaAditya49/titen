# `titen audit` — write-hygiene detection rules

Status: published before the tool was run against any store other than Titen's
own. Every rule below is stated so that a reader can re-derive the count by hand
from the same file, disagree with a rule, and discount exactly that rule without
discarding the others.

## What this measures, and what it refuses to measure

Every published agent-memory benchmark measures retrieval on a corpus somebody
curated. The failure people actually report is on the write side: a store fills
with copies of its own output until it is worth less than no memory at all. The
one public audit of a production store found 97.8% of 10,134 entries were junk
after 32 days, over half of it the system re-extracting what it had just been
handed back. Nothing measures that. This does.

Three properties are load-bearing.

**Nothing leaves the machine.** No network call, no model, no upload, no
telemetry. `titen audit` opens the path read-only, reads it, and prints a report
to stdout. `src/runtime/bun/audit.ts` imports exactly `node:fs`, Titen's own
SQLite opener, its reference-store parser, `sha256Hex`, and two constants —
nothing that can open a socket — so the promise is checkable by reading the
import list, and `tests/integration/audit.test.ts` runs the installed CLI under
a `fetch` that throws on any call. Whether the report is ever shared is the
reader's decision.

**A missing signal is reported as missing.** A store that records no provenance
cannot have its recall-loop rate measured. Reporting `0` there would be a number
that flatters the store, and reporting `fail` would be a number that smears it.
Both are refused. The report says **"not measurable from this export"**, the
JSON carries `"count": null` rather than `0`, and the reason names the missing
signal.

**No composite score, and no leaderboard.** The five counts measure five
different things on five different denominators. Combining them would produce a
number nobody can audit, and ranking stores by it would turn an instrument into
a weapon — which is both dishonest and the fastest way to have the whole thing
dismissed as vendor FUD. The JSON emits `"composite_score": null` explicitly.
Counterexamples are published in the Jepsen shape: the store, the rule, the
entry, the evidence.

## Inputs

| Shape | Detected by | Entries audited |
| --- | --- | --- |
| Titen store | `SQLite format 3\0` file header, then the `observations` table | one entry per observation |
| `@modelcontextprotocol/server-memory` store | first non-empty line is JSON with `"type":"entity"` or `"type":"relation"` | one entry per observation string on an entity |
| Mem0 export | the file parses as one JSON document containing `results`, `memories`, `data`, or `data.results` | one entry per record with a `memory`, `content`, or `text` field |

Anything else is refused by name rather than audited as an empty store.

Reference-server *relations* are structure, not free text, and are not counted
as entries. Titen *claims* are not counted as entries either: this measures the
write path, and in Titen every claim is derived from observations that are
already counted.

## Signals each shape carries

A metric is measurable only where its signal exists.

| Signal | Titen store | reference `memory.json(l)` | Mem0 export |
| --- | --- | --- | --- |
| entry text | yes | yes | yes |
| write timestamp | `observations.ingested_at` | absent | `created_at` when present |
| provenance the store assigned | `observations.source_type` | absent | absent |
| what the store previously served | `context_runs` + `context_run_items` | absent | absent |
| retrieval after write | same | absent | absent |

Consequence: on a reference-server store and on a Mem0 export, **recall loop**
and **stale** are reported as not measurable. That is a statement about the
export format, not a defect in the product that produced it.

## The five rules

### 1. Exact duplicate

Entries whose text is byte-identical to an earlier entry.

- Group entries by their exact text.
- A group of N identical entries contributes **N − 1** redundant entries.
- Rate = redundant entries ÷ total entries.
- Evidence per item: the redundant entry's locator, the locator of the first
  copy, a short SHA-256 group id, and the text.

### 2. Near duplicate

Entries that survive canonicalization into the same string but are not
byte-identical. Canonical form:

1. Unicode NFKC normalization;
2. lowercase;
3. every run of characters that is neither a Unicode letter nor a digit
   collapsed to a single space (`/[^\p{L}\p{N}]+/gu`);
4. trim.

Two entries are near duplicates when their canonical forms are equal and their
raw texts are not. Within one canonical group, the first occurrence of each
distinct raw text is kept and every later distinct text is counted, so exact
duplicates are never counted twice across the two metrics.

This is a hash-equality rule, not a similarity threshold. That is deliberate: a
reader can reproduce it with `tr`, `sort` and `uniq`, and a threshold nobody can
reproduce would sink the credibility of the whole report. It is a lower bound —
paraphrases are not detected.

**This is not Titen's `observations.canonical_hash` column.** That column mixes
in the actor, subject, project, kind, provenance, trust and visibility, so two
agents writing the same sentence get different canonical hashes there, by
design. It is a replay key, not a duplicate detector, and using it here would
report near-zero on every store including Titen's own.

### 3. Recall loop

Entries whose content came back out of the store before it was written back in.
An entry counts when **either** of these holds:

- the store itself assigned the entry provenance meaning *recalled*. In Titen
  this is `source_type = 'recalled'`, which is stamped from a server-issued
  context token and cannot be declared or overridden by the caller
  (`src/core/observations.ts`); or
- the entry's canonical text (rule 2) equals the canonical text of something the
  store served back, and the serve is timestamped strictly before the entry's
  write.

Both mechanisms are named per item in the evidence, so a reader who trusts one
and not the other can recount.

Known ceilings, both in the direction of under-counting:

- the stamp proves a write was made while holding a Titen-issued pack, not that
  its content came out of that pack, and a caller that omits the token is not
  stamped at all;
- the text match catches verbatim and near-verbatim recall only. An agent that
  rephrases what it read is invisible to both mechanisms.

The number is therefore a **lower bound** on the recall loop and never an upper
one.

### 4. Secret pattern

Entries containing a string matching a published credential pattern.

| Rule | Pattern | Precision |
| --- | --- | --- |
| `aws_access_key_id` | `\bAKIA[0-9A-Z]{16}\b` | high |
| `private_key_block` | `-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----` | high |
| `github_token` | `\bgh[pousr]_[A-Za-z0-9]{36,}\b` | high |
| `slack_token` | `\bxox[abprs]-[A-Za-z0-9-]{10,}\b` | high |
| `google_api_key` | `\bAIza[0-9A-Za-z_-]{35}\b` | high |
| `openai_style_key` | `\bsk-(?:[A-Za-z0-9]+-)?[A-Za-z0-9_-]{20,}\b` | high |
| `jwt` | `\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b` | high |
| `url_basic_auth` | `\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@` | high |
| `assigned_credential` | `\b(?:pass(?:word\|wd)?\|secret\|api[_-]?key\|access[_-]?token\|token)\b\s*(?:[:=]\|\bis\b)\s*["']?([^\s"',;]{8,})` | **low** |

An entry is counted once no matter how many patterns it matches. The report
always breaks the total down per rule, so `assigned_credential` — the one rule
that trades precision for the most common real case, an agent told a password in
prose — can be discounted on its own.

Nothing is validated against a provider, because that would be a network call.
Every count here is a *candidate*.

**The report never reproduces what it found.** Matches are masked to their first
four characters and a length (`AKIA…(20 chars)`), and the masking is applied to
every quoted excerpt in the whole report, so a duplicate finding cannot leak a
credential the secret rule already redacted.

### 5. Stale

Entries with no recorded retrieval after they were written.

In a Titen store an observation counts as recalled when a claim it supports
appeared in a context pack compiled strictly after the observation was written
(`claim_sources` → `context_run_items` → `context_runs.created_at`). Direct
evidence reads are not logged per record, so this is an **upper bound**: an
entry read through `GET /v1/claims/:id/evidence` and never through a pack still
counts as stale.

A store whose retrieval log exists but is empty is measurable, and the honest
answer there is 100% stale. A store with no retrieval log at all is not
measurable.

## Usage

```
titen audit <path> [--json]
```

`--json` emits the machine-readable report, including **every** finding; the
text report shows the first ten per metric. Neither writes a file: redirect it
where you want it.

```
npx titen-memory audit ~/.titen/memory.db
npx titen-memory audit ./memory.jsonl --json > audit.json
```

The published bin is a Bun program, so these need Bun on `PATH`; without it the
command exits with `titen: error: bun was not found on PATH.` and audits
nothing. `curl -fsSL https://titen.dev/install.sh | bash` installs Bun when it
is missing.

## If you publish a result

Publish the rule alongside the number, publish the counterexamples, and publish
your own store's numbers before anyone else's. Titen's own are in
[`docs/testing/2026-08-07-titen-audit-self-report.md`](../testing/2026-08-07-titen-audit-self-report.md),
including the parts that do not flatter it.
