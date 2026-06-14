import { formatChange, formatCurrency, formatPercent } from '../../utils/formatters'

const getIstClock = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-IN', {
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Kolkata',
  }).formatToParts(date)

  const weekday = parts.find((part) => part.type === 'weekday')?.value ?? 'Mon'
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? '0')
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? '0')

  return { weekday, totalMinutes: hour * 60 + minute }
}

const isRegularMarketLive = (date = new Date()) => {
  const { weekday, totalMinutes } = getIstClock(date)
  const isWeekday = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(weekday)

  return isWeekday && totalMinutes >= 9 * 60 + 15 && totalMinutes <= 15 * 60 + 30
}

function StockHeader({ quote, price, symbol, quoteHealth }) {
  const prevClose = quote?.close
  const currentPrice = Number.isFinite(price) ? price : quote?.close ?? null
  const closePrice =
    Number.isFinite(quote?.sessionClose) ? quote.sessionClose : Number.isFinite(quote?.lastPrice) ? quote.lastPrice : currentPrice
  const showClosePanel = !isRegularMarketLive()

  const ltpChange = Number.isFinite(currentPrice) && Number.isFinite(prevClose) ? currentPrice - prevClose : null
  const ltpPercent =
    Number.isFinite(ltpChange) && Number.isFinite(prevClose) && prevClose !== 0 ? (ltpChange / prevClose) * 100 : null
  const ltpUp = ltpChange === null || ltpChange >= 0

  const closeChange = Number.isFinite(closePrice) && Number.isFinite(prevClose) ? closePrice - prevClose : null
  const closePercent =
    Number.isFinite(closeChange) && Number.isFinite(prevClose) && prevClose !== 0 ? (closeChange / prevClose) * 100 : null
  const closeUp = closeChange === null || closeChange >= 0

  const quoteErrorMessage = !quote && quoteHealth?.status === 'error' ? quoteHealth.error : null

  return (
    <section className="stock-hdr">
      <div className="sh-row1">
        <div className="sh-ident">
          <div className="sh-sym">{symbol}</div>
          <div className="sh-co">{quote?.companyName ?? (quoteErrorMessage ? 'Quote data unavailable' : 'Loading instrument details...')}</div>
          {quoteErrorMessage ? <div className="sh-error">{quoteErrorMessage}</div> : null}
          <div className="sh-co">{quote?.instrumentKey ?? ''}</div>
        </div>

        <div className="sh-price-block">
          <div className={`sh-price-shell ${showClosePanel ? '' : 'single'}`.trim()}>
            <div className="sh-ltp-panel">
              <div className="sh-close-cap">LTP</div>
              <div className="sh-price-row">
                <div className="sh-price mono">
                  {Number.isFinite(currentPrice) ? formatCurrency(currentPrice) : '--'}
                </div>
                {Number.isFinite(ltpChange) && Number.isFinite(ltpPercent) ? (
                  <>
                    <span className={`sh-arrow ${ltpUp ? 'up' : 'dn'}`}>{ltpUp ? '▲' : '▼'}</span>
                    <span className={`sh-inline-change mono ${ltpUp ? 'up' : 'dn'}`}>
                      {`${formatChange(ltpChange)} (${formatPercent(ltpPercent)})`}
                    </span>
                  </>
                ) : (
                  <span className="sh-inline-change">{quoteErrorMessage ? 'Reconnect broker to load quotes.' : 'Waiting for live quote...'}</span>
                )}
              </div>
            </div>

            {showClosePanel ? (
              <>
                <div className="sh-divider" />

                <div className="sh-close-panel">
                  <div className="sh-close-cap">Close</div>
                  <div className="sh-close-panel-row">
                    <span className="sh-close-price mono">{Number.isFinite(closePrice) ? formatCurrency(closePrice) : '--'}</span>
                    <span className={`sh-close-change mono ${closeUp ? 'up' : 'dn'}`}>
                      {Number.isFinite(closeChange) && Number.isFinite(closePercent)
                        ? `${formatChange(closeChange)} (${formatPercent(closePercent)})`
                        : '--'}
                    </span>
                  </div>
                </div>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  )
}

export default StockHeader
