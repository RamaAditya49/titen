# Titen Python client

A thin synchronous client over the Titen HTTP API. Standard library only —
`urllib.request`, no `requests`, no `httpx` — to match the zero-dependency npm
package. One file: [`titen.py`](./titen.py).

It covers the core agent loop and deliberately nothing else:

```
observe -> consolidate -> compile context -> read evidence
```

Every other route in [`docs/reference/api.md`](../../docs/reference/api.md) is
reachable through `Titen.request` without a wrapper method.

## Install

Python 3.10 or newer.

```bash
pip install ./clients/python        # from a checkout
```

Or copy `titen.py` next to your code. It imports nothing outside the standard
library, so vendoring it is a supported use.

## Use

Start a server and mint a key first:

```bash
pnpm titen bootstrap --org 'My Org'
pnpm titen serve
```

```python
import os
from titen import Titen, TitenError

titen = Titen("http://127.0.0.1:8787", os.environ["TITEN_API_KEY"])

observation = titen.observe(
    subject_id="user_x",
    kind="tool_result",
    content="Production smoke returned 200 application/json.",
    source={"type": "tool", "ref": "deploy_456#smoke"},
)

result = titen.consolidate("user_x", [{
    "kind": "episodic_event",
    "statement": "The deploy_456 smoke returned 200.",
    "confidence": 0.9,
    "sources": [
        {"observation_id": observation["observation_id"], "relation": "supports"},
    ],
}])

pack = titen.compile_context("user_x", "deployment status", max_tokens=900)
for item in pack["items"]:
    print(item["score"], item["claim"])

trace = titen.evidence(result["claims"][0]["claim_id"])
print(trace["evidence"]["supporting"])
```

Anything else on the contract goes through the same authenticated transport:

```python
titen.request("GET", "/readyz")
titen.request("POST", "/v1/checkpoints", json={...}, idempotency_key="run-1")
```

## What the client does and does not do

- Returns the success envelope's `data`. Envelope `meta` is not surfaced; use
  the TypeScript SDK's `requestWithMeta` if you need replay state.
- Titen never derives claims. The caller authors every claim and each one needs
  supporting evidence in the same subject, project, and workspace scope.
- Compiled items carry `untrusted: True`. That is provenance for your prompt
  assembly, not an enforcement claim — treat memory as untrusted data.
- Omitting `project_id` on `compile_context` selects only claims with no
  project. It is never a wildcard; `cross_project=True` is the only all-project
  mode and needs the separate `context:compile:all` capability.

## Errors

Every HTTP, transport, and envelope failure raises `TitenError` with `status`,
`code`, `message`, and `request_id` taken from Titen's error envelope. A
connection failure is `status=0, code="CONNECTION_ERROR"`; a timeout is
`status=0, code="TIMEOUT"`. Raw `urllib` exceptions never escape.

The API key is stripped of surrounding whitespace and carriage returns before
it reaches a header, and a key that still contains a control or non-ASCII byte
is rejected with an error that does not quote it. This is not cosmetic: a key
read from a CRLF `.env` file arrives with a trailing `\r`, and `http.client`
then raises `ValueError("Invalid header value b'Bearer titen_sk_...\r\n'")`,
putting the live bearer token into the traceback and any log that captures it.
3xx responses are never followed, because `urllib` would replay the
`Authorization` header at the redirect target.

## Checks

```bash
python3 test_titen.py                                   # offline checks only
TITEN_URL=http://127.0.0.1:8787 TITEN_API_KEY=titen_sk_... \
  python3 test_titen.py                                 # + live round trip
```

Plain asserts, no framework. The live path runs the full loop against a running
server and asserts the consolidated claim comes back out of `compile_context`
and `evidence`.
