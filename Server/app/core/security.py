from __future__ import annotations

import hashlib
import secrets
import time
from collections import OrderedDict

import bcrypt

from app.config import settings


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt(10)).decode()


def verify_password(password: str, password_hash: str) -> bool:
    return bcrypt.checkpw(password.encode(), password_hash.encode())


def generate_session_token() -> str:
    return secrets.token_hex(32)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def make_id(prefix: str) -> str:
    return f"{prefix}_{secrets.token_hex(16)}"


class LoginRateLimiter:
    def __init__(
        self,
        window_ms: int | None = None,
        max_attempts: int | None = None,
        block_ms: int | None = None,
    ) -> None:
        self.window_ms = window_ms or settings.AUTH_RATE_LIMIT_WINDOW_MS
        self.max_attempts = max_attempts or settings.AUTH_RATE_LIMIT_MAX_ATTEMPTS
        self.block_ms = block_ms or settings.AUTH_RATE_LIMIT_BLOCK_MS
        self._buckets: OrderedDict[str, tuple[list[float], float]] = OrderedDict()

    def consume(self, identifier: str, now: float | None = None) -> tuple[bool, int, int]:
        now = now or time.time()
        key = identifier.strip().upper()
        attempts, blocked_until = self._buckets.get(key, ([], 0.0))

        if blocked_until > now:
            retry_after = int(blocked_until - now)
            return False, 0, retry_after

        cutoff = now - self.window_ms / 1000
        attempts = [t for t in attempts if t > cutoff]
        attempts.append(now)
        remaining = max(0, self.max_attempts - len(attempts))

        if len(attempts) >= self.max_attempts:
            blocked_until = now + self.block_ms / 1000
            retry_after = int(self.block_ms / 1000)
            self._buckets[key] = ([], blocked_until)
            return False, 0, retry_after

        self._buckets[key] = (attempts, blocked_until)
        return True, remaining, 0

    def reset(self, identifier: str) -> None:
        self._buckets.pop(identifier.strip().upper(), None)


rate_limiter = LoginRateLimiter()
