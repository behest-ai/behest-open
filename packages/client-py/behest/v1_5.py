"""Behest v1.5 dual-mode SDK — Python parity with @behest/client-ts v1.5.

See SDK_SPEC.md §8 for the parity requirements. Everything in this module mirrors
the TypeScript surface 1:1: env var contract, method names, error taxonomy,
and mode detection logic.

Public surface:
    from behest import Behest, generate_session_id
    behest = Behest()
    behest.auth.mint(user_id="u_1", session_id="s_1")
    behest.chat.completions.create(model="...", messages=[...], stream=True)
    behest.threads.list() / get(id) / delete(id) / messages(id)
    behest.usage.get(from_=..., to=..., granularity="day")
"""

from __future__ import annotations

import base64
import json
import os
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, AsyncIterable, Callable, Iterable, Iterator, Optional, Union

import httpx
import jwt as pyjwt
from cryptography.hazmat.primitives.serialization import load_pem_private_key


# ============================================================================
# Errors — mirror TS error taxonomy (errors.ts). See SDK_SPEC.md §3.7.
# ============================================================================


class BehestError(Exception):
    """Base error for all Behest v1.5 SDK errors."""

    def __init__(
        self,
        message: str,
        *,
        status: Optional[int] = None,
        code: Optional[str] = None,
        trace_id: Optional[str] = None,
        raw: Any = None,
    ) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.trace_id = trace_id
        self.raw = raw


class BehestConfigError(BehestError):
    def __init__(self, message: str, **kwargs: Any) -> None:
        kwargs.setdefault("code", "bad_key_format")
        super().__init__(message, **kwargs)


class BehestAuthError(BehestError):
    def __init__(self, message: str = "Authentication failed", **kwargs: Any) -> None:
        kwargs.setdefault("status", 401)
        kwargs.setdefault("code", "invalid_token")
        super().__init__(message, **kwargs)


class BehestQuotaError(BehestError):
    def __init__(self, message: str = "Quota exceeded", **kwargs: Any) -> None:
        kwargs.setdefault("status", 402)
        kwargs.setdefault("code", "quota_exceeded")
        super().__init__(message, **kwargs)


class BehestRateLimitError(BehestError):
    def __init__(
        self,
        message: str = "Rate limited",
        *,
        retry_after: Optional[int] = None,
        **kwargs: Any,
    ) -> None:
        kwargs.setdefault("status", 429)
        kwargs.setdefault("code", "rate_limited")
        super().__init__(message, **kwargs)
        self.retry_after = retry_after


class BehestServerError(BehestError):
    def __init__(self, message: str, **kwargs: Any) -> None:
        kwargs.setdefault("status", 500)
        kwargs.setdefault("code", "server_error")
        super().__init__(message, **kwargs)


class BehestBadRequestError(BehestError):
    def __init__(self, message: str = "Bad request", **kwargs: Any) -> None:
        kwargs.setdefault("status", 400)
        kwargs.setdefault("code", "validation_error")
        super().__init__(message, **kwargs)


def classify_http_error(
    status: int,
    *,
    headers: Optional[dict[str, str]] = None,
    body: Any = None,
) -> BehestError:
    """Map an HTTP response tuple to the typed error class."""
    headers = headers or {}
    code: Optional[str] = None
    message = f"HTTP {status}"
    if isinstance(body, dict):
        err = body.get("error")
        if isinstance(err, dict):
            code = err.get("code")
            if err.get("message"):
                message = err["message"]

    trace_id = headers.get("X-Trace-Id") or headers.get("x-trace-id")
    base: dict[str, Any] = {"status": status, "trace_id": trace_id, "raw": body}
    if code:
        base["code"] = code

    if status in (401, 403):
        base.setdefault("code", "forbidden" if status == 403 else "invalid_token")
        return BehestAuthError(message, **base)
    if status == 402:
        base.setdefault("code", "quota_exceeded")
        return BehestQuotaError(message, **base)
    if status == 429:
        retry_after_raw = headers.get("Retry-After") or headers.get("retry-after")
        retry_after = int(retry_after_raw) if retry_after_raw and retry_after_raw.isdigit() else None
        base.setdefault("code", "rate_limited")
        return BehestRateLimitError(message, retry_after=retry_after, **base)
    if status >= 500:
        base.setdefault("code", "server_error")
        return BehestServerError(message, **base)
    if status in (400, 422):
        base.setdefault("code", "validation_error")
        return BehestBadRequestError(message, **base)
    return BehestError(message, **base)


