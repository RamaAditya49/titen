---
work_id: cli-bun-requirement-error
status: done
stage: done
outcome: completed
complexity: simple
created: 2026-08-04
updated: 2026-08-04
owner: CADIS
---
# Titen-branded Bun requirement on the package bin

## Problem

`titen-memory` publishes one executable. `bin.titen` points at
`src/runtime/bun/cli.ts`, and npm and pnpm link that file straight into
`node_modules/.bin`, so the kernel reads its shebang before any Titen code
exists. With `#!/usr/bin/env bun` a machine without Bun on `PATH` produced:

```
env: 'bun': No such file or directory
EXIT=127
```

That is env(1) speaking, not Titen. It names neither the product nor the
requirement, and 127 is the shell's "command not found" code rather than a
Titen failure. Titen already handles the comparable port collision well, with
`error: port 8787 is already in use` and exit 1. This is issue #244, and it is a
new user's first experience when a Node-only install goes wrong.

The file was also mode 0644 in the tree. npm sets the bin executable when it
links it, which is why the defect only appeared after install and could not be
reproduced against the repository checkout.

## In scope

- One branded, actionable failure at the single point every subcommand reaches.
- Keep every working entry working: `bun src/runtime/bun/cli.ts`, `pnpm titen`,
  `bunx`, the npm and pnpm global bins, and a `PATH` whose only runtime is Bun.

## Out of scope

- Installing Bun automatically. The CLI is not an installer.
- A guard inside each subcommand. There is one entry, so there is one check.
- The `titen.dev` release manifest from issue #221 and the hosted `install.sh`
  from issue #243. Both artifacts are built and served by the separate
  `titen-web` repository, not by this one. See "Findings outside this
  repository".

## Constraints and risks

- `scripts/verify-pack.sh` check 9 runs the packed global bin with a `PATH`
  containing only Bun. The check may therefore use shell builtins only.
- npm's `cmd-shim` derives the Windows `.cmd` interpreter from this same
  shebang line. A POSIX shell shebang makes that shim call `sh`, which is not
  normally on a Windows command PATH. The documented Windows path is
  `install.ps1`, which runs `bun add --global`, and Bun's own shims do not read
  the shebang, so the documented path is unaffected. Windows npm global installs
  are not smoked anywhere in this repository and are not claimed by this change.

## EARS acceptance criteria

- **AC-CLI-BUN-001 — Unwanted behavior:** If the packaged `titen` bin is invoked
  while no `bun` executable resolves on `PATH`, then Titen shall exit non-zero
  with a message that names Titen, names Bun 1.2 or newer as the requirement,
  and gives the Bun install page.
- **AC-CLI-BUN-002 — State-driven:** While Bun is the only runtime on `PATH`,
  the packaged `titen` bin shall still start the CLI and report the exact
  package version.

## Findings outside this repository

Two issues in this cluster describe artifacts that this repository neither
contains nor generates. They are recorded here so the fix lands where the drift
actually is.

### Issue #221, the stale plugin block in `version.json`

`https://titen.dev/version.json` is rendered by `src/pages/version.json.ts` in
`titen-web` from `src/data/release.json` there. That data file is written by
`titen-web/scripts/sync-release.mjs`, which reads the plugin version from
`plugins/titen-memory/.codex-plugin/plugin.json` in this repository at the
release tag. At `v0.5.7` that manifest still reads `0.1.0` while the published
Claude and Cursor manifests read `0.2.0`. Because `sync-release.mjs` treats an
unchanged version as "plugin did not ship", it copies the previous plugin block
verbatim, which is also why the plugin `notes` link is frozen at the 0.4.0
release page. One stale manifest produces both halves of the issue. The single
source of truth to correct is that Codex manifest, or the manifest that
`sync-release.mjs` reads. Neither file is owned by this work.

### Issue #243, the installer success banner

`install.sh` is `public/install.sh` in `titen-web`. It verifies the binary by
absolute path, `"$(bun pm bin -g)/titen" --version`, and never checks
`command -v titen`, so it prints its success banner and next steps even when the
caller cannot invoke `titen`. The fix belongs in that file, immediately before
the banner. Nothing in this repository serves or generates that script.
