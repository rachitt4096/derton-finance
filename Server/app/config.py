from __future__ import annotations

from pydantic import AliasChoices, Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import ClassVar


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
        populate_by_name=True,
        extra="ignore",
    )

    # --- General ---
    NODE_ENV: str = "development"
    DEBUG: bool = False
    SECRET_KEY: str = "change-me-in-production"
    PORT: int = 4000
    HOST: str = "0.0.0.0"
    APP_ORIGIN: str = Field(
        default="http://localhost:5173,http://localhost:5174",
        validation_alias=AliasChoices("APP_ORIGIN", "CORS_ORIGINS"),
    )

    # --- Auth ---
    COOKIE_NAME: str = "derton_session"
    COOKIE_SECURE: bool | None = None
    COOKIE_SAME_SITE: str = "lax"
    COOKIE_DOMAIN: str = ""
    SESSION_TTL_HOURS: int = 168
    AUTH_RATE_LIMIT_WINDOW_MS: int = 300_000
    AUTH_RATE_LIMIT_MAX_ATTEMPTS: int = 10
    AUTH_RATE_LIMIT_BLOCK_MS: int = 900_000

    # --- PostgreSQL ---
    POSTGRES_URL: str = Field(
        default="postgresql+asyncpg://postgres:postgres@localhost:5432/derton_finance",
        validation_alias=AliasChoices("POSTGRES_URL", "POSTGRES_DSN"),
    )

    # --- ClickHouse ---
    CLICKHOUSE_HOST: str = "localhost"
    CLICKHOUSE_PORT: int = 9000
    CLICKHOUSE_USER: str = "default"
    CLICKHOUSE_PASSWORD: str = ""
    CLICKHOUSE_DATABASE: str = "derton_finance"

    # --- MinIO ---
    MINIO_ENABLED: bool = True
    MINIO_ENDPOINT: str = "localhost:9000"
    MINIO_ACCESS_KEY: str = "minioadmin"
    MINIO_SECRET_KEY: str = "minioadmin"
    MINIO_BUCKET: str = "derton-finance"
    MINIO_SECURE: bool = False

    # --- Redis ---
    REDIS_URL: str = Field(
        default="redis://localhost:6379/0",
        validation_alias=AliasChoices("REDIS_URL", "REDIS_DSN"),
    )

    # --- AWS / Bedrock ---
    AWS_REGION: str = "ap-south-1"
    AWS_ACCESS_KEY_ID: str = ""
    AWS_SECRET_ACCESS_KEY: str = ""

    # --- AI Assistant ---
    AI_ENABLED: bool = False
    BEDROCK_REGION: str = ""  # falls back to AWS_REGION if empty
    BEDROCK_MODEL_ID: str = ""  # e.g. an enabled Bedrock model / inference profile id
    AI_MAX_TOKENS: int = 2200
    AI_MAX_TOOL_ITERATIONS: int = 8
    # Web search (Tavily) for news/insights tool
    TAVILY_API_KEY: str = ""

    # --- Market Data ---
    BROKER_MODE: str = "upstox"
    MARKET_SNAPSHOT_MS: int = 500
    MARKET_FLUSH_MS: int = 1000
    MARKET_HISTORY_RETENTION_DAYS: int = 90
    MARKET_CANDLE_RETENTION_DAYS: int = 365
    # Continuously record the full market-cap universe (>= 10,000 cr) to ClickHouse,
    # not just user watchlists. RECORD_UNIVERSE_MAX caps subscriptions (largest caps
    # win) to stay under the broker's full-mode per-connection limit.
    RECORD_UNIVERSE_ENABLED: bool = True
    RECORD_UNIVERSE_MAX: int = 1500

    # --- Upstox ---
    UPSTOX_API_KEY: str = ""
    UPSTOX_API_SECRET: str = ""
    UPSTOX_REDIRECT_URI: str = ""
    UPSTOX_AUTH_URL: str = "https://api.upstox.com/v2/login/authorization/dialog"
    UPSTOX_TOKEN_URL: str = "https://api.upstox.com/v2/login/authorization/token"
    UPSTOX_ACCESS_TOKEN: str = ""
    UPSTOX_USER_ID: str = ""
    UPSTOX_PIN: str = ""
    UPSTOX_TOTP_SECRET: str = ""
    UPSTOX_INSTRUMENTS_URL: str = (
        "https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz"
    )

    # --- Seeding ---
    SEED_ADMIN_USERNAME: str = "ADMIN01"
    SEED_ADMIN_EMAIL: str = "admin@derton.local"
    SEED_ADMIN_PASSWORD: str = "admin@2026"
    ALLOW_DEFAULT_ADMIN_PASSWORD: bool | None = None

    # --- Alerts ---
    ALERTS_ENABLED: bool | None = None
    ALERT_COOLDOWN_MS: int = 300_000
    ALERT_SLACK_WEBHOOK_URL: str = ""
    ALERT_EMAIL_WEBHOOK_URL: str = ""
    ALERT_EMAIL_WEBHOOK_TOKEN: str = ""
    ALERT_EMAIL_FROM: str = ""
    ALERT_EMAIL_TO: str = ""
    ALERT_WHATSAPP_TWILIO_ACCOUNT_SID: str = ""
    ALERT_WHATSAPP_TWILIO_AUTH_TOKEN: str = ""
    ALERT_WHATSAPP_TWILIO_FROM: str = ""
    ALERT_WHATSAPP_TWILIO_TO: str = ""

    DEFAULT_ADMIN_PASSWORD: ClassVar[str] = "admin@2026"

    @property
    def APP_ORIGINS(self) -> list[str]:
        return list(
            dict.fromkeys(
                origin.strip()
                for origin in self.APP_ORIGIN.split(",")
                if origin.strip()
            )
        )

    @property
    def COOKIE_SECURE_RESOLVED(self) -> bool:
        if self.COOKIE_SECURE is not None:
            return self.COOKIE_SECURE
        return self.NODE_ENV == "production"

    @property
    def ALLOW_DEFAULT_PASSWORD(self) -> bool:
        if self.ALLOW_DEFAULT_ADMIN_PASSWORD is not None:
            return self.ALLOW_DEFAULT_ADMIN_PASSWORD
        return self.NODE_ENV != "production"

    @property
    def ALERTS_ENABLED_RESOLVED(self) -> bool:
        if self.ALERTS_ENABLED is not None:
            return self.ALERTS_ENABLED
        return False

    @field_validator("NODE_ENV")
    @classmethod
    def validate_env(cls, v: str) -> str:
        if v not in ("development", "test", "production"):
            raise ValueError("NODE_ENV must be development, test, or production")
        return v

    @field_validator("DEBUG", mode="before")
    @classmethod
    def normalize_debug(cls, v: object) -> object:
        if isinstance(v, str) and v.lower().strip() in ("release", "prod", "production"):
            return False
        return v

    @field_validator("COOKIE_SAME_SITE")
    @classmethod
    def validate_same_site(cls, v: str) -> str:
        if v not in ("strict", "lax", "none"):
            raise ValueError('COOKIE_SAME_SITE must be strict, lax, or none')
        return v


settings = Settings()
