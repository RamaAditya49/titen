"""Checks for the Titen Python client. Plain asserts, no test framework.

    python3 test_titen.py                        # offline checks only
    TITEN_URL=http://127.0.0.1:8787 \
      TITEN_API_KEY=titen_sk_... python3 test_titen.py   # + live round trip

The live round trip is the real check: it runs observe -> consolidate ->
compile -> evidence against a running server and asserts the claim comes back.
"""

import os
import sys

from titen import Titen, TitenError


def check_offline() -> None:
    for bad_url in ("", "127.0.0.1:8787", "ftp://host", "/v1"):
        try:
            Titen(bad_url, "titen_sk_test")
            raise AssertionError(f"accepted a non-absolute base_url: {bad_url!r}")
        except ValueError:
            pass

    # A key from a CRLF file has a trailing \r. It must be stripped, not rejected.
    assert Titen("http://127.0.0.1:1", " titen_sk_test\r\n")._authorization == (
        "Bearer titen_sk_test"
    )

    # An embedded CRLF is a header injection, and its error must not leak the key.
    secret = "titen_sk_secret\r\nX-Injected: 1"
    try:
        Titen("http://127.0.0.1:1", secret)
        raise AssertionError("accepted a key containing CRLF")
    except ValueError as error:
        assert "titen_sk_secret" not in str(error), "error text leaked the api key"
        assert "not shown" in str(error), str(error)

    # A transport failure is a bounded TitenError, not a raw urllib exception.
    try:
        Titen("http://127.0.0.1:1", "titen_sk_test", timeout=2).compile_context(
            "user_x", "anything"
        )
        raise AssertionError("expected a connection failure")
    except TitenError as error:
        assert error.status == 0 and error.code == "CONNECTION_ERROR", error
        assert "titen_sk_test" not in str(error), "error text leaked the api key"

    print("offline checks passed")


def check_round_trip(url: str, api_key: str) -> None:
    # Trailing CRLF on purpose: this is how a key arrives from a CRLF env file.
    titen = Titen(url, api_key + "\r\n")
    subject = "user_pyclient"

    observation = titen.observe(
        subject_id=subject,
        kind="tool_result",
        content="The pyclient smoke returned 200 application/json.",
        source={"type": "tool", "ref": "pyclient#smoke"},
    )
    assert observation["observation_id"].startswith("obs_"), observation
    assert observation["subject_id"] == subject, observation

    consolidation = titen.consolidate(
        subject,
        [
            {
                "kind": "episodic_event",
                "statement": "The pyclient smoke returned 200.",
                "confidence": 0.9,
                "sources": [
                    {
                        "observation_id": observation["observation_id"],
                        "relation": "supports",
                    }
                ],
            }
        ],
    )
    assert consolidation["model_used"] is False, consolidation
    claim_id = consolidation["claims"][0]["claim_id"]
    assert claim_id.startswith("claim_"), consolidation

    pack = titen.compile_context(subject, "pyclient smoke result", max_tokens=900)
    assert pack["context_id"].startswith("ctx_"), pack
    statements = [item["claim"] for item in pack["items"]]
    assert "The pyclient smoke returned 200." in statements, statements
    assert all(item["untrusted"] is True for item in pack["items"]), pack["items"]

    trace = titen.evidence(claim_id)
    assert trace["claim"]["claim_id"] == claim_id, trace
    supporting = trace["evidence"]["supporting"]
    assert [entry["observation_id"] for entry in supporting] == [
        observation["observation_id"]
    ], supporting

    # The API's own error envelope survives as a bounded TitenError.
    try:
        titen.evidence("claim_does_not_exist")
        raise AssertionError("expected a 404")
    except TitenError as error:
        assert error.status == 404, error
        assert error.code and error.message, error

    print(f"live round trip passed: {observation['observation_id']} -> {claim_id}")


if __name__ == "__main__":
    check_offline()
    url, api_key = os.environ.get("TITEN_URL"), os.environ.get("TITEN_API_KEY")
    if url and api_key:
        check_round_trip(url, api_key)
    else:
        print("SKIPPED live round trip: set TITEN_URL and TITEN_API_KEY", file=sys.stderr)
    print("ok")
