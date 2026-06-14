import { formatCurrency } from '../../utils/formatters'

const formatValue = (value, digits = 2) => (Number.isFinite(value) ? formatCurrency(value, digits) : '--')

function TodayOhlcStrip({ quote, price }) {
  const closeValue =
    Number.isFinite(quote?.sessionClose) ? quote.sessionClose : Number.isFinite(quote?.lastPrice) ? quote.lastPrice : Number.isFinite(price) ? price : null

  const items = [
    { label: 'Prev. Close', value: formatValue(quote?.close), tone: 'neutral' },
    { label: 'Open', value: formatValue(quote?.open, 0), tone: 'neutral' },
    { label: 'High', value: formatValue(quote?.high, 0), tone: 'up' },
    { label: 'Low', value: formatValue(quote?.low, 0), tone: 'dn' },
    { label: 'Close *', value: formatValue(closeValue), tone: 'neutral' },
    { label: 'VWAP', value: formatValue(quote?.averagePrice), tone: 'neutral' },
  ]

  return (
    <section className="today-ohlc-strip" aria-label="Today's OHLC">
      {items.map((item) => (
        <div className={`today-ohlc-card is-${item.tone}`} key={item.label}>
          <div className="today-ohlc-label">{item.label}</div>
          <div className="today-ohlc-value">{item.value}</div>
        </div>
      ))}
    </section>
  )
}

export default TodayOhlcStrip
