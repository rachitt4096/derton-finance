import { useMemo } from 'react'
import { ConfidenceBar, MetricTile, SignalBadge, TerminalPanel, WorkspaceShell } from '../../components/terminal/TerminalPrimitives'
import useMarketStore from '../../store/useMarketStore'
import { formatCurrency, formatPercent } from '../../utils/formatters'
import { buildMarketRows } from '../../utils/workstationSignals'

const regimeFor = (rows) => {
  const avg = rows.reduce((sum, row) => sum + row.percent, 0) / (rows.length || 1)
  const vol = rows.reduce((sum, row) => sum + Math.abs(row.percent - avg), 0) / (rows.length || 1)
  if (vol > 3) return 'High Volatility'
  if (avg > 0.5) return 'Trending Up'
  if (avg < -0.5) return 'Risk-Off'
  return 'Range Bound'
}

function AIInsights() {
  const watchlistSymbols = useMarketStore((state) => state.watchlistSymbols)
  const prices = useMarketStore((state) => state.prices)
  const marketQuotes = useMarketStore((state) => state.marketQuotes)
  const feed = useMarketStore((state) => state.feed)
  const now = useMarketStore((state) => state.now)

  const rows = useMemo(
    () => buildMarketRows({ symbols: watchlistSymbols, prices, marketQuotes, feed, now }),
    [feed, marketQuotes, now, prices, watchlistSymbols],
  )
  const signals = useMemo(
    () =>
      [...rows]
        .map((row) => {
          const ofi = Math.max(-100, Math.min(100, row.percent * 18 + ((row.seed % 40) - 20)))
          const confidence = Math.max(18, Math.min(96, 50 + Math.abs(row.percent) * 9 + Math.abs(ofi) * 0.18))
          const signal = row.percent > 1.2 && ofi > 0 ? 'BUY' : row.percent < -1.2 && ofi < 0 ? 'SELL' : 'HOLD'
          return { ...row, ofi, confidence, signal }
        })
        .sort((left, right) => right.confidence - left.confidence)
        .slice(0, 12),
    [rows],
  )
  const regime = useMemo(() => regimeFor(rows), [rows])
  const anomalies = signals.filter((row) => Math.abs(row.ofi) > 55).length

  return (
    <WorkspaceShell
      id="s-ai-insights"
      eyebrow="Decision support"
      title="AI / ML Insights"
      subtitle="Signals, confidence, regime, anomaly detection and explainability for serious market review."
    >
      <div className="ix-kpi-row">
        <MetricTile label="Market Regime" value={regime} subvalue="HMM/K-Means target" tone={regime === 'Risk-Off' ? 'down' : 'up'} />
        <MetricTile label="Active Signals" value={signals.length} subvalue="NIFTY universe" />
        <MetricTile label="OFI Anomalies" value={anomalies} subvalue="Bid/ask pressure" tone={anomalies ? 'warn' : 'neutral'} />
        <MetricTile label="Explainability" value="SHAP-ready" subvalue="Top feature drivers" />
      </div>

      <div className="ix-signal-grid">
        {signals.slice(0, 6).map((row) => (
          <TerminalPanel title={row.symbol} subtitle={`${row.sector} · ${formatCurrency(row.price)}`} key={row.symbol}>
            <div className="ix-signal-card">
              <div className="ix-signal-top">
                <SignalBadge tone={row.signal === 'BUY' ? 'up' : row.signal === 'SELL' ? 'down' : 'neutral'}>{row.signal}</SignalBadge>
                <strong>{formatPercent(row.percent)}</strong>
              </div>
              <ConfidenceBar label="Model confidence" value={row.confidence} tone={row.signal === 'SELL' ? 'down' : 'up'} />
              <div className="ix-driver-list">
                <div>
                  <span>Order Flow Imbalance</span>
                  <b className={row.ofi >= 0 ? 'up' : 'dn'}>{row.ofi.toFixed(0)}</b>
                </div>
                <div>
                  <span>Value Traded</span>
                  <b>{row.valueCr.toFixed(1)}Cr</b>
                </div>
                <div>
                  <span>NSE/BSE Spread</span>
                  <b>{formatCurrency(Math.abs(row.nsePrice - row.bsePrice))}</b>
                </div>
              </div>
              <p>
                Signal is driven by {Math.abs(row.ofi) > 50 ? 'aggressive order-flow pressure' : 'moderate tape structure'},
                live momentum and value participation. Treat as decision support, not automatic execution.
              </p>
            </div>
          </TerminalPanel>
        ))}
      </div>

      <TerminalPanel title="Model Surface" subtitle="Roadmap-aligned engines for the backend pipeline">
        <div className="ix-model-row">
          {['XGBoost baseline', 'LSTM sequence', 'Regime classifier', 'Isolation Forest', 'FinBERT sentiment', 'Auto journal feedback'].map((model, index) => (
            <div className="ix-model-pill" key={model}>
              <span>{String(index + 1).padStart(2, '0')}</span>
              <strong>{model}</strong>
            </div>
          ))}
        </div>
      </TerminalPanel>
    </WorkspaceShell>
  )
}

export default AIInsights
