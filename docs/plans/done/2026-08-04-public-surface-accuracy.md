---
work_id: public-surface-accuracy-20260804
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-08-04
updated: 2026-08-04
owner: CADIS
spec: docs/specs/done/2026-08-04-public-surface-accuracy.md
---

# Plan

- [x] Read the five issues from the API, locate every affected surface, and
  confirm which of them this repository actually owns.
- [x] Reproduce the SDK quickstart failure exactly as issue #241 describes it in
  a throwaway directory.
- [x] Read `src/runtime/bun/vectors.ts`, `src/runtime/cloudflare/vectors.ts`,
  `src/core/vectors.ts`, and `src/core/app.ts` to establish the real embedding
  configuration contract instead of restating the issue.
- [x] Probe the published `titen-memory@0.5.7` tarball for the four readiness
  states the embedding documentation claims.
- [x] Compare every changelog heading against the npm registry `time` field and
  correct all drift, not only the three versions the issue names.
- [x] Rewrite the README stability, Vectorize, embedding, SDK, memory-model, and
  client sections.
- [x] Align `docs/README.md`, `docs/ROADMAP.md`, `docs/agent-guide.md`,
  `docs/deployment/vps.md`, and `docs/deployment/cloudflare.md` with the same
  wording.
- [x] Add the UTC-date rule and the two homepage claim checks to the release
  guide so the drift and the site contradiction cannot recur silently.
- [x] Re-run the corrected quickstart verbatim from a fresh `npm init -y`
  project against a live server.
- [x] Re-check `clients/python` before publishing any statement about a Python
  client, and describe what is actually in the repository.
- [x] Run `node scripts/check-workflow-docs.mjs`.

## Acceptance evidence

**AC-STABLE-001.** `README.md` "Project status" opens with "Titen is pre-1.0"
and states that `0.5.7` to `0.6.0` may break and that `^0.5.0` does not match
`0.6.0`. `CHANGELOG.md` keeps its SemVer clause 4 paragraph.

**AC-STABLE-002.** `README.md` and the `CHANGELOG.md` header both carry the same
sentence: the npm `latest` dist-tag and `"channel": "stable"` in `version.json`
name the release channel, never API stability. The claim was verified against
`fetchStableRelease()` in `src/runtime/bun/release.ts`, which rejects a manifest
whose `channel` is not `"stable"` — a prerelease discriminator, not a product
statement. Live manifest read on 2026-08-04:

```
$ curl -s https://titen.dev/version.json
{"schema": 1, "channel": "stable",
 "cli": {"version": "0.5.7", "released_at": "2026-08-01", ...}}
```

**AC-STABLE-003.** `docs/engineering/release.md` "Website handoff" now blocks
the release announcement on a homepage badge that names the channel and
discloses pre-1.0, with the suggested rendering spelled out.

**AC-VECTORIZE-001.** `README.md` carries one "Vectorize scope" note under the
architecture table; the capability row points at it; the status paragraph
repeats the scope in one clause. `docs/README.md`, `docs/ROADMAP.md`, and
`docs/deployment/cloudflare.md` use the same words: isolated the maintainer release stack on
the maintainer's own Cloudflare account, test production, not general
availability, another account needs its own smoke.

**AC-DATE-001.** Registry versus headings after the change:

```
$ curl -s https://registry.npmjs.org/titen-memory | ... print time
0.5.7 2026-08-01T20:01:44.191Z    0.5.6 2026-08-01T19:31:13.684Z
0.5.5 2026-08-01T18:31:45.069Z    0.2.0 2026-07-31T03:02:55.548Z
$ grep -n '^## \[' CHANGELOG.md
36:## [0.5.7] — 2026-08-01     52:## [0.5.6] — 2026-08-01
72:## [0.5.5] — 2026-08-01    456:## [0.2.0] — 2026-07-31
```

All seventeen headings now match the registry, or carry the recorded 0.5.0 date
for the one version that was never published. The issue named three versions;
the registry comparison found a fourth, 0.2.0, drifting the other way.

**AC-DATE-002.** `docs/engineering/release.md` adds "Date every heading in UTC"
with a copyable registry comparison and the instruction to re-check after
`npm publish` because the heading is written before it.

**AC-EMBED-001.** `README.md` carries a seven-row variable table and
`docs/deployment/vps.md` carries the full reference under "Embedding
configuration", including that any single `TITEN_EMBED_*` value opts the whole
group in, so there is no partial mode.

