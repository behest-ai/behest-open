"""Tests for behest.errors — typed exception hierarchy."""

import pytest


class TestBehestError:
    """Base error class."""

    def test_inherits_from_exception(self):
        from behest.errors import BehestError

        err = BehestError("something broke", status=500)
        assert isinstance(err, Exception)

    def test_message_and_status(self):
        from behest.errors import BehestError

        err = BehestError("bad request", status=400, code="invalid_input")
        assert str(err) == "bad request"
        assert err.status == 400
        assert err.code == "invalid_input"

    def test_optional_fields_default_to_none(self):
        from behest.errors import BehestError

        err = BehestError("oops", status=500)
        assert err.code is None
        assert err.request_id is None
        assert err.response_body is None

    def test_request_id_and_response_body(self):
        from behest.errors import BehestError

        body = {"error": "details"}
        err = BehestError(
            "fail",
            status=502,
            request_id="req-123",
            response_body=body,
        )
        assert err.request_id == "req-123"
        assert err.response_body == body


class TestAuthenticationError:
    """401 errors."""

    def test_inherits_from_behest_error(self):
        from behest.errors import AuthenticationError, BehestError

        err = AuthenticationError()
        assert isinstance(err, BehestError)

    def test_default_message(self):
        from behest.errors import AuthenticationError

        err = AuthenticationError()
        assert str(err) == "Authentication failed"
        assert err.status == 401

    def test_custom_message(self):
        from behest.errors import AuthenticationError

        err = AuthenticationError("invalid key")
        assert str(err) == "invalid key"
        assert err.status == 401


class TestTokenExpiredError:
    """401 + token_expired code."""

    def test_inherits_from_authentication_error(self):
        from behest.errors import AuthenticationError, TokenExpiredError

        err = TokenExpiredError()
        assert isinstance(err, AuthenticationError)

    def test_default_code_is_token_expired(self):
        from behest.errors import TokenExpiredError

        err = TokenExpiredError()
        assert err.code == "token_expired"
        assert err.status == 401

    def test_default_message(self):
        from behest.errors import TokenExpiredError

        err = TokenExpiredError()
        assert str(err) == "Token expired"


class TestRateLimitError:
    """429 errors."""

    def test_inherits_from_behest_error(self):
        from behest.errors import BehestError, RateLimitError

        err = RateLimitError()
        assert isinstance(err, BehestError)

    def test_status_is_429(self):
        from behest.errors import RateLimitError

        err = RateLimitError()
        assert err.status == 429

    def test_retry_after_ms(self):
        from behest.errors import RateLimitError

        err = RateLimitError(retry_after_ms=5000)
        assert err.retry_after_ms == 5000

    def test_retry_after_ms_defaults_to_none(self):
        from behest.errors import RateLimitError

        err = RateLimitError()
        assert err.retry_after_ms is None


class TestValidationError:
    """400 errors."""

    def test_inherits_from_behest_error(self):
        from behest.errors import BehestError, ValidationError

        err = ValidationError()
        assert isinstance(err, BehestError)

    def test_status_is_400(self):
        from behest.errors import ValidationError

        err = ValidationError()
        assert err.status == 400


class TestPIIBlockedError:
    """451 PII blocked."""

    def test_inherits_from_behest_error(self):
        from behest.errors import BehestError, PIIBlockedError

        err = PIIBlockedError()
        assert isinstance(err, BehestError)

    def test_status_is_451(self):
        from behest.errors import PIIBlockedError

        err = PIIBlockedError()
        assert err.status == 451
        assert err.code == "pii_blocked"


class TestContentBlockedError:
    """451 content blocked."""

    def test_inherits_from_behest_error(self):
        from behest.errors import BehestError, ContentBlockedError

        err = ContentBlockedError()
        assert isinstance(err, BehestError)

    def test_status_is_451(self):
        from behest.errors import ContentBlockedError

        err = ContentBlockedError()
        assert err.status == 451
        assert err.code == "content_blocked"


class TestBudgetExceededError:
    """429 budget exceeded."""

    def test_inherits_from_behest_error(self):
        from behest.errors import BehestError, BudgetExceededError

        err = BudgetExceededError()
        assert isinstance(err, BehestError)

    def test_status_is_429(self):
        from behest.errors import BudgetExceededError

        err = BudgetExceededError()
        assert err.status == 429
        assert err.code == "budget_exceeded"


