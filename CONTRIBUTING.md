# Contributing to Titen

Thank you for helping build Titen.

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

## Repository stage

The memory service remains in product-definition/P0 preparation. The repository
does contain a runnable Astro dashboard preview; it uses synthetic data and has
no memory-service write path.

Install and verify the current repository with:

```bash
pnpm install
pnpm test
pnpm check:workflow
git diff --check
```

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
`refactor:`, and `chore:`.

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
