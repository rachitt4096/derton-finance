from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.config import Settings


def test_config_validates_same_site():
    with pytest.raises(ValidationError):
        Settings(COOKIE_SAME_SITE="invalid")


def test_config_parses_origins():
    s = Settings(APP_ORIGIN="http://localhost:5173,http://localhost:5174")
    assert s.APP_ORIGINS == ["http://localhost:5173", "http://localhost:5174"]


def test_config_accepts_env_aliases():
    s = Settings(
        POSTGRES_DSN="postgresql+asyncpg://derton:derton@localhost:5433/derton_finance",
        REDIS_DSN="redis://localhost:6379/0",
        CORS_ORIGINS="http://localhost:5176,http://localhost:5181",
        AWS_REGION="ap-south-1",
    )
    assert s.POSTGRES_URL == "postgresql+asyncpg://derton:derton@localhost:5433/derton_finance"
    assert s.REDIS_URL == "redis://localhost:6379/0"
    assert s.APP_ORIGINS == ["http://localhost:5176", "http://localhost:5181"]
    assert s.AWS_REGION == "ap-south-1"


def test_config_default_cookie_secure():
    s = Settings(COOKIE_SECURE=None, NODE_ENV="production")
    assert s.COOKIE_SECURE_RESOLVED is True

    s = Settings(COOKIE_SECURE=None, NODE_ENV="development")
    assert s.COOKIE_SECURE_RESOLVED is False


def test_config_allow_default_password():
    s = Settings(ALLOW_DEFAULT_ADMIN_PASSWORD=None, NODE_ENV="production")
    assert s.ALLOW_DEFAULT_PASSWORD is False

    s = Settings(ALLOW_DEFAULT_ADMIN_PASSWORD=None, NODE_ENV="development")
    assert s.ALLOW_DEFAULT_PASSWORD is True


def test_config_validates_env():
    with pytest.raises(ValidationError):
        Settings(NODE_ENV="invalid")
