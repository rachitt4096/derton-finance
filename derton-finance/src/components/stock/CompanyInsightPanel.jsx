import { formatCrore, formatCurrency } from '../../utils/formatters'

const formatValue = (value, formatter) => (Number.isFinite(value) ? formatter(value) : '--')
const formatRatio = (value, suffix = '') => (Number.isFinite(value) ? `${Number(value).toFixed(2)}${suffix}` : '--')
const joinClasses = (...classes) => classes.filter(Boolean).join(' ')

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

const formatCount = (value) =>
  Number.isFinite(value)
    ? Number(value).toLocaleString('en-IN', {
        maximumFractionDigits: 0,
      })
    : '--'

const getInsightNotice = (insight) =>
  insight?.referenceOnly || insight?.dataSource === 'reference_seed'
    ? 'Live fundamental data is not connected for this symbol yet.'
    : null

export function CompanySnapshotCard({ insight, symbol, className = '' }) {
  const insightNotice = getInsightNotice(insight)
  const snapshotRows = [
    ['Sector', insight?.sector ?? '--'],
    ['Industry', insight?.industry ?? '--'],
    ['Market Cap', formatValue(insight?.marketCapCr, (value) => formatCrore(value))],
    ['P/E', formatRatio(insight?.peRatio, 'x')],
    ['Book Value', formatValue(insight?.bookValue, (value) => formatCurrency(value))],
    ['Dividend Yield', formatRatio(insight?.dividendYield, '%')],
    ['Face Value', formatValue(insight?.faceValue, (value) => formatCurrency(value, 0))],
  ]

  return (
    <article className={joinClasses('s2-rich-card', className)}>
      <div className="s2-rich-title">COMPANY SNAPSHOT</div>
      <div className="insight-description">
        {insight?.description ?? insightNotice ?? `${symbol} will show company fundamentals here when live data is available.`}
      </div>
      {insightNotice ? <div className="insight-empty">{insightNotice}</div> : null}
      <div className="s2-info-list">
        {snapshotRows.map(([label, value]) => (
          <div className="s2-info-row" key={label}>
            <span className="s2-info-label">{label}</span>
            <span className="s2-info-value">{value}</span>
          </div>
        ))}
      </div>
    </article>
  )
}

export function FinancialSnapshotCard({ insight, quote, price, className = '' }) {
  const insightNotice = getInsightNotice(insight)
  const financialRows = [
    ['Revenue', formatValue(insight?.revenueCr, (value) => formatCrore(value))],
    ['Profit', formatValue(insight?.profitCr, (value) => formatCrore(value))],
    ['Open', formatValue(quote?.open, (value) => formatCurrency(value))],
    ['LTP', formatValue(price ?? quote?.lastPrice, (value) => formatCurrency(value))],
    ['Prev Close', formatValue(quote?.close, (value) => formatCurrency(value))],
    ['Total Buy Qty', formatCount(quote?.totalBuyQuantity)],
    ['Total Sell Qty', formatCount(quote?.totalSellQuantity)],
    ['As Of', insight?.asOf ?? '--'],
  ]

  return (
    <article className={joinClasses('s2-rich-card', className)}>
      <div className="s2-rich-title">FINANCIAL SNAPSHOT</div>
      {insightNotice ? <div className="insight-empty">{insightNotice}</div> : null}
      <div className="s2-info-list">
        {financialRows.map(([label, value]) => (
          <div className="s2-info-row" key={label}>
            <span className="s2-info-label">{label}</span>
            <span className="s2-info-value">{value}</span>
          </div>
        ))}
      </div>
    </article>
  )
}

export function RevenueProfitHistoryCard({ insight, symbol, className = '' }) {
  const financialHistory = insight?.financials ?? []
  const insightNotice = getInsightNotice(insight)

  return (
    <article className={joinClasses('s2-rich-card', className)}>
      <div className="insight-header">
        <div className="s2-rich-title">REVENUE & PROFIT HISTORY</div>
        <div className="insight-subtle">Last 3 financial years</div>
      </div>

      {financialHistory.length ? (
        <div className="insight-table-wrap">
          <table className="insight-table">
            <thead>
              <tr>
                <th>Year</th>
                <th>Revenue</th>
                <th>Profit</th>
                <th>EPS</th>
                <th>OPM</th>
              </tr>
            </thead>
            <tbody>
              {financialHistory.map((row) => (
                <tr key={`${symbol}-${row.label}`}>
                  <td>{row.label}</td>
                  <td>{formatCrore(row.revenueCr)}</td>
                  <td>{formatCrore(row.profitCr)}</td>
                  <td>{row.eps.toFixed(2)}</td>
                  <td>{row.operatingMarginPct.toFixed(2)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="insight-empty">{insightNotice ?? 'Financial history is not available for this symbol yet.'}</div>
      )}
    </article>
  )
}

export function TradedValueHistoryCard({ insight, symbol, className = '' }) {
  const tradedValueHistory = insight?.tradedValueHistory ?? []

  return (
    <article className={joinClasses('s2-rich-card', className)}>
      <div className="insight-header">
        <div className="s2-rich-title">TOTAL TRADED VALUE HISTORY</div>
        <div className="insight-subtle">Approx. value derived from daily close x volume</div>
      </div>

      {tradedValueHistory.length ? (
        <div className="insight-table-wrap">
          <table className="insight-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Close</th>
                <th>Volume</th>
                <th>Traded Value</th>
              </tr>
            </thead>
            <tbody>
              {tradedValueHistory.map((row) => (
                <tr key={`${symbol}-${row.time}`}>
                  <td>{formatDateLabel(row.time)}</td>
                  <td>{formatCurrency(row.close)}</td>
                  <td>{formatCount(row.volume)}</td>
                  <td>{formatCrore(row.tradedValue / 10000000, 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="insight-empty">Daily traded value history will appear here once candles are available.</div>
      )}
    </article>
  )
}

function CompanyInsightPanel({ insight, quote, symbol, price }) {
  return (
    <section className="s2-research-grid insight-grid">
      <CompanySnapshotCard insight={insight} symbol={symbol} />
      <FinancialSnapshotCard insight={insight} quote={quote} price={price} />
      <RevenueProfitHistoryCard insight={insight} symbol={symbol} />
      <TradedValueHistoryCard insight={insight} symbol={symbol} className="s2-rich-card-span-3" />
    </section>
  )
}

export default CompanyInsightPanel
