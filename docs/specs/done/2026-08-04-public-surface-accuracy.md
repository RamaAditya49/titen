---
work_id: public-surface-accuracy-20260804
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-08-04
updated: 2026-08-04
owner: CADIS
---

# Public surface accuracy for the go-public launch

## Outcome

Completed. `README.md`, `CHANGELOG.md`, and the affected guides under `docs/`
now state one accurate version of Titen's stability, Vectorize status, release
dates, embedding configuration, SDK quickstart, memory model, and client
surface. The SDK quickstart was reproduced failing, corrected, and re-run
verbatim to a successful `observe -> consolidate -> compile` round trip. The
embedding claims are backed by four live readiness probes against the published
`titen-memory@0.5.7` tarball. No file under `src/core`, `src/runtime`,
`scripts/`, `tests/`, or `package.json` changed.

## Problem

The go-public readiness review and the release-bound benchmark of 2026-08-04
found six contradictions and gaps across the widest-reach surfaces.

1. Issue #222 — the homepage renders `Latest v0.5.7 · stable release` while
   `README.md` and `CHANGELOG.md` say the public API is not stable. The word
   comes from `"channel": "stable"` in `version.json`, which
   `fetchStableRelease()` requires as a release-channel discriminator. Nothing
   said that, so the strongest stability claim sat on the surface with the
   fewest caveats.
2. Issue #223 — the homepage capability table calls Vectorize verified while the
   prose two lines below says it has not landed. `README.md` scoped it to
   `titen-test-*` without saying whose account that is or that it is not general
   availability.
3. Issue #224 — `CHANGELOG.md` dated 0.5.7 as 2026-08-02 while npm and
   `version.json` say 2026-08-01. The registry shows the same drift on 0.5.6,
   0.5.5, and 0.2.0: headings recorded the maintainer's UTC+7 calendar day.
4. Issue #231 — `TITEN_EMBED_REVISION`, `TITEN_EMBED_PROFILE`, and
   `TITEN_EMBED_MIN_COSINE` were named in configuration blocks but never
   explained. `TITEN_EMBED_MIN_COSINE` has no shipped default on either runtime,
   the unset variable reads as the empty string, and semantic retrieval fails
   closed, so an operator calibrating a deployment had to read
   `src/runtime/bun/vectors.ts` or hit the error. The profile is forced by the
   model id and only source reading revealed that.
5. Issue #241 — the "Use the SDK" quickstart failed verbatim. `npm init -y`
   writes `"type": "commonjs"`, `titen-memory` is ESM-only, and the documented
   steps ended in `SyntaxError: Cannot use import statement outside a module`.
   This is the primary adoption path.
6. Strategic debt items 1 and 5 in `PONYTAIL-DEBT.md` — the caller-authored
   memory model is the first objection every evaluator raises and was not stated
   until deep in the architecture section, and the client surface was undescribed.

The site itself lives in the separate `titen-web` repository and is outside this
change; the repository-side contract for it belongs in the release guide.

## Scope

- `README.md`, `CHANGELOG.md`.
- `docs/README.md`, `docs/ROADMAP.md`, `docs/agent-guide.md`,
  `docs/engineering/release.md`, `docs/deployment/vps.md`,
  `docs/deployment/cloudflare.md`.
- Paired spec and plan under `docs/specs/done/` and `docs/plans/done/`.

## Out of scope

- Every file under `src/core`, `src/runtime`, `scripts/`, `tests/`, and
  `package.json`. This change carries no runtime behavior.
- The `titen-web` repository, which owns the homepage markup that issues #222
  and #223 reproduce against. The release guide now states the two claims a
  homepage deploy must satisfy, which is the strongest lever available here.
- The `check:workflow` registry-date assertion suggested in issue #224. It would
  require editing `scripts/`, and it puts a network call in a local check; the
  release guide carries the copyable command instead.
- Republishing or retagging any release. Only heading dates were corrected.

## EARS acceptance criteria

- **AC-STABLE-001 — Ubiquitous:** The README and the changelog header shall
  state that Titen is pre-1.0 and that below `1.0.0` a minor bump carries
  breaking changes.
- **AC-STABLE-002 — Ubiquitous:** Every public surface in this repository that
  uses the word *stable* about a release shall say it names the release channel
  and shall say it does not describe API stability.
- **AC-STABLE-003 — Unwanted behavior:** If a website deploy renders the release
  badge, then the release guide shall require that badge to name the channel and
  disclose pre-1.0 before the release is announced complete.
- **AC-VECTORIZE-001 — Ubiquitous:** Every surface describing Cloudflare
  Vectorize shall scope the live evidence to the isolated `titen-test-*` stack
  on the maintainer's own account and shall deny general availability.
- **AC-DATE-001 — Ubiquitous:** Every released changelog heading shall carry the
  UTC date that the npm registry records for that exact version.
- **AC-DATE-002 — Event-driven:** When a maintainer publishes a release, the
  release guide shall require re-checking the heading date against
  `registry.npmjs.org` and correcting it in the same session.
- **AC-EMBED-001 — Ubiquitous:** The documentation shall name every
  `TITEN_EMBED_*` variable with its shipped default, its accepted values, and
  its behavior when absent or invalid.
- **AC-EMBED-002 — State-driven:** While any `TITEN_EMBED_*` variable is set and
  `TITEN_EMBED_MIN_COSINE` is unset, the documentation shall state that the
  service fails closed with `503` and
  `checks.semantic_index: "embedding_configuration_invalid"`.
- **AC-EMBED-003 — Optional feature:** Where the configured model id contains
  `embeddinggemma`, the documentation shall state that
  `embeddinggemma-retrieval-v1` is the only accepted profile and that raw
  untransformed input is unreachable for that model family.
- **AC-EMBED-004 — Ubiquitous:** The documentation shall include a complete
  worked EmbeddingGemma configuration and the readiness command that confirms
  it.
- **AC-SDK-001 — Event-driven:** When a reader runs `npm init -y`, the README
  install commands, and the README code block without modification on Node 22 or
  newer, the script shall complete a full observe, consolidate, and compile
  round trip.
- **AC-CLAIMS-001 — Ubiquitous:** The README shall state before the API sections
  that consolidation takes caller-authored statements with explicit source links
  and that model-assisted derivation is activation-gated with no candidate model
  past the gate.
- **AC-CLIENT-001 — Ubiquitous:** The README shall describe the client surface
  as it exists in the repository, including that the Python client is not
  published to PyPI, and shall point callers in other languages at the REST
  reference.
