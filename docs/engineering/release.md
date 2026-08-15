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

Titen publishes to npm **manually, from a maintainer's machine**. GitHub Actions
is intentionally disabled so the repository incurs no hosted automation cost.
Publishing by hand also keeps the npm credential on one machine instead of in a
repository secret. Adding a release workflow requires a new maintainer decision
and an explicit cost budget.

The same manual release updates the schema-1 stable manifest served at
`https://titen.dev/version.json` after npm, the Git tag, and the GitHub Release
agree. The manifest records CLI and plugin versions independently. It is the
human/CLI discovery surface; npm `latest` remains the package installation
authority, and host-native plugin managers remain the plugin installation
authority.

## Versioning and channels

**Titen stays on `0.x` until the API stops moving.** SemVer clause 4 is explicit:
*"Major version zero (0.y.z) is for initial development. Anything MAY change at
any time."* That is an accurate description of Titen today: optional model-
driven claim enrichment is implemented but not production-activated, and
consolidation is deterministic. `1.0.0` is a promise of stability, not a
maturity badge; cut it when breaking changes stop, not when the project feels
finished.

While below `1.0.0`:

| Change | Bump | Example |
| --- | --- | --- |
| Breaking — removed route, changed response shape, renamed field | **minor** | `0.1.2` → `0.2.0` |
| Compatible feature, fix, published docs, packaging | **patch** | `0.1.1` → `0.1.2` |
| Internal tests, refactors, contributor process | **none** | no release |

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

Every pull request declares `none`, `patch`, or `minor`, but ordinary pull
requests never run `npm version`, edit `package.json#version`, create a tag, or
add a released changelog heading. They add notable user-facing changes only to
`Unreleased`. At release time, the maintainer chooses the highest impact in the
batch, moves those entries under the dated version, and performs one bump.

Publishing on every merge would burn version numbers on changes nobody asked
for, and every one of them is permanent — npm allows unpublish only within 72
hours. Batch merges until there is a reason to ship: a fix someone is waiting
on, a coherent set of changes, or a prerelease worth feedback.

So, when asked *which version do we use* — `main` for development, `@latest`
for anyone consuming Titen, `@next` only when a change needs testing before it
reaches `latest`.

## What ships

`package.json#files` is an allowlist:

| Included | Why |
| --- | --- |
| `src/core/**` | The shared kernel. Zero external imports, Web Standards only. |
| `src/runtime/bun/**` | The `titen` CLI and `Bun.serve` runtime. |
| `src/sdk.ts` | Source of truth for the SDK, and its `types` entry. |
| `dist/npm/sdk.js` | Type-stripped SDK for Node/Deno/workers, built by `prepack`. |
| `dist/dashboard/**`, `scripts/dashboard-adapter.ts` | Current packaged Astro dashboard and its same-origin adapter. |
| `README.md`, `SECURITY.md`, `LICENSE` | npm entrypoint, disclosure policy, and license. |

Not shipped: Astro source (`src/pages`, `src/styles`), the Cloudflare adapter
(deploy that from a clone with `wrangler`), tests, and repository-only docs.

SDK and lexical-only server consumers install only `titen-memory`. The manifest
declares pinned `sqlite-vec@0.1.9` as an optional peer; a vector-enabled VPS
installs it explicitly, which brings its platform binary. The repository also
retains it as a devDependency for integration tests. `astro`, `wrangler`,
`playwright`, and `miniflare` remain development-only; none belongs on a
consumer's disk.

## Publishing