# ============================================================================
# Config / Mode Detection — mirrors config.ts
# ============================================================================


@dataclass
class ResolvedConfig:
    mode: str  # "apiKey" or "sign"
    key: str
    base_url: str
    default_user_id: str
    ttl: int
    issuer: str
    audience: str
    tier: Optional[int] = None
    kid: Optional[str] = None
    tenant_id: Optional[str] = None
    project_id: Optional[str] = None
    http_client: Optional[httpx.Client] = None


DEFAULT_BASE_URL = "https://api.behest.ai"
DEFAULT_USER_ID = "default"
DEFAULT_TTL = 3600
DEFAULT_ISSUER = "https://api.behest.ai"
DEFAULT_AUDIENCE = "behest"

_warn_once: set[str] = set()


def _default_warn(message: str) -> None:
    import warnings

    warnings.warn(f"[behest] {message}", DeprecationWarning, stacklevel=3)


def _reset_warnings() -> None:
    _warn_once.clear()


def _warn_once_fn(warn: Callable[[str], None], tag: str, message: str) -> None:
    if tag in _warn_once:
        return
    _warn_once.add(tag)
    warn(message)


def detect_mode(raw_key: str) -> tuple[str, str]:
    """Detect mode + unwrap key. Returns (mode, key).

    Run-order matches SDK_SPEC.md §2.1:
        1. strip whitespace
        2. behest_sk_live_ → apiKey
        3. behest_pk_ → sign (strip prefix, raw PEM)
        4. try base64 decode → if "BEGIN PRIVATE KEY" → sign
        5. else BehestConfigError
    """
    key = (raw_key or "").strip()
    if not key:
        raise BehestConfigError(
            "BEHEST_KEY must be an API key (behest_sk_live_*) or a base64-encoded RSA private key",
            code="missing_env",
        )
    if key.startswith("behest_sk_live_"):
        return "apiKey", key
    if key.startswith("behest_pk_"):
        return "sign", key[len("behest_pk_") :]
    try:
        decoded = base64.b64decode(key, validate=False).decode("utf-8")
        if "BEGIN PRIVATE KEY" in decoded or "BEGIN RSA PRIVATE KEY" in decoded:
            return "sign", decoded
    except Exception:
        pass
    raise BehestConfigError(
        "BEHEST_KEY must be an API key (behest_sk_live_*) or a base64-encoded RSA private key"
    )


