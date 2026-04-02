"""Tests for behest.signing — local RS256 JWT signing."""

import json
import time

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
    public_key = private_key.public_key()
    public_pem = public_key.public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode("utf-8")
    return private_pem, public_pem, private_key, public_key


@pytest.fixture
def signing_args(rsa_keypair):
    """Standard signing arguments."""
    private_pem, _, _, _ = rsa_keypair
    return {
        "private_key_pem": private_pem,
        "key_id": "sk_abc123def456789012345678abcdef01",
        "tenant_id": "t-00000000-0000-0000-0000-000000000001",
        "project_id": "p-00000000-0000-0000-0000-000000000001",
        "user_id": "alice",
    }


class TestSignBehestJwt:
    """sign_behest_jwt() produces Kong-compatible JWTs."""

    def test_returns_dict_with_expected_keys(self, signing_args):
        from behest.signing import sign_behest_jwt

        result = sign_behest_jwt(**signing_args)
        assert "access_token" in result
        assert "expires_at" in result
        assert "expires_in" in result

    def test_access_token_is_a_string(self, signing_args):
        from behest.signing import sign_behest_jwt

        result = sign_behest_jwt(**signing_args)
        assert isinstance(result["access_token"], str)

    def test_expires_in_matches_default(self, signing_args):
        from behest.signing import sign_behest_jwt

        result = sign_behest_jwt(**signing_args)
        assert result["expires_in"] == 3600

    def test_custom_ttl(self, signing_args):
        from behest.signing import sign_behest_jwt

        result = sign_behest_jwt(**signing_args, expires_in=600)
        assert result["expires_in"] == 600

    def test_expires_at_is_in_the_future(self, signing_args):
        from behest.signing import sign_behest_jwt

        result = sign_behest_jwt(**signing_args)
        assert result["expires_at"] > int(time.time())

    def test_expires_at_equals_now_plus_ttl(self, signing_args):
        from behest.signing import sign_behest_jwt

        now = int(time.time())
        result = sign_behest_jwt(**signing_args, expires_in=300)
        # Allow 2 seconds tolerance for test execution time
        assert abs(result["expires_at"] - (now + 300)) <= 2


class TestJwtStructure:
    """JWT header and payload match Kong expectations exactly."""

    def _decode_parts(self, token):
        """Decode JWT header and payload without verification."""
        import base64

        parts = token.split(".")
        assert len(parts) == 3, "JWT must have 3 parts"

        def decode_segment(seg):
            # Add padding
            padded = seg + "=" * (4 - len(seg) % 4)
            return json.loads(base64.urlsafe_b64decode(padded))

        header = decode_segment(parts[0])
        payload = decode_segment(parts[1])
        return header, payload

    def test_header_alg_is_rs256(self, signing_args):
        from behest.signing import sign_behest_jwt

        result = sign_behest_jwt(**signing_args)
        header, _ = self._decode_parts(result["access_token"])
        assert header["alg"] == "RS256"

    def test_header_kid_matches_key_id(self, signing_args):
        from behest.signing import sign_behest_jwt

        result = sign_behest_jwt(**signing_args)
        header, _ = self._decode_parts(result["access_token"])
        assert header["kid"] == signing_args["key_id"]

    def test_header_typ_is_jwt(self, signing_args):
        from behest.signing import sign_behest_jwt

        result = sign_behest_jwt(**signing_args)
        header, _ = self._decode_parts(result["access_token"])
        assert header["typ"] == "JWT"

    def test_payload_tid(self, signing_args):
        from behest.signing import sign_behest_jwt

        result = sign_behest_jwt(**signing_args)
        _, payload = self._decode_parts(result["access_token"])
        assert payload["tid"] == signing_args["tenant_id"]

    def test_payload_pid(self, signing_args):
        from behest.signing import sign_behest_jwt

        result = sign_behest_jwt(**signing_args)
        _, payload = self._decode_parts(result["access_token"])
        assert payload["pid"] == signing_args["project_id"]

    def test_payload_uid(self, signing_args):
        from behest.signing import sign_behest_jwt

        result = sign_behest_jwt(**signing_args)
        _, payload = self._decode_parts(result["access_token"])
        assert payload["uid"] == "alice"

    def test_payload_iss_is_behest(self, signing_args):
        from behest.signing import sign_behest_jwt

        result = sign_behest_jwt(**signing_args)
        _, payload = self._decode_parts(result["access_token"])
        assert payload["iss"] == "behest"

    def test_payload_aud_is_behest(self, signing_args):
        from behest.signing import sign_behest_jwt

        result = sign_behest_jwt(**signing_args)
        _, payload = self._decode_parts(result["access_token"])
        assert payload["aud"] == "behest"

    def test_payload_has_iat(self, signing_args):
        from behest.signing import sign_behest_jwt

        now = int(time.time())
        result = sign_behest_jwt(**signing_args)
        _, payload = self._decode_parts(result["access_token"])
        assert "iat" in payload
        assert abs(payload["iat"] - now) <= 2

    def test_payload_has_nbf(self, signing_args):
        from behest.signing import sign_behest_jwt

        now = int(time.time())
        result = sign_behest_jwt(**signing_args)
        _, payload = self._decode_parts(result["access_token"])
        assert "nbf" in payload
        assert abs(payload["nbf"] - now) <= 2

    def test_payload_has_exp(self, signing_args):
        from behest.signing import sign_behest_jwt

        now = int(time.time())
        result = sign_behest_jwt(**signing_args, expires_in=600)
        _, payload = self._decode_parts(result["access_token"])
        assert "exp" in payload
        assert abs(payload["exp"] - (now + 600)) <= 2

    def test_payload_nbf_equals_iat(self, signing_args):
        from behest.signing import sign_behest_jwt

        result = sign_behest_jwt(**signing_args)
        _, payload = self._decode_parts(result["access_token"])
        assert payload["nbf"] == payload["iat"]


