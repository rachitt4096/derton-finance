import { useEffect, useMemo, useState } from 'react'
import { MetricTile, TerminalPanel, WorkspaceShell } from '../../components/terminal/TerminalPrimitives'
import LazyMainChart from '../../components/chart/LazyMainChart'
import useMarketStore from '../../store/useMarketStore'
import { fetchMarketHistory } from '../../utils/terminalApi'
import { normalizeBackendCandles } from '../../hooks/useChartData'
import { formatCurrency, formatPercent } from '../../utils/formatters'

const INTERVALS = [
  { key: '1m', label: '1m' },
  { key: '5m', label: '5m' },
  { key: '15m', label: '15m' },
]

// Most recent weekday (NSE doesn't trade weekends) as a sensible default.
const lastTradingDay = () => {
  const d = new Date()
  const day = d.getDay()
  if (day === 0) d.setDate(d.getDate() - 2) // Sun -> Fri
  else if (day === 6) d.setDate(d.getDate() - 1) // Sat -> Fri
  else d.setDate(d.getDate() - 1) // default to previous session
  return d.toISOString().slice(0, 10)
}

const fmt = (v, d = 2) =>
  Number.isFinite(v) ? Number(v).toLocaleString('en-IN', { maximumFractionDigits: d, minimumFractionDigits: d }) : '--'

function History() {
  const watchlistSymbols = useMarketStore((state) => state.watchlistSymbols)
  const storeSymbol = useMarketStore((state) => state.selectedSymbol)

  const [symbol, setSymbol] = useState(storeSymbol || 'RELIANCE')
  const [date, setDate] = useState(lastTradingDay())
  const [interval, setInterval] = useState('1m')
  const [candles, setCandles] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    fetchMarketHistory({ symbol, interval, date, days: 1 })
      .then((raw) => {
        if (!active) return
        const normalized = normalizeBackendCandles(raw, interval, null)
        setCandles(normalized)
      })
      .catch((err) => active && setError(err.message))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [symbol, interval, date])

  const stats = useMemo(() => {
    if (!candles.length) return null
    const open = candles[0].o
    const close = candles[candles.length - 1].c
    let high = -Infinity
    let low = Infinity
    let vol = 0
    let pv = 0
    for (const c of candles) {
      if (c.h > high) high = c.h
      if (c.l < low) low = c.l
      vol += c.v ?? 0
      pv += ((c.h + c.l + c.c) / 3) * (c.v ?? 0)
    }
    const change = close - open
    const pct = open ? (change / open) * 100 : null
    const vwap = vol ? pv / vol : null
    return { open, high, low, close, vol, change, pct, vwap, range: high - low }
  }, [candles])

  const quickSymbols = [...new Set([storeSymbol, ...(watchlistSymbols ?? [])].filter(Boolean))].slice(0, 8)
  const up = (stats?.change ?? 0) >= 0

  return (
    <WorkspaceShell
      id="history"
      eyebrow="Historical Replay"
      title="Date Explorer"
      subtitle="Pick any past session to see its full intraday chart and stats"
      actions={
        <div className="hist-controls">
          <input
            className="hist-symbol-input"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value.toUpperCase())}
            list="hist-symbol-list"
            placeholder="Symbol"
            spellCheck={false}
          />
          <datalist id="hist-symbol-list">
            {quickSymbols.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
          <input
            type="date"
            className="hist-date-input"
            value={date}
            max={lastTradingDay()}
            onChange={(e) => setDate(e.target.value)}
          />
          <div className="hist-interval-group">
            {INTERVALS.map((iv) => (
              <button
                key={iv.key}
                type="button"
                className={`opt-pill ${interval === iv.key ? 'active' : ''}`}
                onClick={() => setInterval(iv.key)}
              >
                {iv.label}
              </button>
            ))}
          </div>
        </div>
      }
    >
      {quickSymbols.length ? (
        <div className="hist-quick-row">
          {quickSymbols.map((s) => (
            <button
              key={s}
              type="button"
              className={`opt-pill ${symbol === s ? 'active' : ''}`}
              onClick={() => setSymbol(s)}
            >
              {s}
            </button>
          ))}
        </div>
      ) : null}

      <div className="ix-kpi-row">
        <MetricTile label="Open" value={fmt(stats?.open)} subvalue={date} />
        <MetricTile label="High" value={fmt(stats?.high)} tone="up" />
        <MetricTile label="Low" value={fmt(stats?.low)} tone="down" />
        <MetricTile label="Close" value={fmt(stats?.close)} tone={up ? 'up' : 'down'} />
        <MetricTile
          label="Day Change"
          value={stats ? `${up ? '+' : ''}${fmt(stats.change)}` : '--'}
          tone={up ? 'up' : 'down'}
          subvalue={stats?.pct != null ? formatPercent(stats.pct) : '--'}
        />
        <MetricTile label="VWAP" value={fmt(stats?.vwap)} />
        <MetricTile label="Volume" value={stats ? Number(stats.vol).toLocaleString('en-IN') : '--'} />
        <MetricTile label="Day Range" value={fmt(stats?.range)} />
      </div>

      {error ? (
        <TerminalPanel title="History unavailable">
          <div className="opt-error">{error}</div>
        </TerminalPanel>
      ) : null}

      <TerminalPanel
        title={`${symbol} · ${date}`}
        subtitle={`${interval} intraday`}
        meta={loading ? 'Loading…' : `${candles.length} candles`}
      >
        <div className="hist-chart-shell">
          {candles.length ? (
            <LazyMainChart
              id="history-chart"
              symbol={symbol}
              candles={candles}
              timeframe={interval}
              chartType="candle"
              indicators={{}}
              currentPrice={stats?.close ?? null}
            />
          ) : (
            <div className="hist-empty">
              {loading ? 'Loading session…' : 'No trading data for this date. Try another date or symbol.'}
            </div>
          )}
        </div>
      </TerminalPanel>
    </WorkspaceShell>
  )
}

export default History
