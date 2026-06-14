import { useEffect, useMemo, useState } from 'react'
import LazyMainChart from '../components/chart/LazyMainChart'
import ChartControls from '../components/chart/ChartControls'
import TickerTape from '../components/layout/TickerTape'
import InfoPanel from '../components/panels/InfoPanel'
import GraphStatsPanel from '../components/panels/GraphStatsPanel'
import DashboardAiInsight from '../components/panels/DashboardAiInsight'
import StockHeader from '../components/stock/StockHeader'
import TodayOhlcStrip from '../components/stock/TodayOhlcStrip'
import WatchlistItem from '../components/watchlist/WatchlistItem'
import WatchlistSearch from '../components/watchlist/WatchlistSearch'
import useChartData from '../hooks/useChartData'
import useCompanyInsights from '../hooks/useCompanyInsights'
import useMarketStore from '../store/useMarketStore'
import { formatCurrency, formatTime } from '../utils/formatters'
import { resolveDisplayPrice } from '../utils/marketPrice'
import { fetchDefaultWatchlist, saveDefaultWatchlist, searchBackendInstruments } from '../utils/watchlistApi'

const uniqueSymbols = (symbols) => [...new Set((symbols ?? []).filter(Boolean))]
const WATCHLIST_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'gainers', label: 'Up' },
  { key: 'losers', label: 'Down' },
  { key: 'active', label: 'Vol' },
]
const FUNDAMENTAL_FILTERS = [
  { key: 'profitable', label: 'Profit' },
  { key: 'rev180', label: '180Cr+' },
]
const LIVE_DASHBOARD_TIMEFRAMES = ['1m', '5m', '15m', '1H', '1D']

const getWatchlistEmptyCopy = (filter) => {
  switch (filter) {
    case 'gainers':
      return 'No gainers in the watchlist right now.'
    case 'losers':
      return 'No losers in the watchlist right now.'
    case 'active':
      return 'No active volume data is available yet.'
    default:
      return 'Search and add companies to begin.'
  }
}

