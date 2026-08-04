---
work_id: cli-bun-requirement-error
status: done
stage: done
outcome: completed
complexity: simple
created: 2026-08-04
updated: 2026-08-04
owner: CADIS
spec: docs/specs/done/2026-08-04-cli-bun-requirement-error.md
---
# Plan

- [x] Reproduce issue #244 against the real entry: link `src/runtime/bun/cli.ts`
      the way npm links `node_modules/.bin/titen` and run it with a `PATH` that
      has no Bun.
- [x] Make `src/runtime/bun/cli.ts` mode 0755 so the tracked file is the same
      executable npm publishes and the repository can test the kernel path.
- [x] Replace the shebang with a POSIX shell and TypeScript polyglot: `sh` reads
      one line that checks for Bun, prints a branded error, or execs Bun on the
      same file; TypeScript reads it as a string expression and a comment.
- [x] Cover both directions in `tests/integration/cli.test.ts`: missing Bun, and
      Bun as the only runtime on `PATH`.
- [x] Confirm nothing that already worked regressed, and record where issues
      #221 and #243 actually live.

## Acceptance evidence

AC-CLI-BUN-001. Before the change, the linked bin reproduced the issue exactly:

```
AssertionError: /usr/bin/env: 'bun': No such file or directory
127 !== 1
```

After the change the same invocation produces:

```
titen: error: bun was not found on PATH.
titen: the titen CLI runs on Bun 1.2 or newer. Install it from https://bun.sh, then run titen again.
EXIT=1
```

AC-CLI-BUN-002. The same linked bin, run with a `PATH` whose only entry is a
directory containing a `bun` symlink, prints `0.5.7` and exits 0. This mirrors
`scripts/verify-pack.sh` check 9, "packed global bin without Node", which uses
the same one-entry `PATH`. The check itself is shell builtins only, `command`,
`echo`, `exit`, and `exec`, so it needs nothing else on that `PATH`.

Both criteria are asserted by `the bin names Bun and its install page when Bun
is missing from PATH` in `tests/integration/cli.test.ts`.

## Verification

```
$ bun test tests/integration/cli.test.ts -t "the bin names Bun"
 1 pass
 0 fail

$ bun test tests/integration
 201 pass
 0 fail
 97 expect() calls
Ran 201 tests across 23 files. [28.12s]
```

The contract suite on both runtimes and `node scripts/check-workflow-docs.mjs`
were run for this change; their output is recorded in the delivery report.

No new dependency, file, or abstraction was added. The diff is one shebang line,
one comment, one file mode, and one test.

## Closure reason

Issue #244 is closed by this change. Issues #221 and #243 are recorded in the
spec under "Findings outside this repository" with their exact root cause: both
name artifacts that the `titen-web` repository builds and serves, and neither is
generated from this repository's sources. They are not fixable here, and nothing
was invented to appear to close them.
