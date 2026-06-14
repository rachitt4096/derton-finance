import { Fragment, useEffect, useMemo, useState } from 'react'
import useCompanyInsights from '../hooks/useCompanyInsights'
import useMarketStore from '../store/useMarketStore'
import { exportCsv } from '../utils/exportHelpers'
import { formatCurrency, formatPercent, formatShortTime } from '../utils/formatters'
import { getNseMarketWindowState } from '../utils/marketSession'
import { resolveDisplayPrice } from '../utils/marketPrice'
import { fetchOpeningWindow } from '../utils/terminalApi'

const OPENING_REFRESH_MS = 30000

const CATEGORY_OPTIONS = [
  { value: 'all', label: 'Live Universe' },
  { value: 'watchlist', label: 'Watchlist' },
  { value: 'gap-up', label: 'Gap Up' },
  { value: 'gap-down', label: 'Gap Down' },
]

const DENOMINATION_OPTIONS = [
  { value: 'lakhs', label: 'Lakhs', divisor: 100000, digits: 2, suffix: 'L' },
  { value: 'crores', label: 'Crores', divisor: 10000000, digits: 2, suffix: 'Cr' },
  { value: 'billions', label: 'Billions', divisor: 1000000000, digits: 2, suffix: 'Bn' },
]

const formatCount = (value) =>
  Number.isFinite(value)
    ? Number(value).toLocaleString('en-IN', {
        maximumFractionDigits: 0,
      })
    : '--'

const formatScaledValue = (value, denominationValue) => {
  if (!Number.isFinite(value)) {
    return '--'
  }

  const option = DENOMINATION_OPTIONS.find((item) => item.value === denominationValue) ?? DENOMINATION_OPTIONS[1]
  return `${(value / option.divisor).toLocaleString('en-IN', {
    minimumFractionDigits: option.digits,
    maximumFractionDigits: option.digits,
  })}`
}

