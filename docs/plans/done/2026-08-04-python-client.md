---
work_id: python-client-20260804
status: done
stage: done
outcome: completed
complexity: simple
created: 2026-08-04
updated: 2026-08-04
owner: ramaaditya
spec: docs/specs/done/2026-08-04-python-client.md
---

# Minimal Python client plan

## Steps

- [x] Read `docs/reference/api.md` and `src/sdk.ts` to take the real request and
  response shapes for observations, consolidations, context compilation, and
  claim evidence, and to copy the success and error envelope handling rather
  than invent it.
- [x] Write `clients/python/titen.py`: one `Titen` class, one `TitenError`, four
  typed methods for the core loop, and one generic `request`. Standard library
  only, `urllib.request`.
- [x] Strip and validate every header value before it reaches `http.client`, and
  raise without quoting the value. Refuse to follow 3xx so `urllib` cannot
  replay the `Authorization` header at a redirect target.
- [x] Write `clients/python/test_titen.py` with plain asserts: offline checks
  that always run, and a live round trip when `TITEN_URL` and `TITEN_API_KEY`
  are set.
- [x] Bootstrap a throwaway organization and database under the scratchpad, serve
  it on loopback port 8799, and run the round trip for real.
- [x] Reproduce the CRLF token leak against a copy of the module with the guard
  removed, to prove the check is load-bearing.
- [x] Add `pyproject.toml` and `README.md`, build the wheel, install it into a
  throwaway virtual environment, and rerun the round trip from the installed
  module.
- [x] Run `node scripts/check-workflow-docs.mjs`.

## Acceptance evidence

All output below is from a live Bun/SQLite server on `127.0.0.1:8799` backed by
a throwaway database and organization created for this work. No real store was
touched. Keys are never reproduced here.

**AC-PY-001.** `python3 test_titen.py` with `TITEN_URL` and `TITEN_API_KEY` set:

```
offline checks passed
live round trip passed: obs_da78b10427bb463d94c3001868679bb3 -> claim_360964234bb24d97b6db3d6f76f2efe9
ok
exit=0
```

The same run seen from the server:

```
POST /v1/observations 201 27ms req_0f5dc9eb774c40b5b02fff91180f2cbc
POST /v1/consolidations 201 8ms req_6eb6fb3ca1264ce69408d7f8eb751fb5
POST /v1/context/compile 200 8ms req_04c446de2adf4d2b82006e89fff9707d
GET /v1/claims/claim_360964234bb24d97b6db3d6f76f2efe9/evidence 200 2ms req_e1ae4e13f50e46a2b445228b65a2a4a4
GET /v1/claims/claim_does_not_exist/evidence 404 2ms req_3dcb4f1be53846ba80784de7fccf87b9
```

The round trip asserts that the consolidated statement appears in
`compile_context` items and that `evidence` returns exactly the originating
observation as supporting evidence.

**AC-PY-002.** The module imports `json`, `urllib.error`, `urllib.parse`,
`urllib.request`, and `typing`. Nothing else. The wheel declares
`dependencies = []` and installed with `--no-index` into an empty virtual
environment.

**AC-PY-003.** The live round trip constructs the client with the API key plus a
deliberate trailing `\r\n`, which is how a key arrives from a CRLF environment
file, and every request above authenticated normally. The offline check asserts
the resulting header is exactly `Bearer titen_sk_test`.

**AC-PY-004.** With the strip and validation removed from a scratchpad copy of
the module, the offline check fails:

```
File ".../nostrip/test_titen.py", line 26, in check_offline
  assert Titen("http://127.0.0.1:1", " titen_sk_test\r\n")._authorization == (
AssertionError
exit=1
```

and the same unguarded copy reproduces the issue #233 leak against the live
server. The token in this transcript is redacted by hand; the raw output
contained the live bearer token:

```
ValueError: Invalid header value b'Bearer titen_sk_LEAKED-TOKEN-WOULD-APPEAR-HERE\r\n'
```

The shipped module raises `ValueError` stating the value is not shown, and the
offline check asserts the key substring is absent from that message.

**AC-PY-005.** The round trip requests `GET /v1/claims/claim_does_not_exist/evidence`
and asserts a `TitenError` with `status == 404` and a non-empty `code` and
`message`. The server log line above confirms the 404 was real.

**AC-PY-006.** The offline check compiles context against `http://127.0.0.1:1`
and asserts `TitenError` with `status == 0`, `code == "CONNECTION_ERROR"`, and
the API key absent from the message. A timeout maps to `code == "TIMEOUT"` on
the same path.

**AC-PY-007.** `Titen.request(method, path, json=None, idempotency_key=None)`
returns the success envelope's `data` and is the documented route to everything
the four typed methods do not cover.

**AC-PY-008.** `python3 -m pip wheel . --no-deps`:

```
Building wheel for titen-memory (pyproject.toml): finished with status 'done'
Created wheel for titen-memory: filename=titen_memory-0.1.0-py3-none-any.whl size=6886
Successfully built titen-memory
```

Installed into a throwaway virtual environment and rerun:

```
offline checks passed
live round trip passed: obs_0bb31b2bc0594a7996e2dd1ee8543a9d -> claim_a5633aa662a74f0590698b7ba4b717dd
ok
exit=0
installed module: titen.py 0.1.0
```

## Verification

- Live loop, source module: `python3 test_titen.py` with `TITEN_URL` and
  `TITEN_API_KEY` set. Exit 0.
- Live loop, installed wheel: same command under the throwaway virtual
  environment. Exit 0.
- Guard regression: the scratchpad copy without the strip exits 1 and leaks the
  bearer token into a `ValueError`.
- Packaging: `python3 -m pip wheel . --no-deps` builds
  `titen_memory-0.1.0-py3-none-any.whl` with no dependencies.
- Workflow documents: `node scripts/check-workflow-docs.mjs` passes.

Nothing under `src/**` changed, so the dual-runtime contract suite is unaffected
by this work. The npm `files` allowlist is unchanged, so `clients/python` is not
added to the published npm tarball.

## Deliberate omissions

- No async client, no retries, no session or connection pooling. Add when a
  caller measures the loopback synchronous path as the bottleneck.
- No wrappers for the other routes, checkpoints, leases, handoffs, events, or
  the Memory Atlas. Add a typed method when a Python caller actually uses one.
- Not published to PyPI. The wheel builds; publishing is a maintainer release
  action with its own decision.
