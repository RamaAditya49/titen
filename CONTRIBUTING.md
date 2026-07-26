# Contributing to Titen

Thank you for helping build Titen.

## Before coding

- Read the [PRD](./docs/PRD.md) and relevant architecture document.
- Open an issue before a large feature, new dependency, provider, database, or
  architectural change.
- Small documentation fixes, tests, and isolated bug fixes may go directly to a
  pull request.
- Security vulnerabilities must follow [SECURITY.md](./SECURITY.md), never a
  public issue.

## Repository stage

Titen is currently in product-definition/P0 preparation. Runtime setup commands
will be added with the first package scaffold; this document does not invent
commands that cannot run yet.

Documentation changes can be checked with:

```bash
git diff --check
```

Also verify that every relative Markdown link points to an existing file.

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

- the problem and smallest chosen solution;
- affected runtime(s);
- security/data-migration impact;
- tests and manual verification;
- documentation changed;
- rollback or compatibility notes when relevant.

## Architecture decisions

Add an ADR under `docs/decisions/` when changing a durable boundary such as:

- canonical storage semantics;
- scope/visibility model;
- runtime support;
- API compatibility;
- federation/conflict strategy;
- a mandatory dependency or service.

Use the next sequential number and record context, decision, consequences, and
rejected alternatives.
