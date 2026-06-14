import { formatCurrency } from '../../utils/formatters'

const formatCount = (value) =>
  Number.isFinite(value)
    ? Number(value).toLocaleString('en-IN', {
        maximumFractionDigits: 0,
      })
    : '-'

const formatDepthQuantity = (value) => (Number.isFinite(value) && Number(value) > 0 ? formatCount(value) : '-')

const formatDepthPrice = (value) =>
  Number.isFinite(value) && Number(value) > 0 ? formatCurrency(Number(value)) : '-'

const sumDepthQuantity = (rows) =>
  (rows ?? []).reduce((total, row) => total + (Number.isFinite(row?.quantity) ? Number(row.quantity) : 0), 0)

const readQuantity = (value, fallbackRows) => {
  if (Number.isFinite(value) && value > 0) {
    return Number(value)
  }

  const fallback = sumDepthQuantity(fallbackRows)
  return fallback > 0 ? fallback : 0
}

function MarketDepthTable({ quote, rows = 5 }) {
  const buyRows = (quote?.depth?.buy ?? []).slice(0, rows)
  const sellRows = (quote?.depth?.sell ?? []).slice(0, rows)
  const rowCount = Math.max(buyRows.length, sellRows.length, rows)
  const depthRows = Array.from({ length: rowCount }, (_, index) => ({
    buy: buyRows[index] ?? null,
    sell: sellRows[index] ?? null,
  }))

  const totalBuyQuantity = readQuantity(quote?.totalBuyQuantity, buyRows)
  const totalSellQuantity = readQuantity(quote?.totalSellQuantity, sellRows)
  const totalQuantity = totalBuyQuantity + totalSellQuantity
  const buyPercent = totalQuantity > 0 && totalBuyQuantity > 0 ? (totalBuyQuantity / totalQuantity) * 100 : null
  const sellPercent = totalQuantity > 0 && totalSellQuantity > 0 ? (totalSellQuantity / totalQuantity) * 100 : null
  const buyBarWidth = totalQuantity > 0 ? (totalBuyQuantity / totalQuantity) * 100 : 0
  const sellBarWidth = totalQuantity > 0 ? (totalSellQuantity / totalQuantity) * 100 : 0

  return (
    <div className="market-depth-book">
      <div className="market-depth-head">
        <span>Qty</span>
        <span>Bid (₹)</span>
        <span>Ask (₹)</span>
        <span>Qty</span>
      </div>

      <div className="market-depth-body">
        {depthRows.map((row, index) => (
          <div className="market-depth-row" key={`depth-row-${index}`}>
            <span className="market-depth-cell market-depth-qty buy mono">{formatDepthQuantity(row.buy?.quantity)}</span>
            <span className="market-depth-cell market-depth-price buy mono">{formatDepthPrice(row.buy?.price)}</span>
            <span className="market-depth-cell market-depth-price sell mono">{formatDepthPrice(row.sell?.price)}</span>
            <span className="market-depth-cell market-depth-qty sell mono">
              {formatDepthQuantity(row.sell?.quantity)}
            </span>
          </div>
        ))}
      </div>

      <div className="market-depth-meter" aria-hidden="true">
        <span className="market-depth-meter-buy" style={{ width: `${buyBarWidth}%` }} />
        <span className="market-depth-meter-sell" style={{ width: `${sellBarWidth}%` }} />
      </div>

      <div className="market-depth-summary">
        <div className="market-depth-summary-side buy">
          <span>{buyPercent !== null ? `${buyPercent.toFixed(2)}% Buy` : '-% Buy'}</span>
          <strong>{totalBuyQuantity > 0 ? formatCount(totalBuyQuantity) : '-'}</strong>
        </div>

        <div className="market-depth-summary-total">
          <span>Total Quantity</span>
          <strong>{totalQuantity > 0 ? formatCount(totalQuantity) : '-'}</strong>
        </div>

        <div className="market-depth-summary-side sell">
          <span>{sellPercent !== null ? `${sellPercent.toFixed(2)}% Sell` : '-% Sell'}</span>
          <strong>{totalSellQuantity > 0 ? formatCount(totalSellQuantity) : '-'}</strong>
        </div>
      </div>
    </div>
  )
}

export default MarketDepthTable