def resolve_config(
    *,
    key: Optional[str] = None,
    api_key: Optional[str] = None,  # deprecated alias
    tenant_id: Optional[str] = None,
    project_id: Optional[str] = None,
    kid: Optional[str] = None,
    base_url: Optional[str] = None,
    default_user_id: Optional[str] = None,
    tier: Optional[int] = None,
    ttl: Optional[int] = None,
    issuer: Optional[str] = None,
    audience: Optional[str] = None,
    http_client: Optional[httpx.Client] = None,
    warn: Optional[Callable[[str], None]] = None,
) -> ResolvedConfig:
    warn_fn: Callable[[str], None] = warn or _default_warn

    resolved_key = key
    if not resolved_key and api_key:
        _warn_once_fn(warn_fn, "opt:api_key", "`api_key` is deprecated; use `key` instead.")
        resolved_key = api_key
    if not resolved_key:
        env_key = os.environ.get("BEHEST_KEY")
        if env_key:
            resolved_key = env_key
        elif os.environ.get("BEHEST_API_KEY"):
            _warn_once_fn(
                warn_fn,
                "env:BEHEST_API_KEY",
                "`BEHEST_API_KEY` is deprecated; rename to `BEHEST_KEY`.",
            )
            resolved_key = os.environ["BEHEST_API_KEY"]
    if not resolved_key:
        raise BehestConfigError(
            "BEHEST_KEY is required but was not set (no BEHEST_KEY or legacy BEHEST_API_KEY in env, and no `key` option passed).",
            code="missing_env",
        )

    mode, unwrapped = detect_mode(resolved_key)

    cfg = ResolvedConfig(
        mode=mode,
        key=unwrapped,
        base_url=base_url or os.environ.get("BEHEST_BASE_URL", DEFAULT_BASE_URL),
        default_user_id=default_user_id or os.environ.get("BEHEST_USER_ID", DEFAULT_USER_ID),
        ttl=ttl if ttl is not None else int(os.environ.get("BEHEST_TTL") or DEFAULT_TTL),
        tier=tier if tier is not None else (int(os.environ["BEHEST_TIER"]) if "BEHEST_TIER" in os.environ else None),
        issuer=issuer or os.environ.get("BEHEST_ISSUER", DEFAULT_ISSUER),
        audience=audience or os.environ.get("BEHEST_AUDIENCE", DEFAULT_AUDIENCE),
        http_client=http_client,
    )

    if mode == "sign":
        resolved_kid = kid or os.environ.get("BEHEST_KID")
        resolved_tid = tenant_id or os.environ.get("BEHEST_TENANT_ID")
        resolved_pid = project_id or os.environ.get("BEHEST_PROJECT_ID")
        missing = [
            name for name, val in (
                ("BEHEST_KID", resolved_kid),
                ("BEHEST_TENANT_ID", resolved_tid),
                ("BEHEST_PROJECT_ID", resolved_pid),
            ) if not val
        ]
        if missing:
            raise BehestConfigError(
                f"Sign mode requires {', '.join(missing)}. Provide them via env or constructor.",
                code="missing_env",
            )
        cfg.kid = resolved_kid
        cfg.tenant_id = resolved_tid
        cfg.project_id = resolved_pid

    return cfg


# ============================================================================
# Helpers — generate_session_id, decode_token
# ============================================================================


def generate_session_id() -> str:
    """Return a UUIDv4 session id string."""
    return str(uuid.uuid4())


def decode_token(token: str) -> dict[str, Any]:
    """Decode a JWT payload (base64url) without verifying the signature."""
    parts = token.split(".")
    if len(parts) != 3:
        raise ValueError("decode_token: expected a 3-part JWT (header.payload.signature)")
    payload_b64 = parts[1]
    padding = "=" * (-len(payload_b64) % 4)
    decoded = base64.urlsafe_b64decode(payload_b64 + padding)
    return json.loads(decoded.decode("utf-8"))


# ============================================================================
# Auth module — apiKey (HTTP) or sign (local RS256)
# ============================================================================


def _is_browser() -> bool:
    """Python has no browser runtime; returns False. Present for API parity."""
    return False


@dataclass
class MintOptions:
    user_id: Optional[str] = None
    session_id: Optional[str] = None
    tier: Optional[int] = None
    ttl: Optional[int] = None
    role: Optional[str] = None


@dataclass
class MintResult:
    token: str
    session_id: str
    ttl: int
    expires_at: int


_private_key_cache: dict[str, Any] = {}


def _load_signing_key(pem: str) -> Any:
    if pem not in _private_key_cache:
        try:
            _private_key_cache[pem] = load_pem_private_key(pem.encode("utf-8"), password=None)
        except Exception as exc:
            raise BehestConfigError(
                f"Invalid RSA private key (expected PEM): {exc}"
            ) from exc
    return _private_key_cache[pem]


