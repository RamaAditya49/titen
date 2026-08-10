---
work_id: mcp-local-mode-diagnosability
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-08-10
updated: 2026-08-10
owner: ramaaditya
spec: docs/specs/done/2026-08-10-mcp-local-mode-diagnosability.md
---
# Plan

- [x] Print one stderr line from `runLocalMcpStdio` naming the store and the two
      unset variables. (AC-MLD-001)
- [x] Carry the same fact in band: an optional `mcpInstructionsNote` on
      `AppContext`, set only by `openLocalStore`, appended to the `initialize`
      instructions in `src/core/mcp.ts`. (AC-MLD-001, AC-MLD-002)
- [x] Log the endpoint and the caught reason in the bridge's `catch`, with the
      existing key redaction, and put the HTTP status in the reason when the
      upstream answer is not JSON-RPC. (AC-MLD-003, AC-MLD-004)
- [x] Add `*.key`, `*.pem`, `*.p12` and `secrets/` to `.gitignore`. (AC-MLD-005)
- [x] Correct `docs/reference/api.md` and extend `docs/agent-guide.md`.
      (AC-MLD-006)
- [x] Run the contract, integration, workflow, route and Worker checks and
      record the output. (all)

## Evidence mapping

- AC-MLD-001: `tests/integration/local-mode.test.ts` asserts the exact stderr
  line and that the handshake instructions contain the store path and the
  sentence naming both variables.
- AC-MLD-002: `tests/integration/mcp-protocol.test.ts` holds the served
  instructions to its five phrases and to 512 characters.
- AC-MLD-003: `tests/integration/mcp-stdio.test.ts` captures `console.error`
  over a dead port and asserts three lines for two replies, each naming the
  endpoint, none containing the key.
- AC-MLD-004: the same test's message shape, plus reading the throw site: the
  status is interpolated and the body is not.
- AC-MLD-005: `git check-ignore` on `titen.key`, `keys/owner.key`,
  `secrets/x.pem`, `certs/a.p12`; `git ls-files -i -c --exclude-standard` for
  the tracked-file regression.
- AC-MLD-006: the diff of `docs/reference/api.md`, read against what the code
  emits.

## Security, migration, deployment, rollback

No schema change, no dependency, no configuration flag. The added log line
prints a URL and an error message; the response body is never printed because
it carries memory content, and the API key is redacted the same way it is
redacted out of a body. The instructions note is local-mode only, so no served
deployment changes what it returns. Roll back as one commit.

## Acceptance evidence

- AC-MLD-001: `bun test tests/integration/local-mode.test.ts` passes. stderr is
  asserted equal to `titen: no TITEN_MCP_URL/TITEN_API_KEY set; serving the
  local store` followed by the temporary home's `.titen/memory.db` and one
  newline, and nothing else, and the handshake
  instructions are asserted to contain that path and
  `neither TITEN_MCP_URL nor TITEN_API_KEY was set`.
- AC-MLD-002: `tests/integration/mcp-protocol.test.ts` passes unchanged,
  including its `instructions.length <= 512` assertion, because `openLocalStore`
  is the only caller that sets the note.
- AC-MLD-003: `tests/integration/mcp-stdio.test.ts` passes with the new
  assertions. Three lines were logged for three failed messages — a request, a
  notification, and a second request — where the notification previously left
  no reply and no trace. Each matches
  `^titen: http://127.0.0.1:9/mcp failed: .`; none contains the key.
- AC-MLD-004: same suite. The reason for the dead port is
  `Unable to connect. Is the computer able to access the url?`; a non-JSON-RPC
  answer now reads `HTTP 401 was not a JSON-RPC response` for a revoked key,
  with the status interpolated and no body.
- AC-MLD-005: `git check-ignore -q` returns 0 for `titen.key`,
  `keys/owner.key`, `secrets/x.pem`, `certs/a.p12` and `secrets/notes.md`, and
  `git ls-files -i -c --exclude-standard` returns nothing, so no tracked file
  became ignored.
- AC-MLD-006: the "Adopting an existing store" paragraph no longer claims a
  first run with no graph warns on stderr, which the code never did; the "Local
  mode" section now names both announcements and says a served deployment
  appends nothing.

## Verification

```text
$ bun test tests/contract/bun-sqlite.test.ts
 114 pass
 0 fail
Ran 114 tests across 1 file. [9.99s]
exit 0

$ pnpm test:api
ℹ tests 123
ℹ pass 123
ℹ fail 0
 151 pass
 0 fail
Ran 151 tests across 3 files. [10.41s]
exit 0

$ pnpm test:integration
 221 pass
 0 fail
Ran 221 tests across 28 files. [33.38s]
exit 0

$ pnpm check:workflow
workflow docs OK (116 artifacts)
workflow checker self-test OK
Ponytail debt ledger OK (1 tracked markers).
exit 0

$ pnpm check:routes
route docs OK (84 routes)
exit 0

$ pnpm build:worker
Total Upload: 639.20 KiB / gzip: 133.42 KiB
--dry-run: exiting now.
exit 0

$ pnpm typecheck
exit 2 — 106 errors, all pre-existing
```

`pnpm typecheck` is red at HEAD and this change does not move it. Baseline
taken in a detached worktree at `6211fd6`: 106 errors, exit 2. After this
change: 106 errors, exit 2, and the two sorted error lists are identical. Every
one of them is in `tests/`, `scripts/` or a `docs/testing/**/harness` file;
`src/` is clean, which is the boundary `65075ec` set.

`pnpm test` (Playwright) and `pnpm verify:dashboard-live` were not run: this
change touches no dashboard surface, and neither browser binaries nor a live
instance are part of what it can affect.
