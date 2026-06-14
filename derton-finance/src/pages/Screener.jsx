import { useEffect, useMemo } from 'react'
import useCompanyInsights from '../hooks/useCompanyInsights'
import useMarketStore from '../store/useMarketStore'
import { formatCompactCrore, formatCurrency, formatPercent } from '../utils/formatters'
import { resolveDisplayPrice } from '../utils/marketPrice'

function Screener() {
  const watchlistSymbols = useMarketStore((state) => state.watchlistSymbols)
  const marketQuotes = useMarketStore((state) => state.marketQuotes)
  const prices = useMarketStore((state) => state.prices)
  const feed = useMarketStore((state) => state.feed)
  const selectedSymbol = useMarketStore((state) => state.selectedSymbol)
  const setSelectedSymbol = useMarketStore((state) => state.setSelectedSymbol)
  const setScreen = useMarketStore((state) => state.setScreen)
  const setActiveSymbols = useMarketStore((state) => state.setActiveSymbols)
  const { itemsBySymbol: companyInsightsBySymbol } = useCompanyInsights(watchlistSymbols)

  useEffect(() => {
    setActiveSymbols(watchlistSymbols)
  }, [setActiveSymbols, watchlistSymbols])

  useEffect(() => {
    return () => {
      setActiveSymbols([])
    }
  }, [setActiveSymbols])

  const rows = useMemo(
    () =>
      (watchlistSymbols ?? [])
        .map((symbol) => {
          const quote = marketQuotes[symbol]
          const insight = companyInsightsBySymbol[symbol] ?? null
          const price = resolveDisplayPrice({
            livePrice: prices[symbol],
            quote,
            feed,
          })
          const prevClose = quote?.close ?? null
          const change = Number.isFinite(price) && Number.isFinite(prevClose) ? price - prevClose : null
          const percent =
            Number.isFinite(change) && Number.isFinite(prevClose) && prevClose !== 0 ? (change / prevClose) * 100 : null

          return {
            symbol,
            company: quote?.companyName ?? symbol,
            exchange: quote?.exchange ?? '--',
            price,
            prevClose,
            change,
            percent,
            volume: quote?.volume ?? null,
            open: quote?.open ?? null,
            high: quote?.high ?? null,
            low: quote?.low ?? null,
            turnover:
              Number.isFinite(quote?.averagePrice) && Number.isFinite(quote?.volume)
                ? quote.averagePrice * quote.volume
                : null,
            revenueCr: insight?.revenueCr ?? null,
            profitCr: insight?.profitCr ?? null,
            sector: insight?.sector ?? '--',
          }
        })
        .sort((left, right) => (right.percent ?? -Infinity) - (left.percent ?? -Infinity)),
    [companyInsightsBySymbol, feed, marketQuotes, prices, watchlistSymbols],
  )

  const positiveCount = rows.filter((row) => (row.percent ?? 0) > 0).length
  const negativeCount = rows.filter((row) => (row.percent ?? 0) < 0).length

  return (
    <section id="s3" className="screen screen-col">
      <div className="sc-filter-bar">
        <span className="sc-filter-label">REAL-TIME WATCHLIST SCREENER</span>
      </div>

      <div className="sc-body">
        <div className="sc-table-wrap">
          <table className="sc-table">
            <thead>
              <tr>
                <th>Symbol</th>
                <th>LTP</th>
                <th>Prev Close</th>
                <th>Change</th>
                <th>% Chg</th>
                <th>Open</th>
                <th>High</th>
                <th>Low</th>
                <th>Turnover</th>
                <th>Revenue</th>
                <th>Profit</th>
                <th>Volume</th>
                <th>Sector</th>
              </tr>
            </thead>
            <tbody>
              {rows.length ? (
                rows.map((row) => (
                  <tr
                    key={row.symbol}
                    onClick={() => {
                      setSelectedSymbol(row.symbol)
                      setScreen('stock')
                    }}
                    style={{ cursor: 'pointer' }}
                  >
                    <td>
                      <span className="sc-sym">{row.symbol}</span>
                      <span className="sc-co">{row.company}</span>
                    </td>
                    <td>{Number.isFinite(row.price) ? formatCurrency(row.price) : '--'}</td>
                    <td>{Number.isFinite(row.prevClose) ? formatCurrency(row.prevClose) : '--'}</td>
                    <td className={(row.change ?? 0) >= 0 ? 'up' : 'dn'}>
                      {Number.isFinite(row.change) ? formatCurrency(row.change) : '--'}
                    </td>
                    <td className={(row.percent ?? 0) >= 0 ? 'up' : 'dn'}>
                      {Number.isFinite(row.percent) ? formatPercent(row.percent) : '--'}
                    </td>
                    <td>{Number.isFinite(row.open) ? formatCurrency(row.open) : '--'}</td>
                    <td>{Number.isFinite(row.high) ? formatCurrency(row.high) : '--'}</td>
                    <td>{Number.isFinite(row.low) ? formatCurrency(row.low) : '--'}</td>
                    <td>{Number.isFinite(row.turnover) ? formatCompactCrore(row.turnover / 10000000) : '--'}</td>
                    <td>{Number.isFinite(row.revenueCr) ? formatCompactCrore(row.revenueCr) : '--'}</td>
                    <td>{Number.isFinite(row.profitCr) ? formatCompactCrore(row.profitCr) : '--'}</td>
                    <td>{Number.isFinite(row.volume) ? Number(row.volume).toLocaleString('en-IN') : '--'}</td>
                    <td>{row.sector}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="13" className="sc-wl-empty">
                    Add symbols to the watchlist to see the screener.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <aside className="sc-sidebar">
          <div className="sc-sb-title">Watchlist Snapshot</div>
          {rows.length ? (
            rows.map((row) => (
              <div className="sc-wl-item" key={`side-${row.symbol}`}>
                <span>{row.symbol}</span>
                <span className={(row.percent ?? 0) >= 0 ? 'up' : 'dn'}>
                  {Number.isFinite(row.percent) ? formatPercent(row.percent) : '--'}
                </span>
              </div>
            ))
          ) : (
            <div className="sc-wl-empty">No active symbols.</div>
          )}
        </aside>
      </div>

      <div className="sc-summary">
        <div className="sc-sum-item">
          <span className="sc-sum-l">Rows</span>
          <span>{rows.length}</span>
        </div>
        <div className="sc-sum-item">
          <span className="sc-sum-l">Advances</span>
          <span className="up">{positiveCount}</span>
        </div>
        <div className="sc-sum-item">
          <span className="sc-sum-l">Declines</span>
          <span className="dn">{negativeCount}</span>
        </div>
        <div className="sc-sum-item">
          <span className="sc-sum-l">Selected</span>
          <span>{selectedSymbol}</span>
        </div>
      </div>
    </section>
  )
}

export default Screener