class AuthModule:
    """auth.mint() — HTTP in apiKey mode, local RS256 in sign mode."""

    def __init__(self, cfg: ResolvedConfig) -> None:
        if cfg.mode == "sign" and _is_browser():  # pragma: no cover
            raise BehestConfigError(
                "Local signing keys must never be used in the browser. Use API-key mode."
            )
        self.cfg = cfg
        self.last_session_id: Optional[str] = None
        self._http = cfg.http_client or httpx.Client(timeout=30.0)

    def mint(self, **kwargs: Any) -> MintResult:
        opts = MintOptions(**kwargs)
        user_id = opts.user_id or self.cfg.default_user_id
        role = opts.role or "user"
        ttl = opts.ttl if opts.ttl is not None else self.cfg.ttl
        tier = opts.tier if opts.tier is not None else self.cfg.tier
        session_id = opts.session_id or generate_session_id()

        if self.cfg.mode == "apiKey":
            result = self._mint_http(user_id=user_id, role=role, ttl=ttl, tier=tier, session_id=session_id)
        else:
            result = self._sign_local(user_id=user_id, role=role, ttl=ttl, tier=tier, session_id=session_id)
        self.last_session_id = result.session_id
        return result

    def _mint_http(
        self,
        *,
        user_id: str,
        role: str,
        ttl: int,
        tier: Optional[int],
        session_id: str,
    ) -> MintResult:
        url = self.cfg.base_url.rstrip("/") + "/v1/auth/mint"
        body: dict[str, Any] = {
            "user_id": user_id,
            "role": role,
            "ttl": ttl,
            "session_id": session_id,
        }
        if tier is not None:
            body["tier"] = tier
        try:
            resp = self._http.post(
                url,
                headers={
                    "Authorization": f"Bearer {self.cfg.key}",
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                },
                content=json.dumps(body).encode("utf-8"),
            )
        except httpx.HTTPError as exc:
            raise BehestServerError(f"Network error: {exc}", code="network_error", raw=exc) from exc

        if resp.status_code >= 400:
            try:
                parsed = resp.json()
            except Exception:
                parsed = resp.text
            raise classify_http_error(resp.status_code, headers=dict(resp.headers), body=parsed)

        data = resp.json()
        token = data.get("jwt") or data.get("access_token")
        if not token:
            raise BehestServerError("Mint response missing jwt/access_token", raw=data)
        resolved_ttl = data.get("ttl", ttl) if isinstance(data.get("ttl"), int) else ttl
        return MintResult(
            token=token,
            session_id=data.get("session_id", session_id),
            ttl=resolved_ttl,
            expires_at=int(time.time()) + resolved_ttl,
        )

    def _sign_local(
        self,
        *,
        user_id: str,
        role: str,
        ttl: int,
        tier: Optional[int],
        session_id: str,
    ) -> MintResult:
        key = _load_signing_key(self.cfg.key)
        now = int(time.time())
        exp = now + ttl
        # Claim order mirrors services/behest-auth/src/mint.ts:58-71 exactly
        # (tid, pid, uid, role, scp, iss, aud, iat, nbf, exp, jti, sid, tier).
        # Python dict preserves insertion order.
        payload: dict[str, Any] = {
            "tid": self.cfg.tenant_id,
            "pid": self.cfg.project_id,
            "uid": user_id,
            "role": role,
            "scp": [],
            "iss": self.cfg.issuer,
            "aud": self.cfg.audience,
            "iat": now,
            "nbf": now,
            "exp": exp,
            "jti": str(uuid.uuid4()),
            "sid": session_id,
        }
        if tier is not None:
            payload["tier"] = tier
        token = pyjwt.encode(
            payload,
            key=key,
            algorithm="RS256",
            headers={"kid": self.cfg.kid, "typ": "JWT"},
        )
        return MintResult(token=token, session_id=session_id, ttl=ttl, expires_at=exp)


# ============================================================================
# HTTP helper for chat/threads/usage
# ============================================================================


def _resolve_token(auth: AuthModule, token: Optional[str], session_id: Optional[str], **mint_kw: Any) -> str:
    if token:
        return token
    result = auth.mint(session_id=session_id, **mint_kw)
    return result.token


def _session_header(auth: AuthModule, session_id: Optional[str]) -> Optional[str]:
    return session_id or auth.last_session_id


