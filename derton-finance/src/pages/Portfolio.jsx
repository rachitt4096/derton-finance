import { useEffect, useMemo, useState } from 'react'
import {
  createPortfolioTransaction,
  fetchPortfolioHoldings,
  fetchPortfolioSummary,
  fetchPortfolioTransactions,
} from '../utils/terminalApi'
import { formatCurrency, formatDateShort, formatPercent } from '../utils/formatters'
import { resolveDisplayPrice } from '../utils/marketPrice'
import useMarketStore from '../store/useMarketStore'

const PORTFOLIO_REFRESH_MS = 30000
const emptyManualEntry = {
  symbol: '',
  side: 'BUY',
  quantity: '',
  price: '',
  tradedAt: '',
}

function Portfolio() {
  const [summary, setSummary] = useState(null)
  const [holdings, setHoldings] = useState([])
  const [transactions, setTransactions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [manualEntry, setManualEntry] = useState(emptyManualEntry)
  const [savingEntry, setSavingEntry] = useState(false)
  const prices = useMarketStore((state) => state.prices)
  const marketQuotes = useMarketStore((state) => state.marketQuotes)
  const feed = useMarketStore((state) => state.feed)
  const setActiveSymbols = useMarketStore((state) => state.setActiveSymbols)
  const addToast = useMarketStore((state) => state.addToast)

  useEffect(() => {
    let isMounted = true

    const load = async ({ silent = false } = {}) => {
      if (!silent) {
        setLoading(true)
      }
      setError('')

      try {
        const [nextSummary, nextHoldings, nextTransactions] = await Promise.all([
          fetchPortfolioSummary(),
          fetchPortfolioHoldings(),
          fetchPortfolioTransactions(),
        ])

        if (!isMounted) {
          return
        }

        setSummary(nextSummary)
        setHoldings(nextHoldings)
        setTransactions(nextTransactions)
      } catch (nextError) {
        if (isMounted) {
          setError(nextError instanceof Error ? nextError.message : 'Unable to load portfolio.')
        }
      } finally {
        if (isMounted && !silent) {
          setLoading(false)
        }
      }
    }

    const refresh = () => {
      void load({ silent: true })
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refresh()
      }
    }

    void load()
    const intervalId = window.setInterval(refresh, PORTFOLIO_REFRESH_MS)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      isMounted = false
      window.clearInterval(intervalId)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [])

  useEffect(() => {
    setActiveSymbols(holdings.map((row) => row.symbol))
  }, [holdings, setActiveSymbols])

  useEffect(() => {
    return () => {
      setActiveSymbols([])
    }
  }, [setActiveSymbols])

  const liveHoldings = useMemo(
    () => {
      const rows = holdings.map((row) => {
        const quote = marketQuotes[row.symbol] ?? null
        const livePrice = resolveDisplayPrice({
          livePrice: prices[row.symbol],
          quote,
          feed,
        })
        const currentPrice = Number.isFinite(livePrice) ? livePrice : row.currentPrice ?? row.avgPrice ?? 0
        const currentValue = row.quantity * currentPrice
        const pnl = currentValue - row.quantity * row.avgPrice

        return {
          ...row,
          currentPrice,
          currentValue,
          pnl,
          pnlPct: row.avgPrice ? ((currentPrice - row.avgPrice) / row.avgPrice) * 100 : 0,
        }
      })
      const totalCurrent = rows.reduce((sum, row) => sum + row.currentValue, 0)

      return rows.map((row) => ({
        ...row,
        allocationPct: totalCurrent ? (row.currentValue / totalCurrent) * 100 : 0,
      }))
    },
    [feed, holdings, marketQuotes, prices],
  )

  const derivedSummary = useMemo(() => {
    const invested = liveHoldings.reduce((sum, row) => sum + row.avgPrice * row.quantity, 0)
    const current = liveHoldings.reduce((sum, row) => sum + row.currentValue, 0)
    const unrealized = liveHoldings.reduce((sum, row) => sum + row.pnl, 0)
    const realized =
      summary?.totals?.realized ?? liveHoldings.reduce((sum, row) => sum + Number(row.realizedPnl ?? 0), 0)
    const totalPnl = realized + unrealized

    return {
      cards: [
        { id: 'invested', label: 'Total Invested', value: invested, change: null },
        { id: 'current', label: 'Current Value', value: current, change: invested ? (current / invested - 1) * 100 : 0 },
        { id: 'total_pl', label: 'Total P&L', value: totalPnl, change: invested ? (totalPnl / invested) * 100 : 0 },
        { id: 'unrealized', label: 'Unrealized', value: unrealized, change: invested ? (unrealized / invested) * 100 : 0 },
        { id: 'realized', label: 'Realized', value: realized, change: null },
      ],
      totals: {
        invested,
        current,
        realized,
        unrealized,
        totalPnl,
      },
    }
  }, [liveHoldings, summary])

  const topTransactions = useMemo(() => transactions.slice(0, 12), [transactions])

  const refreshPortfolioData = async () => {
    const [nextSummary, nextHoldings, nextTransactions] = await Promise.all([
      fetchPortfolioSummary(),
      fetchPortfolioHoldings(),
      fetchPortfolioTransactions(),
    ])

    setSummary(nextSummary)
    setHoldings(nextHoldings)
    setTransactions(nextTransactions)
  }

  const handleManualSubmit = async (event) => {
    event.preventDefault()

    if (savingEntry) {
      return
    }

    setSavingEntry(true)
    setError('')

    try {
      await createPortfolioTransaction({
        symbol: manualEntry.symbol.trim().toUpperCase(),
        side: manualEntry.side,
        quantity: Number(manualEntry.quantity),
        price: Number(manualEntry.price),
        ...(manualEntry.tradedAt ? { tradedAt: new Date(manualEntry.tradedAt).toISOString() } : {}),
      })

      setManualEntry(emptyManualEntry)
      addToast('Portfolio entry added.', 'h', 3000)
      await refreshPortfolioData()
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Unable to add portfolio entry.')
    } finally {
      setSavingEntry(false)
    }
  }

  return (
    <section id="s4" className="screen screen-col">
      <div className="port-top">
        {(derivedSummary?.cards ?? []).map((card) => (
          <div className="port-card" key={card.id}>
            <div className="pc-l">{card.label}</div>
            <div className="pc-v">{formatCurrency(card.value ?? 0)}</div>
            <div className={`pc-c ${Number(card.change ?? 0) >= 0 ? 'up' : 'dn'}`}>
              {Number.isFinite(card.change) ? formatPercent(card.change) : '--'}
            </div>
          </div>
        ))}
      </div>

      <div className="port-body">
        <div className="port-main">
          <div className="port-table-wrap">
            <table className="ptable">
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>Qty</th>
                  <th>Avg Price</th>
                  <th>Current</th>
                  <th>Value</th>
                  <th>P&L</th>
                  <th>% P&L</th>
                  <th>Alloc</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan="8">Loading portfolio...</td>
                  </tr>
                ) : error ? (
                  <tr>
                    <td colSpan="8">{error}</td>
                  </tr>
                ) : liveHoldings.length ? (
                  liveHoldings.map((row) => (
                    <tr key={row.symbol}>
                      <td>{row.symbol}</td>
                      <td>{row.quantity}</td>
                      <td>{formatCurrency(row.avgPrice ?? 0)}</td>
                      <td>{formatCurrency(row.currentPrice ?? 0)}</td>
                      <td>{formatCurrency(row.currentValue ?? 0)}</td>
                      <td className={(row.pnl ?? 0) >= 0 ? 'up' : 'dn'}>{formatCurrency(row.pnl ?? 0)}</td>
                      <td className={(row.pnlPct ?? 0) >= 0 ? 'up' : 'dn'}>{formatPercent(row.pnlPct ?? 0)}</td>
                      <td>{formatPercent(row.allocationPct ?? 0)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="8">No portfolio holdings yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="book-header">
            <div className="book-title">Recent Transactions</div>
          </div>
          <div className="book-table-wrap">
            <table className="ptable">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Symbol</th>
                  <th>Side</th>
                  <th>Qty</th>
                  <th>Price</th>
                </tr>
              </thead>
              <tbody>
                {topTransactions.length ? (
                  topTransactions.map((row) => (
                    <tr key={row.id}>
                      <td>{formatDateShort(new Date(row.tradedAt))}</td>
                      <td>{row.symbol}</td>
                      <td className={row.side === 'BUY' ? 'up' : 'dn'}>{row.side}</td>
                      <td>{row.quantity}</td>
                      <td>{formatCurrency(row.price)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="5">No transactions recorded yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <aside className="port-side">
          <div className="book-header">
            <div className="book-title">Manual Entry</div>
          </div>
          <div className="port-side-body port-side-body-form">
            <form className="port-entry-form" onSubmit={handleManualSubmit}>
              <label className="port-entry-field">
                <span>Symbol</span>
                <input
                  type="text"
                  value={manualEntry.symbol}
                  onChange={(event) =>
                    setManualEntry((current) => ({ ...current, symbol: event.target.value.toUpperCase() }))
                  }
                  placeholder="RELIANCE"
                  required
                />
              </label>

              <label className="port-entry-field">
                <span>Side</span>
                <select
                  value={manualEntry.side}
                  onChange={(event) => setManualEntry((current) => ({ ...current, side: event.target.value }))}
                >
                  <option value="BUY">Buy</option>
                  <option value="SELL">Sell</option>
                </select>
              </label>

              <div className="port-entry-grid">
                <label className="port-entry-field">
                  <span>Quantity</span>
                  <input
                    type="number"
                    min="0.0001"
                    step="any"
                    value={manualEntry.quantity}
                    onChange={(event) => setManualEntry((current) => ({ ...current, quantity: event.target.value }))}
                    placeholder="10"
                    required
                  />
                </label>

                <label className="port-entry-field">
                  <span>Price</span>
                  <input
                    type="number"
                    min="0.01"
                    step="any"
                    value={manualEntry.price}
                    onChange={(event) => setManualEntry((current) => ({ ...current, price: event.target.value }))}
                    placeholder="1450"
                    required
                  />
                </label>
              </div>

              <label className="port-entry-field">
                <span>Trade Time</span>
                <input
                  type="datetime-local"
                  value={manualEntry.tradedAt}
                  onChange={(event) => setManualEntry((current) => ({ ...current, tradedAt: event.target.value }))}
                />
              </label>

              <button type="submit" className="port-entry-submit" disabled={savingEntry}>
                {savingEntry ? 'Saving...' : 'Add Transaction'}
              </button>
            </form>
          </div>

          <div className="book-header">
            <div className="book-title">Portfolio Totals</div>
          </div>
          <div className="port-side-body">
            <div className="perf-body">
              {derivedSummary?.totals ? (
                <>
                  <div className="perf-row">
                    <span>Invested</span>
                    <span>{formatCurrency(derivedSummary.totals.invested ?? 0)}</span>
                  </div>
                  <div className="perf-row">
                    <span>Current</span>
                    <span>{formatCurrency(derivedSummary.totals.current ?? 0)}</span>
                  </div>
                  <div className="perf-row">
                    <span>Realized</span>
                    <span className={(derivedSummary.totals.realized ?? 0) >= 0 ? 'up' : 'dn'}>
                      {formatCurrency(derivedSummary.totals.realized ?? 0)}
                    </span>
                  </div>
                  <div className="perf-row">
                    <span>Unrealized</span>
                    <span className={(derivedSummary.totals.unrealized ?? 0) >= 0 ? 'up' : 'dn'}>
                      {formatCurrency(derivedSummary.totals.unrealized ?? 0)}
                    </span>
                  </div>
                  <div className="perf-row">
                    <span>Total P&L</span>
                    <span className={(derivedSummary.totals.totalPnl ?? 0) >= 0 ? 'up' : 'dn'}>
                      {formatCurrency(derivedSummary.totals.totalPnl ?? 0)}
                    </span>
                  </div>
                </>
              ) : (
                <div className="sc-wl-empty">No totals available.</div>
              )}
            </div>
          </div>
        </aside>
      </div>
    </section>
  )
}

export default Portfolio
