from __future__ import annotations

import json
from contextlib import asynccontextmanager
from datetime import datetime
from typing import TYPE_CHECKING, AsyncGenerator

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import async_sessionmaker


class BrokerCredentialStore:
    def __init__(
        self,
        db: AsyncSession | None = None,
        *,
        session_factory: "async_sessionmaker[AsyncSession] | None" = None,
    ) -> None:
        self._db = db
        self._session_factory = session_factory

    @asynccontextmanager
    async def _session(self) -> AsyncGenerator[AsyncSession, None]:
        if self._db is not None:
            yield self._db
        elif self._session_factory is not None:
            async with self._session_factory() as session:
                yield session
        else:
            raise RuntimeError("BrokerCredentialStore requires a db session or session_factory")

    async def get(self, provider: str) -> dict | None:
        async with self._session() as db:
            result = await db.execute(
                text(
                    """
                    SELECT provider, access_token, expires_at::text, metadata, updated_at::text
                    FROM broker_credentials
                    WHERE provider = :provider
                    LIMIT 1
                    """
                ),
                {"provider": provider},
            )
            row = result.one_or_none()
        if not row:
            return None
        return {
            "provider": row[0],
            "access_token": row[1],
            "expires_at": row[2],
            "metadata": row[3],
            "updated_at": row[4],
        }

    async def set(
        self,
        provider: str,
        access_token: str,
        expires_at: datetime | None = None,
        metadata: dict | None = None,
    ) -> None:
        async with self._session() as db:
            await db.execute(
                text(
                    """
                    INSERT INTO broker_credentials (provider, access_token, expires_at, metadata, updated_at)
                    VALUES (:provider, :token, :expires, CAST(:metadata AS jsonb), now())
                    ON CONFLICT (provider) DO UPDATE SET
                        access_token = EXCLUDED.access_token,
                        expires_at = EXCLUDED.expires_at,
                        metadata = EXCLUDED.metadata,
                        updated_at = now()
                    """
                ),
                {
                    "provider": provider,
                    "token": access_token,
                    "expires": expires_at,
                    "metadata": json.dumps(metadata or {}),
                },
            )
            await db.commit()

    async def clear(self, provider: str) -> None:
        async with self._session() as db:
            await db.execute(
                text("DELETE FROM broker_credentials WHERE provider = :provider"),
                {"provider": provider},
            )
            await db.commit()

    async def resolve_access_token(self, provider: str, env_token: str = "") -> str | None:
        stored = await self.get(provider)
        if stored and stored.get("access_token"):
            return stored["access_token"]
        return env_token.strip() or None