def _json_request(
    cfg: ResolvedConfig,
    auth: AuthModule,
    method: str,
    path: str,
    *,
    token: Optional[str] = None,
    session_id: Optional[str] = None,
    json_body: Any = None,
    query: Optional[dict[str, Any]] = None,
    user_id: Optional[str] = None,
    tier: Optional[int] = None,
) -> Any:
    client = cfg.http_client or httpx.Client(timeout=60.0)
    bearer = _resolve_token(auth, token, session_id, user_id=user_id, tier=tier)
    url = cfg.base_url.rstrip("/") + (path if path.startswith("/") else "/" + path)
    if query:
        q = {k: v for k, v in query.items() if v is not None}
        if q:
            url += ("&" if "?" in url else "?") + "&".join(
                f"{k}={httpx.QueryParams({k: v})[k]}" for k, v in q.items()
            )
    headers: dict[str, str] = {
        "Authorization": f"Bearer {bearer}",
        "Accept": "application/json",
    }
    sid = _session_header(auth, session_id)
    if sid:
        headers["X-Session-Id"] = sid
    body_bytes: Optional[bytes] = None
    if json_body is not None:
        headers["Content-Type"] = "application/json"
        body_bytes = json.dumps(json_body).encode("utf-8")

    try:
        resp = client.request(method, url, headers=headers, content=body_bytes)
    except httpx.HTTPError as exc:
        raise BehestServerError(f"Network error: {exc}", code="network_error", raw=exc) from exc

    if resp.status_code >= 400:
        try:
            parsed = resp.json()
        except Exception:
            parsed = resp.text
        raise classify_http_error(resp.status_code, headers=dict(resp.headers), body=parsed)

    if resp.status_code == 204 or not resp.content:
        return None
    try:
        return resp.json()
    except Exception:
        return resp.text


# ============================================================================
# Chat module — streaming + non-streaming
# ============================================================================


class _CompletionsResource:
    def __init__(self, cfg: ResolvedConfig, auth: AuthModule) -> None:
        self._cfg = cfg
        self._auth = auth

    def create(self, **params: Any) -> Any:
        session_id = params.pop("session_id", None)
        token = params.pop("token", None)
        user_id = params.pop("user_id", None)
        tier = params.pop("tier", None)
        stream = params.get("stream", False)

        bearer = _resolve_token(
            self._auth, token, session_id, user_id=user_id, tier=tier
        )
        url = self._cfg.base_url.rstrip("/") + "/v1/chat/completions"
        headers: dict[str, str] = {
            "Authorization": f"Bearer {bearer}",
            "Content-Type": "application/json",
            "Accept": "text/event-stream" if stream else "application/json",
        }
        sid = _session_header(self._auth, session_id)
        if sid:
            headers["X-Session-Id"] = sid

        client = self._cfg.http_client or httpx.Client(timeout=None)

        if stream:
            return _stream_chat(client, url, headers, params)

        try:
            resp = client.post(url, headers=headers, content=json.dumps(params).encode("utf-8"))
        except httpx.HTTPError as exc:
            raise BehestServerError(f"Network error: {exc}", code="network_error", raw=exc) from exc
        if resp.status_code >= 400:
            try:
                parsed = resp.json()
            except Exception:
                parsed = resp.text
            raise classify_http_error(resp.status_code, headers=dict(resp.headers), body=parsed)
        return resp.json()


class ChatModule:
    def __init__(self, cfg: ResolvedConfig, auth: AuthModule) -> None:
        self.completions = _CompletionsResource(cfg, auth)


def _stream_chat(
    client: httpx.Client,
    url: str,
    headers: dict[str, str],
    body: dict[str, Any],
) -> Iterator[dict[str, Any]]:
    """Yield JSON chunks parsed from an SSE stream.

    Generator closes the underlying response on exit.
    """
    try:
        req = client.stream("POST", url, headers=headers, content=json.dumps(body).encode("utf-8"))
    except httpx.HTTPError as exc:
        raise BehestServerError(f"Network error: {exc}", code="network_error", raw=exc) from exc

    with req as resp:
        if resp.status_code >= 400:
            try:
                parsed = resp.read().decode("utf-8")
                try:
                    parsed = json.loads(parsed)
                except Exception:
                    pass
            except Exception:
                parsed = None
            raise classify_http_error(resp.status_code, headers=dict(resp.headers), body=parsed)

        buffer = ""
        for text in resp.iter_text():
            buffer += text
            while "\n\n" in buffer:
                raw_event, buffer = buffer.split("\n\n", 1)
                data_lines = [
                    line[len("data:") :].lstrip()
                    for line in raw_event.split("\n")
                    if line.startswith("data:")
                ]
                if not data_lines:
                    continue
                data = "\n".join(data_lines)
                if data == "[DONE]":
                    return
                try:
                    yield json.loads(data)
                except Exception as exc:
                    raise BehestError(
                        f"Failed to parse streaming chunk: {exc}",
                        code="stream_parse_error",
                        raw=data,
                    ) from exc


