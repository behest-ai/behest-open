"""Tests for behest.client — BehestClient and BehestSigningClient."""

import os
import time
from unittest.mock import patch, MagicMock

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa


@pytest.fixture
def rsa_keypair():
    """Generate a fresh RSA 2048-bit keypair for testing."""
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    private_pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode("utf-8")
    return private_pem


class TestBehestClient:
    """BehestClient extends openai.OpenAI."""

    def test_inherits_from_openai(self):
        from openai import OpenAI

        from behest.client import BehestClient

        client = BehestClient(api_key="bh_live_test123")
        assert isinstance(client, OpenAI)

    def test_default_base_url(self):
        from behest.client import BehestClient

        client = BehestClient(api_key="bh_live_test123")
        assert str(client.base_url).rstrip("/") == "https://api.behest.ai/v1"

    def test_custom_base_url(self):
        from behest.client import BehestClient

        client = BehestClient(
            api_key="bh_live_test123",
            base_url="https://custom.behest.ai/v1",
        )
        assert "custom.behest.ai" in str(client.base_url)

    def test_api_key_from_env(self):
        from behest.client import BehestClient

        with patch.dict(os.environ, {"BEHEST_API_KEY": "bh_live_envkey"}):
            client = BehestClient()
            assert client.api_key == "bh_live_envkey"

    def test_explicit_api_key_overrides_env(self):
        from behest.client import BehestClient

        with patch.dict(os.environ, {"BEHEST_API_KEY": "bh_live_envkey"}):
            client = BehestClient(api_key="bh_live_explicit")
            assert client.api_key == "bh_live_explicit"

    def test_end_user_id_injected_as_header(self):
        from behest.client import BehestClient

        client = BehestClient(api_key="bh_live_test123", end_user_id="alice")
        # The header should be set in default_headers
        assert client._custom_headers.get("X-End-User-Id") == "alice"

    def test_no_end_user_id_header_when_not_provided(self):
        from behest.client import BehestClient

        client = BehestClient(api_key="bh_live_test123")
        assert "X-End-User-Id" not in client._custom_headers

    def test_base_url_from_env(self):
        from behest.client import BehestClient

        with patch.dict(os.environ, {"BEHEST_BASE_URL": "https://staging.behest.ai/v1"}):
            client = BehestClient(api_key="bh_live_test123")
            assert "staging.behest.ai" in str(client.base_url)

    def test_kwargs_passed_through(self):
        from behest.client import BehestClient

        # max_retries is a valid OpenAI constructor param
        client = BehestClient(api_key="bh_live_test123", max_retries=5)
        assert client.max_retries == 5


