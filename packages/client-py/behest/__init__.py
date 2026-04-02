"""Behest AI Python SDK -- extends OpenAI with Behest auth and local JWT signing."""

from behest._version import __version__
from behest.client import BehestClient, BehestSigningClient
from behest.errors import (
    AuthenticationError,
    BehestError,
    BudgetExceededError,
    ContentBlockedError,
    PIIBlockedError,
    RateLimitError,
    ServerError,
    TokenExpiredError,
    ValidationError,
)
from behest.signing import sign_behest_jwt

__all__ = [
    "__version__",
    "BehestClient",
    "BehestSigningClient",
    "sign_behest_jwt",
    "BehestError",
    "AuthenticationError",
    "TokenExpiredError",
    "RateLimitError",
    "ValidationError",
    "PIIBlockedError",
    "ContentBlockedError",
    "BudgetExceededError",
    "ServerError",
]
