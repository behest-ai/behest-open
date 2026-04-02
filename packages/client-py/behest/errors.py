"""Behest error classes — typed exception hierarchy.

Mirrors the TypeScript SDK error hierarchy in client-ts/src/errors.ts.
All errors inherit from BehestError, which inherits from Exception.
"""

from __future__ import annotations

from typing import Any, Optional


class BehestError(Exception):
    """Base error for all Behest API errors."""

    def __init__(
        self,
        message: str,
        *,
        status: int = 0,
        code: Optional[str] = None,
        request_id: Optional[str] = None,
        response_body: Optional[dict[str, Any]] = None,
    ) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.request_id = request_id
        self.response_body = response_body


class AuthenticationError(BehestError):
    """Authentication failed (401)."""

    def __init__(self, message: str = "Authentication failed", **kwargs: Any) -> None:
        super().__init__(message, status=401, **kwargs)


class TokenExpiredError(AuthenticationError):
    """JWT token has expired (401 + token_expired code)."""

    def __init__(self, message: str = "Token expired", **kwargs: Any) -> None:
        super().__init__(message, code="token_expired", **kwargs)


class RateLimitError(BehestError):
    """Rate limited (429)."""

    def __init__(
        self,
        message: str = "Rate limited",
        *,
        retry_after_ms: Optional[int] = None,
        **kwargs: Any,
    ) -> None:
        super().__init__(message, status=429, code="rate_limit_exceeded", **kwargs)
        self.retry_after_ms = retry_after_ms


class ValidationError(BehestError):
    """Request validation failed (400)."""

    def __init__(self, message: str = "Validation failed", **kwargs: Any) -> None:
        super().__init__(message, status=400, **kwargs)


class PIIBlockedError(BehestError):
    """PII detected and blocked (451)."""

    def __init__(self, message: str = "PII blocked", **kwargs: Any) -> None:
        super().__init__(message, status=451, code="pii_blocked", **kwargs)


class ContentBlockedError(BehestError):
    """Content blocked by guardrails (451)."""

    def __init__(self, message: str = "Content blocked", **kwargs: Any) -> None:
        super().__init__(message, status=451, code="content_blocked", **kwargs)


class BudgetExceededError(BehestError):
    """Budget exceeded (429 budget)."""

    def __init__(self, message: str = "Budget exceeded", **kwargs: Any) -> None:
        super().__init__(message, status=429, code="budget_exceeded", **kwargs)


class ServerError(BehestError):
    """Server error (5xx)."""

    def __init__(self, message: str, status: int = 500, **kwargs: Any) -> None:
        super().__init__(message, status=status, **kwargs)


def parse_error_response(response: Any) -> BehestError:
    """Parse an httpx/mock Response into the appropriate BehestError subclass.

    Expects a response object with:
      - status_code: int
      - headers: dict-like
      - json() method
      - text property
      - reason_phrase: str
    """
    status: int = response.status_code
    request_id: Optional[str] = response.headers.get("x-request-id")

    try:
        body: dict[str, Any] = response.json()
    except Exception:
        body = {"message": response.text}

    message: str = body.get("message") or body.get("error") or response.reason_phrase
    code: Optional[str] = body.get("code")

    if status == 401:
        if code == "token_expired" or "expired" in (message or "").lower():
            return TokenExpiredError(message, request_id=request_id, response_body=body)
        return AuthenticationError(message, code=code, request_id=request_id, response_body=body)

    if status == 429:
        if code == "budget_exceeded":
            return BudgetExceededError(message, request_id=request_id, response_body=body)
        retry_after = response.headers.get("retry-after")
        retry_ms = int(retry_after) * 1000 if retry_after else None
        return RateLimitError(
            message,
            retry_after_ms=retry_ms,
            request_id=request_id,
            response_body=body,
        )

    if status == 451:
        if code == "content_blocked":
            return ContentBlockedError(message, request_id=request_id, response_body=body)
        return PIIBlockedError(message, request_id=request_id, response_body=body)

    if status == 400:
        return ValidationError(message, code=code, request_id=request_id, response_body=body)

    if status >= 500:
        return ServerError(
            message,
            status=status,
            code=code,
            request_id=request_id,
            response_body=body,
        )

    return BehestError(
        message,
        status=status,
        code=code,
        request_id=request_id,
        response_body=body,
    )
