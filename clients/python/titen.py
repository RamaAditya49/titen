"""Titen — minimal synchronous Python client for the Titen memory service.

Standard library only, to match the zero-dependency npm package. It covers the
core agent loop and nothing else:

    observe -> consolidate -> compile context -> read evidence

Every other route in ``docs/reference/api.md`` is reachable through
:meth:`Titen.request` without a wrapper method.

    import os
    from titen import Titen

    titen = Titen("http://127.0.0.1:8787", os.environ["TITEN_API_KEY"])

    obs = titen.observe(
        subject_id="user_x",
        kind="tool_result",
        content="Production smoke returned 200 application/json.",
        source={"type": "tool", "ref": "deploy_456#smoke"},
    )
    result = titen.consolidate("user_x", [{
        "kind": "episodic_event",
        "statement": "The deploy_456 smoke returned 200.",
        "sources": [
            {"observation_id": obs["observation_id"], "relation": "supports"},
        ],
    }])
    pack = titen.compile_context("user_x", "deployment status", max_tokens=900)
    trace = titen.evidence(result["claims"][0]["claim_id"])
"""

from __future__ import annotations

import json as _json
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Iterable, Mapping

__all__ = ["Titen", "TitenError", "__version__"]
__version__ = "0.1.0"


class TitenError(Exception):
    """A bounded API error carrying Titen's own error envelope.

    It never contains the API key. ``http.client`` raises
    ``ValueError("Invalid header value %r" % value)``, which puts a raw bearer
    token into a traceback, so this client validates header values itself and
    raises without quoting them.
    """

    def __init__(
        self,
        status: int,
        code: str,
        message: str,
        request_id: str | None = None,
    ) -> None:
        suffix = f" (request_id={request_id})" if request_id else ""
        super().__init__(f"[{status} {code}] {message}{suffix}")
        self.status = status
        self.code = code
        self.message = message
        self.request_id = request_id


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """Fail closed on 3xx: urllib replays Authorization at the new host."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: D102
        return None


def _header_value(value: str, label: str) -> str:
    """Return a header-safe copy of ``value`` or raise without quoting it.

    A key read from a CRLF ``.env`` file arrives with a trailing ``\\r``, which
    is the failure this strip exists for.
    """
    if not isinstance(value, str):
        raise TypeError(f"{label} must be a string")
    cleaned = value.strip()
    if not cleaned:
        raise ValueError(f"{label} is required")
    if any(not ("\x20" <= character <= "\x7e") for character in cleaned):
        raise ValueError(
            f"{label} contains characters that cannot appear in an HTTP header "
            "(check the source file for CRLF line endings or non-ASCII bytes); "
            "the value is not shown"
        )
    return cleaned


def _body(**fields: Any) -> dict[str, Any]:
    return {name: value for name, value in fields.items() if value is not None}


def _data(status: int, raw: bytes, content_type: str, request_id: str | None) -> Any:
    if not raw:
        return None
    if "json" not in content_type.lower():
        raise TitenError(status, "INVALID_RESPONSE", "Response was not JSON.", request_id)
    try:
        payload = _json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        raise TitenError(
            status, "INVALID_RESPONSE", "Response was not valid JSON.", request_id
        ) from None
    if not isinstance(payload, dict):
        raise TitenError(
            status,
            "INVALID_RESPONSE",
            "Response was not a valid object envelope.",
            request_id,
        )
    return payload.get("data")


def _api_error(error: urllib.error.HTTPError) -> TitenError:
    request_id = error.headers.get("x-request-id") if error.headers else None
    code = "HTTP_ERROR"
    message = f"Request failed with status {error.code}."
    try:
        payload = _json.loads(error.read().decode("utf-8"))
    except Exception:  # noqa: BLE001 — any unparsable body falls back to the status.
        payload = None
    if isinstance(payload, dict):
        envelope = payload.get("error")
        if isinstance(envelope, dict):
            code = envelope.get("code") or code
            message = envelope.get("message") or message
        meta = payload.get("meta")
        if isinstance(meta, dict) and isinstance(meta.get("request_id"), str):
            request_id = meta["request_id"]
    return TitenError(error.code, code, message, request_id)


class Titen:
    """Synchronous client for one Titen deployment and one API key."""

    def __init__(self, base_url: str, api_key: str, timeout: float = 20.0) -> None:
        if not isinstance(base_url, str):
            raise TypeError("base_url must be a string")
        parsed = urllib.parse.urlsplit(base_url)
        if parsed.scheme not in ("http", "https") or not parsed.netloc:
            raise ValueError("base_url must be an absolute http(s) URL")
        if not isinstance(timeout, (int, float)) or timeout <= 0:
            raise ValueError("timeout must be a positive number of seconds")
        self.base_url = base_url.rstrip("/")
        self.timeout = float(timeout)
        self._authorization = "Bearer " + _header_value(api_key, "api_key")
        self._opener = urllib.request.build_opener(_NoRedirect())

    # --- transport ---

    def request(
        self,
        method: str,
        path: str,
        json: Any = None,
        idempotency_key: str | None = None,
    ) -> Any:
        """Authenticated JSON call returning the success envelope's ``data``.

        Raises :class:`TitenError` for any HTTP, transport, or envelope failure.
        """
        if not isinstance(path, str) or not path.startswith("/") or path.startswith("//"):
            raise ValueError("path must be an absolute API path")
        body = None if json is None else _json.dumps(json).encode("utf-8")
        request = urllib.request.Request(self.base_url + path, data=body, method=method)
        request.add_header("authorization", self._authorization)
        request.add_header("accept", "application/json")
        request.add_header("user-agent", f"titen-python/{__version__}")
        if body is not None:
            request.add_header("content-type", "application/json")
        if idempotency_key is not None:
            key = _header_value(idempotency_key, "idempotency_key")
            if len(key) > 200:
                raise ValueError("idempotency_key must contain 1 to 200 characters")
            request.add_header("idempotency-key", key)
        try:
            with self._opener.open(request, timeout=self.timeout) as response:
                return _data(
                    response.status,
                    response.read(),
                    response.headers.get("content-type", ""),
                    response.headers.get("x-request-id"),
                )
        except urllib.error.HTTPError as error:
            raise _api_error(error) from None
        except urllib.error.URLError as error:
            raise TitenError(
                0, "CONNECTION_ERROR", f"{self.base_url} is unreachable: {error.reason}"
            ) from None
        except TimeoutError:
            raise TitenError(
                0, "TIMEOUT", f"{self.base_url} did not respond within {self.timeout}s."
            ) from None

    # --- core loop ---

    def observe(
        self,
        subject_id: str,
        kind: str,
        content: str,
        source: Mapping[str, Any],
        *,
        trust: str | None = None,
        visibility: str | None = None,
        workspace_id: str | None = None,
        project_id: str | None = None,
        agent_id: str | None = None,
        run_id: str | None = None,
        occurred_at: str | None = None,
        idempotency_key: str | None = None,
    ) -> dict[str, Any]:
        """``POST /v1/observations`` — append one evidence record.

        ``kind`` is one of ``user_statement``, ``tool_result``,
        ``imported_source``, ``decision``, ``system_event``. ``source`` is
        ``{"type": ..., "ref": ..., "id": ...}`` where only ``type`` is required.
        """
        return self.request(
            "POST",
            "/v1/observations",
            json=_body(
                subject_id=subject_id,
                kind=kind,
                content=content,
                source=dict(source),
                trust=trust,
                visibility=visibility,
                workspace_id=workspace_id,
                project_id=project_id,
                agent_id=agent_id,
                run_id=run_id,
                occurred_at=occurred_at,
            ),
            idempotency_key=idempotency_key,
        )

    def consolidate(
        self,
        subject_id: str,
        claims: Iterable[Mapping[str, Any]],
        *,
        project_id: str | None = None,
        workspace_id: str | None = None,
        idempotency_key: str | None = None,
    ) -> dict[str, Any]:
        """``POST /v1/consolidations`` — materialize caller-authored claims.

        Each claim is ``{"kind", "statement", "sources": [{"observation_id",
        "relation"}], ...}``. Titen performs no extraction; the caller authors
        the claim and every claim needs evidence in the same scope.
        """
        return self.request(
            "POST",
            "/v1/consolidations",
            json=_body(
                subject_id=subject_id,
                claims=[dict(claim) for claim in claims],
                project_id=project_id,
                workspace_id=workspace_id,
            ),
            idempotency_key=idempotency_key,
        )

    def compile_context(
        self,
        subject_id: str,
        task: str,
        *,
        max_tokens: int = 1200,
        project_id: str | None = None,
        cross_project: bool | None = None,
        max_candidates: int | None = None,
        top_k: int | None = None,
        at: str | None = None,
        include_checkpoints: bool | None = None,
    ) -> dict[str, Any]:
        """``POST /v1/context/compile`` — compile a task-specific context pack.

        ``max_tokens`` accepts 128 through 32,000. Omitting ``project_id``
        selects only claims with no project; it is never a wildcard.
        ``top_k`` accepts 1 through 1,000 and hard-caps the returned items;
        omitting it leaves ``max_tokens`` as the only bound.
        """
        return self.request(
            "POST",
            "/v1/context/compile",
            json=_body(
                subject_id=subject_id,
                task=task,
                max_tokens=max_tokens,
                project_id=project_id,
                cross_project=cross_project,
                max_candidates=max_candidates,
                top_k=top_k,
                at=at,
                include_checkpoints=include_checkpoints,
            ),
        )

    def evidence(self, claim_id: str) -> dict[str, Any]:
        """``GET /v1/claims/:id/evidence`` — the claim and its observations."""
        quoted = urllib.parse.quote(str(claim_id), safe="")
        return self.request("GET", f"/v1/claims/{quoted}/evidence")
