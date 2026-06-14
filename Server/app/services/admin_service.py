from __future__ import annotations

import secrets

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.clickhouse import get_ch_client
from app.config import settings
from app.core.exceptions import ConflictError, NotFoundError
from app.core.security import hash_password, make_id


class AdminService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def get_overview(self) -> dict:
        users = await self.db.execute(
            text(
                """
                SELECT
                    COUNT(*)::text as total,
                    COUNT(*) FILTER (WHERE is_active = true)::text as active,
                    COUNT(*) FILTER (WHERE role = 'admin' AND is_active = true)::text as admins
                FROM users
                """
            )
        )
        u = users.one_or_none()
        sessions = await self.db.execute(
            text("SELECT COUNT(*)::text FROM sessions WHERE expires_at > now()")
        )
        instruments = await self.db.execute(
            text("SELECT COUNT(*)::text FROM instruments")
        )
        watchlists = await self.db.execute(
            text("SELECT COUNT(*)::text FROM watchlists")
        )

        try:
            ch = get_ch_client()
            tick_rows = ch.execute(
                "SELECT COUNT(*), MIN(recorded_at), MAX(recorded_at) FROM market_ticks"
            )
            t = tick_rows[0] if tick_rows else (0, None, None)
        except Exception:
            t = (0, None, None)

        return {
            "users": {
                "total": int(u[0] or 0),
                "active": int(u[1] or 0),
                "admins": int(u[2] or 0),
            },
            "sessions": {"active": int(sessions.scalar() or 0)},
            "instruments": {"total": int(instruments.scalar() or 0)},
            "watchlists": {"total": int(watchlists.scalar() or 0)},
            "market_history": {
                "tick_count": int(t[0] or 0),
                "oldest_tick_at": t[1].isoformat() if t[1] and hasattr(t[1], "isoformat") else t[1],
                "newest_tick_at": t[2].isoformat() if t[2] and hasattr(t[2], "isoformat") else t[2],
            },
        }

    async def list_users(self) -> list[dict]:
        result = await self.db.execute(
            text(
                """
                SELECT
                    users.id, users.email, users.username, users.display_name,
                    users.role, users.is_active, users.created_at::text, users.updated_at::text,
                    COUNT(sessions.id) FILTER (WHERE sessions.expires_at > now())::text as active_sessions,
                    MAX(sessions.created_at)::text as last_session
                FROM users
                LEFT JOIN sessions ON sessions.user_id = users.id
                GROUP BY users.id
                ORDER BY users.created_at ASC
                """
            )
        )
        return [
            {
                "id": r[0],
                "email": r[1],
                "username": r[2],
                "display_name": r[3],
                "role": r[4],
                "is_active": r[5],
                "created_at": r[6],
                "updated_at": r[7],
                "active_session_count": int(r[8] or 0),
                "last_session_at": r[9],
            }
            for r in result.all()
        ]

    async def create_user(self, actor_id: str, input_data: dict) -> str:
        username = input_data["username"].strip().upper()
        email = f"{username.lower()}@derton.local"
        display_name = input_data.get("display_name", "").strip() or None

        existing = await self.db.execute(
            text(
                """
                SELECT 1 FROM users
                WHERE LOWER(email) = LOWER(:email) OR UPPER(username) = UPPER(:username)
                LIMIT 1
                """
            ),
            {"email": email, "username": username},
        )
        if existing.one_or_none():
            raise ConflictError("A user with this username already exists.")

        uid = secrets.token_hex(16)
        pwd_hash = hash_password(input_data["password"])
        await self.db.execute(
            text(
                """
                INSERT INTO users (id, email, username, display_name, password_hash, role, is_active, updated_at)
                VALUES (:id, :email, :username, :display_name, :pwd_hash, :role, true, now())
                """
            ),
            {
                "id": uid,
                "email": email,
                "username": username,
                "display_name": display_name,
                "pwd_hash": pwd_hash,
                "role": input_data["role"],
            },
        )

        await self._write_audit(actor_id, "user.create", "user", uid, {
            "email": email, "username": username, "role": input_data["role"],
        })
        return uid

    async def update_user(self, actor_id: str, user_id: str, input_data: dict) -> None:
        user = await self._get_user(user_id)
        if not user:
            raise NotFoundError("User not found.")

        updates: list[str] = []
        params: dict = {"id": user_id}
        idx = 1

        if "email" in input_data and input_data["email"] is not None:
            updates.append(f"email = :p{idx}")
            params[f"p{idx}"] = input_data["email"].lower().strip()
            idx += 1
        if "role" in input_data and input_data["role"] is not None:
            updates.append(f"role = :p{idx}")
            params[f"p{idx}"] = input_data["role"]
            idx += 1
        if "display_name" in input_data:
            updates.append(f"display_name = :p{idx}")
            params[f"p{idx}"] = input_data["display_name"].strip() if input_data["display_name"] else None
            idx += 1
        if "is_active" in input_data and input_data["is_active"] is not None:
            updates.append(f"is_active = :p{idx}")
            params[f"p{idx}"] = input_data["is_active"]
            idx += 1

        if not updates:
            return

        updates.append("updated_at = now()")
        await self.db.execute(
            text(f"UPDATE users SET {', '.join(updates)} WHERE id = :id"),
            params,
        )

        if input_data.get("is_active") is False:
            await self.db.execute(
                text("DELETE FROM sessions WHERE user_id = :uid"), {"uid": user_id}
            )

        await self._write_audit(actor_id, "user.update", "user", user_id, input_data)

    async def reset_password(self, actor_id: str, user_id: str, password: str) -> None:
        user = await self._get_user(user_id)
        if not user:
            raise NotFoundError("User not found.")

        pwd_hash = hash_password(password)
        await self.db.execute(
            text("UPDATE users SET password_hash = :pwd, updated_at = now() WHERE id = :id"),
            {"pwd": pwd_hash, "id": user_id},
        )
        await self.db.execute(
            text("DELETE FROM sessions WHERE user_id = :uid"), {"uid": user_id}
        )
        await self._write_audit(actor_id, "user.reset_password", "user", user_id, {})

    async def revoke_sessions(self, actor_id: str, user_id: str) -> None:
        user = await self._get_user(user_id)
        if not user:
            raise NotFoundError("User not found.")
        await self.db.execute(
            text("DELETE FROM sessions WHERE user_id = :uid"), {"uid": user_id}
        )
        await self._write_audit(actor_id, "user.revoke_sessions", "user", user_id, {})

    async def _get_user(self, user_id: str) -> dict | None:
        result = await self.db.execute(
            text(
                """
                SELECT id, email, username, display_name, role, is_active
                FROM users WHERE id = :id LIMIT 1
                """
            ),
            {"id": user_id},
        )
        row = result.one_or_none()
        if not row:
            return None
        return {
            "id": row[0], "email": row[1], "username": row[2],
            "display_name": row[3], "role": row[4], "is_active": row[5],
        }

    async def _write_audit(
        self, actor_id: str, action: str, entity_type: str, entity_id: str | None, payload: dict
    ) -> None:
        await self.db.execute(
            text(
                """
                INSERT INTO audit_logs (id, actor_user_id, action, entity_type, entity_id, payload)
                VALUES (:id, :actor, :action, :entity_type, :entity_id, :payload::jsonb)
                """
            ),
            {
                "id": secrets.token_hex(16),
                "actor": actor_id,
                "action": action,
                "entity_type": entity_type,
                "entity_id": entity_id,
                "payload": payload,
            },
        )
