"""Thin helpers over redis streams (the event bus) and hot-state keys."""
from __future__ import annotations

import json

import redis.asyncio as aioredis

from .config import settings

_pool: aioredis.Redis | None = None


def redis() -> aioredis.Redis:
    global _pool
    if _pool is None:
        _pool = aioredis.from_url(settings.redis_url, decode_responses=True)
    return _pool


async def xadd(stream: str, payload: dict, maxlen: int = 1_000_000) -> str:
    flat = {k: (v if isinstance(v, (str, int, float)) else json.dumps(v))
            for k, v in payload.items()}
    return await redis().xadd(stream, flat, maxlen=maxlen, approximate=True)


async def ensure_group(stream: str, group: str) -> None:
    try:
        await redis().xgroup_create(stream, group, id="0", mkstream=True)
    except aioredis.ResponseError as exc:
        if "BUSYGROUP" not in str(exc):
            raise


async def consume(stream: str, group: str, consumer: str, count: int = 100,
                  block_ms: int = 2000):
    """Async generator yielding (msg_id, dict). Caller must `await ack(...)`."""
    await ensure_group(stream, group)
    r = redis()
    while True:
        resp = await r.xreadgroup(group, consumer, {stream: ">"},
                                  count=count, block=block_ms)
        if not resp:
            continue
        for _stream, messages in resp:
            for msg_id, fields in messages:
                yield msg_id, fields


async def ack(stream: str, group: str, msg_id: str) -> None:
    await redis().xack(stream, group, msg_id)


async def reclaim(stream: str, group: str, consumer: str, min_idle_ms: int = 30_000):
    """Recover messages from dead consumers (crash safety)."""
    r = redis()
    await ensure_group(stream, group)
    _, claimed, _ = await r.xautoclaim(stream, group, consumer,
                                       min_idle_time=min_idle_ms, count=100)
    return claimed