**AC-EMBED-002.** Probed against the published 0.5.7 tarball with every variable
except `TITEN_EMBED_MIN_COSINE` set:

```
HTTP 503
ready = False
checks.semantic_index = embedding_configuration_invalid
capabilities.vector = configured_error
```

The four-variable case from the issue gives the same result, and a server with
no `TITEN_EMBED_*` variable at all answers `200` with
`checks.semantic_index = disabled` and `capabilities.fts = enabled`.

**AC-EMBED-003.** `model=tuf/embeddinggemma` with `profile=raw-unit-v1`, a valid
revision, and `min_cosine=0`:

```
HTTP 503
checks.semantic_index = embedding_configuration_invalid
```

`embeddingProfileMatchesModel()` in `src/core/vectors.ts` strips
non-alphanumeric characters before the `embeddinggemma` test, which is why
`tuf/embeddinggemma`, `embeddinggemma:300m`, and `EmbeddingGemma-Q4` behave
identically. Both the README and the VPS guide state this and state that raw
input is therefore unreachable for that model family.

**AC-EMBED-004.** The worked example appears twice — a runnable `bunx` form in
`README.md` and an environment-file form in `docs/deployment/vps.md` — with the
readiness command and the expected `"vector":"enabled"` output, plus explicit
notes that the revision and the floor shown are placeholders to substitute.

**AC-SDK-001.** Reproduced first, exactly as issue #241 describes:

```
$ npm init -y && npm install titen-memory && node readme-sdk.ts
SyntaxError: Cannot use import statement outside a module
NODE_EXIT=1
```

Then the corrected README steps, with the code block extracted from `README.md`
itself rather than retyped:

```
$ npm init -y
$ npm install titen-memory
$ npm pkg set type=module
$ node titen-example.js
[ { untrusted: true, claim_id: 'claim_0353...', kind: 'procedural',
    claim: 'Run a rollback smoke test after deployment.',
    evidence_ids: [ 'obs_0d49...' ], score: 0.863333, ... } ]
NODE_EXIT=0
```

**AC-CLAIMS-001.** `README.md` adds "You author the claims" immediately after
the memory-model table, before any API section: `consolidate()` takes statements
the caller wrote with explicit source links, the trade-off against systems that
derive from raw dialogue is named rather than hidden, and the activation gate is
quantified at 65.56% against a 90% threshold.

**AC-CLIENT-001.** `clients/python/` was re-read immediately before writing the
claim and had been added by concurrent work. The README therefore describes a
TypeScript SDK, the `titen` CLI, and a standard-library-only Python client that
installs from a checkout and is **not** published to PyPI, and points every
other language at the REST reference. An earlier draft asserting that no Python
client existed was corrected before completion.

## Verification

```
$ pnpm check:workflow
workflow docs OK (84 artifacts)
workflow checker self-test OK
Ponytail debt ledger OK (0 tracked markers).

$ node scripts/check-route-docs.mjs
route docs OK (84 routes)

$ pnpm test:integration
bun test v1.3.13 (bf2e2cec)
 201 pass
 0 fail
 97 expect() calls
Ran 201 tests across 23 files. [30.40s]

$ pnpm test:api
ℹ tests 111        (workerd/D1 contract)
ℹ pass 111
ℹ fail 0
 136 pass          (Bun/SQLite contract, vectors, SDK)
 0 fail
Ran 136 tests across 3 files. [12.33s]
```

`tests/integration/agent-plugin.test.ts` is the suite that reads `README.md` and
`docs/agent-guide.md` and asserts on their content, which is why it is the
relevant gate for this change. The artifact count above moves with concurrent
work landing in the same checkout.

Runtime probes used the published `titen-memory@0.5.7` tarball installed into
throwaway directories under `/tmp`, on Node v24.18.0 and Bun 1.3.13. The
throwaway stores, keys, and servers were destroyed after the run; no credential
from them appears in this repository.

No source, script, or manifest file changed, so no new test can fail on this
work. The behavioral claims in the documentation were verified against the
shipped package directly, which is stronger evidence for a documentation change
than a suite that cannot fail on prose.

## Follow-up

`titen-web` still renders `Latest v0.5.7 · stable release` and the stale
Vectorize sentence. Issues #222 and #223 reproduce against that repository, and
the fix belongs there; `docs/engineering/release.md` now states the two claims
its deploy must satisfy.
