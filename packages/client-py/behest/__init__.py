"""Behest AI Python SDK -- extends OpenAI with Behest auth and local JWT signing."""

from behest._version import __version__
from behest.client import BehestClient, BehestSigningClient
from behest.errors import (
    AuthenticationError,
    BehestError as LegacyBehestError,
    BudgetExceededError,
    ContentBlockedError,
    PIIBlockedError,
    RateLimitError,
    ServerError,
    TokenExpiredError,
    ValidationError,
)
from behest.signing import sign_behest_jwt

# v1.5 dual-mode SDK (see SDK_SPEC.md §8 — TS parity)
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
    MintOptions,
    MintResult,
    ResolvedConfig,
    ThreadsModule,
    UsageModule,
    classify_http_error,
    decode_token,
    detect_mode,
    generate_session_id,
    resolve_config,
)

__all__ = [
    "__version__",
    # v1.x (legacy)
    "BehestClient",
    "BehestSigningClient",
    "sign_behest_jwt",
    "LegacyBehestError",
    "AuthenticationError",
    "TokenExpiredError",
    "RateLimitError",
    "ValidationError",
    "PIIBlockedError",
    "ContentBlockedError",
    "BudgetExceededError",
    "ServerError",
    # v1.5 surface
    "Behest",
    "AuthModule",
    "ChatModule",
    "ThreadsModule",
    "UsageModule",
    "MintOptions",
    "MintResult",
    "ResolvedConfig",
    "BehestError",
    "BehestAuthError",
    "BehestBadRequestError",
    "BehestConfigError",
    "BehestQuotaError",
    "BehestRateLimitError",
    "BehestServerError",
    "classify_http_error",
    "detect_mode",
    "resolve_config",
    "generate_session_id",
    "decode_token",
]
