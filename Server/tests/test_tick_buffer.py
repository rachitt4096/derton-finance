from __future__ import annotations

from app.services.tick_buffer import TickBuffer


def test_ingest_and_drain():
    buf = TickBuffer()
    buf.ingest({"symbol": "RELIANCE", "price": 2500.0, "recorded_at": 1000, "volume": 100})
    buf.ingest({"symbol": "TCS", "price": 3500.0, "recorded_at": 1001, "volume": 50})

    prices = buf.get_latest_price_map()
    assert prices["RELIANCE"] == 2500.0
    assert prices["TCS"] == 3500.0

    pending = buf.drain_pending()
    assert len(pending) == 2
    assert len(buf.drain_pending()) == 0


def test_latest_price_map_with_filter():
    buf = TickBuffer()
    buf.ingest({"symbol": "RELIANCE", "price": 2500.0, "recorded_at": 1000, "volume": 100})
    buf.ingest({"symbol": "TCS", "price": 3500.0, "recorded_at": 1001, "volume": 50})

    prices = buf.get_latest_price_map(["RELIANCE"])
    assert "RELIANCE" in prices
    assert "TCS" not in prices


def test_restore_pending():
    buf = TickBuffer()
    buf.ingest({"symbol": "RELIANCE", "price": 2500.0, "recorded_at": 1000, "volume": 100})
    ticks = buf.drain_pending()
    buf.restore_pending(ticks)
    assert len(buf.drain_pending()) == 1


def test_get_latest_tick_at():
    buf = TickBuffer()
    buf.ingest({"symbol": "A", "price": 100, "recorded_at": 100, "volume": 1})
    buf.ingest({"symbol": "B", "price": 200, "recorded_at": 200, "volume": 1})
    assert buf.get_latest_tick_at() == 200
    assert buf.get_latest_tick_at(["A"]) == 100


def test_seed():
    buf = TickBuffer()
    buf.seed("RELIANCE", 2600.0)
    assert buf.get_latest_price_map()["RELIANCE"] == 2600.0


def test_delete_symbol():
    buf = TickBuffer()
    buf.ingest({"symbol": "RELIANCE", "price": 2500.0, "recorded_at": 1000, "volume": 100})
    buf.delete_symbol("RELIANCE")
    assert "RELIANCE" not in buf.get_latest_price_map()
