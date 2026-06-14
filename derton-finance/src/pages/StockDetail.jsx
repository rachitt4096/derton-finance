import { useEffect, useMemo, useState } from 'react'
import LazyMainChart from '../components/chart/LazyMainChart'
import ChartControls from '../components/chart/ChartControls'
import CompanyInsightPanel, {
  CompanySnapshotCard,
  FinancialSnapshotCard,
  RevenueProfitHistoryCard,
  TradedValueHistoryCard,
} from '../components/stock/CompanyInsightPanel'
import MarketDepthTable from '../components/stock/MarketDepthTable'
import StockHistoryTable from '../components/stock/StockHistoryTable'
import Modal from '../components/ui/Modal'
import useChartData from '../hooks/useChartData'
import useCompanyInsights from '../hooks/useCompanyInsights'
import useMarketStore from '../store/useMarketStore'
import { formatChange, formatCurrency, formatPercent } from '../utils/formatters'
import { resolveDisplayPrice } from '../utils/marketPrice'

const uniqueSymbols = (symbols) => [...new Set((symbols ?? []).filter(Boolean))]

const formatCount = (value) =>
  Number.isFinite(value)
    ? Number(value).toLocaleString('en-IN', {
        maximumFractionDigits: 2,
      })
    : '--'

const formatDateLabel = (value) => {
  if (!value) {
    return '--'
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return '--'
  }

  return date.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

const formatCurrencyOrDash = (value, digits = 2) => (Number.isFinite(value) ? formatCurrency(value, digits) : '--')
const formatPercentOrDash = (value) => (Number.isFinite(value) ? formatPercent(value) : '--')

function StockDetail({ onCaptureCanvas }) {
  const selectedSymbol = useMarketStore((state) => state.selectedSymbol)
  const setSelectedSymbol = useMarketStore((state) => state.setSelectedSymbol)
  const watchlistSymbols = useMarketStore((state) => state.watchlistSymbols)
  const prices = useMarketStore((state) => state.prices)
  const marketQuotes = useMarketStore((state) => state.marketQuotes)
  const feed = useMarketStore((state) => state.feed)
  const timeframe = useMarketStore((state) => state.timeframeDetail)
  const chartType = useMarketStore((state) => state.chartTypeDetail)
  const indicators = useMarketStore((state) => state.chartIndicators)
  const setTimeframe = useMarketStore((state) => state.setTimeframeDetail)
  const setChartType = useMarketStore((state) => state.setChartTypeDetail)
  const toggleChartIndicator = useMarketStore((state) => state.toggleChartIndicator)
  const openExportModal = useMarketStore((state) => state.openExportModal)
  const openCalendar = useMarketStore((state) => state.openCalendar)
  const resetCalendarDate = useMarketStore((state) => state.resetCalendarDate)
  const setActiveSymbols = useMarketStore((state) => state.setActiveSymbols)
  const { itemsBySymbol: companyInsightsBySymbol } = useCompanyInsights([selectedSymbol], {
    includeHistory: true,
    historyDays: 30,
  })

  const [isChartHidden, setIsChartHidden] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [activeShortcutState, setActiveShortcutState] = useState(null)

  const selectedQuote = marketQuotes[selectedSymbol] ?? null
  const selectedInsight = companyInsightsBySymbol[selectedSymbol] ?? null
  const selectedDate = useMarketStore((state) => state.calendar.selectedDateDetail)
  const selectedPrice = resolveDisplayPrice({
    livePrice: prices[selectedSymbol],
    quote: selectedQuote,
    feed,
  })

  const candles = useChartData({
    symbol: selectedSymbol,
    price: selectedPrice,
    timeframe,
    selectedDate,
    quote: selectedQuote,
  })

  const dailyCandles = useChartData({
    symbol: selectedSymbol,
    price: selectedPrice,
    timeframe: '1M',
  })

  const quickSymbols = useMemo(
    () =>
      uniqueSymbols([selectedSymbol, ...watchlistSymbols]).slice(0, 8).map((symbol) => ({
        symbol,
        quote: marketQuotes[symbol] ?? null,
        price: resolveDisplayPrice({
          livePrice: prices[symbol],
          quote: marketQuotes[symbol],
          feed,
        }),
      })),
    [feed, marketQuotes, prices, selectedSymbol, watchlistSymbols],
  )

  const close = selectedQuote?.close ?? null
  const change = Number.isFinite(selectedPrice) && Number.isFinite(close) ? selectedPrice - close : null
  const percent = Number.isFinite(change) && Number.isFinite(close) && close !== 0 ? (change / close) * 100 : null
  const bestBid = (selectedQuote?.depth?.buy ?? []).find((row) => Number.isFinite(row?.price) && row.price > 0) ?? null
  const bestAsk = (selectedQuote?.depth?.sell ?? []).find((row) => Number.isFinite(row?.price) && row.price > 0) ?? null
  const turnover =
    Number.isFinite(selectedQuote?.averagePrice) && Number.isFinite(selectedQuote?.volume)
      ? selectedQuote.averagePrice * selectedQuote.volume
      : null
  const topStats = [
    ['Open', formatCurrencyOrDash(selectedQuote?.open, 0)],
    ['High', formatCurrencyOrDash(selectedQuote?.high, 0)],
    ['Low', formatCurrencyOrDash(selectedQuote?.low, 0)],
    ['Prev Close', formatCurrencyOrDash(close)],
    ['Volume', formatCount(selectedQuote?.volume)],
    ['Avg Price', formatCurrencyOrDash(selectedQuote?.averagePrice)],
    ['Buy Qty', formatCount(selectedQuote?.totalBuyQuantity)],
    ['Sell Qty', formatCount(selectedQuote?.totalSellQuantity)],
  ]

  const metricColumns = [
    {
      title: 'Daily Metrics',
      rows: [
        ['Open', formatCurrencyOrDash(selectedQuote?.open)],
        ['High', formatCurrencyOrDash(selectedQuote?.high)],
        ['Low', formatCurrencyOrDash(selectedQuote?.low)],
        ['Prev Close', formatCurrencyOrDash(close)],
        ['Day Change', Number.isFinite(change) ? formatChange(change) : '--'],
        ['Day %', formatPercentOrDash(percent)],
      ],
    },
    {
      title: 'Trading',
      rows: [
        ['LTP', formatCurrencyOrDash(selectedPrice)],
        ['Volume', formatCount(selectedQuote?.volume)],
        ['Avg Price', formatCurrencyOrDash(selectedQuote?.averagePrice)],
        ['Turnover', turnover !== null ? formatCurrency(turnover, 0) : '--'],
        ['Buy Qty', formatCount(selectedQuote?.totalBuyQuantity)],
        ['Sell Qty', formatCount(selectedQuote?.totalSellQuantity)],
      ],
    },
    {
      title: 'Depth',
      rows: [
        ['Best Bid', bestBid ? formatCurrency(bestBid.price) : '--'],
        ['Bid Qty', bestBid ? formatCount(bestBid.quantity) : '--'],
        ['Best Ask', bestAsk ? formatCurrency(bestAsk.price) : '--'],
        ['Ask Qty', bestAsk ? formatCount(bestAsk.quantity) : '--'],
        [
          'Spread',
          bestBid && bestAsk && Number.isFinite(bestAsk.price - bestBid.price)
            ? formatCurrency(bestAsk.price - bestBid.price)
            : '--',
        ],
      ],
    },
    {
      title: 'Range',
      rows: [
        ['Upper Circuit', formatCurrencyOrDash(selectedQuote?.upperCircuitLimit)],
        ['Lower Circuit', formatCurrencyOrDash(selectedQuote?.lowerCircuitLimit)],
        ['52W High', formatCurrencyOrDash(selectedQuote?.yearHigh)],
        ['52W High Dt', formatDateLabel(selectedQuote?.yearHighDate)],
        ['52W Low', formatCurrencyOrDash(selectedQuote?.yearLow)],
        ['52W Low Dt', formatDateLabel(selectedQuote?.yearLowDate)],
      ],
    },
  ]
  const shortcutItems = [
    { key: 'snapshot', label: 'Snapshot' },
    { key: 'financials', label: 'Financials' },
    { key: 'revenue', label: 'Revenue' },
    { key: 'traded-value', label: 'Trade Value' },
    { key: 'history', label: 'History' },
    { key: 'order-book', label: 'Order Book' },
  ]
  const activeShortcut =
    activeShortcutState?.symbol === selectedSymbol && activeShortcutState?.key ? activeShortcutState.key : null
  const activeShortcutMeta = shortcutItems.find((item) => item.key === activeShortcut) ?? null
  const setActiveShortcut = (key) => {
    setActiveShortcutState(key ? { key, symbol: selectedSymbol } : null)
  }

  const handlePrint = () => {
    if (typeof window !== 'undefined') {
      window.print()
    }
  }

  const renderShortcutContent = () => {
    switch (activeShortcut) {
      case 'snapshot':
        return <CompanySnapshotCard insight={selectedInsight} symbol={selectedSymbol} className="sd-modal-panel" />
      case 'financials':
        return (
          <FinancialSnapshotCard
            insight={selectedInsight}
            quote={selectedQuote}
            price={selectedPrice}
            className="sd-modal-panel"
          />
        )
      case 'revenue':
        return <RevenueProfitHistoryCard insight={selectedInsight} symbol={selectedSymbol} className="sd-modal-panel" />
      case 'traded-value':
        return <TradedValueHistoryCard insight={selectedInsight} symbol={selectedSymbol} className="sd-modal-panel" />
      case 'history':
        return <StockHistoryTable symbol={selectedSymbol} candles={dailyCandles} currentPrice={selectedPrice} />
      case 'order-book':
        return (
          <article className="s2-rich-card sd-modal-panel">
            <div className="s2-rich-title">ORDER BOOK</div>
            <MarketDepthTable quote={selectedQuote} />
          </article>
        )
      default:
        return null
    }
  }

  useEffect(() => {
    setActiveSymbols(uniqueSymbols([selectedSymbol, ...watchlistSymbols]))
  }, [selectedSymbol, setActiveSymbols, watchlistSymbols])

  useEffect(() => {
    return () => {
      setActiveSymbols([])
    }
  }, [setActiveSymbols])

  return (
    <section id="s2" className="screen screen-col">
      <header className="s2-hdr">
        <div className="s2-top">
          <div className="s2-headline-row">
            <div className="s2-ident">
              <div className="s2-title-line">
                <div className="s2-sym">{selectedSymbol}</div>
                <div className="s2-price-block">
                  <div className={`s2-price ${change !== null && change < 0 ? 'dn' : 'up'}`}>
                    {Number.isFinite(selectedPrice) ? formatCurrency(selectedPrice) : '--'}
                  </div>
                  <div className={`s2-chg ${change !== null && change < 0 ? 'dn' : 'up'}`}>
                    {Number.isFinite(change) && Number.isFinite(percent)
                      ? `${formatChange(change)} (${formatPercent(percent)})`
                      : 'Waiting for live quote...'}
                  </div>
                </div>
              </div>
              <div className="s2-co">{selectedQuote?.companyName ?? 'Loading instrument details...'}</div>
            </div>

            <div className="sd-shortcuts">
              {shortcutItems.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className={`sd-quick-btn ${activeShortcut === item.key ? 'on' : ''}`}
                  onClick={() => setActiveShortcut(item.key)}
                >
                  {item.label}
                </button>
              ))}
              <button type="button" className="sd-quick-btn utility" onClick={openExportModal}>
                Export
              </button>
              <button type="button" className="sd-quick-btn utility" onClick={handlePrint}>
                Print
              </button>
              <button
                type="button"
                className="sd-quick-btn close"
                onClick={() => setActiveShortcut(null)}
                disabled={!activeShortcut}
              >
                Close
              </button>
            </div>
          </div>

          <div className="s2-flags">
            {quickSymbols.map((item) => (
              <button
                key={item.symbol}
                type="button"
                className={`tf-btn ${item.symbol === selectedSymbol ? 'on' : ''}`}
                onClick={() => setSelectedSymbol(item.symbol)}
              >
                {item.symbol}
              </button>
            ))}
          </div>
        </div>

        <div className="s2-stats">
          {topStats.map(([label, value]) => (
            <div className="s2-stat" key={label}>
              <span className="s2-sl">{label}</span>
              <span className="s2-sv">{value}</span>
            </div>
          ))}
        </div>
      </header>

      <ChartControls
        className="s2-ctrl"
        timeframe={timeframe}
        chartType={chartType}
        indicators={indicators}
        onToggleIndicator={toggleChartIndicator}
        onTimeframe={setTimeframe}
        onChartType={setChartType}
        onExport={openExportModal}
        onOpenCalendar={() => openCalendar('detail')}
        onToday={() => {
          resetCalendarDate('detail')
          setTimeframe('1D')
        }}
        isChartHidden={isChartHidden}
        onToggleChart={() => setIsChartHidden((value) => !value)}
        isFullscreen={isFullscreen}
        onToggleFullscreen={() => setIsFullscreen((value) => !value)}
      />

      <div className="s2-body">
        <div className={`s2-chart-row ${isFullscreen ? 'fullscreen' : ''}`.trim()}>
          <div className={`graph-shell s2-chart ${isFullscreen ? 'fullscreen' : ''}`.trim()}>
            <div className="chart-wrap">
              {isChartHidden ? (
                <div className="chart-empty-state">
                  <div className="chart-empty-title">Chart Hidden</div>
                  <div className="chart-empty-copy">Use the controls above to show the graph again.</div>
                </div>
              ) : (
                <LazyMainChart
                  id="detail-chart"
                  symbol={selectedSymbol}
                  candles={candles}
                  timeframe={timeframe}
                  chartType={chartType}
                  indicators={indicators}
                  currentPrice={selectedPrice}
                  onCanvasReady={onCaptureCanvas}
                />
              )}
            </div>
          </div>

          {!isFullscreen ? (
            <aside className="s2-orderbook-panel s2-rich-card">
              <div className="s2-rich-title">ORDER BOOK</div>
              <MarketDepthTable quote={selectedQuote} />
            </aside>
          ) : null}
        </div>

        <div className="s2-bottom">
          {metricColumns.map((column) => (
            <div className="s2-col" key={column.title}>
              <div className="s2-col-title">{column.title}</div>
              {column.rows.map(([label, value]) => (
                <div className="s2-row" key={`${column.title}-${label}`}>
                  <span className="s2-rl">{label}</span>
                  <span>{value}</span>
                </div>
              ))}
            </div>
          ))}
        </div>

        <CompanyInsightPanel insight={selectedInsight} quote={selectedQuote} symbol={selectedSymbol} price={selectedPrice} />

        <StockHistoryTable symbol={selectedSymbol} candles={dailyCandles} currentPrice={selectedPrice} />
      </div>

      <Modal open={Boolean(activeShortcutMeta)} onClose={() => setActiveShortcut(null)} className="sd-modal">
        <div className="sd-modal-head">
          <div>
            <div className="sd-modal-title">{activeShortcutMeta?.label ?? 'Details'}</div>
            <div className="sd-modal-subtitle">{`${selectedSymbol} fullscreen view`}</div>
          </div>

          <div className="sd-modal-actions">
            <button type="button" className="sd-quick-btn utility" onClick={openExportModal}>
              Export
            </button>
            <button type="button" className="sd-quick-btn utility" onClick={handlePrint}>
              Print
            </button>
            <button type="button" className="sd-quick-btn close" onClick={() => setActiveShortcut(null)}>
              Close
            </button>
          </div>
        </div>

        <div className="sd-modal-body">{renderShortcutContent()}</div>
      </Modal>
    </section>
  )
}

export default StockDetail