# ============================================================================
# Threads module
# ============================================================================


class ThreadsModule:
    def __init__(self, cfg: ResolvedConfig, auth: AuthModule) -> None:
        self._cfg = cfg
        self._auth = auth

    def list(self, **opts: Any) -> list[dict[str, Any]]:
        return _json_request(self._cfg, self._auth, "GET", "/v1/threads", **opts) or []

    def get(self, thread_id: str, **opts: Any) -> dict[str, Any]:
        return _json_request(self._cfg, self._auth, "GET", f"/v1/threads/{thread_id}", **opts)

    def delete(self, thread_id: str, **opts: Any) -> None:
        _json_request(self._cfg, self._auth, "DELETE", f"/v1/threads/{thread_id}", **opts)

    def messages(self, thread_id: str, **opts: Any) -> list[dict[str, Any]]:
        return (
            _json_request(self._cfg, self._auth, "GET", f"/v1/threads/{thread_id}/messages", **opts)
            or []
        )


# ============================================================================
# Usage module
# ============================================================================


def _serialize_ts(v: Any) -> Optional[str]:
    if v is None:
        return None
    if hasattr(v, "isoformat"):
        return v.isoformat()
    return str(v)


class UsageModule:
    def __init__(self, cfg: ResolvedConfig, auth: AuthModule) -> None:
        self._cfg = cfg
        self._auth = auth

    def get(
        self,
        *,
        from_: Any = None,
        to: Any = None,
        user_id: Optional[str] = None,
        granularity: str = "day",
        **opts: Any,
    ) -> dict[str, Any]:
        try:
            return _json_request(
                self._cfg,
                self._auth,
                "GET",
                "/v1/usage",
                query={
                    "from": _serialize_ts(from_),
                    "to": _serialize_ts(to),
                    "user_id": user_id,
                    "granularity": granularity,
                },
                **opts,
            )
        except BehestError as err:
            if err.status == 404:
                raise BehestError(
                    "Usage endpoint not available on this environment",
                    status=404,
                    code="not_supported",
                    trace_id=err.trace_id,
                    raw=err.raw,
                ) from err
            raise


# ============================================================================
# Top-level Behest class
# ============================================================================


class Behest:
    """Top-level v1.5 SDK entry point. See SDK_SPEC.md §3.1."""

    def __init__(self, **init: Any) -> None:
        warn = init.pop("warn", None)
        self.config = resolve_config(**init, warn=warn)
        self.mode = self.config.mode
        self.auth = AuthModule(self.config)
        self.chat = ChatModule(self.config, self.auth)
        self.threads = ThreadsModule(self.config, self.auth)
        self.usage = UsageModule(self.config, self.auth)
        self._warn = warn

    def mint_token(self, **opts: Any) -> dict[str, Any]:
        """Deprecated v1.x alias for auth.mint(). Returns legacy+new shape."""
        import warnings

        warnings.warn(
            "`mint_token()` is deprecated; use `auth.mint()` instead.",
            DeprecationWarning,
            stacklevel=2,
        )
        # Map legacy param names.
        legacy_opts: dict[str, Any] = {}
        if "userId" in opts:
            legacy_opts["user_id"] = opts.pop("userId")
        if "sessionId" in opts:
            legacy_opts["session_id"] = opts.pop("sessionId")
        legacy_opts.update(opts)
        result = self.auth.mint(**legacy_opts)
        return {
            "token": result.token,
            "session_id": result.session_id,
            "sessionId": result.session_id,
            "ttl": result.ttl,
            "expires_at": result.expires_at,
            "access_token": result.token,
            "expires_in": result.ttl,
        }
