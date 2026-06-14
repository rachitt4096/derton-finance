import { formatCurrency } from '../../utils/formatters'

const formatCount = (value) => (Number.isFinite(value) ? Number(value).toLocaleString('en-IN') : '--')

function BandBar({ quote, price }) {
  const closeValue =
    Number.isFinite(quote?.sessionClose) ? quote.sessionClose : Number.isFinite(quote?.lastPrice) ? quote.lastPrice : Number.isFinite(price) ? price : null

  return (
    <div className="band-bar">
      <div className="bb">
        <span className="bb-l">CIRCUIT↑</span>
        <span className="bb-v up">
          {Number.isFinite(quote?.upperCircuitLimit) ? formatCurrency(quote.upperCircuitLimit, 0) : '--'}
        </span>
      </div>

      <div className="bb">
        <span className="bb-l">CIRCUIT↓</span>
        <span className="bb-v dn">
          {Number.isFinite(quote?.lowerCircuitLimit) ? formatCurrency(quote.lowerCircuitLimit, 0) : '--'}
        </span>
      </div>

      <div className="vsep" />

      <div className="bb">
        <span className="bb-l">DAY</span>
        <span className="bb-v dn">{Number.isFinite(quote?.low) ? formatCurrency(quote.low, 0) : '--'}</span>
        <span className="bb-mid">—</span>
        <span className="bb-v up">{Number.isFinite(quote?.high) ? formatCurrency(quote.high, 0) : '--'}</span>
      </div>

      <div className="bb">
        <span className="bb-l">AVG</span>
        <span className="bb-v accent">
          {Number.isFinite(quote?.averagePrice) ? formatCurrency(quote.averagePrice) : '--'}
        </span>
      </div>

      <div className="bb">
        <span className="bb-l">BUY QTY</span>
        <span className="bb-v">{formatCount(quote?.totalBuyQuantity)}</span>
      </div>

      <div className="bb">
        <span className="bb-l">SELL QTY</span>
        <span className="bb-v">{formatCount(quote?.totalSellQuantity)}</span>
      </div>

      <div className="bb">
        <span className="bb-l">CLOSE</span>
        <span className="bb-v">{Number.isFinite(closeValue) ? formatCurrency(closeValue) : '--'}</span>
      </div>
    </div>
  )
}

export default BandBar