function OpeningWindow() {
  const [rawRows, setRawRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [category, setCategory] = useState('all')
  const [searchTerm, setSearchTerm] = useState('')
  const [denomination, setDenomination] = useState('crores')
  const [expandedSymbol, setExpandedSymbol] = useState(null)

  const watchlistSymbols = useMarketStore((state) => state.watchlistSymbols)
  const marketQuotes = useMarketStore((state) => state.marketQuotes)
  const prices = useMarketStore((state) => state.prices)
  const feed = useMarketStore((state) => state.feed)
  const now = useMarketStore((state) => state.now)
  const setActiveSymbols = useMarketStore((state) => state.setActiveSymbols)
  const marketState = useMemo(() => {
    const state = getNseMarketWindowState(now)
    if (state.label === 'Closed') {
      return { label: 'Closed', className: 'closed' }
    }

    if (state.label === 'Pre Open') {
      return { label: 'Pre Open', className: 'upcoming' }
    }

    return { label: 'Live', className: '' }
  }, [now])

  useEffect(() => {
    let isMounted = true

    const load = async ({ silent = false } = {}) => {
      if (!silent) {
        setLoading(true)
      } else if (isMounted) {
        setRefreshing(true)
      }

      setError('')

      try {
        const items = await fetchOpeningWindow()
        if (!isMounted) {
          return
        }

        setRawRows(items)
      } catch (nextError) {
        if (isMounted) {
          setError(nextError instanceof Error ? nextError.message : 'Unable to load opening window.')
        }
      } finally {
        if (isMounted) {
          setLoading(false)
          setRefreshing(false)
        }
      }
    }

    void load()
    const intervalId = window.setInterval(() => {
      void load({ silent: true })
    }, OPENING_REFRESH_MS)

    return () => {
      isMounted = false
      window.clearInterval(intervalId)
    }
  }, [])

  const insightSymbols = useMemo(() => rawRows.slice(0, 120).map((row) => row.symbol), [rawRows])
  const { itemsBySymbol: companyInsightsBySymbol } = useCompanyInsights(insightSymbols, {
    includeHistory: false,
  })

  const rows = useMemo(() => {
    return rawRows
      .map((row) => {
        const quote = marketQuotes[row.symbol] ?? null
        const insight = companyInsightsBySymbol[row.symbol] ?? null
        const prevClose = Number.isFinite(row.prevClose) ? row.prevClose : quote?.close ?? null
        const iep = Number.isFinite(row.preOpen) ? row.preOpen : quote?.open ?? null
        const finalPrice = resolveDisplayPrice({
          livePrice: prices[row.symbol],
          quote,
          feed,
        })
        const final = Number.isFinite(finalPrice) ? finalPrice : Number.isFinite(iep) ? iep : quote?.lastPrice ?? null
        const change = Number.isFinite(final) && Number.isFinite(prevClose) ? final - prevClose : null
        const changePct =
          Number.isFinite(change) && Number.isFinite(prevClose) && prevClose !== 0 ? (change / prevClose) * 100 : null
        const finalQuantity = Number.isFinite(quote?.volume)
          ? Number(quote.volume)
          : Number.isFinite(Number(row.openVolume))
            ? Number(row.openVolume)
            : null
        const tradedValue = Number.isFinite(final) && Number.isFinite(finalQuantity) ? final * finalQuantity : null

        return {
          symbol: row.symbol,
          company: row.company,
          prevClose,
          iep,
          final,
          change,
          changePct,
          finalQuantity,
          tradedValue,
          ffmCapCr: insight?.freeFloatMarketCapCr ?? null,
          yearHigh: quote?.yearHigh ?? null,
          yearLow: quote?.yearLow ?? null,
          gap: Number.isFinite(iep) && Number.isFinite(prevClose) ? iep - prevClose : null,
          currentVolume: quote?.volume ?? null,
        }
      })
      .sort((left, right) => Math.abs(right.changePct ?? 0) - Math.abs(left.changePct ?? 0))
  }, [companyInsightsBySymbol, feed, marketQuotes, prices, rawRows])

  const filteredRows = useMemo(() => {
    const search = searchTerm.trim().toUpperCase()

    return rows.filter((row) => {
      if (category === 'watchlist' && !watchlistSymbols.includes(row.symbol)) {
        return false
      }

      if (category === 'gap-up' && !((row.changePct ?? 0) > 0)) {
        return false
      }

      if (category === 'gap-down' && !((row.changePct ?? 0) < 0)) {
        return false
      }

      if (!search) {
        return true
      }

      return row.symbol.includes(search) || row.company.toUpperCase().includes(search)
    })
  }, [category, rows, searchTerm, watchlistSymbols])

  useEffect(() => {
    setActiveSymbols(filteredRows.slice(0, 120).map((row) => row.symbol))
  }, [filteredRows, setActiveSymbols])

  useEffect(() => {
    return () => {
      setActiveSymbols([])
    }
  }, [setActiveSymbols])

  const positiveCount = filteredRows.filter((row) => (row.changePct ?? 0) > 0).length
  const negativeCount = filteredRows.filter((row) => (row.changePct ?? 0) < 0).length

  const handleDownload = () => {
    exportCsv(
      filteredRows.map((row) => ({
        Symbol: row.symbol,
        Company: row.company,
        PrevClose: Number.isFinite(row.prevClose) ? row.prevClose.toFixed(2) : '--',
        IEP: Number.isFinite(row.iep) ? row.iep.toFixed(2) : '--',
        Change: Number.isFinite(row.change) ? row.change.toFixed(2) : '--',
        ChangePct: Number.isFinite(row.changePct) ? row.changePct.toFixed(2) : '--',
        Final: Number.isFinite(row.final) ? row.final.toFixed(2) : '--',
        FinalQuantity: Number.isFinite(row.finalQuantity) ? row.finalQuantity : '--',
        Value: Number.isFinite(row.tradedValue) ? row.tradedValue.toFixed(2) : '--',
        FreeFloatMarketCapCr: Number.isFinite(row.ffmCapCr) ? row.ffmCapCr.toFixed(2) : '--',
        YearHigh52W: Number.isFinite(row.yearHigh) ? row.yearHigh.toFixed(2) : '--',
        YearLow52W: Number.isFinite(row.yearLow) ? row.yearLow.toFixed(2) : '--',
      })),
      'opening-window.csv',
    )
  }

  return (
    <section id="s5" className="screen screen-col">
      <div className="ow-shell">
        <div className="ow-headbar">
          <div>
            <div className="ow-h-title">Opening Window</div>
            <div className="ow-sub">NSE-style pre-open screener using live quote, prev close, value and 52-week range.</div>
          </div>

          <div className="ow-head-meta">
            <div className={`ow-status ${marketState.className}`.trim()}>
              <span className="live-dot" />
              {marketState.label}
            </div>
            <div className="ow-countdown">{formatShortTime(now)}</div>
          </div>
        </div>

        <div className="ow-filter-bar">
          <div className="ow-filter-group">
            <span className="ow-filter-label">Category</span>
            <select value={category} onChange={(event) => setCategory(event.target.value)}>
              {CATEGORY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="ow-filter-group">
            <span className="ow-filter-label">Symbol</span>
            <input
              type="text"
              placeholder="Enter symbol"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value.toUpperCase())}
            />
          </div>

          <button type="button" className="ow-clear-btn" onClick={() => setSearchTerm('')}>
            Clear
          </button>

          <div className="ow-denomination">
            <span className="ow-filter-label">Change denomination</span>
            <div className="ow-radio-row">
              {DENOMINATION_OPTIONS.map((option) => (
                <label className="ow-radio" key={option.value}>
                  <input
                    type="radio"
                    name="ow-denomination"
                    value={option.value}
                    checked={denomination === option.value}
                    onChange={(event) => setDenomination(event.target.value)}
                  />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
          </div>

          <button type="button" className="ow-download-btn" onClick={handleDownload}>
            Download (.csv)
          </button>
        </div>

        <div className="ow-summary-strip">
          <span>{`${filteredRows.length} symbols`}</span>
          <span className="up">{`${positiveCount} gainers`}</span>
          <span className="dn">{`${negativeCount} losers`}</span>
          <span>{refreshing ? 'Refreshing live rows...' : error || 'Live opening screen synchronized.'}</span>
        </div>

        <div className="ow-table-wrap nse">
          <table className="ow-table ow-nse-table">
            <thead>
              <tr>
                <th className="ow-exp-col" />
                <th>Symbol</th>
                <th className="num">Prev. Close</th>
                <th className="num">IEP</th>
                <th className="num">Chng</th>
                <th className="num">%Chng</th>
                <th className="num">Final</th>
                <th className="num">Final Quantity</th>
                <th className="num">{`Value (${(DENOMINATION_OPTIONS.find((item) => item.value === denomination) ?? DENOMINATION_OPTIONS[1]).suffix})`}</th>
                <th className="num">{`FFM Cap (${(DENOMINATION_OPTIONS.find((item) => item.value === denomination) ?? DENOMINATION_OPTIONS[1]).suffix})`}</th>
                <th className="num">NM 52W H</th>
                <th className="num">NM 52W L</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan="12">Loading opening window...</td>
                </tr>
              ) : filteredRows.length ? (
                filteredRows.map((row) => {
                  const isExpanded = expandedSymbol === row.symbol
                  const rowTone = (row.changePct ?? 0) > 0 ? 'up' : (row.changePct ?? 0) < 0 ? 'dn' : 'flat'

                  return (
                    <Fragment key={row.symbol}>
                      <tr key={row.symbol} className={`ow-row-main ${rowTone}`.trim()}>
                        <td className="ow-exp-col">
                          <button
                            type="button"
                            className={`ow-expand-btn ${isExpanded ? 'open' : ''}`}
                            onClick={() => setExpandedSymbol((current) => (current === row.symbol ? null : row.symbol))}
                            aria-label={isExpanded ? `Collapse ${row.symbol}` : `Expand ${row.symbol}`}
                          >
                            {isExpanded ? '−' : '+'}
                          </button>
                        </td>
                        <td className="ow-symbol-cell">
                          <span>{row.symbol}</span>
                        </td>
                        <td className="num">{Number.isFinite(row.prevClose) ? formatCurrency(row.prevClose) : '--'}</td>
                        <td className="num">{Number.isFinite(row.iep) ? formatCurrency(row.iep) : '--'}</td>
                        <td className={`num ${(row.change ?? 0) >= 0 ? 'up' : 'dn'}`}>
                          {Number.isFinite(row.change) ? formatCurrency(row.change) : '--'}
                        </td>
                        <td className={`num ${(row.changePct ?? 0) >= 0 ? 'up' : 'dn'}`}>
                          {Number.isFinite(row.changePct) ? formatPercent(row.changePct) : '--'}
                        </td>
                        <td className="num ow-final-cell">{Number.isFinite(row.final) ? formatCurrency(row.final) : '--'}</td>
                        <td className="num">{formatCount(row.finalQuantity)}</td>
                        <td className="num">{formatScaledValue(row.tradedValue, denomination)}</td>
                        <td className="num">
                          {Number.isFinite(row.ffmCapCr)
                            ? formatScaledValue(row.ffmCapCr * 10000000, denomination)
                            : '--'}
                        </td>
                        <td className="num">{Number.isFinite(row.yearHigh) ? formatCurrency(row.yearHigh) : '--'}</td>
                        <td className="num">{Number.isFinite(row.yearLow) ? formatCurrency(row.yearLow) : '--'}</td>
                      </tr>
                      {isExpanded ? (
                        <tr key={`${row.symbol}-detail`} className="ow-detail-tr">
                          <td colSpan="12">
                            <div className="ow-detail-grid">
                              <div>
                                <div className="ow-detail-label">Company</div>
                                <div className="ow-detail-value">{row.company}</div>
                              </div>
                              <div>
                                <div className="ow-detail-label">Gap vs Prev Close</div>
                                <div className={`ow-detail-value ${(row.gap ?? 0) >= 0 ? 'up' : 'dn'}`}>
                                  {Number.isFinite(row.gap) ? formatCurrency(row.gap) : '--'}
                                </div>
                              </div>
                              <div>
                                <div className="ow-detail-label">Live Volume</div>
                                <div className="ow-detail-value">{formatCount(row.currentVolume)}</div>
                              </div>
                              <div>
                                <div className="ow-detail-label">Final Price</div>
                                <div className="ow-detail-value">{Number.isFinite(row.final) ? formatCurrency(row.final) : '--'}</div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  )
                })
              ) : (
                <tr>
                  <td colSpan="12">{error || 'No opening quote data available yet.'}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}

export default OpeningWindow