class TestBehestSigningClient:
    """BehestSigningClient uses local JWT signing."""

    def test_inherits_from_openai(self, rsa_keypair):
        from openai import OpenAI

        from behest.client import BehestSigningClient

        client = BehestSigningClient(
            signing_key_pem=rsa_keypair,
            key_id="sk_abc123def456789012345678abcdef01",
            tenant_id="tid-001",
            project_id="pid-001",
        )
        assert isinstance(client, OpenAI)

    def test_default_base_url(self, rsa_keypair):
        from behest.client import BehestSigningClient

        client = BehestSigningClient(
            signing_key_pem=rsa_keypair,
            key_id="sk_abc123def456789012345678abcdef01",
            tenant_id="tid-001",
            project_id="pid-001",
        )
        assert str(client.base_url).rstrip("/") == "https://api.behest.ai/v1"

    def test_custom_base_url(self, rsa_keypair):
        from behest.client import BehestSigningClient

        client = BehestSigningClient(
            signing_key_pem=rsa_keypair,
            key_id="sk_abc123def456789012345678abcdef01",
            tenant_id="tid-001",
            project_id="pid-001",
            base_url="https://dev.behest.ai/v1",
        )
        assert "dev.behest.ai" in str(client.base_url)

    def test_kid_must_start_with_sk_(self, rsa_keypair):
        from behest.errors import BehestError
        from behest.client import BehestSigningClient

        with pytest.raises(BehestError, match="sk_"):
            BehestSigningClient(
                signing_key_pem=rsa_keypair,
                key_id="bad_prefix",
                tenant_id="tid-001",
                project_id="pid-001",
            )

    def test_sign_token_method_exists(self, rsa_keypair):
        from behest.client import BehestSigningClient

        client = BehestSigningClient(
            signing_key_pem=rsa_keypair,
            key_id="sk_abc123def456789012345678abcdef01",
            tenant_id="tid-001",
            project_id="pid-001",
        )
        assert hasattr(client, "sign_token")
        assert callable(client.sign_token)

    def test_sign_token_returns_valid_jwt(self, rsa_keypair):
        from behest.client import BehestSigningClient

        client = BehestSigningClient(
            signing_key_pem=rsa_keypair,
            key_id="sk_abc123def456789012345678abcdef01",
            tenant_id="tid-001",
            project_id="pid-001",
        )
        result = client.sign_token(user_id="alice")
        assert "access_token" in result
        assert "expires_at" in result
        assert "expires_in" in result
        # JWT has 3 dot-separated parts
        assert result["access_token"].count(".") == 2

    def test_sign_token_default_user_id(self, rsa_keypair):
        """When default_user_id is set, sign_token uses it."""
        from behest.client import BehestSigningClient

        client = BehestSigningClient(
            signing_key_pem=rsa_keypair,
            key_id="sk_abc123def456789012345678abcdef01",
            tenant_id="tid-001",
            project_id="pid-001",
            default_user_id="bob",
        )
        result = client.sign_token()
        assert isinstance(result["access_token"], str)

    def test_sign_token_user_id_override(self, rsa_keypair):
        """Explicit user_id overrides default_user_id."""
        import json
        import base64

        from behest.client import BehestSigningClient

        client = BehestSigningClient(
            signing_key_pem=rsa_keypair,
            key_id="sk_abc123def456789012345678abcdef01",
            tenant_id="tid-001",
            project_id="pid-001",
            default_user_id="bob",
        )
        result = client.sign_token(user_id="charlie")
        # Decode payload to verify uid
        payload_b64 = result["access_token"].split(".")[1]
        padded = payload_b64 + "=" * (4 - len(payload_b64) % 4)
        payload = json.loads(base64.urlsafe_b64decode(padded))
        assert payload["uid"] == "charlie"

    def test_sign_token_without_user_id_uses_anonymous(self, rsa_keypair):
        """When no user_id and no default_user_id, falls back to 'anonymous'."""
        import json
        import base64

        from behest.client import BehestSigningClient

        client = BehestSigningClient(
            signing_key_pem=rsa_keypair,
            key_id="sk_abc123def456789012345678abcdef01",
            tenant_id="tid-001",
            project_id="pid-001",
        )
        result = client.sign_token()
        payload_b64 = result["access_token"].split(".")[1]
        padded = payload_b64 + "=" * (4 - len(payload_b64) % 4)
        payload = json.loads(base64.urlsafe_b64decode(padded))
        assert payload["uid"] == "anonymous"

    def test_custom_token_ttl(self, rsa_keypair):
        from behest.client import BehestSigningClient

        client = BehestSigningClient(
            signing_key_pem=rsa_keypair,
            key_id="sk_abc123def456789012345678abcdef01",
            tenant_id="tid-001",
            project_id="pid-001",
            token_ttl=600,
        )
        result = client.sign_token(user_id="alice")
        assert result["expires_in"] == 600

    def test_sign_token_ttl_override(self, rsa_keypair):
        from behest.client import BehestSigningClient

        client = BehestSigningClient(
            signing_key_pem=rsa_keypair,
            key_id="sk_abc123def456789012345678abcdef01",
            tenant_id="tid-001",
            project_id="pid-001",
            token_ttl=3600,
        )
        result = client.sign_token(user_id="alice", ttl=120)
        assert result["expires_in"] == 120

    def test_missing_tenant_id_raises(self, rsa_keypair):
        from behest.errors import BehestError
        from behest.client import BehestSigningClient

        with pytest.raises(BehestError):
            BehestSigningClient(
                signing_key_pem=rsa_keypair,
                key_id="sk_abc123def456789012345678abcdef01",
                tenant_id="",
                project_id="pid-001",
            )

    def test_missing_project_id_raises(self, rsa_keypair):
        from behest.errors import BehestError
        from behest.client import BehestSigningClient

        with pytest.raises(BehestError):
            BehestSigningClient(
                signing_key_pem=rsa_keypair,
                key_id="sk_abc123def456789012345678abcdef01",
                tenant_id="tid-001",
                project_id="",
            )

    def test_invalid_pem_raises(self):
        from behest.errors import BehestError
        from behest.client import BehestSigningClient

        with pytest.raises(BehestError):
            BehestSigningClient(
                signing_key_pem="not-valid-pem",
                key_id="sk_abc123def456789012345678abcdef01",
                tenant_id="tid-001",
                project_id="pid-001",
            )


