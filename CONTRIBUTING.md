# Contributing to Titen

Thank you for helping build Titen.

Participation in this project is governed by the
[Code of Conduct](./CODE_OF_CONDUCT.md).

## Before coding

- Read the [PRD](./docs/PRD.md) and relevant architecture document.
- Follow the
  [requirements and delivery workflow](./docs/engineering/requirements-workflow.md):
  `spec -> plan -> implement -> done`.
- For memory, retrieval, authorization, or persistence changes, also read the
  [evaluation specification](./docs/testing/EVALS.md) and
  [threat model](./docs/security/threat-model.md).
- Open an issue before a large feature, new dependency, provider, database, or
  architectural change.
- Small documentation fixes, tests, and isolated bug fixes may go directly to a
  pull request.
- Security vulnerabilities must follow [SECURITY.md](./SECURITY.md), never a
  public issue.

Classify the change before implementation. Public contracts, persistence,
migrations, authorization, privacy, dual-runtime behavior, external services,
concurrency, recovery, dependencies, and measurable performance or reliability
work are always complex. Complex work requires paired active spec/plan files
with EARS acceptance criteria. Simple work may keep the same four stages inline
in its issue or pull request.

## Branches and parallel work

- Branch from the latest `origin/main` and use `<type>/<short-scope>`, where
  `type` is `feat`, `fix`, `docs`, `test`, `refactor`, or `chore`.
- Keep one logical concern and one owner per branch. Do not share a working
  branch; dependent work uses separate pull requests that declare their base
  and merge order.
- Contributors change `main` through pull requests. Direct pushes are reserved
  for maintainer emergency reverts and must leave a follow-up issue or pull
  request record.
- Rebase onto current `origin/main` before final review, resolve conflicts on
  the topic branch, and rerun affected checks. If the resulting diff changes,
  request review again.

## Repository stage

The repository contains the P0 memory service, shared core, Cloudflare/D1
adapter, Bun/SQLite adapter, and dual-runtime contract tests. This is local
verification, not proof of a live Cloudflare deployment. The Astro dashboard
preview still uses synthetic data, and automatic model-assisted derivation and
reflection remain planned.

Install and verify the current repository with:

```bash
pnpm install
pnpm test
pnpm check:workflow
git diff --check
```

Run the local workerd/D1 gate with `pnpm build:worker && pnpm test:d1`. It
reserves one loopback lane across worktrees and fails immediately with the
current owner identity if another D1 gate is active. Do not retry a red run:
retain its run/case/workerd diagnostic and classify it separately from product
assertions. This emulator gate is not a substitute for an explicitly authorized
real Cloudflare D1 smoke.

It stays a local manual gate. **This repository runs no GitHub Actions at all**,
by standing decision of the maintainer: there is no CI workflow, no release
workflow, and no container-publish workflow, and none should be added. The gates
above are the gate. Publishing stays manual from a maintainer's machine — see
[`docs/engineering/release.md`](./docs/engineering/release.md) — and the
container image is built and pushed the same way.

A contributor is therefore expected to run the commands above before opening a
pull request, because nothing hosted will run them afterwards.

### Restricted or read-only home directories

pnpm and Wrangler need writable user data/configuration directories before
Titen's checks can start. In an ephemeral container with an absent or read-only
home, keep those tool writes outside the repository and scope the override to a
subshell:

```bash
(
  set -eu
  titen_tool_home="$(mktemp -d)"
  trap 'rm -rf -- "$titen_tool_home"' EXIT
  export HOME="$titen_tool_home"
  export XDG_CONFIG_HOME="$titen_tool_home/.config"
  export WRANGLER_SEND_METRICS=false
  mkdir -p "$XDG_CONFIG_HOME"

  pnpm install
  pnpm test:all
)
```

This is contributor-tool setup, not a Titen runtime requirement.

Use `pnpm dev` for local dashboard work and `pnpm screenshots` after a production
build when an approved visual change needs refreshed README images. Also verify
that every relative Markdown link points to an existing file.

## Contribution principles

- Keep one logical change per pull request.
- Prefer deletion and native platform features over new abstractions.
- Do not add a provider matrix or framework for hypothetical future use.
- Add the smallest regression/contract test for non-trivial behavior.
- Preserve Cloudflare and Bun/VPS contract parity.
- Update docs with externally visible behavior.
- Keep secrets, private memory content, and raw production payloads out of
  issues, fixtures, logs, and commits.

## Commit and pull request style

Use Conventional Commit prefixes such as `feat:`, `fix:`, `docs:`, `test:`,
`refactor:`, and `chore:`. Use the same format for the pull request title; it
becomes the commit subject when the pull request is squash-merged.

A pull request should state:

- whether the work is simple or complex and, when complex, its spec/plan paths;
- the problem and smallest chosen solution;
- affected runtime(s);
- security/data-migration impact;
- tests and manual verification;
- documentation changed;
- rollback or compatibility notes when relevant.

Before marking a pull request complete, close its workflow: record evidence for
every acceptance ID, resolve all plan checkboxes, and move a complex spec/plan
pair to `done/` together. Cancelled or superseded work also moves to `done/`
with a concrete closure reason.

Maintainers merge only a current, approved pull request with resolved review
threads and reproducible verification. Use **squash merge**, then delete the
topic branch; never reuse a merged branch. Merge dependent pull requests from
base to tip and rebase each remaining branch after its base lands.

## Version, changelog, and README

Every pull request declares one release impact using the
[release policy](./docs/engineering/release.md#versioning-and-channels):

| Impact  | Use when |
| ------- | -------- |
| `none`  | No published package or user-facing behavior changes |
| `patch` | Compatible feature, fix, published documentation, or packaging changes |
| `minor` | A breaking change while Titen remains below `1.0.0` |

Ordinary pull requests do not edit `package.json#version`, create tags, or add a
released changelog heading. Add notable user-facing changes under
[`CHANGELOG.md#Unreleased`](./CHANGELOG.md#unreleased) in the same pull request;
the release maintainer batches merged work and performs the version bump.

Update `README.md` in the same pull request when verified, shipped behavior
changes any of these public entry points:

- installation, quick start, commands, configuration, or system requirements;
- public API/SDK behavior, supported runtimes, compatibility, or deprecations;
- feature availability, implementation status, screenshots, or visible flows;
- package contents, project links, or contributor-facing instructions already
  summarized by the README.

Do not update the README for an internal refactor, test-only change, or planned
capability with no shipped behavior. The README is a summary: update the
authoritative API, deployment, or product document alongside it. A pull request
that changes implementation status must rebase first and reconcile both
`README.md` and `docs/README.md` so concurrent work cannot restore a stale claim.
The README links to the stable npm package page; version-specific links belong
in the changelog and GitHub Release, not in general documentation.

## Architecture decisions

Add an ADR under `docs/decisions/` when changing a durable boundary such as:

- canonical storage semantics;
- scope/visibility model;
- channel/audience release and customer-identity boundary;
- runtime support;
- API compatibility;
- federation/conflict strategy;
- a mandatory dependency or service.

Use the next sequential number and record context, decision, consequences, and
rejected alternatives.
