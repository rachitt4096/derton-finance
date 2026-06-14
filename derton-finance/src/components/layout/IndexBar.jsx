import { useMemo } from 'react'
import useMarketStore from '../../store/useMarketStore'
import { resolveDisplayPrice } from '../../utils/marketPrice'

function IndexBar() {
  const watchlistSymbols = useMarketStore((state) => state.watchlistSymbols)
  const selectedSymbol = useMarketStore((state) => state.selectedSymbol)
  const prices = useMarketStore((state) => state.prices)
  const marketQuotes = useMarketStore((state) => state.marketQuotes)
  const feed = useMarketStore((state) => state.feed)

  const rows = useMemo(() => {
    const symbols = [...new Set([...(watchlistSymbols ?? []), selectedSymbol].filter(Boolean))].slice(0, 4)

    return symbols
      .map((symbol) => {
        const quote = marketQuotes[symbol]
        const value = resolveDisplayPrice({
          livePrice: prices[symbol],
          quote,
          feed,
        })
        const close = quote?.close ?? null

        if (!Number.isFinite(value)) {
          return null
        }

        const change = Number.isFinite(close) ? value - close : null
        const percent = Number.isFinite(change) && Number.isFinite(close) && close !== 0 ? (change / close) * 100 : null

        return {
          name: symbol,
          value,
          change,
          percent,
        }
      })
      .filter(Boolean)
  }, [feed, marketQuotes, prices, selectedSymbol, watchlistSymbols])

  if (!rows.length) {
    return null
  }

  return (
    <section id="indexbar">
      {rows.map((row) => {
        const up = (row.change ?? 0) >= 0
        return (
          <div className="idx" key={row.name}>
            <div>
              <div className="idx-n">{row.name}</div>
            </div>
            <div>
              <div className={`idx-v ${up ? 'up' : 'dn'}`}>
                {row.value.toLocaleString('en-IN', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </div>
              <div className={`idx-c ${up ? 'up' : 'dn'}`}>
                {Number.isFinite(row.change) && Number.isFinite(row.percent)
                  ? `${up ? '+' : ''}${row.change.toFixed(2)} (${up ? '+' : ''}${row.percent.toFixed(2)}%)`
                  : 'Awaiting close reference'}
              </div>
            </div>
          </div>
        )
      })}
    </section>
  )
}

export default IndexBar
