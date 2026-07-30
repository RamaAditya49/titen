# CLAUDE.md

Guidance for Claude Code (claude.ai/code) in this repository.

## Read AGENTS.md first

[`AGENTS.md`](./AGENTS.md) is the authoritative agent contract: product framing,
reading order, the `spec -> plan -> implement -> done` lifecycle, coding
constraints, the simplicity budget, security, and verification rules. It is not
duplicated here. This file only adds what an agent cannot infer from it.

## Commands

| Task | Command |
| --- | --- |
| Install | `pnpm install` |
| Memory service (local) | `pnpm titen serve` — Bun + SQLite on `127.0.0.1:8787` |
| Bootstrap org + owner key | `pnpm titen bootstrap --org 'My Org'` |
| Contract + SDK tests | `pnpm test:api` (Bun) |
| Integration tests | `pnpm test:integration` |
| Dashboard build + browser tests | `pnpm test` |
| Everything | `pnpm test:all` |
| Workflow doc check (before handoff) | `pnpm check:workflow` |
| Cloudflare dry-run build | `pnpm build:worker` |

A single test file: `bun test tests/contract/<name>.test.ts`.

## Two runtimes, one core

`src/core/**` has **zero external imports** and uses Web Standards only. That is
load-bearing, not incidental — it is what lets the same kernel run on
`bun:sqlite` and on Cloudflare D1 against one contract suite. Keep it that way:

- Runtime-specific code goes in `src/runtime/bun/**` or `src/runtime/cloudflare/**`.
- `bun:sqlite` appears in exactly one file, `src/runtime/bun/sqlite.ts`.
- `sqlite-vec` is loaded through a lazy `require()` in `src/runtime/bun/vectors.ts`
  and is an `optionalDependency`; retrieval degrades to lexical FTS5 when it is
  absent, and `/readyz` reports the capability as disabled.

## Publishing to npm

Releases are **manual, from a maintainer's machine — never a GitHub Action**.
The full procedure is [`docs/engineering/release.md`](./docs/engineering/release.md).
Two facts that will bite an agent editing `package.json`:

- `files` is an allowlist that overrides `.gitignore`, which is the only reason
  the gitignored `dist/npm/sdk.js` reaches the tarball. Adding a build output
  outside `files` silently ships nothing.
- `astro`, `wrangler`, `playwright`, and `miniflare` are **devDependencies** on
  purpose. Promoting any of them to `dependencies` installs a build toolchain on
  every consumer's disk.

Run `bash scripts/verify-pack.sh` after touching `package.json`, `src/sdk.ts`,
or anything under `src/runtime/bun/`. It installs the real tarball into a
throwaway directory and fails if the CLI, the server, or the Node SDK import
breaks. `npm publish` cannot be undone after 72 hours; the script can.

## Claims discipline

The dashboard preview runs on a synthetic fixture, not the memory API. Never
present it as live service evidence. Likewise, do not claim Cloudflare or VPS
support for a change until a real runtime smoke test passes — `AGENTS.md`
treats this as a hard rule and the repository's commit history reflects
enforcing it.
