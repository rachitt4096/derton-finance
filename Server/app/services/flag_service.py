from __future__ import annotations

import secrets

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


class FlagService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def list_flags(self) -> list[dict]:
        result = await self.db.execute(
            text(
                """
                SELECT id, symbol, company_name, type, detail, since_label, severity, status
                FROM risk_flags
                ORDER BY created_at DESC, symbol ASC
                """
            )
        )
        return [
            {
                "id": r[0],
                "symbol": r[1],
                "company": r[2],
                "type": r[3],
                "detail": r[4],
                "since": r[5],
                "severity": r[6],
                "status": r[7],
            }
            for r in result.all()
        ]

    async def create_flag(self, input_data: dict) -> str:
        fid = secrets.token_hex(16)
        await self.db.execute(
            text(
                """
                INSERT INTO risk_flags (id, symbol, company_name, type, detail, since_label, severity, status)
                VALUES (:id, :symbol, :company, :type, :detail, :since, :severity, :status)
                """
            ),
            {
                "id": fid,
                "symbol": input_data["symbol"],
                "company": input_data["company"],
                "type": input_data["type"],
                "detail": input_data["detail"],
                "since": input_data["since"],
                "severity": input_data["severity"],
                "status": input_data["status"],
            },
        )
        return fid

    async def update_flag(self, flag_id: str, input_data: dict) -> None:
        await self.db.execute(
            text(
                """
                UPDATE risk_flags
                SET detail = :detail, severity = :severity, status = :status
                WHERE id = :id
                """
            ),
            {
                "detail": input_data["detail"],
                "severity": input_data["severity"],
                "status": input_data["status"],
                "id": flag_id,
            },
        )

    async def delete_flag(self, flag_id: str) -> None:
        await self.db.execute(
            text("DELETE FROM risk_flags WHERE id = :id"), {"id": flag_id}
        )
