"""ClickHouse access: a shared client plus a batched, async-flushing inserter.

The inserter keeps ClickHouse off the hot path — services push rows into an
in-memory buffer that flushes on size or time, whichever comes first.
"""
from __future__ import annotations

import asyncio
import threading
import time
from collections import defaultdict

import clickhouse_connect

from .config import settings


def get_client():
    return clickhouse_connect.get_client(
        host=settings.clickhouse_host,
        port=settings.clickhouse_port,
        username=settings.clickhouse_user,
        password=settings.clickhouse_password,
        compress=True,
    )


class BatchInserter:
    """Thread-safe batched inserter. One instance per process; many tables.

    insert("market_data.ticks", columns, row) buffers; a background flusher
    writes whenever a table buffer hits ch_insert_batch or ch_flush_secs.
    """

    def __init__(self):
        self._client = get_client()
        self._buf: dict[str, list[list]] = defaultdict(list)
        self._cols: dict[str, list[str]] = {}
        self._lock = threading.Lock()
        self._last_flush = time.monotonic()
        self._stop = threading.Event()
        self._t = threading.Thread(target=self._loop, daemon=True)
        self._t.start()

    def insert(self, table: str, columns: list[str], row: list) -> None:
        with self._lock:
            self._cols[table] = columns
            self._buf[table].append(row)
            if len(self._buf[table]) >= settings.ch_insert_batch:
                self._flush_locked()

    def _loop(self):
        while not self._stop.wait(settings.ch_flush_secs):
            with self._lock:
                if time.monotonic() - self._last_flush >= settings.ch_flush_secs:
                    self._flush_locked()

    def _flush_locked(self):
        for table, rows in list(self._buf.items()):
            if not rows:
                continue
            try:
                self._client.insert(table, rows, column_names=self._cols[table])
                self._buf[table] = []
            except Exception as exc:  # noqa: BLE001 — keep buffering, log & retry next tick
                print(f"[ch-insert] {table} failed, will retry: {exc}")
        self._last_flush = time.monotonic()

    def close(self):
        self._stop.set()
        with self._lock:
            self._flush_locked()


# Convenience for async code that wants to await a flush without blocking the loop.
async def aflush(inserter: BatchInserter):
    await asyncio.get_running_loop().run_in_executor(None, inserter._flush_locked)
