# Release

The npm package is **`titen-memory`**, not `titen`. The registry rejects the
short name outright:

```
403 Forbidden - PUT https://registry.npmjs.org/titen
Package name too similar to existing package vite
```

That is npm's typosquat filter, not a name collision — `npm view titen` returns
404 to this day. Do not "fix" `package.json` back to `titen`; the publish will
fail at the registry after every local check has passed. The **CLI command is
still `titen`**, because that comes from `bin`, not from the package name.

Titen publishes to npm **manually, from a maintainer's machine**. There is no
release GitHub Action and adding one is a decision, not a chore: the npm token
would then live in repository secrets, and a compromised workflow could publish
on its own. Publishing by hand keeps the credential on one machine.

## What ships

`package.json#files` is an allowlist, so the tarball is 41 files / ~73 kB:

| Included | Why |
| --- | --- |
| `src/core/**` | The shared kernel. Zero external imports, Web Standards only. |
| `src/runtime/bun/**` | The `titen` CLI and `Bun.serve` runtime. |
| `src/sdk.ts` | Source of truth for the SDK, and its `types` entry. |
| `dist/npm/sdk.js` | Type-stripped SDK for Node/Deno/workers, built by `prepack`. |

Not shipped: the Astro dashboard (`src/pages`, `src/styles`), the Cloudflare
adapter (deploy that from a clone with `wrangler`), tests, and docs.

Consumers install **three** packages — `titen`, `sqlite-vec`, and its platform
binary. `astro`, `wrangler`, `playwright`, and `miniflare` are devDependencies
and must stay there; moving one into `dependencies` puts a build toolchain on
every user's disk.

## Publishing

```bash
# 0. One time per machine — interactive, do this yourself.
npm login

# 1. Clean tree, tests green.
git status --short          # must be empty
pnpm test:all

# 2. Bump. This also creates the vN.N.N tag.
npm version <patch|minor|major>

# 3. Prove the tarball works before it becomes permanent (see below).
#    npm publish is irreversible after 72 hours.
bash scripts/verify-pack.sh

# 4. Ship.
npm publish                 # prepack rebuilds dist/npm/sdk.js
git push && git push --tags
```

`npm publish` is the right command even though the repo uses pnpm: `pnpm
publish` refuses a dirty tree and re-runs the workspace lifecycle, which buys
nothing here. Either works.

## Verifying a candidate

`scripts/verify-pack.sh` packs the current tree, installs the tarball into a
throwaway directory, and asserts the five things a broken publish breaks:

1. npm's publish-time normalization still ships a `titen` bin;
2. the dependency tree contains no build toolchain;
3. `titen bootstrap` creates a database and an API key;
4. `titen serve` answers `/readyz` with every migration applied;
5. plain `node` can `import { TitenClient } from "titen-memory"` and `"titen-memory/sdk"`.

Check 1 exists because `npm publish` rewrites `package.json` and `npm pack` does
not — a `bin` entry can vanish at publish time and in no earlier step. npm's own
warning for this is misleading: `"bin[titen]" script name … was invalid and
removed` also fires when npm merely strips a leading `./` and keeps the entry.
The check reports what the field actually becomes instead of what npm calls it.

Run it before every publish. It exits non-zero on the first failure.

## After publishing

```bash
bunx titen-memory@latest --help
npm view titen-memory version
```

The npmjs.com page renders `README.md` and resolves its relative image paths
against the GitHub repo, so push the tag before or with the publish or the
banner will 404.