class TestBehestSigningClientAutoRefresh:
    """H6: Token auto-refresh when within 30 seconds of expiry."""

    def test_token_expires_at_set_on_init(self, rsa_keypair):
        """_token_expires_at is set during construction."""
        from behest.client import BehestSigningClient

        before = time.time()
        client = BehestSigningClient(
            signing_key_pem=rsa_keypair,
            key_id="sk_abc123def456789012345678abcdef01",
            tenant_id="tid-001",
            project_id="pid-001",
            token_ttl=300,
        )
        after = time.time()
        assert before + 300 <= client._token_expires_at <= after + 300

    def test_no_refresh_when_token_is_fresh(self, rsa_keypair):
        """Token is NOT refreshed when well within TTL."""
        from behest.client import BehestSigningClient

        client = BehestSigningClient(
            signing_key_pem=rsa_keypair,
            key_id="sk_abc123def456789012345678abcdef01",
            tenant_id="tid-001",
            project_id="pid-001",
            token_ttl=300,
        )
        original_token = client.api_key
        client._refresh_token_if_needed()
        # Token should NOT have changed (still fresh, >30s from expiry)
        assert client.api_key == original_token

    def test_refresh_when_token_near_expiry(self, rsa_keypair):
        """Token IS refreshed when within 30 seconds of expiry."""
        from behest.client import BehestSigningClient

        client = BehestSigningClient(
            signing_key_pem=rsa_keypair,
            key_id="sk_abc123def456789012345678abcdef01",
            tenant_id="tid-001",
            project_id="pid-001",
            token_ttl=300,
        )

        # Simulate token about to expire (within 30s window)
        client._token_expires_at = time.time() + 10
        client._refresh_token_if_needed()

        # Expiry should be reset to ~now + 300
        assert client._token_expires_at > time.time() + 250
        # api_key should be a valid JWT
        assert client.api_key.count(".") == 2

    def test_refresh_when_token_already_expired(self, rsa_keypair):
        """Token IS refreshed when already past expiry."""
        from behest.client import BehestSigningClient

        client = BehestSigningClient(
            signing_key_pem=rsa_keypair,
            key_id="sk_abc123def456789012345678abcdef01",
            tenant_id="tid-001",
            project_id="pid-001",
            token_ttl=300,
        )

        # Simulate token already expired
        client._token_expires_at = time.time() - 60
        old_expires = client._token_expires_at
        client._refresh_token_if_needed()

        # Expiry should be reset to the future
        assert client._token_expires_at > time.time() + 250
        assert client._token_expires_at != old_expires

    def test_prepare_request_refreshes_token_and_patches_header(self, rsa_keypair):
        """_prepare_request refreshes expired token and updates Authorization header."""
        import httpx
        from behest.client import BehestSigningClient

        client = BehestSigningClient(
            signing_key_pem=rsa_keypair,
            key_id="sk_abc123def456789012345678abcdef01",
            tenant_id="tid-001",
            project_id="pid-001",
            token_ttl=300,
        )

        # Simulate token about to expire
        client._token_expires_at = time.time() + 5
        old_expires = client._token_expires_at

        # Create a mock httpx.Request
        request = httpx.Request("GET", "https://api.behest.ai/v1/models")

        client._prepare_request(request)

        # Expiry should have been reset (token refreshed)
        assert client._token_expires_at > old_expires
        assert client._token_expires_at > time.time() + 250
        # Authorization header should carry the current token
        assert request.headers["authorization"] == f"Bearer {client.api_key}"

    def test_prepare_request_patches_header_even_when_fresh(self, rsa_keypair):
        """_prepare_request always patches the header with current api_key."""
        import httpx
        from behest.client import BehestSigningClient

        client = BehestSigningClient(
            signing_key_pem=rsa_keypair,
            key_id="sk_abc123def456789012345678abcdef01",
            tenant_id="tid-001",
            project_id="pid-001",
            token_ttl=300,
        )

        request = httpx.Request("GET", "https://api.behest.ai/v1/models")
        client._prepare_request(request)

        assert request.headers["authorization"] == f"Bearer {client.api_key}"

    def test_refresh_produces_valid_jwt(self, rsa_keypair):
        """Refreshed token is a valid 3-part JWT."""
        from behest.client import BehestSigningClient

        client = BehestSigningClient(
            signing_key_pem=rsa_keypair,
            key_id="sk_abc123def456789012345678abcdef01",
            tenant_id="tid-001",
            project_id="pid-001",
            token_ttl=300,
        )

        # Force refresh
        client._token_expires_at = time.time() - 1
        client._refresh_token_if_needed()

        assert client.api_key.count(".") == 2
