from __future__ import annotations

from collections.abc import Callable
from typing import Any

from app.database import async_session_factory
from app.services.instrument_service import InstrumentService
from app.services.upstox.credential_store import BrokerCredentialStore
from app.services.upstox.ws_client import UpstoxWebsocketClient


class UpstoxBrokerAdapter:
    """Upstox market data adapter using WebSocket V3 with protobuf encoding.

    Connects to the Upstox Market Data Feed V3 via a persistent WebSocket,
    subscribes to instrument keys, and emits parsed ticks to registered handlers.
    Replaces the original Node.js MarketDataStreamerV3 SDK usage.
    """

    def __init__(
        self,
        credential_store: BrokerCredentialStore,
        instrument_service: InstrumentService,
    ) -> None:
        self._ws_client = UpstoxWebsocketClient(credential_store, instrument_service)

        self._tick_handlers: list[Callable] = []
        self._status_handlers: list[Callable] = []

        self._ws_client.on_tick(self._on_client_tick)
        self._ws_client.on_status_change(self._on_client_status)

    @property
    def status(self) -> dict[str, Any]:
        return self._ws_client.status

    async def connect(self) -> None:
        await self._ws_client.start()

    async def disconnect(self) -> None:
        await self._ws_client.stop()

    async def subscribe(self, symbols: list[str]) -> None:
        await self._ws_client.subscribe(symbols)

    async def unsubscribe(self, symbols: list[str]) -> None:
        await self._ws_client.unsubscribe(symbols)

    def get_status(self) -> dict[str, Any]:
        return self._ws_client.status

    def on_tick(self, handler: Callable) -> None:
        self._tick_handlers.append(handler)

    def on_status_change(self, handler: Callable) -> None:
        self._status_handlers.append(handler)

    def _on_client_tick(self, tick: dict) -> None:
        for handler in self._tick_handlers:
            try:
                handler(tick)
            except Exception:
                pass

    def _on_client_status(self, status: dict) -> None:
        for handler in self._status_handlers:
            try:
                handler(status)
            except Exception:
                pass

    @classmethod
    async def create_default(cls) -> UpstoxBrokerAdapter:
        credential_store = BrokerCredentialStore(session_factory=async_session_factory)
        instrument_service = InstrumentService(session_factory=async_session_factory)
        return cls(credential_store, instrument_service)
