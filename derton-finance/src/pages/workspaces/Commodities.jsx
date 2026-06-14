import { useEffect, useMemo, useState } from 'react'
import { TerminalPanel, WorkspaceShell } from '../../components/terminal/TerminalPrimitives'
import LazyMainChart from '../../components/chart/LazyMainChart'
import { fetchCommodities, fetchCommodityHistory } from '../../utils/terminalApi'
import { normalizeBackendCandles } from '../../hooks/useChartData'
import { cn } from '../../utils/formatters'

const INTERVALS = [
  { key: '1d', label: '1D', days: 180 },
  { key: '1h', label: '1H', days: 30 },
  { key: '15m', label: '15m', days: 7 },
  { key: '5m', label: '5m', days: 3 },
]
const LABELS = { GOLD: 'Gold', SILVER: 'Silver', CRUDEOIL: 'Crude Oil', NATURALGAS: 'Natural Gas', COPPER: 'Copper' }
const QUOTE_REFRESH_MS = 20_000

const fmt = (v, d = 2) =>
  v === null || v === undefined || Number.isNaN(Number(v))
    ? '--'
    : Number(v).toLocaleString('en-IN', { maximumFractionDigits: d, minimumFractionDigits: d })

function Commodities() {
  const [items, setItems] = useState([])
  const [selected, setSelected] = useState('GOLD')
  const [interval, setInterval] = useState('1d')
  const [candles, setCandles] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  // Quotes (cards) — refresh during market hours
  useEffect(() => {
    let active = true
    const load = () =>
      fetchCommodities()
        .then((rows) => active && setItems(rows))
        .catch((err) => active && setError(err.message))
    load()
    const t = window.setInterval(load, QUOTE_REFRESH_MS)
    return () => {
      active = false
      window.clearInterval(t)
    }
  }, [])

  // Chart for the selected commodity
  useEffect(() => {
    let active = true
    setLoading(true)
    const cfg = INTERVALS.find((i) => i.key === interval) ?? INTERVALS[0]
    fetchCommodityHistory(selected, { interval, days: cfg.days })
      .then((res) => active && setCandles(normalizeBackendCandles(res.candles ?? [], interval, null)))
      .catch((err) => active && setError(err.message))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [selected, interval])

  const selectedItem = useMemo(() => items.find((i) => i.name === selected), [items, selected])
  const lastClose = candles.length ? candles[candles.length - 1].c : null

  return (
    <WorkspaceShell
      id="commodities"
      eyebrow="MCX Commodities"
      title="Commodities"
      subtitle="Gold, Silver, Crude Oil & more — near-month futures, live"
    >
      <div className="comm-cards">
        {items.map((it) => {
          const up = (it.net_change ?? 0) >= 0
          return (
            <button
              key={it.name}
              type="button"
              className={cn('comm-card', selected === it.name && 'active')}
              onClick={() => setSelected(it.name)}
            >
              <div className="comm-card-head">
                <span>{LABELS[it.name] ?? it.name}</span>
                <small>{it.trading_symbol}</small>
              </div>
              <div className="comm-card-price">₹{fmt(it.last_price)}</div>
              <div className={cn('comm-card-chg', up ? 'up' : 'dn')}>
                {up ? '+' : ''}{fmt(it.net_change)} ({up ? '+' : ''}{fmt(it.percent_change)}%)
              </div>
            </button>
          )
        })}
        {!items.length ? <div className="comm-empty">Loading commodities…</div> : null}
      </div>

      {error ? (
        <TerminalPanel title="Commodities unavailable">
          <div className="opt-error">{error}</div>
        </TerminalPanel>
      ) : null}

      <TerminalPanel
        title={`${LABELS[selected] ?? selected}${selectedItem ? ` · ₹${fmt(selectedItem.last_price)}` : ''}`}
        subtitle={selectedItem?.trading_symbol}
        meta={
          <div className="opt-underlying-group">
            {INTERVALS.map((iv) => (
              <button
                key={iv.key}
                type="button"
                className={cn('opt-pill', interval === iv.key && 'active')}
                onClick={() => setInterval(iv.key)}
              >
                {iv.label}
              </button>
            ))}
          </div>
        }
      >
        <div className="hist-chart-shell">
          {candles.length ? (
            <LazyMainChart
              id="commodity-chart"
              symbol={LABELS[selected] ?? selected}
              candles={candles}
              timeframe={interval === '1d' ? '1M' : interval}
              chartType="candle"
              indicators={{}}
              currentPrice={lastClose}
            />
          ) : (
            <div className="hist-empty">{loading ? 'Loading chart…' : 'No data for this contract.'}</div>
          )}
        </div>
      </TerminalPanel>
    </WorkspaceShell>
  )
}

export default Commodities
