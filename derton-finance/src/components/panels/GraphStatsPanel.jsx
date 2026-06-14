import { formatCurrency } from '../../utils/formatters'

const formatFixed = (value, digits = 2) => (Number.isFinite(value) ? Number(value).toFixed(digits) : '--')
const formatPercent = (value, digits = 2) => (Number.isFinite(value) ? `${Number(value).toFixed(digits)}%` : '--')
const formatCurrencyOrDash = (value, digits = 2) => (Number.isFinite(value) ? formatCurrency(value, digits) : '--')
const formatCrore = (value, digits = 2) =>
  Number.isFinite(value)
    ? Number(value).toLocaleString('en-IN', {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      })
    : '--'
const formatLakhs = (value) => (Number.isFinite(value) ? Number(value / 100000).toFixed(2) : '--')

const formatDateTag = (value) => {
  if (!value) {
    return ''
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return ''
  }

  return date
    .toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      timeZone: 'Asia/Kolkata',
    })
    .replace(/\s+/g, '-')
}

const renderItems = (items) =>
  items.map(({ label, value, tone }) => (
    <div className="gm-item" key={label}>
      <span className="gm-item-label">{label}</span>
      <span className={`gm-item-value ${tone ? `gm-${tone}` : ''}`.trim()}>{value}</span>
    </div>
  ))

function GraphStatsPanel({ quote, insight }) {
  const tradedValueCr =
    Number.isFinite(quote?.averagePrice) && Number.isFinite(quote?.volume) ? (quote.averagePrice * quote.volume) / 10000000 : null
  const highDateTag = formatDateTag(quote?.yearHighDate)
  const lowDateTag = formatDateTag(quote?.yearLowDate)

  const tradingDataItems = [
    { label: 'Traded Volume (Lakhs)', value: formatLakhs(quote?.volume), tone: 'accent' },
    { label: 'Traded Value (₹ Cr.)', value: formatCrore(tradedValueCr), tone: 'accent' },
    { label: 'Total Mkt Cap (₹ Cr.)', value: formatCrore(insight?.marketCapCr), tone: 'gold' },
    { label: 'Free Float Mkt Cap (₹ Cr.)', value: formatCrore(insight?.freeFloatMarketCapCr), tone: 'gold' },
    { label: '% Deliverable (NSE EOD)', value: formatPercent(insight?.deliverablePct), tone: 'up' },
  ]

  const circuitBandItems = [
    { label: highDateTag ? `52W High (${highDateTag})` : '52W High', value: formatCurrencyOrDash(quote?.yearHigh), tone: 'up' },
    { label: lowDateTag ? `52W Low (${lowDateTag})` : '52W Low', value: formatCurrencyOrDash(quote?.yearLow), tone: 'dn' },
    { label: 'Upper Circuit Band', value: formatCurrencyOrDash(quote?.upperCircuitLimit), tone: 'up' },
    { label: 'Lower Circuit Band', value: formatCurrencyOrDash(quote?.lowerCircuitLimit), tone: 'dn' },
  ]

  const volatilityItems = [
    { label: 'Daily Volatility', value: formatPercent(quote?.dailyVolatility ?? insight?.dailyVolatility) },
    { label: 'Annualised Volatility', value: formatPercent(quote?.annualisedVolatility ?? insight?.annualisedVolatility) },
  ]

  const securitiesItems = [
    { label: 'Symbol P/E', value: formatFixed(insight?.peRatio), tone: 'accent' },
    { label: 'Adjusted P/E', value: formatFixed(insight?.adjustedPeRatio ?? insight?.peRatio), tone: 'accent' },
  ]

  const stackedItems = [...tradingDataItems, ...circuitBandItems, ...volatilityItems, ...securitiesItems]

  return (
    <section className="graph-meta">
      <div className="graph-meta-grid graph-meta-grid-flat">
        <div className="gm-items gm-stack">{renderItems(stackedItems)}</div>
      </div>
    </section>
  )
}

export default GraphStatsPanel
