"""Tests for Behest v1.5 dual-mode SDK (Python parity with TS)."""

from __future__ import annotations

import base64
import json
import os
from unittest.mock import patch, MagicMock

import httpx
import jwt as pyjwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives import serialization

from behest.v1_5 import (
    AuthModule,
    Behest,
    BehestAuthError,
    BehestBadRequestError,
    BehestConfigError,
    BehestError,
    BehestQuotaError,
    BehestRateLimitError,
    BehestServerError,
    ChatModule,
    ThreadsModule,
    UsageModule,
    classify_http_error,
    decode_token,
    detect_mode,
    generate_session_id,
    resolve_config,
    _reset_warnings,
)


# ============================================================================
# Shared fixtures
# ============================================================================


@pytest.fixture
def rsa_pem() -> str:
    """Generate a test RSA private key PEM."""
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    return key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode("utf-8")


@pytest.fixture
def rsa_public_pem(rsa_pem: str) -> str:
    key = serialization.load_pem_private_key(rsa_pem.encode(), password=None)
    return key.public_key().public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode("utf-8")


@pytest.fixture
def clean_env():
    saved = {k: v for k, v in os.environ.items() if k.startswith("BEHEST_")}
    for k in list(os.environ.keys()):
        if k.startswith("BEHEST_"):
            del os.environ[k]
    _reset_warnings()
    yield
    for k in list(os.environ.keys()):
        if k.startswith("BEHEST_"):
            del os.environ[k]
    os.environ.update(saved)


# ============================================================================
# Error taxonomy
# ============================================================================


class TestErrors:
    def test_BehestError_carries_status_code_traceId_raw(self):
        e = BehestError("boom", status=500, code="server_error", trace_id="t", raw={"x": 1})
        assert str(e) == "boom"
        assert e.status == 500
        assert e.code == "server_error"
        assert e.trace_id == "t"
        assert e.raw == {"x": 1}

    def test_default_subclass_statuses(self):
        assert BehestAuthError("x").status == 401
        assert BehestAuthError("x").code == "invalid_token"
        assert BehestQuotaError("x").status == 402
        assert BehestRateLimitError("x").status == 429
        assert BehestServerError("x").status == 500
        assert BehestBadRequestError("x").status == 400
        assert BehestConfigError("x").code == "bad_key_format"

    def test_rate_limit_retry_after(self):
        e = BehestRateLimitError("slow", retry_after=5)
        assert e.retry_after == 5

    def test_classify_401_to_auth(self):
        e = classify_http_error(401, headers={}, body={"error": {"code": "invalid_token"}})
        assert isinstance(e, BehestAuthError)

    def test_classify_402_to_quota(self):
        e = classify_http_error(402, body={"error": {"code": "tier_limit"}})
        assert isinstance(e, BehestQuotaError)
        assert e.code == "tier_limit"

    def test_classify_429_with_retry_after(self):
        e = classify_http_error(429, headers={"Retry-After": "7"})
        assert isinstance(e, BehestRateLimitError)
        assert e.retry_after == 7

    def test_classify_500(self):
        assert isinstance(classify_http_error(500), BehestServerError)

    def test_classify_400_422(self):
        assert isinstance(classify_http_error(400), BehestBadRequestError)
        assert isinstance(classify_http_error(422), BehestBadRequestError)

    def test_classify_unknown_to_generic(self):
        e = classify_http_error(418)
        assert type(e) is BehestError
        assert e.status == 418

    def test_classify_trace_id(self):
        e = classify_http_error(500, headers={"X-Trace-Id": "abc"})
        assert e.trace_id == "abc"


# ============================================================================
# Mode detection
# ============================================================================


class TestDetectMode:
    def test_apikey_prefix(self):
        assert detect_mode("behest_sk_live_abc") == ("apiKey", "behest_sk_live_abc")

    def test_pk_prefix_unwraps_raw_pem(self, rsa_pem: str):
        mode, unwrapped = detect_mode("behest_pk_" + rsa_pem)
        assert mode == "sign"
        # Leading prefix stripped; trailing whitespace/newlines are also stripped
        # per §2.1 step 1 ("strip leading/trailing whitespace from BEHEST_KEY").
        assert unwrapped == rsa_pem.rstrip()

    def test_base64_wrapped_pem(self, rsa_pem: str):
        b64 = base64.b64encode(rsa_pem.encode()).decode()
        mode, unwrapped = detect_mode(b64)
        assert mode == "sign"
        assert "BEGIN PRIVATE KEY" in unwrapped

    def test_strips_whitespace(self):
        mode, key = detect_mode("  behest_sk_live_xyz  \n")
        assert mode == "apiKey"
        assert key == "behest_sk_live_xyz"

    def test_empty_raises_config_error(self):
        with pytest.raises(BehestConfigError):
            detect_mode("")

    def test_garbage_base64_raises(self):
        not_pem = base64.b64encode(b"hello world").decode()
        with pytest.raises(BehestConfigError):
            detect_mode(not_pem)

    def test_raw_invalid_raises(self):
        with pytest.raises(BehestConfigError):
            detect_mode("not-a-key")


