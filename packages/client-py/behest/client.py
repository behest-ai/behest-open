"""Behest client classes — extends OpenAI with Behest authentication.

BehestClient: API key flow (traditional, extends openai.OpenAI).
BehestSigningClient: Local JWT signing flow (extends openai.OpenAI).
"""

from __future__ import annotations

import os
from typing import Any, Optional

import openai

from behest.errors import BehestError, ValidationError
from behest.signing import sign_behest_jwt


class BehestClient(openai.OpenAI):
    """Behest AI client -- extends OpenAI SDK with Behest auth.

    Usage::

        client = BehestClient(api_key="bh_live_YOUR_API_KEY")

        response = client.chat.completions.create(
            model="gemini-2.5-flash",
            messages=[{"role": "user", "content": "Hello, Behest!"}],
        )
    """

    _custom_headers: dict[str, str]

    def __init__(
        self,
        *,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        end_user_id: Optional[str] = None,
        **kwargs: Any,
    ) -> None:
        resolved_api_key = api_key or os.environ.get("BEHEST_API_KEY", "")
        resolved_base_url = base_url or os.environ.get(
            "BEHEST_BASE_URL", "https://api.behest.ai/v1"
        )

        # Build custom headers
        custom_headers: dict[str, str] = {}
        if end_user_id:
            custom_headers["X-End-User-Id"] = end_user_id

        # Merge with any user-provided default_headers
        user_headers = kwargs.pop("default_headers", None) or {}
        if isinstance(user_headers, dict):
            custom_headers.update(user_headers)

        self._custom_headers = custom_headers

        super().__init__(
            api_key=resolved_api_key,
            base_url=resolved_base_url,
            default_headers=custom_headers if custom_headers else None,
            **kwargs,
        )


class BehestSigningClient(openai.OpenAI):
    """Behest AI client using local JWT signing with tenant signing keys.

    Signs JWTs locally (~1ms) instead of calling the mint endpoint (50-200ms).

    Usage::

        client = BehestSigningClient(
            signing_key_pem=os.environ["BEHEST_SIGNING_KEY_PEM"],
            key_id=os.environ["BEHEST_SIGNING_KEY_ID"],   # "sk_a1b2c3..."
            tenant_id=os.environ["BEHEST_TENANT_ID"],
            project_id=os.environ["BEHEST_PROJECT_ID"],
        )

        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[{"role": "user", "content": "Hello from Python!"}],
        )
    """

    _signing_key_pem: str
    _key_id: str
    _tenant_id: str
    _project_id: str
    _default_user_id: str
    _token_ttl: int
    _custom_headers: dict[str, str]

    def __init__(
        self,
        *,
        signing_key_pem: str,
        key_id: str,
        tenant_id: str,
        project_id: str,
        base_url: Optional[str] = None,
        default_user_id: Optional[str] = None,
        token_ttl: int = 300,
        **kwargs: Any,
    ) -> None:
        # Validate inputs at construction time
        if not key_id.startswith("sk_"):
            raise ValidationError("key_id must start with 'sk_'")
        if not tenant_id:
            raise ValidationError("tenant_id is required")
        if not project_id:
            raise ValidationError("project_id is required")

        # Validate PEM is parseable eagerly (fail fast)
        from behest.signing import _get_private_key

        _get_private_key(signing_key_pem)

        self._signing_key_pem = signing_key_pem
        self._key_id = key_id
        self._tenant_id = tenant_id
        self._project_id = project_id
        self._default_user_id = default_user_id or "anonymous"
        self._token_ttl = token_ttl
        self._custom_headers = {}

        resolved_base_url = base_url or os.environ.get(
            "BEHEST_BASE_URL", "https://api.behest.ai/v1"
        )

        # Sign an initial token to use as the api_key placeholder.
        # The OpenAI SDK requires api_key; we pass a signed JWT.
        initial_token = sign_behest_jwt(
            private_key_pem=signing_key_pem,
            key_id=key_id,
            tenant_id=tenant_id,
            project_id=project_id,
            user_id=self._default_user_id,
            expires_in=token_ttl,
        )

        super().__init__(
            api_key=initial_token["access_token"],
            base_url=resolved_base_url,
            **kwargs,
        )

    def sign_token(
        self,
        *,
        user_id: Optional[str] = None,
        ttl: Optional[int] = None,
    ) -> dict[str, Any]:
        """Sign a Behest JWT locally.

        Args:
            user_id: End-user identifier. Falls back to default_user_id,
                     then to "anonymous".
            ttl: Token lifetime in seconds. Falls back to token_ttl from
                 constructor.

        Returns:
            dict with keys: ``access_token``, ``expires_at``, ``expires_in``.
        """
        return sign_behest_jwt(
            private_key_pem=self._signing_key_pem,
            key_id=self._key_id,
            tenant_id=self._tenant_id,
            project_id=self._project_id,
            user_id=user_id or self._default_user_id,
            expires_in=ttl or self._token_ttl,
        )
