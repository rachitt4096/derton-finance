import { useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ConfidenceBar, MetricTile, SignalBadge, TerminalPanel, WorkspaceShell } from '../../components/terminal/TerminalPrimitives'
import useMarketStore from '../../store/useMarketStore'
import { formatCurrency, formatPercent, formatTime } from '../../utils/formatters'
import { buildMarketRows, getSignalTone, summarizeMarket } from '../../utils/workstationSignals'

const INDEX_OPTIONS = ['NIFTY 50', 'NIFTY NEXT 50', 'NIFTY BANK', 'NIFTY FINANCIAL SERVICES', 'NIFTY MIDCAP SELECT', 'NIFTY MIDCAP 50', 'NIFTY MIDCAP 100', 'NIFTY SMALLCAP 50']

const RETURNS = [
  ['1W', 1.07],
  ['1M', -0.37],
  ['3M', -5.05],
  ['6M', -8.76],
  ['YTD', -8.56],
  ['1Y', -3.42],
  ['3Y', 29.23],
  ['5Y', 54.88],
]

function RangeLine({ label, low, high, value }) {
  const pct = Math.max(0, Math.min(100, ((value - low) / (high - low || 1)) * 100))

  return (
    <div className="ix-range">
      <div className="ix-range-top">
        <strong>{label}</strong>
        <span>{formatCurrency(value)}</span>
      </div>
      <div className="ix-range-track">
        <span className="ix-range-pin" style={{ left: `${pct}%` }} />
      </div>
      <div className="ix-range-bottom">
        <span>Low {formatCurrency(low)}</span>
        <span>High {formatCurrency(high)}</span>
      </div>
    </div>
  )
}

