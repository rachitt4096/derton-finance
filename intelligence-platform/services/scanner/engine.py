"""Scanner: continuously rank symbols per horizon into Redis sorted sets.

    Score = confidence × expected_move × liquidity_rank

Consumes stream:preds.new (event-driven) and also runs a periodic full rebuild
(every few seconds) so stale entries age out. liquidity_rank is read from the
nightly liq:rank hash. Reads/writes are pure Redis — no ClickHouse on the path.
Run as a single active instance (global ranking).
"""
from __future__ import annotations

import asyncio

from services.common.config import settings
from services.common.redis_bus import ack, consume, redis


class Scanner:
    async def run(self):
        await asyncio.gather(self._consume(), self._reaper())

    async def _consume(self, consumer="scanner-1"):
        async for msg_id, ev in consume("stream:preds.new", "cg:scanner", consumer):
            await self._score(ev)
            await ack("stream:preds.new", "cg:scanner", msg_id)

    async def _score(self, ev: dict):
        sym, h = ev["symbol"], ev["horizon"]
        conf = float(ev["conf"])
        move = abs(float(ev["exp_move"]))
        liq = float(await redis().hget("liq:rank", sym) or 0.5)
        score = conf * move * liq
        await redis().zadd(f"scanner:{h}", {sym: score})

    async def _reaper(self):
        """Periodically trim each scanner set to its top-N and drop stale syms
        whose live prediction key has expired."""
        while True:
            await asyncio.sleep(5)
            for h in settings.horizons:
                key = f"scanner:{h}"
                members = await redis().zrevrange(key, 0, 500)
                pipe = redis().pipeline()
                for sym in members:
                    if not await redis().exists(f"pred:{h}:{sym}"):
                        pipe.zrem(key, sym)
                await pipe.execute()
                # keep only top 200
                await redis().zremrangebyrank(key, 0, -201)

    @staticmethod
    async def top(horizon: str, n: int = 20):
        rows = await redis().zrevrange(f"scanner:{horizon}", 0, n - 1,
                                       withscores=True)
        return [{"symbol": s, "score": sc} for s, sc in rows]


if __name__ == "__main__":
    asyncio.run(Scanner().run())
