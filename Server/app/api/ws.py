from __future__ import annotations

import json
import secrets
from typing import Any

from fastapi import WebSocket


class ConnectionManager:
    def __init__(self) -> None:
        self._connections: dict[str, dict[str, Any]] = {}

    async def connect(self, websocket: WebSocket) -> str:
        await websocket.accept()
        conn_id = secrets.token_hex(8)
        self._connections[conn_id] = {
            "ws": websocket,
            "user_id": None,
            "symbols": set(),
        }
        return conn_id

    def disconnect(self, conn_id: str) -> None:
        self._connections.pop(conn_id, None)

    def set_user(self, conn_id: str, user_id: str) -> None:
        conn = self._connections.get(conn_id)
        if conn:
            conn["user_id"] = user_id

    def set_symbols(self, conn_id: str, symbols: list[str]) -> None:
        conn = self._connections.get(conn_id)
        if conn:
            conn["symbols"] = set(symbols)

    async def broadcast(self, message: dict) -> None:
        disconnected: list[str] = []
        for conn_id, conn in self._connections.items():
            if not conn["user_id"]:
                continue
            try:
                await conn["ws"].send_json(message)
            except Exception:
                disconnected.append(conn_id)
        for cid in disconnected:
            self.disconnect(cid)

    async def send_personal_by_id(self, conn_id: str, message: dict) -> None:
        conn = self._connections.get(conn_id)
        if conn:
            try:
                await conn["ws"].send_json(message)
            except Exception:
                pass

    def get_connected_user_ids(self) -> list[str]:
        return [
            c["user_id"]
            for c in self._connections.values()
            if c["user_id"] is not None
        ]


manager = ConnectionManager()
