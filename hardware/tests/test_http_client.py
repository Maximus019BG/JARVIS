"""Tests for core.network.http_client – HttpClient and exceptions."""

from __future__ import annotations

import asyncio
import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# Patch get_config before importing HttpClient
_fake_cfg = MagicMock()
_fake_cfg.http_max_connections = 10
_fake_cfg.http_max_keepalive = 5
_fake_cfg.http_keepalive_expiry = 5.0
_fake_cfg.http_connect_timeout = 2.0
_fake_cfg.http_read_timeout = 5.0
_fake_cfg.http_write_timeout = 2.0
_fake_cfg.http_pool_timeout = 2.0
_fake_cfg.http_enable_http2 = False


def _get_config():
    return _fake_cfg


with patch("core.network.http_client.get_config", _get_config):
    from core.network.http_client import (
        ApiError,
        AuthenticationError,
        AuthorizationError,
        HttpClient,
        RateLimitExceeded,
    )


# ---------------------------------------------------------------------------
# Exception classes
# ---------------------------------------------------------------------------

class TestExceptions:
    def test_rate_limit(self):
        ex = RateLimitExceeded("too fast")
        assert "too fast" in str(ex)

    def test_authentication_error(self):
        assert issubclass(AuthenticationError, Exception)

    def test_authorization_error(self):
        assert issubclass(AuthorizationError, Exception)

    def test_api_error(self):
        ex = ApiError("500")
        assert "500" in str(ex)


# ---------------------------------------------------------------------------
# HttpClient helpers
# ---------------------------------------------------------------------------

def _make_client() -> HttpClient:
    security = MagicMock()
    security.rate_limiter.allow_request.return_value = True
    security.get_signing_key.return_value = b"secret-key-1234567890abcdef"
    with patch("core.network.http_client.get_config", _get_config):
        return HttpClient(base_url="http://test.local", security_manager=security)


class TestBuildSecurityHeaders:
    def test_has_required_headers(self):
        client = _make_client()
        headers = client._build_security_headers("dev1", {"a": 1})
        assert headers["X-Device-Id"] == "dev1"
        assert "X-Timestamp" in headers
        assert "X-Nonce" in headers
        assert "X-Signature" in headers
        assert headers["Content-Type"] == "application/json"
        # No Authorization header (JWT removed)
        assert "Authorization" not in headers

    def test_signature_deterministic(self):
        client = _make_client()
        sig1 = client._calculate_signature({"x": 1}, "2024-01-01T00:00:00", "nonce1")
        sig2 = client._calculate_signature({"x": 1}, "2024-01-01T00:00:00", "nonce1")
        assert sig1 == sig2

    def test_signature_changes_with_payload(self):
        client = _make_client()
        sig1 = client._calculate_signature({"x": 1}, "ts", "n")
        sig2 = client._calculate_signature({"x": 2}, "ts", "n")
        assert sig1 != sig2


# ---------------------------------------------------------------------------
# _handle_response
# ---------------------------------------------------------------------------

class TestHandleResponse:
    def _resp(self, status_code: int, data: dict | None = None):
        resp = MagicMock()
        resp.status_code = status_code
        resp.json.return_value = data or {}
        return resp

    def test_200_ok(self):
        client = _make_client()
        result = client._handle_response(self._resp(200, {"ok": True}))
        assert result == {"ok": True}

    def test_429_rate_limit(self):
        client = _make_client()
        with pytest.raises(RateLimitExceeded):
            client._handle_response(self._resp(429))

    def test_401_auth(self):
        client = _make_client()
        with pytest.raises(AuthenticationError):
            client._handle_response(self._resp(401))

    def test_403_authz(self):
        client = _make_client()
        with pytest.raises(AuthorizationError):
            client._handle_response(self._resp(403))

    def test_500_api_error(self):
        client = _make_client()
        with pytest.raises(ApiError):
            client._handle_response(self._resp(500))


# ---------------------------------------------------------------------------
# Async GET / POST
# ---------------------------------------------------------------------------

class TestAsyncMethods:
    def test_get_rate_limited(self):
        client = _make_client()
        client.security.rate_limiter.allow_request.return_value = False
        with pytest.raises(RateLimitExceeded):
            asyncio.run(client.get("/test", device_id="d"))

    def test_post_rate_limited(self):
        client = _make_client()
        client.security.rate_limiter.allow_request.return_value = False
        with pytest.raises(RateLimitExceeded):
            asyncio.run(client.post("/test", device_id="d"))

    def test_get_success(self):
        client = _make_client()
        fake_resp = MagicMock()
        fake_resp.status_code = 200
        fake_resp.json.return_value = {"data": "ok"}
        client.client.get = AsyncMock(return_value=fake_resp)
        result = asyncio.run(client.get("/ep", params={"since": "0"}, device_id="d"))
        assert result == {"data": "ok"}

    def test_post_success(self):
        client = _make_client()
        fake_resp = MagicMock()
        fake_resp.status_code = 200
        fake_resp.json.return_value = {"created": True}
        client.client.post = AsyncMock(return_value=fake_resp)
        result = asyncio.run(client.post("/ep", data={"a": 1}, device_id="d"))
        assert result == {"created": True}

    def test_post_with_idempotency_key(self):
        client = _make_client()
        fake_resp = MagicMock()
        fake_resp.status_code = 200
        fake_resp.json.return_value = {}
        client.client.post = AsyncMock(return_value=fake_resp)
        asyncio.run(client.post("/ep", data={}, device_id="d",
                                idempotency_key="idem-123"))
        # Verify idempotency header was included
        call_kwargs = client.client.post.call_args
        headers = call_kwargs.kwargs.get("headers") or call_kwargs[1].get("headers", {})
        assert headers.get("X-Idempotency-Key") == "idem-123"

    def test_close(self):
        client = _make_client()
        client.client.aclose = AsyncMock()
        asyncio.run(client.close())
        client.client.aclose.assert_awaited_once()