```bash
# 0. One time per machine — interactive, do this yourself.
npm login

# 1. Clean tree, tests green.
git status --short          # must be empty
pnpm test:all

# 2. Prepare the reviewed release commit before merging it.
#    Move CHANGELOG.md's [Unreleased] items under the exact dated version,
#    set package.json to that same version, and update the compare links.
$EDITOR CHANGELOG.md
$EDITOR package.json

# 3. Merge the release pull request, then check out that exact clean commit.
#    Do not run `npm version`: the reviewed commit already carries the version.
git status --short          # must still be empty

# 4. Prove the tarball works before it becomes permanent (see below).
#    npm publish is irreversible after 72 hours.
bash scripts/verify-pack.sh

# 5. Ship.
npm publish                 # prepack rebuilds dist/npm/sdk.js

# 6. Tag that same commit and publish the generated GitHub release.
git tag -a "v$(node -p 'require("./package.json").version')" \
  -m "titen-memory $(node -p 'require("./package.json").version')"
git push origin "v$(node -p 'require("./package.json").version')"
gh release create "v$(node -p 'require("./package.json").version')" \
  --title "titen-memory $(node -p 'require("./package.json").version')" \
  --notes-file <(scripts/changelog-section.sh)
```

`npm publish` is the right command even though the repo uses pnpm: `pnpm
publish` refuses a dirty tree and re-runs the workspace lifecycle, which buys
nothing here. Either works.

## Changelog and GitHub releases

[`CHANGELOG.md`](../../CHANGELOG.md) is the single source for release notes;
the GitHub release body is generated from it by
[`scripts/changelog-section.sh`](../../scripts/changelog-section.sh) so the two
can never drift. Do not hand-write a release body.

Keep each released changelog section easy to scan:

1. begin with a one- or two-sentence summary when the release needs context;
2. put `### Upgrade notes` first when an operator must migrate or reconfigure;
3. use the applicable Keep a Changelog headings: `Added`, `Changed`,
   `Deprecated`, `Removed`, `Fixed`, and `Security`;
4. omit empty headings; and
5. prefix every incompatible change with **`Breaking:`** and describe the
   required migration in the same item.

**Date every heading in UTC.** The heading date must equal the npm registry
publish date for that exact version, not the maintainer's local calendar day.
A late-evening publish in UTC+7 lands on the previous UTC day, and recording the
local date makes the changelog useless as a cross-reference against registry
metadata. The registry is the authority:

```bash
version=$(node -p 'require("./package.json").version')
curl -s https://registry.npmjs.org/titen-memory \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>
      console.log(JSON.parse(s).time[process.argv[1]].slice(0,10)))' "$version"
grep -n "^## \[$version\]" CHANGELOG.md
```

The two must print the same date. Because the heading is written before the
publish in step 2, re-check it immediately after `npm publish` and correct it in
the same session if the clock crossed midnight UTC. Historical headings for
0.5.7, 0.5.6, 0.5.5, and 0.2.0 were corrected this way on 2026-08-04.

The generator adds the exact install command and links to the install guide,
the matching titen.dev page, and the versioned npm package. These presentation
lines are derived from the version; the release content still comes only from
`CHANGELOG.md`.

Every published version needs a `vN.N.N` tag and a GitHub release. The one
exception on record is **0.1.0**, published from a staging tree before the
packaging work was committed — no commit represents it, so it has no tag.
Do not retrofit one onto a later commit; that would point the tag at code the
release never contained.

### Website handoff

A stable release is not complete until its static discovery surface is live.
After npm `latest`, the annotated tag, and the non-draft GitHub Release agree,
update a clean `titen-web` branch:

```bash
pnpm release:sync <version>
pnpm release:sync <version> --check
pnpm build
```

`release:sync` reads the public GitHub Release, the package and Codex-plugin
manifests at that exact tag, and npm `latest`. It writes a reviewable Markdown
snapshot plus `src/data/release.json`; the website build itself remains offline
and deterministic. If the plugin version did not change, its previous release
date and notes link stay unchanged.

Merge and deploy the reviewed `titen-web` change manually, then smoke
`/version.json`, `/releases/<version>`, the homepage release badge, and both
`titen.dev` hostnames. Do not announce the release as complete before those
checks pass. If published notes need a correction, update `CHANGELOG.md`,
replace the GitHub Release body with regenerated output, then sync and deploy
the website again.

The homepage carries the widest reach and the fewest caveats, so two claims are
checked by hand on every deploy:

