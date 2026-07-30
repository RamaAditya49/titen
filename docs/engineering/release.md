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

## Versioning and channels

**Titen stays on `0.x` until the API stops moving.** SemVer clause 4 is explicit:
*"Major version zero (0.y.z) is for initial development. Anything MAY change at
any time."* That is an accurate description of Titen today — model-driven claim
extraction is still planned and consolidation is deterministic. `1.0.0` is a
promise of stability, not a maturity badge; cut it when breaking changes stop,
not when the project feels finished.

While below `1.0.0`:

| Change | Bump | Example |
| --- | --- | --- |
| Breaking — removed route, changed response shape, renamed field | **minor** | `0.1.2` → `0.2.0` |
| Feature, fix, docs, packaging | **patch** | `0.1.1` → `0.1.2` |

There is no major bump before `1.0.0`. `^0.1.0` does not match `0.2.0`, so the
minor slot is the only breaking-change signal consumers get.

### Two dist-tags, not three

| Tag | Command | What it is |
| --- | --- | --- |
| `latest` | `npm i titen-memory` | The current deliberate release. What everyone gets. |
| `next` | `npm i titen-memory@next` | Optional prerelease for early feedback. |

Prereleases are named `0.2.0-rc.1`, `0.2.0-rc.2`. Skip `alpha` and `beta`: a
three-stage pipeline is ceremony a single-maintainer project will not honour,
and an unused stage is worse than no stage because it implies a gate nobody
runs.

**A prerelease must be published with `--tag next`:**

```bash
npm version 0.2.0-rc.1
npm publish --tag next        # WITHOUT --tag it becomes `latest` for everyone
```

SemVer clause 11.3 gives `0.2.0-rc.1 < 0.2.0`, and `^0.1.0` will not resolve a
prerelease — but do not rely on that. The dist-tag is the real guard; the range
rules are a backstop.

Promote a prerelease without republishing:

```bash
npm dist-tag add titen-memory@0.2.0 latest
```

### Merging is not releasing

Every merged issue fix lands on `main` under `## [Unreleased]` in
[`CHANGELOG.md`](../../CHANGELOG.md). **`main` is always the truth; npm `latest`
is the last deliberate cut.** They are allowed to differ, and usually do.

Publishing on every merge would burn version numbers on changes nobody asked
for, and every one of them is permanent — npm allows unpublish only within 72
hours. Batch merges until there is a reason to ship: a fix someone is waiting
on, a coherent set of changes, or a prerelease worth feedback.

So, when asked *which version do we use* — `main` for development, `@latest`
for anyone consuming Titen, `@next` only when a change needs testing before it
reaches `latest`.

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

# 2. Write the entry FIRST, while the reasons are still in your head.
#    Move CHANGELOG.md's [Unreleased] items under the new version heading,
#    date it, and update the compare links at the bottom.
$EDITOR CHANGELOG.md

# 3. Bump. This commits package.json and creates the vN.N.N tag.
npm version <patch|minor|major>

# 4. Prove the tarball works before it becomes permanent (see below).
#    npm publish is irreversible after 72 hours.
bash scripts/verify-pack.sh

# 5. Ship.
npm publish                 # prepack rebuilds dist/npm/sdk.js
git push && git push --tags

# 6. Publish the GitHub release from the entry you already wrote.
gh release create "v$(node -p 'require("./package.json").version')" \
  --title "…" --notes-file <(scripts/changelog-section.sh)
```

`npm publish` is the right command even though the repo uses pnpm: `pnpm
publish` refuses a dirty tree and re-runs the workspace lifecycle, which buys
nothing here. Either works.

## Changelog and GitHub releases

[`CHANGELOG.md`](../../CHANGELOG.md) is the single source for release notes;
the GitHub release body is generated from it by
[`scripts/changelog-section.sh`](../../scripts/changelog-section.sh) so the two
can never drift. Do not hand-write a release body.

Every published version needs a `vN.N.N` tag and a GitHub release. The one
exception on record is **0.1.0**, published from a staging tree before the
packaging work was committed — no commit represents it, so it has no tag.
Do not retrofit one onto a later commit; that would point the tag at code the
release never contained.

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