class TestJwtVerification:
    """JWT is verifiable with the corresponding public key."""

    def test_verifiable_with_public_key(self, rsa_keypair, signing_args):
        import jwt as pyjwt

        from behest.signing import sign_behest_jwt

        _, public_pem, _, _ = rsa_keypair
        result = sign_behest_jwt(**signing_args)

        decoded = pyjwt.decode(
            result["access_token"],
            public_pem,
            algorithms=["RS256"],
            audience="behest",
            issuer="behest",
        )
        assert decoded["tid"] == signing_args["tenant_id"]
        assert decoded["pid"] == signing_args["project_id"]
        assert decoded["uid"] == "alice"

    def test_not_verifiable_with_wrong_key(self, signing_args):
        import jwt as pyjwt

        from behest.signing import sign_behest_jwt

        # Generate a different keypair
        other_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        other_public_pem = other_key.public_key().public_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PublicFormat.SubjectPublicKeyInfo,
        ).decode("utf-8")

        result = sign_behest_jwt(**signing_args)

        with pytest.raises(pyjwt.exceptions.InvalidSignatureError):
            pyjwt.decode(
                result["access_token"],
                other_public_pem,
                algorithms=["RS256"],
                audience="behest",
                issuer="behest",
            )


class TestInputValidation:
    """Invalid inputs raise appropriate errors."""

    def test_kid_must_start_with_sk_(self, rsa_keypair):
        from behest.errors import BehestError
        from behest.signing import sign_behest_jwt

        private_pem, _, _, _ = rsa_keypair
        with pytest.raises(BehestError, match="sk_"):
            sign_behest_jwt(
                private_key_pem=private_pem,
                key_id="invalid_kid",
                tenant_id="tid",
                project_id="pid",
                user_id="alice",
            )

    def test_invalid_pem_raises_error(self):
        from behest.errors import BehestError
        from behest.signing import sign_behest_jwt

        with pytest.raises(BehestError):
            sign_behest_jwt(
                private_key_pem="not-a-pem",
                key_id="sk_abc123def456789012345678abcdef01",
                tenant_id="tid",
                project_id="pid",
                user_id="alice",
            )

    def test_empty_tenant_id_raises_error(self, rsa_keypair):
        from behest.errors import BehestError
        from behest.signing import sign_behest_jwt

        private_pem, _, _, _ = rsa_keypair
        with pytest.raises(BehestError):
            sign_behest_jwt(
                private_key_pem=private_pem,
                key_id="sk_abc123def456789012345678abcdef01",
                tenant_id="",
                project_id="pid",
                user_id="alice",
            )

    def test_empty_project_id_raises_error(self, rsa_keypair):
        from behest.errors import BehestError
        from behest.signing import sign_behest_jwt

        private_pem, _, _, _ = rsa_keypair
        with pytest.raises(BehestError):
            sign_behest_jwt(
                private_key_pem=private_pem,
                key_id="sk_abc123def456789012345678abcdef01",
                tenant_id="tid",
                project_id="",
                user_id="alice",
            )

    def test_empty_user_id_raises_error(self, rsa_keypair):
        from behest.errors import BehestError
        from behest.signing import sign_behest_jwt

        private_pem, _, _, _ = rsa_keypair
        with pytest.raises(BehestError):
            sign_behest_jwt(
                private_key_pem=private_pem,
                key_id="sk_abc123def456789012345678abcdef01",
                tenant_id="tid",
                project_id="pid",
                user_id="",
            )

    def test_pkcs1_pem_format_also_works(self):
        """PKCS#1 (BEGIN RSA PRIVATE KEY) should also work."""
        from behest.signing import sign_behest_jwt

        private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        pkcs1_pem = private_key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.TraditionalOpenSSL,
            encryption_algorithm=serialization.NoEncryption(),
        ).decode("utf-8")

        result = sign_behest_jwt(
            private_key_pem=pkcs1_pem,
            key_id="sk_abc123def456789012345678abcdef01",
            tenant_id="tid",
            project_id="pid",
            user_id="alice",
        )
        assert isinstance(result["access_token"], str)
