---
work_id: mcp-local-mode-diagnosability
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-08-10
updated: 2026-08-10
owner: ramaaditya
---
# Local mode and a failed bridge both say which store answered

## Problem

On `rama-tuf`, 0.7.3 serving `~/titen.db` on `127.0.0.1:8787` held one active
claim under subject `caraka`. `POST /v1/context/compile` with
`{"subject_id":"caraka","task":"oxfmt prettier","max_tokens":800}` returned one
item. A coding agent calling `titen_compile` with the same subject and the same
task received zero. The bridge reported healthy: connected, eighteen tools
listed, and writes through it landed in a database.

They landed in a different database. `~/.claude.json` carried a project-scoped
registration for `/home/ramaaditya/Project/caraka` running `titen mcp` with an
empty `env`, which shadowed the user-scoped entry that had both variables. With
neither variable set, `runMcpStdio` falls back to `runLocalMcpStdio` and serves
`~/.titen/memory.db`. The fallback is correct behaviour and Titen cannot fix a
host's configuration. What Titen can fix is that nothing in either stream named
the store, so the only reading available to the caller was "no memory".

The same function hides the opposite failure. A wrong `TITEN_API_KEY` and a
dead port both produced exit 0, empty stderr, and the identical
`-32000 Titen MCP request failed.`, because the catch discarded the error. For
a notification there was no reply either, so the failure left no trace at all.

Separately, `.gitignore` covers databases thoroughly and key material not at
all. `git check-ignore` confirmed `titen.key`, `keys/owner.key` and
`secrets/x.pem` were all committable. This is the repository whose CLI prints
an API key and a dashboard password, and whose default `--db` is relative to
the working directory, so the repository root is a place those commands get run.

## Scope

Name the local store in band as well as on stderr; name the endpoint and reason
when a bridged request fails; ignore key material; correct the API reference
where it already described a warning the code does not emit.

## Out of scope

The lexical-versus-semantic behaviour of `compile` on an instance with
embeddings disabled. That is configuration, measured and recorded in Caraka's
`docs/integrasi-ekosistem.md`, not a defect here.

Making the fallback refusable. A client that means to bridge still has no way
to ask for a hard failure instead of local mode; that is a design decision with
its own cost, and it is not taken in this change.

## Constraints and risks

The response body is redacted for the API key before anything is printed, and
is never printed itself, because it carries memory content. The added
`instructions` clause is local-mode only: a served deployment appends nothing,
and `tests/integration/mcp-protocol.test.ts` holds the served string to 512
characters.

## Acceptance criteria

- **AC-MLD-001 — State-driven:** While `titen mcp` runs with neither
  `TITEN_MCP_URL` nor `TITEN_API_KEY` set, Titen shall name the opened store
  path and both unset variables in the `instructions` string of the
  `initialize` result.
- **AC-MLD-002 — State-driven:** While a served deployment answers
  `initialize`, Titen shall return the instructions string unchanged and within
  512 characters.
- **AC-MLD-003 — Unwanted behavior:** If a bridged MCP request fails, then
  Titen shall write one stderr line naming the endpoint and the caught reason,
  with the API key redacted, for a notification as well as for a request.
- **AC-MLD-004 — Event-driven:** When an upstream response is not JSON-RPC,
  Titen shall report the HTTP status as the reason and shall not report the
  response body.
- **AC-MLD-005 — Ubiquitous:** Titen's `.gitignore` shall ignore `*.key`,
  `*.pem`, `*.p12` and `secrets/`, and no currently tracked file shall become
  ignored by that addition.
- **AC-MLD-006 — Ubiquitous:** `docs/reference/api.md` shall describe both
  announcements of local mode and shall not claim a stderr warning that the
  code does not emit.

## Done conditions

Every criterion has a run recorded in the plan; the dual-runtime contract suite
and the integration suite pass; the Worker dry-run builds; the workflow and
route-doc checks pass; spec and plan are in `done/`.
