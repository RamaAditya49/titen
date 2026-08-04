---
work_id: python-client-20260804
status: done
stage: done
outcome: completed
complexity: simple
created: 2026-08-04
updated: 2026-08-04
owner: ramaaditya
---

# Minimal Python client

## Outcome

Completed. `clients/python/` ships a single-file, standard-library-only
synchronous client over the existing REST contract, covering the core agent
loop only. The full `observe -> consolidate -> compile -> evidence` round trip
was verified against a live Bun/SQLite server on `127.0.0.1:8799`, both from
the source file and from an installed wheel. No repository dependency, build
step, or npm package content changed.

## Problem

Strategic debt item 5 in `PONYTAIL-DEBT.md`: Titen ships a TypeScript SDK and a
Bun CLI only. Mem0 does 3,833,479 PyPI downloads per month, `graphiti-core`
1,548,307, and `honcho-ai` 746,380. The absence of any Python entry point
excludes most of the addressable market regardless of kernel quality, and
silence on the subject reads as oversight rather than a decision.

A second, narrower problem is recorded in issue #233 and was reproduced during
the 2026-08-04 benchmark: an API key read from a CRLF file carries a trailing
`\r`, and `http.client` then raises
`ValueError("Invalid header value b'Bearer titen_sk_...\r\n'")`. The live
bearer token lands in the traceback and in anything that logs it.

## Scope

- One module, `clients/python/titen.py`, plus a README and a `pyproject.toml`.
- Standard library only: `urllib.request`. No `requests`, no `httpx`, no
  code generation, no packaging framework.
- Typed methods for `POST /v1/observations`, `POST /v1/consolidations`,
  `POST /v1/context/compile`, and `GET /v1/claims/:id/evidence`, plus one
  generic authenticated `request` for the rest of the contract.
- Bearer auth, an explicit timeout, and a bounded error type that surfaces the
  API's own error envelope.
- Header-value sanitation that never quotes the key.

## Out of scope

- Wrapping the remaining routes. The generic `request` reaches them in one line.
- Async, streaming, connection pooling, retries, or a session abstraction.
- Publishing to PyPI, a release pipeline, or CI. The wheel builds locally and
  the publish decision is a separate maintainer action.
- Any change to `src/**`, the npm package contents, or the TypeScript SDK.

## EARS acceptance criteria

- **AC-PY-001 — Event-driven:** When a caller constructs the client with a base
  URL and an API key and then calls `observe`, `consolidate`,
  `compile_context`, and `evidence` against a running server, the client shall
  complete the loop and return the consolidated claim from both
  `compile_context` and `evidence`.

- **AC-PY-002 — Ubiquitous:** The client shall import nothing outside the
  Python standard library.

- **AC-PY-003 — Event-driven:** When an API key carries surrounding whitespace
  or carriage returns, the client shall strip them before the value reaches an
  HTTP header, so a key read from a CRLF file authenticates normally.

- **AC-PY-004 — Unwanted behavior:** If a header value still contains a
  character that cannot appear in an HTTP header after stripping, then the
  client shall reject it with an error whose text does not contain the value.

- **AC-PY-005 — Event-driven:** When the API returns an error envelope, the
  client shall raise a single bounded error type carrying the envelope's
  status, code, message, and request identifier instead of a raw `urllib`
  exception.

- **AC-PY-006 — Unwanted behavior:** If the server is unreachable or does not
  answer within the configured timeout, then the client shall raise the same
  bounded error type with the API key absent from its text.

- **AC-PY-007 — Optional feature:** Where a caller needs a route without a
  typed method, the client shall provide one authenticated `request` method
  that returns the success envelope's `data`.

- **AC-PY-008 — Event-driven:** When the project is built with its
  `pyproject.toml`, the build shall produce an installable wheel whose module
  runs the same verified round trip.