function Dashboard({ onCaptureCanvas }) {
  const selectedSymbol = useMarketStore((state) => state.selectedSymbol)
  const setSelectedSymbol = useMarketStore((state) => state.setSelectedSymbol)
  const watchlistSymbols = useMarketStore((state) => state.watchlistSymbols)
  const setWatchlistSymbols = useMarketStore((state) => state.setWatchlistSymbols)
  const prices = useMarketStore((state) => state.prices)
  const marketQuotes = useMarketStore((state) => state.marketQuotes)
  const quoteHealth = useMarketStore((state) => state.quoteHealth)
  const feed = useMarketStore((state) => state.feed)
  const now = useMarketStore((state) => state.now)
  const timeframe = useMarketStore((state) => state.timeframeMain)
  const chartType = useMarketStore((state) => state.chartTypeMain)
  const indicators = useMarketStore((state) => state.chartIndicators)
  const setTimeframe = useMarketStore((state) => state.setTimeframeMain)
  const setChartType = useMarketStore((state) => state.setChartTypeMain)
  const toggleChartIndicator = useMarketStore((state) => state.toggleChartIndicator)
  const openExportModal = useMarketStore((state) => state.openExportModal)
  const addToast = useMarketStore((state) => state.addToast)
  const setActiveSymbols = useMarketStore((state) => state.setActiveSymbols)
  const { itemsBySymbol: companyInsightsBySymbol } = useCompanyInsights(watchlistSymbols)

  const [isChartHidden, setIsChartHidden] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchError, setSearchError] = useState(null)
  const [watchlistFilter, setWatchlistFilter] = useState('all')
  const [fundamentalFilter, setFundamentalFilter] = useState('all')

  useEffect(() => {
    let isMounted = true

    const loadWatchlist = async () => {
      try {
        const savedSymbols = await fetchDefaultWatchlist()

        if (!isMounted) {
          return
        }

        if (savedSymbols?.length) {
          setWatchlistSymbols(uniqueSymbols(savedSymbols))

          if (!savedSymbols.includes(selectedSymbol)) {
            setSelectedSymbol(savedSymbols[0])
          }

          return
        }

        if (!watchlistSymbols.length && selectedSymbol) {
          setWatchlistSymbols([selectedSymbol])
        }
      } catch {
        if (isMounted && !watchlistSymbols.length && selectedSymbol) {
          setWatchlistSymbols([selectedSymbol])
        }
      }
    }

    void loadWatchlist()

    return () => {
      isMounted = false
    }
  }, [selectedSymbol, setSelectedSymbol, setWatchlistSymbols, watchlistSymbols.length])

  useEffect(() => {
    if (!watchlistSymbols.length || watchlistSymbols.includes(selectedSymbol)) {
      return
    }

    setSelectedSymbol(watchlistSymbols[0])
  }, [selectedSymbol, setSelectedSymbol, watchlistSymbols])

  useEffect(() => {
    setActiveSymbols(uniqueSymbols([selectedSymbol, ...watchlistSymbols]))
  }, [selectedSymbol, setActiveSymbols, watchlistSymbols])

  useEffect(() => {
    return () => {
      setActiveSymbols([])
    }
  }, [setActiveSymbols])

  useEffect(() => {
    if (!LIVE_DASHBOARD_TIMEFRAMES.includes(timeframe)) {
      setTimeframe('1D')
    }
  }, [setTimeframe, timeframe])

  useEffect(() => {
    if (searchQuery.trim().length < 2) {
      setSearchResults([])
      setSearchError(null)
      setSearchLoading(false)
      return undefined
    }

    let isMounted = true
    const timer = window.setTimeout(async () => {
      setSearchLoading(true)
      setSearchError(null)

      try {
        const items = await searchBackendInstruments(searchQuery.trim(), 12)

        if (!isMounted) {
          return
        }

        const nextResults = items.map((item) => ({
          ...item,
          symbol: item.symbol?.toUpperCase?.() ?? item.symbol,
          isAdded: watchlistSymbols.includes(item.symbol?.toUpperCase?.() ?? item.symbol),
        }))

        setSearchResults(nextResults)
      } catch (error) {
        if (isMounted) {
          setSearchResults([])
          setSearchError(error instanceof Error ? error.message : 'Search failed')
        }
      } finally {
        if (isMounted) {
          setSearchLoading(false)
        }
      }
    }, 250)

    return () => {
      isMounted = false
      window.clearTimeout(timer)
    }
  }, [searchQuery, watchlistSymbols])

  const watchlistItems = useMemo(
    () =>
      uniqueSymbols(watchlistSymbols).map((symbol) => {
        const quote = marketQuotes[symbol] ?? null
        const insight = companyInsightsBySymbol[symbol] ?? null
        const price = resolveDisplayPrice({
          livePrice: prices[symbol],
          quote,
          feed,
          now: now.getTime(),
        })

        return {
          symbol,
          quote,
          insight,
          price,
          volume: Number.isFinite(quote?.volume) ? quote.volume : null,
          close: Number.isFinite(quote?.close) ? quote.close : null,
          revenueCr: Number.isFinite(insight?.revenueCr) ? insight.revenueCr : null,
          profitCr: Number.isFinite(insight?.profitCr) ? insight.profitCr : null,
          change:
            Number.isFinite(price) && Number.isFinite(quote?.close)
              ? price - quote.close
              : null,
          percent:
            Number.isFinite(price) && Number.isFinite(quote?.close) && quote.close !== 0
              ? ((price - quote.close) / quote.close) * 100
              : null,
        }
      }),
    [companyInsightsBySymbol, feed, marketQuotes, now, prices, watchlistSymbols],
  )

  const watchlistCounts = useMemo(
    () => ({
      all: watchlistItems.length,
      gainers: watchlistItems.filter((item) => Number.isFinite(item.percent) && item.percent > 0).length,
      losers: watchlistItems.filter((item) => Number.isFinite(item.percent) && item.percent < 0).length,
      active: watchlistItems.filter((item) => Number.isFinite(item.volume) && item.volume > 0).length,
    }),
    [watchlistItems],
  )

  const filteredWatchlistItems = useMemo(() => {
    const byFundamentals = (() => {
      switch (fundamentalFilter) {
        case 'profitable':
          return watchlistItems.filter((item) => Number.isFinite(item.profitCr) && item.profitCr > 0)
        case 'rev180':
          return watchlistItems.filter((item) => Number.isFinite(item.revenueCr) && item.revenueCr >= 180)
        default:
          return watchlistItems
      }
    })()

    switch (watchlistFilter) {
      case 'gainers':
        return byFundamentals
          .filter((item) => Number.isFinite(item.percent) && item.percent > 0)
          .sort((left, right) => right.percent - left.percent)
      case 'losers':
        return byFundamentals
          .filter((item) => Number.isFinite(item.percent) && item.percent < 0)
          .sort((left, right) => left.percent - right.percent)
      case 'active':
        return byFundamentals
          .filter((item) => Number.isFinite(item.volume) && item.volume > 0)
          .sort((left, right) => right.volume - left.volume)
      default:
        return byFundamentals
    }
  }, [fundamentalFilter, watchlistFilter, watchlistItems])

  const selectedQuote = marketQuotes[selectedSymbol] ?? null
  const selectedInsight = companyInsightsBySymbol[selectedSymbol] ?? null
  const selectedPrice = resolveDisplayPrice({
    livePrice: prices[selectedSymbol],
    quote: selectedQuote,
    feed,
    now: now.getTime(),
  })

  const candles = useChartData({
    symbol: selectedSymbol,
    price: selectedPrice,
    timeframe,
    quote: selectedQuote,
  })

  const summarySymbols = uniqueSymbols([selectedSymbol, ...watchlistSymbols]).slice(0, 8)

  const fundamentalCounts = useMemo(
    () => ({
      profitable: watchlistItems.filter((item) => Number.isFinite(item.profitCr) && item.profitCr > 0).length,
      rev180: watchlistItems.filter((item) => Number.isFinite(item.revenueCr) && item.revenueCr >= 180).length,
    }),
    [watchlistItems],
  )

  const persistWatchlist = async (symbols, successMessage) => {
    const normalized = uniqueSymbols(symbols)
    const previous = watchlistSymbols
    setWatchlistSymbols(normalized)

    try {
      const saved = await saveDefaultWatchlist(normalized)
      setWatchlistSymbols(saved)
      if (saved.length && !saved.includes(selectedSymbol)) {
        setSelectedSymbol(saved[0])
      }
      if (successMessage) {
        addToast(successMessage, 'h', 3000)
      }
    } catch (error) {
      setWatchlistSymbols(previous)
      addToast(error instanceof Error ? error.message : 'Watchlist update failed', 'l', 4500)
    }
  }

  const handleAddSymbol = async (symbol) => {
    const nextSymbols = uniqueSymbols([...watchlistSymbols, symbol])
    await persistWatchlist(nextSymbols, `${symbol} added to watchlist.`)
    setSelectedSymbol(symbol)
    setSearchOpen(false)
    setSearchQuery('')
    setSearchResults([])
  }

  const handleRemoveSymbol = async (symbol) => {
    const nextSymbols = watchlistSymbols.filter((item) => item !== symbol)
    await persistWatchlist(nextSymbols, `${symbol} removed from watchlist.`)

    if (selectedSymbol === symbol && nextSymbols.length) {
      setSelectedSymbol(nextSymbols[0])
    }
  }

  return (
    <section id="s1" className="screen active screen-col">

      <div className="s1-body">
        <aside className="wl-sidebar">
          <div className="wl-head">
              <span className="wl-title">WATCHLIST</span>
            <button
              type="button"
              className={`wl-add ${searchOpen ? 'on' : ''}`}
              onClick={() => setSearchOpen((value) => !value)}
              aria-label="Add company"
            >
              +
            </button>
          </div>

          <WatchlistSearch
            open={searchOpen}
            query={searchQuery}
            results={searchResults}
            isLoading={searchLoading}
            error={searchError}
            onClose={() => setSearchOpen(false)}
            onQueryChange={setSearchQuery}
            onAdd={handleAddSymbol}
          />

          {watchlistItems.length ? (
            <div className="wl-filter-stack">
              <div className="wl-filters">
                {WATCHLIST_FILTERS.map((filter) => (
                  <button
                    key={filter.key}
                    type="button"
                    className={`wl-chip ${watchlistFilter === filter.key ? 'on' : ''}`}
                    onClick={() => setWatchlistFilter(filter.key)}
                    aria-pressed={watchlistFilter === filter.key}
                  >
                    <span>{filter.label}</span>
                    <span className="wl-chip-count">{watchlistCounts[filter.key]}</span>
                  </button>
                ))}
              </div>

              <div className="wl-filters wl-filters-secondary">
                {FUNDAMENTAL_FILTERS.map((filter) => (
                  <button
                    key={filter.key}
                    type="button"
                    className={`wl-chip muted ${fundamentalFilter === filter.key ? 'on' : ''}`}
                    onClick={() => setFundamentalFilter((current) => (current === filter.key ? 'all' : filter.key))}
                    aria-pressed={fundamentalFilter === filter.key}
                  >
                    <span>{filter.label}</span>
                    <span className="wl-chip-count">{fundamentalCounts[filter.key]}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="wl-list">
            {filteredWatchlistItems.length ? (
              filteredWatchlistItems.map((item) => (
                <WatchlistItem
                  key={item.symbol}
                  item={item}
                  isSelected={item.symbol === selectedSymbol}
                  onSelect={() => setSelectedSymbol(item.symbol)}
                  onRemove={watchlistItems.length > 1 ? handleRemoveSymbol : null}
                />
              ))
            ) : (
              <div className="wl-empty">{getWatchlistEmptyCopy(watchlistFilter)}</div>
            )}
          </div>
        </aside>

        <div className="chart-area">
          <StockHeader
            quote={selectedQuote}
            price={selectedPrice}
            symbol={selectedSymbol}
            quoteHealth={quoteHealth}
            insight={selectedInsight}
          />
          <TodayOhlcStrip quote={selectedQuote} price={selectedPrice} />

          <ChartControls
            timeframes={LIVE_DASHBOARD_TIMEFRAMES}
            timeframe={timeframe}
            chartType={chartType}
            indicators={indicators}
            onToggleIndicator={toggleChartIndicator}
            onTimeframe={setTimeframe}
            onChartType={setChartType}
            onExport={openExportModal}
            isChartHidden={isChartHidden}
            onToggleChart={() => setIsChartHidden((value) => !value)}
            isFullscreen={isFullscreen}
            onToggleFullscreen={() => setIsFullscreen((value) => !value)}
          />

          <div className={`graph-shell ${isFullscreen ? 'fullscreen' : ''}`.trim()}>
            {isChartHidden ? (
              <div className="chart-wrap">
                <div className="chart-empty-state">
                  <div className="chart-empty-title">Chart Hidden</div>
                  <div className="chart-empty-copy">Use the chart controls to show the graph again.</div>
                </div>
              </div>
            ) : (
              <div className="chart-mount">
                <LazyMainChart
                  id="main-chart"
                  symbol={selectedSymbol}
                  candles={candles}
                  timeframe={timeframe}
                  chartType={chartType}
                  indicators={indicators}
                  currentPrice={selectedPrice}
                  onCanvasReady={onCaptureCanvas}
                />
              </div>
            )}
          </div>

          <GraphStatsPanel quote={selectedQuote} insight={selectedInsight} />
          <TickerTape symbols={summarySymbols} prices={prices} quotes={marketQuotes} feed={feed} />
        </div>

        <div className="right-col-stack">
          <InfoPanel quote={selectedQuote} price={selectedPrice} symbol={selectedSymbol} />
          <DashboardAiInsight />
        </div>
      </div>
    </section>
  )
}

export default Dashboard
