from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.security import (
    generate_session_token,
    hash_password,
    hash_token,
    make_id,
    verify_password,
)
from app.models.session import Session
from app.models.user import User


class AuthService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def login(self, identifier: str, password: str) -> dict | None:
        identifier = identifier.strip()
        result = await self.db.execute(
            select(User).where(
                (User.is_active.is_(True))
                & (
                    (User.email.ilike(identifier))
                    | (User.username.ilike(identifier))
                )
            )
        )
        user = result.scalar_one_or_none()
        if not user:
            return None
        if not verify_password(password, user.password_hash):
            return None

        raw_token = generate_session_token()
        token_hash_val = hash_token(raw_token)
        expires_at = datetime.now(timezone.utc) + timedelta(
            hours=settings.SESSION_TTL_HOURS
        )

        session = Session(
            id=make_id("sess"),
            user_id=user.id,
            token_hash=token_hash_val,
            expires_at=expires_at,
        )
        self.db.add(session)

        return {
            "token": raw_token,
            "expires_at": expires_at,
            "user": {
                "id": user.id,
                "email": user.email,
                "username": user.username,
                "role": user.role,
            },
        }

    async def logout(self, token: str) -> None:
        token_hash_val = hash_token(token)
        await self.db.execute(
            text("DELETE FROM sessions WHERE token_hash = :token_hash"),
            {"token_hash": token_hash_val},
        )

    async def get_session_user(self, token: str) -> dict | None:
        token_hash_val = hash_token(token)
        result = await self.db.execute(
            text(
                """
                SELECT users.id, users.email, users.username, users.role
                FROM sessions
                JOIN users ON users.id = sessions.user_id
                WHERE sessions.token_hash = :token_hash
                  AND sessions.expires_at > now()
                  AND users.is_active = true
                LIMIT 1
                """
            ),
            {"token_hash": token_hash_val},
        )
        row = result.one_or_none()
        if not row:
            return None
        return {
            "id": row[0],
            "email": row[1],
            "username": row[2],
            "role": row[3],
        }

    async def revoke_user_sessions(self, user_id: str) -> None:
        await self.db.execute(
            text("DELETE FROM sessions WHERE user_id = :user_id"),
            {"user_id": user_id},
        )

    async def purge_expired_sessions(self) -> None:
        await self.db.execute(
            text("DELETE FROM sessions WHERE expires_at <= now()")
        )
