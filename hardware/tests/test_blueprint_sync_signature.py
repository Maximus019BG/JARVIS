import hmac
import hashlib
import json

from core.network.http_client import HttpClient


class _DummyRateLimiter:
    def allow_request(self) -> bool:
        return True


class _DummySecurityManager:
    def __init__(self, signing_key: bytes):
        self._signing_key = signing_key
        self.rate_limiter = _DummyRateLimiter()

    def get_signing_key(self) -> bytes:
        return self._signing_key


def _server_expected_signature(payload: dict, timestamp: str, nonce: str, secret: bytes) -> str:
    """Mirror server verifier canonicalization.

    Server does:
      canonical = { timestamp, nonce, payload }
      payloadString = JSON.stringify(canonical, Object.keys(canonical).sort())
      sig = HMAC-SHA256(payloadString)

    That sorts only the *top-level* keys.
    """

    canonical = {"timestamp": timestamp, "nonce": nonce, "payload": payload}
    canonical_ordered = {k: canonical[k] for k in sorted(canonical.keys())}
    payload_str = json.dumps(
        canonical_ordered,
        separators=(",", ":"),
        sort_keys=False,
        ensure_ascii=False,
    )

    return hmac.new(secret, payload_str.encode("utf-8"), hashlib.sha256).hexdigest()


def test_signature_generation_matches_server_for_get_sync() -> None:
    secret = b"test-secret"
    sec = _DummySecurityManager(secret)
    client = HttpClient(base_url="https://example.invalid", security_manager=sec)

    timestamp = "2026-01-01T00:00:00.000Z"
    nonce = "nonce-1"

    # GET /sync server expects payload { since }
    payload = {"since": "2020-01-01T00:00:00.000Z"}

    expected = _server_expected_signature(payload, timestamp, nonce, secret)
    actual = client._calculate_signature(payload, timestamp, nonce)

    assert actual == expected


def test_signature_generation_matches_server_for_post_push() -> None:
    secret = b"test-secret"
    sec = _DummySecurityManager(secret)
    client = HttpClient(base_url="https://example.invalid", security_manager=sec)

    timestamp = "2026-01-01T00:00:00.000Z"
    nonce = "nonce-2"

    payload = {
        "blueprintId": "bp-1",
        "name": "Test",
        "data": {"a": 1},
        "version": 1,
        "hash": "hash-1",
    }

    expected = _server_expected_signature(payload, timestamp, nonce, secret)
    actual = client._calculate_signature(payload, timestamp, nonce)

    assert actual == expected