# ============================================================================
# Config resolution
# ============================================================================


class TestResolveConfig:
    def test_env_apikey_default_fields(self, clean_env):
        os.environ["BEHEST_KEY"] = "behest_sk_live_x"
        cfg = resolve_config()
        assert cfg.mode == "apiKey"
        assert cfg.base_url == "https://api.behest.ai"
        assert cfg.default_user_id == "default"
        assert cfg.ttl == 3600

    def test_legacy_BEHEST_API_KEY_env_with_warning(self, clean_env):
        os.environ["BEHEST_API_KEY"] = "behest_sk_live_legacy"
        warnings: list[str] = []
        cfg = resolve_config(warn=lambda m: warnings.append(m))
        assert cfg.key == "behest_sk_live_legacy"
        assert any("BEHEST_API_KEY" in w for w in warnings)

    def test_explicit_api_key_alias_with_warning(self, clean_env):
        warnings: list[str] = []
        cfg = resolve_config(api_key="behest_sk_live_alias", warn=lambda m: warnings.append(m))
        assert cfg.key == "behest_sk_live_alias"
        assert any("api_key" in w for w in warnings)

    def test_sign_mode_missing_vars_raises(self, clean_env, rsa_pem: str):
        os.environ["BEHEST_KEY"] = "behest_pk_" + rsa_pem
        with pytest.raises(BehestConfigError):
            resolve_config()

    def test_sign_mode_with_full_env(self, clean_env, rsa_pem: str):
        os.environ["BEHEST_KEY"] = "behest_pk_" + rsa_pem
        os.environ["BEHEST_KID"] = "sk_kid"
        os.environ["BEHEST_TENANT_ID"] = "t1"
        os.environ["BEHEST_PROJECT_ID"] = "p1"
        cfg = resolve_config()
        assert cfg.mode == "sign"
        assert cfg.kid == "sk_kid"
        assert cfg.tenant_id == "t1"
        assert cfg.project_id == "p1"

    def test_explicit_options_override_env(self, clean_env):
        os.environ["BEHEST_KEY"] = "behest_sk_live_env"
        cfg = resolve_config(key="behest_sk_live_explicit")
        assert cfg.key == "behest_sk_live_explicit"

    def test_missing_key_raises(self, clean_env):
        with pytest.raises(BehestConfigError):
            resolve_config()


# ============================================================================
# Helpers
# ============================================================================


class TestHelpers:
    def test_generate_session_id_uuid_v4_format(self):
        import re

        sid = generate_session_id()
        assert re.match(
            r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", sid
        )

    def test_generate_unique(self):
        assert generate_session_id() != generate_session_id()

    def test_decode_token(self):
        payload = {"sub": "123", "tid": "t1"}
        token = "header." + base64.urlsafe_b64encode(
            json.dumps(payload).encode()
        ).decode().rstrip("=") + ".sig"
        assert decode_token(token) == payload

    def test_decode_token_malformed(self):
        with pytest.raises(ValueError):
            decode_token("notajwt")


# ============================================================================
# AuthModule — apiKey mode
# ============================================================================


