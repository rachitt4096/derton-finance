import { useMemo } from 'react'
import { formatCurrency, formatDateShort, formatPercent } from '../../utils/formatters'

const getSessionKey = (date) => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function StockHistoryTable({ symbol, candles, currentPrice = null }) {
  const rows = useMemo(() => {
    if (!candles.length) {
      return []
    }

    const todayKey = getSessionKey(new Date())
    const startIndex = Math.max(0, candles.length - 60)

    return candles
      .slice(startIndex)
      .map((candle, offset) => {
        const candleIndex = startIndex + offset
        const prevClose = candleIndex > 0 ? candles[candleIndex - 1].c : candle.o
        const isTodayRow = getSessionKey(candle.t) === todayKey
        const ltp = isTodayRow && Number.isFinite(currentPrice) ? currentPrice : candle.c
        const openToHighPercent = candle.o ? ((candle.h - candle.o) / candle.o) * 100 : 0
        const openToLowPercent = candle.o ? ((candle.l - candle.o) / candle.o) * 100 : 0
        const openToLtpPercent = candle.o ? ((ltp - candle.o) / candle.o) * 100 : 0
        const openToClosePercent = candle.o ? ((candle.c - candle.o) / candle.o) * 100 : 0

        return {
          date: candle.t,
          open: candle.o,
          high: candle.h,
          openToHighPercent,
          low: candle.l,
          openToLowPercent,
          prevClose,
          ltp,
          openToLtpPercent,
          close: candle.c,
          openToClosePercent,
        }
      })
      .reverse()
  }, [candles, currentPrice])

  return (
    <section className="hist-section">
      <div className="hist-head">
        <div className="hist-title">Daily History Sheet</div>
        <div className="hist-sub">{`${symbol} · Last 60 sessions`}</div>
      </div>

      <div className="hist-table-wrap">
        <table className="hist-table">
          <thead>
            <tr>
              <th>Date</th>
              <th className="num">Open</th>
              <th className="num">High</th>
              <th className="num">Open to High %</th>
              <th className="num">Low</th>
              <th className="num">Open to Low %</th>
              <th className="num">Prev Close</th>
              <th className="num">LTP</th>
              <th className="num">Open to LTP %</th>
              <th className="num">Close</th>
              <th className="num">Open to Close %</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${symbol}-${row.date.toISOString()}`}>
                <td>{formatDateShort(row.date)}</td>
                <td className="num">{formatCurrency(row.open)}</td>
                <td className="num up">{formatCurrency(row.high)}</td>
                <td className={`num ${row.openToHighPercent >= 0 ? 'up' : 'dn'}`}>{formatPercent(row.openToHighPercent)}</td>
                <td className="num dn">{formatCurrency(row.low)}</td>
                <td className={`num ${row.openToLowPercent >= 0 ? 'up' : 'dn'}`}>{formatPercent(row.openToLowPercent)}</td>
                <td className="num">{formatCurrency(row.prevClose)}</td>
                <td className={`num ${row.openToLtpPercent >= 0 ? 'up' : 'dn'}`}>{formatCurrency(row.ltp)}</td>
                <td className={`num ${row.openToLtpPercent >= 0 ? 'up' : 'dn'}`}>{formatPercent(row.openToLtpPercent)}</td>
                <td className={`num ${row.openToClosePercent >= 0 ? 'up' : 'dn'}`}>{formatCurrency(row.close)}</td>
                <td className={`num ${row.openToClosePercent >= 0 ? 'up' : 'dn'}`}>{formatPercent(row.openToClosePercent)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export default StockHistoryTable
