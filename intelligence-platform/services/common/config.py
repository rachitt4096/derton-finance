"""Single source of configuration for every service (12-factor: env-driven)."""
from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # ClickHouse
    clickhouse_host: str = "localhost"
    clickhouse_port: int = 8123
    clickhouse_user: str = "default"
    clickhouse_password: str = ""

    # Redis
    redis_url: str = "redis://localhost:6379/0"

    # Object store (model + dataset artifacts)
    s3_endpoint: str = "http://localhost:9000"
    s3_bucket: str = "models"
    s3_access_key: str = "minioadmin"
    s3_secret_key: str = "minioadmin"

    # Upstox
    upstox_access_token: str = ""
    upstox_ws_url: str = "wss://api.upstox.com/v3/feed/market-data-feed"

    # Ingestion / batching
    ch_insert_batch: int = 10_000
    ch_flush_secs: float = 1.0

    # Model serving
    feature_version: str = "fv1"
    horizons: tuple[str, ...] = ("30s", "2m", "15m", "eod")

    # Drift thresholds
    psi_threshold: float = 0.2
    accuracy_drop_threshold: float = 0.05
    ece_threshold: float = 0.08


settings = Settings()