def _mock_http_client_with(response_payloads: list[tuple[int, dict, dict | None]]) -> httpx.Client:
    """Build an httpx.Client with a MockTransport returning queued responses."""
    idx = {"i": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        i = min(idx["i"], len(response_payloads) - 1)
        idx["i"] += 1
        status, body, headers = response_payloads[i]
        return httpx.Response(
            status,
            json=body if body is not None else None,
            headers=headers or {},
        )

    return httpx.Client(transport=httpx.MockTransport(handler))


class TestAuthApiKey:
    def test_mint_posts_and_parses(self, clean_env):
        client = _mock_http_client_with(
            [(200, {"jwt": "server.jwt", "ttl": 3600, "session_id": "s_123"}, None)]
        )
        from behest.v1_5 import ResolvedConfig

        cfg = ResolvedConfig(
            mode="apiKey",
            key="behest_sk_live_x",
            base_url="https://api.example",
            default_user_id="default",
            ttl=3600,
            issuer="i",
            audience="a",
            http_client=client,
        )
        auth = AuthModule(cfg)
        result = auth.mint(user_id="u_1", session_id="s_123", tier=2)
        assert result.token == "server.jwt"
        assert result.session_id == "s_123"
        assert result.ttl == 3600

    def test_mint_auto_generates_session_id(self, clean_env):
        client = _mock_http_client_with([(200, {"jwt": "t", "ttl": 60}, None)])
        from behest.v1_5 import ResolvedConfig

        cfg = ResolvedConfig(
            mode="apiKey",
            key="behest_sk_live_x",
            base_url="https://api.example",
            default_user_id="default",
            ttl=60,
            issuer="i",
            audience="a",
            http_client=client,
        )
        auth = AuthModule(cfg)
        result = auth.mint(user_id="u")
        # UUIDv4 format check
        import re

        assert re.match(r"^[0-9a-f]{8}-", result.session_id)

    def test_mint_401_raises_auth_error(self, clean_env):
        client = _mock_http_client_with(
            [(401, {"error": {"code": "invalid_token", "message": "bad"}}, None)]
        )
        from behest.v1_5 import ResolvedConfig

        cfg = ResolvedConfig(
            mode="apiKey",
            key="behest_sk_live_x",
            base_url="https://api.example",
            default_user_id="default",
            ttl=60,
            issuer="i",
            audience="a",
            http_client=client,
        )
        with pytest.raises(BehestAuthError):
            AuthModule(cfg).mint(user_id="u")


# ============================================================================
# AuthModule — sign mode
# ============================================================================


class TestAuthSign:
    def test_signs_rs256_with_all_claims(self, clean_env, rsa_pem: str, rsa_public_pem: str):
        from behest.v1_5 import ResolvedConfig

        cfg = ResolvedConfig(
            mode="sign",
            key=rsa_pem,
            base_url="https://api.example",
            default_user_id="default",
            ttl=900,
            issuer="https://api.behest.ai",
            audience="behest",
            kid="sk_kid",
            tenant_id="t_abc",
            project_id="p_xyz",
            tier=2,
        )
        auth = AuthModule(cfg)
        result = auth.mint(user_id="u_1", session_id="s_1")
        parts = result.token.split(".")
        assert len(parts) == 3

        # Header
        header = pyjwt.get_unverified_header(result.token)
        assert header["alg"] == "RS256"
        assert header["kid"] == "sk_kid"
        assert header["typ"] == "JWT"

        # Claims — verify signature with public key
        claims = pyjwt.decode(result.token, rsa_public_pem, algorithms=["RS256"], audience="behest")
        assert claims["tid"] == "t_abc"
        assert claims["pid"] == "p_xyz"
        assert claims["uid"] == "u_1"
        assert claims["role"] == "user"
        assert claims["scp"] == []
        assert claims["iss"] == "https://api.behest.ai"
        assert claims["aud"] == "behest"
        assert claims["sid"] == "s_1"
        assert claims["tier"] == 2
        assert claims["exp"] == claims["iat"] + 900
        assert claims["nbf"] == claims["iat"]
        assert claims["jti"]

    def test_claim_order_matches_mint_ts(self, clean_env, rsa_pem: str):
        from behest.v1_5 import ResolvedConfig

        cfg = ResolvedConfig(
            mode="sign",
            key=rsa_pem,
            base_url="https://api.example",
            default_user_id="default",
            ttl=60,
            issuer="i",
            audience="a",
            kid="sk_kid",
            tenant_id="t",
            project_id="p",
            tier=2,
        )
        auth = AuthModule(cfg)
        token = auth.mint(user_id="u", session_id="s").token
        payload_b64 = token.split(".")[1]
        padding = "=" * (-len(payload_b64) % 4)
        decoded = json.loads(base64.urlsafe_b64decode(payload_b64 + padding).decode())
        assert list(decoded.keys()) == [
            "tid", "pid", "uid", "role", "scp",
            "iss", "aud", "iat", "nbf", "exp", "jti",
            "sid", "tier",
        ]

    def test_tier_omitted_when_unset(self, clean_env, rsa_pem: str):
        from behest.v1_5 import ResolvedConfig

        cfg = ResolvedConfig(
            mode="sign",
            key=rsa_pem,
            base_url="x",
            default_user_id="default",
            ttl=60,
            issuer="i",
            audience="a",
            kid="sk_kid",
            tenant_id="t",
            project_id="p",
        )
        token = AuthModule(cfg).mint(user_id="u").token
        payload_b64 = token.split(".")[1]
        padding = "=" * (-len(payload_b64) % 4)
        decoded = json.loads(base64.urlsafe_b64decode(payload_b64 + padding).decode())
        assert "tier" not in decoded

    def test_invalid_pem_raises_config_error(self, clean_env):
        from behest.v1_5 import ResolvedConfig, _private_key_cache

        _private_key_cache.clear()
        cfg = ResolvedConfig(
            mode="sign",
            key="not-a-pem",
            base_url="x",
            default_user_id="default",
            ttl=60,
            issuer="i",
            audience="a",
            kid="sk_kid",
            tenant_id="t",
            project_id="p",
        )
        with pytest.raises(BehestConfigError):
            AuthModule(cfg).mint(user_id="u")


# ============================================================================
# ThreadsModule
# ============================================================================


class TestThreads:
    def test_list(self, clean_env):
        client = _mock_http_client_with(
            [
                (200, {"jwt": "tk", "ttl": 60}, None),
                (200, [{"id": "t1"}, {"id": "t2"}], None),
            ]
        )
        from behest.v1_5 import ResolvedConfig

        cfg = ResolvedConfig(
            mode="apiKey", key="behest_sk_live_x", base_url="https://api.example",
            default_user_id="default", ttl=60, issuer="i", audience="a", http_client=client,
        )
        auth = AuthModule(cfg)
        threads = ThreadsModule(cfg, auth)
        result = threads.list()
        assert len(result) == 2
        assert result[0]["id"] == "t1"

    def test_get_and_delete_and_messages(self, clean_env):
        # Auth does not cache tokens — each call re-mints before the actual op.
        client = _mock_http_client_with(
            [
                (200, {"jwt": "tk", "ttl": 60}, None),  # mint for get
                (200, {"id": "t1"}, None),
                (200, {"jwt": "tk", "ttl": 60}, None),  # mint for delete
                (204, None, None),
                (200, {"jwt": "tk", "ttl": 60}, None),  # mint for messages
                (200, [{"role": "user", "content": "hi"}], None),
            ]
        )
        from behest.v1_5 import ResolvedConfig

        cfg = ResolvedConfig(
            mode="apiKey", key="behest_sk_live_x", base_url="https://api.example",
            default_user_id="default", ttl=60, issuer="i", audience="a", http_client=client,
        )
        auth = AuthModule(cfg)
        threads = ThreadsModule(cfg, auth)
        assert threads.get("t1")["id"] == "t1"
        # delete returns None
        assert threads.delete("t1") is None
        msgs = threads.messages("t1")
        assert msgs[0]["content"] == "hi"


# ============================================================================
# UsageModule
# ============================================================================


class TestUsage:
    def test_get_query_params(self, clean_env):
        client = _mock_http_client_with(
            [
                (200, {"jwt": "tk", "ttl": 60}, None),
                (200, {"totals": {"tokens": 100}, "breakdown": []}, None),
            ]
        )
        from behest.v1_5 import ResolvedConfig

        cfg = ResolvedConfig(
            mode="apiKey", key="behest_sk_live_x", base_url="https://api.example",
            default_user_id="default", ttl=60, issuer="i", audience="a", http_client=client,
        )
        auth = AuthModule(cfg)
        usage = UsageModule(cfg, auth)
        report = usage.get(from_="2026-04-01", to="2026-04-13", user_id="u", granularity="day")
        assert report["totals"]["tokens"] == 100

    def test_404_maps_to_not_supported(self, clean_env):
        client = _mock_http_client_with(
            [
                (200, {"jwt": "tk", "ttl": 60}, None),
                (404, {"error": {"message": "not shipped"}}, None),
            ]
        )
        from behest.v1_5 import ResolvedConfig

        cfg = ResolvedConfig(
            mode="apiKey", key="behest_sk_live_x", base_url="https://api.example",
            default_user_id="default", ttl=60, issuer="i", audience="a", http_client=client,
        )
        auth = AuthModule(cfg)
        usage = UsageModule(cfg, auth)
        with pytest.raises(BehestError) as exc_info:
            usage.get()
        assert exc_info.value.code == "not_supported"
        assert exc_info.value.status == 404


# ============================================================================
# ChatModule — non-streaming + streaming
# ============================================================================


class TestChat:
    def test_create_non_streaming(self, clean_env):
        client = _mock_http_client_with(
            [
                (200, {"jwt": "tk", "ttl": 60}, None),
                (
                    200,
                    {"id": "c", "choices": [{"message": {"role": "assistant", "content": "hi"}}]},
                    None,
                ),
            ]
        )
        from behest.v1_5 import ResolvedConfig

        cfg = ResolvedConfig(
            mode="apiKey", key="behest_sk_live_x", base_url="https://api.example",
            default_user_id="default", ttl=60, issuer="i", audience="a", http_client=client,
        )
        auth = AuthModule(cfg)
        chat = ChatModule(cfg, auth)
        result = chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": "hi"}],
            session_id="s_call",
        )
        assert result["choices"][0]["message"]["content"] == "hi"

    def test_create_streaming(self, clean_env):
        # Use custom transport that yields a streaming body.
        events = (
            'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n'
            'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n'
            'data: [DONE]\n\n'
        )

        responses = [
            (200, {"jwt": "tk", "ttl": 60}, None),
        ]
        idx = {"i": 0}

        def handler(request: httpx.Request) -> httpx.Response:
            if idx["i"] == 0:
                idx["i"] += 1
                s, b, h = responses[0]
                return httpx.Response(s, json=b, headers=h or {})
            # Stream response
            return httpx.Response(
                200,
                content=events.encode(),
                headers={"content-type": "text/event-stream"},
            )

        client = httpx.Client(transport=httpx.MockTransport(handler))
        from behest.v1_5 import ResolvedConfig

        cfg = ResolvedConfig(
            mode="apiKey", key="behest_sk_live_x", base_url="https://api.example",
            default_user_id="default", ttl=60, issuer="i", audience="a", http_client=client,
        )
        auth = AuthModule(cfg)
        chat = ChatModule(cfg, auth)
        iterator = chat.completions.create(
            model="m",
            messages=[{"role": "user", "content": "hi"}],
            stream=True,
        )
        pieces = []
        for chunk in iterator:
            c = chunk["choices"][0]["delta"].get("content")
            if c:
                pieces.append(c)
        assert "".join(pieces) == "Hello"

    def test_create_streaming_401_raises_before_iteration(self, clean_env):
        idx = {"i": 0}

        def handler(request: httpx.Request) -> httpx.Response:
            if idx["i"] == 0:
                idx["i"] += 1
                return httpx.Response(200, json={"jwt": "tk", "ttl": 60})
            return httpx.Response(
                401,
                json={"error": {"code": "invalid_token"}},
            )

        client = httpx.Client(transport=httpx.MockTransport(handler))
        from behest.v1_5 import ResolvedConfig

        cfg = ResolvedConfig(
            mode="apiKey", key="behest_sk_live_x", base_url="https://api.example",
            default_user_id="default", ttl=60, issuer="i", audience="a", http_client=client,
        )
        auth = AuthModule(cfg)
        chat = ChatModule(cfg, auth)
        # Calling create() itself raises because the helper opens the stream
        # and inspects status before returning the iterator.
        gen = chat.completions.create(
            model="m",
            messages=[{"role": "user", "content": "x"}],
            stream=True,
        )
        with pytest.raises(BehestAuthError):
            list(gen)


# ============================================================================
# Top-level Behest
# ============================================================================


class TestBehestClass:
    def test_no_env_raises(self, clean_env):
        with pytest.raises(BehestConfigError):
            Behest()

    def test_with_key_builds_modules(self, clean_env):
        b = Behest(key="behest_sk_live_x")
        assert b.auth is not None
        assert b.chat is not None
        assert b.chat.completions is not None
        assert b.threads is not None
        assert b.usage is not None
        assert b.mode == "apiKey"

    def test_sign_mode_missing_kid_raises(self, clean_env, rsa_pem):
        with pytest.raises(BehestConfigError):
            Behest(key="behest_pk_" + rsa_pem)

    def test_mint_token_legacy_alias(self, clean_env):
        client = _mock_http_client_with([(200, {"jwt": "t", "ttl": 60, "session_id": "s"}, None)])
        b = Behest(key="behest_sk_live_x", http_client=client)
        with pytest.warns(DeprecationWarning):
            legacy = b.mint_token(userId="u_legacy")
        assert legacy["token"] == "t"
        assert legacy["access_token"] == "t"
        assert legacy["expires_in"] == 60
        assert legacy["session_id"] == "s"
