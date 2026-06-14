import { useMemo, useState } from 'react'
import { ConfidenceBar, MetricTile, SignalBadge, TerminalPanel, WorkspaceShell } from '../../components/terminal/TerminalPrimitives'
import useMarketStore from '../../store/useMarketStore'
import { formatCurrency, formatPercent } from '../../utils/formatters'
import { buildMarketRows } from '../../utils/workstationSignals'

const venueFor = (row) => (row.nsePrice >= row.bsePrice ? ['BSE', 'NSE'] : ['NSE', 'BSE'])

function buildArbitrageRows(rows) {
  return rows
    .map((row) => {
      const [buyVenue, sellVenue] = venueFor(row)
      const buy = Math.min(row.nsePrice, row.bsePrice)
      const sell = Math.max(row.nsePrice, row.bsePrice)
      const grossSpread = sell - buy
      const spreadPct = buy ? (grossSpread / buy) * 100 : 0
      const liquidityScore = Math.min(100, Math.log10(Math.max(row.volume, 1)) * 14)
      const riskScore = Math.min(100, Math.abs(row.percent) * 9 + (row.spread / row.price) * 10000)
      const confidence = Math.max(4, Math.min(98, spreadPct * 240 + liquidityScore * 0.45 - riskScore * 0.18))
      const urgency = Math.max(12, Math.min(100, spreadPct * 480 + Math.abs(row.percent) * 8))
      const feasible = confidence > 62 && spreadPct > 0.04 && liquidityScore > 70

      return {
        ...row,
        buyVenue,
        sellVenue,
        buy,
        sell,
        grossSpread,
        spreadPct,
        liquidityScore,
        riskScore,
        confidence,
        urgency,
        feasible,
        signalQuality: confidence * 0.55 + urgency * 0.25 + liquidityScore * 0.2 - riskScore * 0.15,
      }
    })
    .sort((left, right) => right.signalQuality - left.signalQuality)
}

