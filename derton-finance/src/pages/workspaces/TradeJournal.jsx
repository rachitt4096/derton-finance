import { useMemo } from 'react'
import { MetricTile, SignalBadge, TerminalPanel, WorkspaceShell } from '../../components/terminal/TerminalPrimitives'
import useMarketStore from '../../store/useMarketStore'
import { formatCurrency, formatPercent, formatShortTime } from '../../utils/formatters'
import { buildMarketRows } from '../../utils/workstationSignals'

function TradeJournal() {
  const watchlistSymbols = useMarketStore((state) => state.watchlistSymbols)
  const prices = useMarketStore((state) => state.prices)
  const marketQuotes = useMarketStore((state) => state.marketQuotes)
  const feed = useMarketStore((state) => state.feed)
  const now = useMarketStore((state) => state.now)

  const rows = useMemo(
    () => buildMarketRows({ symbols: watchlistSymbols, prices, marketQuotes, feed, now }).slice(0, 10),
    [feed, marketQuotes, now, prices, watchlistSymbols],
  )
  const journalRows = useMemo(
    () =>
      rows.slice(0, 8).map((row, index) => ({
        id: `${row.symbol}-${index}`,
        time: new Date(now.getTime() - index * 11 * 60 * 1000),
        symbol: row.symbol,
        side: row.percent >= 0 ? 'LONG' : 'SHORT',
        price: row.price,
        pnl: row.percent * 120,
        regime: Math.abs(row.percent) > 2 ? 'Volatile' : row.percent > 0 ? 'Trending' : 'Mean Revert',
        signal: Math.min(96, 54 + Math.abs(row.percent) * 10),
        context: `OFI ${row.percent >= 0 ? 'positive' : 'negative'}, value ${row.valueCr.toFixed(1)}Cr, spread ${formatCurrency(row.spread)}.`,
      })),
    [now, rows],
  )
  const totalPnl = journalRows.reduce((sum, row) => sum + row.pnl, 0)

  return (
    <WorkspaceShell
      id="s-trade-journal"
      eyebrow="Feedback loop"
      title="Trade Journal"
      subtitle="Auto/manual journal with market context, regime, signal score and outcome tracking."
    >
      <div className="ix-kpi-row">
        <MetricTile label="Journal Entries" value={journalRows.length} />
        <MetricTile label="Context Capture" value="Enabled" subvalue="Regime + signal + OFI" />
        <MetricTile label="Session P&L" value={formatCurrency(totalPnl)} tone={totalPnl >= 0 ? 'up' : 'down'} />
        <MetricTile label="ML Feedback" value="Ready" subvalue="Future training labels" />
      </div>

      <TerminalPanel title="Recent Trade Context" subtitle="This surface is ready to merge real broker executions later">
        <div className="ix-table-wrap">
          <table className="ix-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Symbol</th>
                <th>Side</th>
                <th>Entry</th>
                <th>P&L</th>
                <th>Regime</th>
                <th>Signal</th>
                <th>Market Context</th>
              </tr>
            </thead>
            <tbody>
              {journalRows.map((row) => (
                <tr key={row.id}>
                  <td>{formatShortTime(row.time)}</td>
                  <td className="strong">{row.symbol}</td>
                  <td>
                    <SignalBadge tone={row.side === 'LONG' ? 'up' : 'down'}>{row.side}</SignalBadge>
                  </td>
                  <td>{formatCurrency(row.price)}</td>
                  <td className={row.pnl >= 0 ? 'up' : 'dn'}>{formatCurrency(row.pnl)}</td>
                  <td>{row.regime}</td>
                  <td>{formatPercent(row.signal)}</td>
                  <td>{row.context}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </TerminalPanel>
    </WorkspaceShell>
  )
}

export default TradeJournal
