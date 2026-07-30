# Changelog

All notable changes to Titen are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
While the version stays below `1.0.0`, a **minor** bump may carry a breaking
change — any entry that does will say so under **Changed** and name the
migration.

The published npm package is [`titen-memory`](https://www.npmjs.com/package/titen-memory).
The **CLI command is `titen`** regardless; see [Package name](#package-name).

## [Unreleased]

Nothing yet.

## [0.1.1] — 2026-07-30

### Fixed

- **`./package.json` is reachable again.** An `exports` map hides every subpath
  it does not list, so `require("titen-memory/package.json")` failed with
  `ERR_PACKAGE_PATH_NOT_EXPORTED`. Bundlers and tooling read that file. It is
  now listed explicitly, and `scripts/verify-pack.sh` fails if it stops
  resolving.

## [0.1.0] — 2026-07-30

First published release. Titen was previously reachable only by cloning the
repository.

### Added

- **`titen` CLI on the registry.** `bunx titen-memory serve` starts the memory
  service with no clone and no build step. Also `bootstrap`, `migrate`,
  `key create|list|revoke`, `backup`, and `schema`.
- **Agent SDK for every runtime.** `import { TitenClient } from "titen-memory"`
  is plain `fetch` — Node 22+, Bun, Deno, and edge workers. The `titen-memory/sdk`
  subpath resolves to the same client.
- **`scripts/verify-pack.sh`** — the release gate. It installs the real tarball
  into a throwaway directory and exercises bootstrap, serve, and the SDK, because
  every path resolves in a working tree even when `files` forgot to ship it.
- **`docs/engineering/release.md`** — the manual release procedure.
- **`CLAUDE.md`** — agent guidance that points at `AGENTS.md` instead of
  restating it.

### Changed

- **`astro` moved to `devDependencies`.** It only builds the dashboard, but it
  was declared as a runtime dependency, so installing Titen pulled a full build
  toolchain onto every consumer's disk. A consumer tree is now three packages:
  `titen-memory`, `sqlite-vec`, and its platform binary.

### Notes

- The tarball is 41 files / ~73 kB: the Web-Standards kernel, the Bun runtime,
  and a type-stripped SDK for Node. The Astro dashboard, the Cloudflare adapter,
  tests, and docs are not shipped — deploy the Worker from a clone.
- `sqlite-vec` is an `optionalDependency` loaded lazily. Without it retrieval
  degrades to lexical FTS5 and `/readyz` reports the vector capability as
  disabled rather than failing.
- **The CLI requires Bun** — it uses `bun:sqlite`, and the published `bin`
  carries a `#!/usr/bin/env bun` shebang. `npx titen-memory` works only with Bun
  on `PATH`. The SDK has no such constraint.
- 0.1.0 carries no git tag. It was published from a staging tree assembled
  before the packaging work was committed, and was superseded by 0.1.1 the same
  day. Prefer 0.1.1.

## Package name

npm refuses to register `titen`:

```
403 Forbidden - PUT https://registry.npmjs.org/titen
Package name too similar to existing package vite
```

That is npm's typosquat filter, not a collision — `npm view titen` still returns
404. The package is therefore `titen-memory`. The **command stays `titen`**,
because that comes from the `bin` field rather than from the package name:

```console
$ bunx titen-memory serve
titen — self-hosted memory service
```

## Releasing

Releases are cut by hand from a maintainer's machine and deliberately have no
GitHub Action, so an npm token never lives in repository secrets. See
[`docs/engineering/release.md`](./docs/engineering/release.md).

[Unreleased]: https://github.com/RamaAditya49/titen/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/RamaAditya49/titen/releases/tag/v0.1.1
[0.1.0]: https://www.npmjs.com/package/titen-memory/v/0.1.0