class TestServerError:
    """5xx errors."""

    def test_inherits_from_behest_error(self):
        from behest.errors import BehestError, ServerError

        err = ServerError("internal error")
        assert isinstance(err, BehestError)

    def test_default_status_is_500(self):
        from behest.errors import ServerError

        err = ServerError("crash")
        assert err.status == 500

    def test_custom_status(self):
        from behest.errors import ServerError

        err = ServerError("bad gateway", status=502)
        assert err.status == 502


class TestErrorHierarchy:
    """Verify the full hierarchy for isinstance checks."""

    def test_all_errors_are_behest_error(self):
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

        errors = [
            AuthenticationError(),
            TokenExpiredError(),
            RateLimitError(),
            ValidationError(),
            PIIBlockedError(),
            ContentBlockedError(),
            BudgetExceededError(),
            ServerError("err"),
        ]
        for err in errors:
            assert isinstance(err, BehestError), f"{type(err).__name__} is not a BehestError"

    def test_token_expired_is_authentication_error(self):
        from behest.errors import AuthenticationError, TokenExpiredError

        err = TokenExpiredError()
        assert isinstance(err, AuthenticationError)

    def test_all_are_catchable_as_exception(self):
        from behest.errors import BehestError

        err = BehestError("test", status=500)
        with pytest.raises(Exception):
            raise err


class TestParseErrorResponse:
    """Test parse_error_response factory function."""

    def _make_response(self, status_code, json_body=None, text="", headers=None):
        """Create a mock response object matching httpx Response interface."""

        class MockResponse:
            def __init__(self, sc, jb, t, h):
                self.status_code = sc
                self._json = jb
                self._text = t
                self.headers = h or {}
                self.reason_phrase = "Error"

            def json(self):
                if self._json is None:
                    raise ValueError("No JSON")
                return self._json

            @property
            def text(self):
                return self._text

        return MockResponse(status_code, json_body, text, headers)

    def test_401_returns_authentication_error(self):
        from behest.errors import AuthenticationError, parse_error_response

        resp = self._make_response(401, {"message": "invalid key"})
        err = parse_error_response(resp)
        assert isinstance(err, AuthenticationError)
        assert err.status == 401

    def test_401_token_expired_returns_token_expired_error(self):
        from behest.errors import TokenExpiredError, parse_error_response

        resp = self._make_response(401, {"message": "jwt expired", "code": "token_expired"})
        err = parse_error_response(resp)
        assert isinstance(err, TokenExpiredError)

    def test_401_expired_in_message_returns_token_expired_error(self):
        from behest.errors import TokenExpiredError, parse_error_response

        resp = self._make_response(401, {"message": "Token has expired"})
        err = parse_error_response(resp)
        assert isinstance(err, TokenExpiredError)

    def test_429_returns_rate_limit_error(self):
        from behest.errors import RateLimitError, parse_error_response

        resp = self._make_response(
            429,
            {"message": "too many requests"},
            headers={"retry-after": "5"},
        )
        err = parse_error_response(resp)
        assert isinstance(err, RateLimitError)
        assert err.retry_after_ms == 5000

    def test_400_returns_validation_error(self):
        from behest.errors import ValidationError, parse_error_response

        resp = self._make_response(400, {"message": "invalid param"})
        err = parse_error_response(resp)
        assert isinstance(err, ValidationError)

    def test_500_returns_server_error(self):
        from behest.errors import ServerError, parse_error_response

        resp = self._make_response(500, {"message": "internal server error"})
        err = parse_error_response(resp)
        assert isinstance(err, ServerError)
        assert err.status == 500

    def test_502_returns_server_error(self):
        from behest.errors import ServerError, parse_error_response

        resp = self._make_response(502, {"message": "bad gateway"})
        err = parse_error_response(resp)
        assert isinstance(err, ServerError)
        assert err.status == 502

    def test_request_id_extracted_from_header(self):
        from behest.errors import parse_error_response

        resp = self._make_response(
            500,
            {"message": "error"},
            headers={"x-request-id": "req-abc"},
        )
        err = parse_error_response(resp)
        assert err.request_id == "req-abc"

    def test_non_json_response_falls_back_to_text(self):
        from behest.errors import parse_error_response

        resp = self._make_response(500, json_body=None, text="plain text error")
        err = parse_error_response(resp)
        assert "plain text error" in str(err) or err.response_body == {"message": "plain text error"}

    def test_unknown_status_returns_generic_behest_error(self):
        from behest.errors import BehestError, parse_error_response

        resp = self._make_response(403, {"message": "forbidden"})
        err = parse_error_response(resp)
        assert isinstance(err, BehestError)
        assert err.status == 403