function Arbitrage() {
  const [filter, setFilter] = useState('all')
  const watchlistSymbols = useMarketStore((state) => state.watchlistSymbols)
  const prices = useMarketStore((state) => state.prices)
  const marketQuotes = useMarketStore((state) => state.marketQuotes)
  const feed = useMarketStore((state) => state.feed)
  const now = useMarketStore((state) => state.now)

  const baseRows = useMemo(
    () => buildMarketRows({ symbols: watchlistSymbols, prices, marketQuotes, feed, now }),
    [feed, marketQuotes, now, prices, watchlistSymbols],
  )
  const opportunities = useMemo(() => buildArbitrageRows(baseRows).slice(0, 30), [baseRows])
  const filteredRows = useMemo(
    () =>
      opportunities.filter((row) => {
        if (filter === 'executable') {
          return row.feasible
        }
        if (filter === 'high-confidence') {
          return row.confidence >= 75
        }
        if (filter === 'watchlist') {
          return watchlistSymbols.includes(row.symbol)
        }
        return true
      }),
    [filter, opportunities, watchlistSymbols],
  )
  const best = opportunities[0]
  const executableCount = opportunities.filter((row) => row.feasible).length
  const avgSpread = opportunities.reduce((sum, row) => sum + row.spreadPct, 0) / (opportunities.length || 1)

  return (
    <WorkspaceShell
      id="s-arbitrage"
      eyebrow="NSE/BSE cross-venue scanner"
      title="Arbitrage Opportunity Engine"
      subtitle="Ranks spread capture against liquidity, urgency, risk and execution feasibility."
      actions={
        <div className="ix-segment">
          {[
            ['all', 'All'],
            ['executable', 'Executable'],
            ['high-confidence', 'High Confidence'],
            ['watchlist', 'Watchlist'],
          ].map(([key, label]) => (
            <button className={filter === key ? 'on' : ''} type="button" key={key} onClick={() => setFilter(key)}>
              {label}
            </button>
          ))}
        </div>
      }
    >
      <div className="ix-kpi-row">
        <MetricTile label="Best Spread" value={best ? formatCurrency(best.grossSpread) : '--'} subvalue={best?.symbol} tone="up" />
        <MetricTile label="Avg Spread" value={`${avgSpread.toFixed(3)}%`} />
        <MetricTile label="Executable" value={executableCount} subvalue={`${opportunities.length} ranked`} tone={executableCount ? 'up' : 'neutral'} />
        <MetricTile label="Venue Pair" value="NSE / BSE" subvalue="Cash equity" />
      </div>

      <div className="ix-arb-layout">
        <TerminalPanel title="Ranked Opportunities" subtitle="Best rows are priced for speed, liquidity and signal quality">
          <div className="ix-table-wrap">
            <table className="ix-table">
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>Symbol</th>
                  <th>Buy</th>
                  <th>Sell</th>
                  <th>NSE</th>
                  <th>BSE</th>
                  <th>Spread</th>
                  <th>Conf.</th>
                  <th>Urgency</th>
                  <th>Risk</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row, index) => (
                  <tr key={row.symbol}>
                    <td>{index + 1}</td>
                    <td className="strong">{row.symbol}</td>
                    <td>{row.buyVenue}</td>
                    <td>{row.sellVenue}</td>
                    <td>{formatCurrency(row.nsePrice)}</td>
                    <td>{formatCurrency(row.bsePrice)}</td>
                    <td className={row.spreadPct > 0.04 ? 'up' : ''}>
                      {formatCurrency(row.grossSpread)} · {formatPercent(row.spreadPct)}
                    </td>
                    <td>{row.confidence.toFixed(0)}%</td>
                    <td>{row.urgency.toFixed(0)}%</td>
                    <td>{row.riskScore.toFixed(0)}</td>
                    <td>
                      <SignalBadge tone={row.feasible ? 'up' : row.confidence > 60 ? 'warn' : 'neutral'}>
                        {row.feasible ? 'Executable' : row.confidence > 60 ? 'Watch' : 'Thin'}
                      </SignalBadge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TerminalPanel>

        <TerminalPanel title="Signal Reasoning" subtitle={best ? `${best.symbol} venue discrepancy` : 'Waiting for opportunities'}>
          {best ? (
            <div className="ix-reason-stack">
              <div className="ix-arb-ticket">
                <span>Buy {best.buyVenue}</span>
                <strong>{formatCurrency(best.buy)}</strong>
                <span>Sell {best.sellVenue}</span>
                <strong>{formatCurrency(best.sell)}</strong>
              </div>
              <ConfidenceBar label="Execution feasibility" value={best.confidence} tone="up" />
              <ConfidenceBar label="Liquidity quality" value={best.liquidityScore} tone="accent" />
              <ConfidenceBar label="Urgency" value={best.urgency} tone="warn" />
              <ConfidenceBar label="Risk load" value={best.riskScore} tone="down" />
              <div className="ix-ai-note">
                <strong>AI reasoning</strong>
                <p>
                  {best.symbol} is showing a {formatPercent(best.spreadPct)} venue gap. The signal is strongest when the
                  spread clears estimated fees, volume is deep enough for fast execution, and the quote is not moving
                  violently against the entry.
                </p>
              </div>
              <div className="ix-checklist">
                <span className={best.spreadPct > 0.04 ? 'ok' : ''}>Spread above fee buffer</span>
                <span className={best.liquidityScore > 70 ? 'ok' : ''}>Liquidity available</span>
                <span className={best.riskScore < 45 ? 'ok' : ''}>Risk controlled</span>
                <span className={best.confidence > 70 ? 'ok' : ''}>Signal quality confirmed</span>
              </div>
            </div>
          ) : null}
        </TerminalPanel>
      </div>
    </WorkspaceShell>
  )
}

export default Arbitrage