- **Stability.** `"channel": "stable"` in `version.json` is a release-channel
  discriminator — `fetchStableRelease()` in `src/runtime/bun/release.ts` rejects
  a manifest without it — and it says nothing about the API. Rendering the bare
  word *stable* beside the version reads as a product-stability claim and
  contradicts both `README.md` and `CHANGELOG.md`. The badge must name the
  channel and disclose pre-1.0, for example `v0.5.7 · stable channel · pre-1.0`.
- **Vectorize.** Cloudflare Vectorize and Workers AI are verified live only on
  the maintainer's isolated `titen-test-*` stack. Every surface says test
  production, not general availability. Table cells and prose in the same
  section must not disagree.

This handoff does not use GitHub Actions, a webhook, a scheduled job, or a
runtime GitHub API request. Roll back a bad website deployment to its previous
Cloudflare Worker version; do not republish an unchanged npm release.

### Where published links live

- `README.md` links once to the stable
  [`titen-memory`](https://www.npmjs.com/package/titen-memory) package page. Its
  npm badge reads the current registry version, so releases do not hard-code a
  version there.
- `CHANGELOG.md` keeps that stable package link near the top. Each released
  version reference points to its GitHub Release, which carries the tag and
  release notes.
- Use `https://www.npmjs.com/package/titen-memory/v/<version>` only when exact
  registry evidence is needed. Do not copy version-specific npm links into the
  README, product docs, or deployment docs.
- `package.json` remains the source for npm's repository, homepage, and issue
  links; do not duplicate that metadata in release notes.

## Verifying a candidate

`scripts/verify-pack.sh` packs the current tree, installs the tarball into a
throwaway directory, and asserts the eight things a broken publish breaks:

1. the packaged README contains no repository-relative references to omitted files;
2. `SECURITY.md` and key-management guidance ship with the package;
3. the dependency tree contains no build toolchain and the CLI reports the package version;
4. `titen bootstrap` creates a database and an API key;
5. `titen serve` answers `/readyz` with every migration applied;
6. plain `node` can `import { TitenClient } from "titen-memory"` and `"titen-memory/sdk"`;
7. a global install under a custom npm prefix exposes an executable `titen` bin;
8. that packed global executable runs with Bun as the only runtime on `PATH`.

The bootstrap and serve checks execute the installed `node_modules/.bin/titen`
entrypoint, so a missing or invalid bin fails without importing npm's private
package normalizer or assuming where npm itself is installed. The gate therefore
works with a system npm and a custom user global prefix as well as an npm
installed under that prefix.

Run it before every publish. It exits non-zero on the first failure.

## After publishing

```bash
bunx titen-memory@latest --help
npm view titen-memory version
```

The npmjs.com page renders `README.md`; its repository-only documentation and
image references use stable absolute GitHub URLs because those files are not in
the package allowlist.

## Supply-chain assurance

The tarball carries **no provenance attestation**, and that is a decision, not
an oversight. `npm publish --provenance` mints a sigstore attestation from the
OIDC token of a supported CI, so it is obtainable only from GitHub Actions or
GitLab CI. This repository runs no GitHub Actions by standing maintainer rule
(see [`CONTRIBUTING.md`](../../CONTRIBUTING.md#repository-stage)) and publishes
by hand to keep the npm credential off a repository secret. Restoring provenance
means reversing that decision, which the top of this file already states
requires a new maintainer decision and an explicit cost budget.

What a consumer can verify today is the registry's own integrity metadata:

```bash
npm audit signatures
npm view titen-memory@<version> dist.integrity dist.shasum dist.fileCount dist.unpackedSize
npm pack titen-memory@<version> && sha256sum titen-memory-<version>.tgz
```

Those checks prove the tarball on disk is byte-for-byte what npm served and that
the registry signed it. They prove nothing about origin: no commit, tree, or
build is bound to the artifact. A consumer who needs that binding must build
from a tagged checkout and compare against `npm pack` themselves.
