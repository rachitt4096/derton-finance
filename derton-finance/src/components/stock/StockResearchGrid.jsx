import { formatCurrency } from '../../utils/formatters'

const formatCount = (value) => (Number.isFinite(value) ? Number(value).toLocaleString('en-IN') : '--')
const formatShortDate = (value) => {
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

function StockResearchGrid({ quote, symbol, price }) {
  const tradeRows = [
    ['Volume', formatCount(quote?.volume)],
    ['Average Price', Number.isFinite(quote?.averagePrice) ? formatCurrency(quote.averagePrice) : '--'],
    ['Net Change', Number.isFinite(quote?.netChange) ? formatCurrency(quote.netChange) : '--'],
    ['Total Buy Qty', formatCount(quote?.totalBuyQuantity)],
    ['Total Sell Qty', formatCount(quote?.totalSellQuantity)],
    ['Last Trade Time', quote?.lastTradeTime ?? '--'],
  ]

  const priceRows = [
    ['Open', Number.isFinite(quote?.open) ? formatCurrency(quote.open) : '--'],
    ['High', Number.isFinite(quote?.high) ? formatCurrency(quote.high) : '--'],
    ['Low', Number.isFinite(quote?.low) ? formatCurrency(quote.low) : '--'],
    ['Prev Close', Number.isFinite(quote?.close) ? formatCurrency(quote.close) : '--'],
    ['52 Week High', Number.isFinite(quote?.yearHigh) ? formatCurrency(quote.yearHigh) : '--'],
    ['52 Week High Date', formatShortDate(quote?.yearHighDate)],
    ['52 Week Low', Number.isFinite(quote?.yearLow) ? formatCurrency(quote.yearLow) : '--'],
    ['52 Week Low Date', formatShortDate(quote?.yearLowDate)],
    ['Upper Circuit', Number.isFinite(quote?.upperCircuitLimit) ? formatCurrency(quote.upperCircuitLimit) : '--'],
    ['Lower Circuit', Number.isFinite(quote?.lowerCircuitLimit) ? formatCurrency(quote.lowerCircuitLimit) : '--'],
  ]

  const securityRows = [
    ['Company', quote?.companyName ?? '--'],
    ['Symbol', symbol],
    ['Exchange', quote?.exchange ?? '--'],
    ['Instrument Key', quote?.instrumentKey ?? '--'],
    ['Timestamp', quote?.timestamp ?? '--'],
    ['Live Price', Number.isFinite(price) ? formatCurrency(price) : '--'],
  ]

  const askRows = (quote?.depth?.sell ?? []).slice(0, 5)
  const bidRows = (quote?.depth?.buy ?? []).slice(0, 5)

  return (
    <section className="s2-research-grid">
      <article className="s2-rich-card">
        <div className="s2-rich-title">TRADE INFORMATION</div>
        <div className="s2-info-list">
          {tradeRows.map(([label, value]) => (
            <div className="s2-info-row" key={label}>
              <span className="s2-info-label">{label}</span>
              <span className="s2-info-value">{value}</span>
            </div>
          ))}
        </div>
      </article>

      <article className="s2-rich-card">
        <div className="s2-rich-title">PRICE INFORMATION</div>
        <div className="s2-info-list">
          {priceRows.map(([label, value]) => (
            <div className="s2-info-row" key={label}>
              <span className="s2-info-label">{label}</span>
              <span className="s2-info-value">{value}</span>
            </div>
          ))}
        </div>
      </article>

      <article className="s2-rich-card">
        <div className="s2-rich-title">SECURITIES INFORMATION</div>
        <div className="s2-info-list">
          {securityRows.map(([label, value]) => (
            <div className="s2-info-row" key={label}>
              <span className="s2-info-label">{label}</span>
              <span className="s2-info-value">{value}</span>
            </div>
          ))}
        </div>
      </article>

      <article className="s2-rich-card s2-rich-card-span-2">
        <div className="s2-rich-title">ORDER DEPTH (TOP 5)</div>
        <div className="depth-hd-row">
          <span>BID QTY</span>
          <span className="center">PRICE</span>
          <span>ASK QTY</span>
        </div>

        {Array.from({ length: Math.max(askRows.length, bidRows.length) }, (_, index) => {
          const ask = askRows[index] ?? null
          const bid = bidRows[index] ?? null

          return (
            <div className="depth-data-row" key={`${symbol}-depth-${index}`}>
              <span className="ddr-bid">{bid ? formatCount(bid.quantity) : '-'}</span>
              <span className="ddr-price">
                {bid?.price ?? ask?.price ? formatCurrency(bid?.price ?? ask?.price ?? 0) : '--'}
              </span>
              <span className="ddr-ask">{ask ? formatCount(ask.quantity) : '-'}</span>
            </div>
          )
        })}
      </article>
    </section>
  )
}

export default StockResearchGrid
