from __future__ import annotations

import boto3
from botocore.config import Config
from app.config import settings

_minio_client = None


def get_minio_client():
    global _minio_client
    if _minio_client is None:
        _minio_client = boto3.client(
            "s3",
            endpoint_url=f"http{'s' if settings.MINIO_SECURE else ''}://{settings.MINIO_ENDPOINT}",
            aws_access_key_id=settings.MINIO_ACCESS_KEY,
            aws_secret_access_key=settings.MINIO_SECRET_KEY,
            config=Config(
                connect_timeout=5,
                read_timeout=30,
                retries={"max_attempts": 3, "mode": "standard"},
            ),
        )
    return _minio_client


async def init_minio() -> None:
    if not settings.MINIO_ENABLED:
        return
    client = get_minio_client()
    buckets = [b["Name"] for b in client.list_buckets().get("Buckets", [])]
    if settings.MINIO_BUCKET not in buckets:
        client.create_bucket(Bucket=settings.MINIO_BUCKET)


def close_minio() -> None:
    global _minio_client
    if _minio_client:
        _minio_client.close()
        _minio_client = None
