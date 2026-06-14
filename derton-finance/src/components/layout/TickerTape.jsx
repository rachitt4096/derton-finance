import { formatCurrency, formatPercent } from '../../utils/formatters'
import { resolveDisplayPrice } from '../../utils/marketPrice'

function TickerTape({ symbols, prices, quotes, feed }) {
  const items = (symbols ?? []).map((symbol) => {
    const quote = quotes?.[symbol]
    const price = resolveDisplayPrice({
      livePrice: prices?.[symbol],
      quote,
      feed,
    })
    const close = quote?.close
    const change = Number.isFinite(price) && Number.isFinite(close) ? price - close : null
    const percent = Number.isFinite(change) && Number.isFinite(close) && close !== 0 ? (change / close) * 100 : null
    const up = change === null || change >= 0

    return (
      <span className="ti" key={symbol}>
        <span className="ti-s">{symbol}</span>
        <span className={up ? 'up' : 'dn'}>
          {Number.isFinite(price) ? formatCurrency(price) : '--'}{' '}
          {Number.isFinite(percent) ? `${up ? '▲' : '▼'} ${formatPercent(percent)}` : '--'}
        </span>
      </span>
    )
  })

  return (
    <div className="ticker">
      <div className="ticker-inner">
        {items}
        {items}
      </div>
    </div>
  )
}

export default TickerTape