function Markets() {
  const [indexName, setIndexName] = useState('NIFTY 50')
  const watchlistSymbols = useMarketStore((state) => state.watchlistSymbols)
  const prices = useMarketStore((state) => state.prices)
  const marketQuotes = useMarketStore((state) => state.marketQuotes)
  const feed = useMarketStore((state) => state.feed)
  const now = useMarketStore((state) => state.now)

  const rows = useMemo(
    () => buildMarketRows({ symbols: watchlistSymbols, prices, marketQuotes, feed, now }),
    [feed, marketQuotes, now, prices, watchlistSymbols],
  )
  const summary = useMemo(() => summarizeMarket(rows), [rows])
  const gainers = useMemo(() => [...rows].sort((a, b) => b.percent - a.percent).slice(0, 8), [rows])
  const losers = useMemo(() => [...rows].sort((a, b) => a.percent - b.percent).slice(0, 8), [rows])
  const active = useMemo(() => [...rows].sort((a, b) => b.valueCr - a.valueCr).slice(0, 18), [rows])
  const chartRows = useMemo(
    () => gainers.slice(0, 5).map((row) => ({ symbol: row.symbol, change: Math.abs(row.change ?? 0) })),
    [gainers],
  )

  return (
    <WorkspaceShell
      id="s-markets"
      eyebrow="NSE-style market overview"
      title={indexName}
      subtitle={`As on ${formatTime(now)} IST · Live universe, breadth, movers and equity-stock watch`}
      actions={
        <label className="ix-select-label">
          <span>Indices</span>
          <select value={indexName} onChange={(event) => setIndexName(event.target.value)}>
            {INDEX_OPTIONS.map((option) => (
              <option key={option}>{option}</option>
            ))}
          </select>
        </label>
      }
      className="ix-markets"
    >
      <div className="ix-market-hero">
        <TerminalPanel className="ix-index-panel">
          <div className="ix-index-main">
            <div>
              <div className="ix-symbol-title">{indexName}</div>
              <div className="ix-index-value">
                {summary.indexValue.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                <span className={summary.change >= 0 ? 'up' : 'dn'}>
                  {formatCurrency(summary.change)} ({formatPercent(summary.percent)})
                </span>
              </div>
            </div>
            <SignalBadge tone={summary.percent >= 0 ? 'up' : 'down'}>{summary.percent >= 0 ? 'Advancing' : 'Soft'}</SignalBadge>
          </div>

          <div className="ix-index-grid">
            <MetricTile label="Prev. Close" value={summary.prevClose.toLocaleString('en-IN')} />
            <MetricTile label="Open" value={summary.open.toLocaleString('en-IN')} />
            <MetricTile label="Volume" value={`${summary.volumeLakhs.toFixed(2)}L`} />
            <MetricTile label="Value" value={`${summary.valueCr.toFixed(2)}Cr`} />
            <MetricTile label="FFM Cap" value={`${summary.ffmCap.toFixed(2)}`} />
            <MetricTile label="Advance" value={summary.advances} tone="up" />
            <MetricTile label="Decline" value={summary.declines} tone="down" />
            <MetricTile label="P/E" value={summary.pe} />
            <MetricTile label="P/B" value={summary.pb} />
          </div>

          <div className="ix-range-grid">
            <RangeLine label="52 Week" low={22182.55} high={26373.2} value={summary.indexValue} />
            <RangeLine label="Intraday" low={23858.25} high={23983.2} value={summary.indexValue} />
          </div>
        </TerminalPanel>

        <TerminalPanel title="Returns" className="ix-returns-panel">
          <div className="ix-return-grid">
            {RETURNS.map(([label, value]) => (
              <div className={`ix-return-card ${value >= 0 ? 'up' : 'dn'}`} key={label}>
                <strong>{label}</strong>
                <span>{formatPercent(value)}</span>
              </div>
            ))}
          </div>
        </TerminalPanel>
      </div>

      <div className="ix-market-grid">
        <TerminalPanel title="Gainers / Losers" subtitle="Index movers with value and volume context">
          <div className="ix-tabs">
            <span className="on">Gainers</span>
            <span>Losers</span>
            <span>Most Active Value</span>
          </div>
          <div className="ix-table-wrap compact">
            <table className="ix-table">
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>LTP</th>
                  <th>Chng</th>
                  <th>%Chng</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                {gainers.slice(0, 6).map((row) => (
                  <tr key={row.symbol}>
                    <td>{row.symbol}</td>
                    <td>{formatCurrency(row.price)}</td>
                    <td className="up">{formatCurrency(row.change ?? 0)}</td>
                    <td className="up">{formatPercent(row.percent)}</td>
                    <td>{row.valueCr.toFixed(2)}Cr</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="ix-mover-chart">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={chartRows}>
                <CartesianGrid stroke="rgba(116, 133, 165, .12)" vertical={false} />
                <XAxis dataKey="symbol" tick={{ fill: '#91a0ba', fontSize: 10 }} />
                <YAxis tick={{ fill: '#91a0ba', fontSize: 10 }} />
                <Tooltip cursor={{ fill: 'rgba(255,255,255,.04)' }} />
                <Bar dataKey="change" fill="#21c8a2" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </TerminalPanel>

        <TerminalPanel title="Heatmap" subtitle="NIFTY-style price tiles by % change" className="ix-heat-panel">
          <div className="ix-heatmap">
            {[...gainers, ...losers].slice(0, 42).map((row) => {
              const tone = getSignalTone(row.percent)
              const magnitude = Math.min(1, Math.abs(row.percent) / 5)
              return (
                <div className={`ix-heat-cell ${tone}`} style={{ '--strength': magnitude }} key={row.symbol}>
                  <strong>{row.symbol}</strong>
                  <span>{formatCurrency(row.price)}</span>
                  <b>{formatPercent(row.percent)}</b>
                </div>
              )
            })}
          </div>
        </TerminalPanel>
      </div>

      <TerminalPanel title="Equity / Stock Market Watch" subtitle="Dense NSE-like table for quick scanning">
        <div className="ix-table-wrap">
          <table className="ix-table nse-like">
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Open</th>
                <th>High</th>
                <th>Low</th>
                <th>Prev. Close</th>
                <th>LTP</th>
                <th>Chng</th>
                <th>%Chng</th>
                <th>Volume</th>
                <th>Value</th>
                <th>52W H</th>
                <th>52W L</th>
              </tr>
            </thead>
            <tbody>
              {active.map((row) => (
                <tr key={row.symbol}>
                  <td>{row.symbol}</td>
                  <td>{formatCurrency(row.open)}</td>
                  <td>{formatCurrency(row.high)}</td>
                  <td>{formatCurrency(row.low)}</td>
                  <td>{formatCurrency(row.close)}</td>
                  <td className="strong">{formatCurrency(row.price)}</td>
                  <td className={row.change >= 0 ? 'up' : 'dn'}>{formatCurrency(row.change ?? 0)}</td>
                  <td className={row.percent >= 0 ? 'up' : 'dn'}>{formatPercent(row.percent)}</td>
                  <td>{Number(row.volume).toLocaleString('en-IN')}</td>
                  <td>{row.valueCr.toFixed(2)}Cr</td>
                  <td>{formatCurrency(row.yearHigh)}</td>
                  <td>{formatCurrency(row.yearLow)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </TerminalPanel>
    </WorkspaceShell>
  )
}

export default Markets
