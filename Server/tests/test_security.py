from __future__ import annotations

from app.core.security import hash_password, verify_password, generate_session_token, hash_token, LoginRateLimiter


def test_password_hashing():
    pwd = "test-password-123"
    hashed = hash_password(pwd)
    assert hashed != pwd
    assert verify_password(pwd, hashed) is True
    assert verify_password("wrong", hashed) is False


def test_session_token():
    token = generate_session_token()
    assert len(token) == 64
    hashed = hash_token(token)
    assert hashed != token
    assert len(hashed) == 64


def test_rate_limiter_allows_first_attempt():
    limiter = LoginRateLimiter(window_ms=60000, max_attempts=3, block_ms=120000)
    allowed, remaining, _ = limiter.consume("testuser")
    assert allowed is True
    assert remaining == 2


def test_rate_limiter_blocks_after_max():
    limiter = LoginRateLimiter(window_ms=60000, max_attempts=2, block_ms=120000)
    limiter.consume("testuser")
    allowed, remaining, _ = limiter.consume("testuser")
    assert allowed is False
    assert remaining == 0


def test_rate_limiter_reset():
    limiter = LoginRateLimiter(window_ms=60000, max_attempts=2, block_ms=120000)
    limiter.consume("testuser")
    limiter.reset("testuser")
    allowed, remaining, _ = limiter.consume("testuser")
    assert allowed is True
    assert remaining == 1


def test_rate_limiter_case_insensitive():
    limiter = LoginRateLimiter(window_ms=60000, max_attempts=2, block_ms=120000)
    limiter.consume("ADMIN01")
    allowed, _, _ = limiter.consume("admin01")
    assert allowed is False
