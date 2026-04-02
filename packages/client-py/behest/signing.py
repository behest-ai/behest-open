"""Local RS256 JWT signing for Behest tenant signing keys.

Produces JWTs with the exact structure that Kong validates for sk_* tokens:

    Header:  { "alg": "RS256", "kid": key_id, "typ": "JWT" }
    Payload: { "tid", "pid", "uid", "iss": "behest", "aud": "behest", "iat", "nbf", "exp" }

Uses PyJWT + cryptography for RS256 signing (~1ms per token).
"""

from __future__ import annotations

import hashlib
import time
from typing import Any

import jwt
from cryptography.hazmat.primitives.serialization import load_pem_private_key

from behest.errors import BehestError, ValidationError

# Module-level key cache: avoids re-parsing PEM on every sign call.
_key_cache: dict[str, Any] = {}


def _get_private_key(pem: str) -> Any:
    """Parse and cache a PEM private key.

    Supports both PKCS#8 (BEGIN PRIVATE KEY) and PKCS#1 (BEGIN RSA PRIVATE KEY).

    Raises:
        BehestError: If the PEM is invalid or not an RSA private key.
    """
    cache_key = hashlib.sha256(pem.encode("utf-8")).hexdigest()
    if cache_key not in _key_cache:
        try:
            _key_cache[cache_key] = load_pem_private_key(
                pem.encode("utf-8"), password=None
            )
        except Exception as exc:
            raise BehestError(
                f"Invalid private key PEM: {exc}. "
                "Expected an RSA private key in PEM format "
                "(-----BEGIN PRIVATE KEY----- or -----BEGIN RSA PRIVATE KEY-----).",
                status=400,
                code="invalid_signing_key",
            ) from exc
    return _key_cache[cache_key]


def sign_behest_jwt(
    *,
    private_key_pem: str,
    key_id: str,
    tenant_id: str,
    project_id: str,
    user_id: str,
    expires_in: int = 3600,
) -> dict[str, Any]:
    """Sign a Behest JWT locally using a tenant signing key.

    Produces a JWT with the exact header and claims structure
    that Kong expects for sk_* tokens.

    Args:
        private_key_pem: RSA private key in PEM format (PKCS#8 or PKCS#1).
        key_id: Key ID assigned by Behest (must start with ``sk_``).
        tenant_id: Tenant UUID that owns this signing key.
        project_id: Project UUID for this token.
        user_id: End-user identifier.
        expires_in: Token lifetime in seconds (60--86400). Default: 3600.

    Returns:
        dict with keys: ``access_token`` (str), ``expires_at`` (int), ``expires_in`` (int).

    Raises:
        BehestError: If the key_id prefix is wrong or required fields are empty.
        BehestError: If the PEM is invalid.
        ValueError: If expires_in is outside the 60--86400 range.
    """
    # Input validation
    if not key_id.startswith("sk_"):
        raise ValidationError("key_id must start with 'sk_'")
    if not tenant_id:
        raise ValidationError("tenant_id is required")
    if not project_id:
        raise ValidationError("project_id is required")
    if not user_id:
        raise ValidationError("user_id is required")
    if expires_in < 60 or expires_in > 86400:
        raise ValueError(
            f"expires_in must be between 60 and 86400 seconds, got {expires_in}"
        )

    now = int(time.time())
    exp = now + expires_in

    private_key = _get_private_key(private_key_pem)

    token: str = jwt.encode(
        payload={
            "tid": tenant_id,
            "pid": project_id,
            "uid": user_id,
            "iss": "behest",
            "aud": "behest",
            "iat": now,
            "nbf": now,
            "exp": exp,
        },
        key=private_key,
        algorithm="RS256",
        headers={
            "kid": key_id,
            "typ": "JWT",
        },
    )

    return {
        "access_token": token,
        "expires_at": exp,
        "expires_in": expires_in,
    }
