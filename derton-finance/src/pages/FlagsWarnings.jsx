import { useEffect, useMemo, useState } from 'react'
import { fetchFlags } from '../utils/terminalApi'
import { formatCurrency, formatPercent } from '../utils/formatters'
import { resolveDisplayPrice } from '../utils/marketPrice'
import useMarketStore from '../store/useMarketStore'

const FLAGS_REFRESH_MS = 30000

const severityClass = (severity) => {
  const normalized = String(severity ?? '').toLowerCase()
  if (normalized.includes('critical')) {
    return 'sev-critical'
  }
  if (normalized.includes('warn') || normalized.includes('high')) {
    return 'sev-warn'
  }
  return 'sev-info'
}

function FlagsWarnings() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const prices = useMarketStore((state) => state.prices)
  const marketQuotes = useMarketStore((state) => state.marketQuotes)
  const feed = useMarketStore((state) => state.feed)
  const setActiveSymbols = useMarketStore((state) => state.setActiveSymbols)

  useEffect(() => {
    let isMounted = true

    const load = async ({ silent = false } = {}) => {
      if (!silent) {
        setLoading(true)
      }
      setError('')

      try {
        const nextRows = await fetchFlags()
        if (isMounted) {
          setRows(nextRows)
        }
      } catch (nextError) {
        if (isMounted) {
          setError(nextError instanceof Error ? nextError.message : 'Unable to load flags.')
        }
      } finally {
        if (isMounted && !silent) {
          setLoading(false)
        }
      }
    }

    const refresh = () => {
      void load({ silent: true })
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refresh()
      }
    }

    void load()
    const intervalId = window.setInterval(refresh, FLAGS_REFRESH_MS)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      isMounted = false
      window.clearInterval(intervalId)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [])

  useEffect(() => {
    setActiveSymbols(rows.map((row) => row.symbol))
  }, [rows, setActiveSymbols])

  useEffect(() => {
    return () => {
      setActiveSymbols([])
    }
  }, [setActiveSymbols])

  const liveRows = useMemo(
    () =>
      rows.map((row) => {
        const quote = marketQuotes[row.symbol] ?? null
        const price = resolveDisplayPrice({
          livePrice: prices[row.symbol],
          quote,
          feed,
        })
        const prevClose = quote?.close ?? null
        const changePct =
          Number.isFinite(price) && Number.isFinite(prevClose) && prevClose !== 0 ? ((price - prevClose) / prevClose) * 100 : null

        return {
          ...row,
          price,
          changePct,
        }
      }),
    [feed, marketQuotes, prices, rows],
  )

  const summary = useMemo(
    () => ({
      critical: liveRows.filter((row) => String(row.severity).toLowerCase().includes('critical')).length,
      warning: liveRows.filter((row) => String(row.severity).toLowerCase().includes('warn')).length,
      watch: liveRows.filter((row) => String(row.status).toLowerCase().includes('watch')).length,
    }),
    [liveRows],
  )

  return (
    <section id="s6" className="screen screen-col">
      <div className="fw-summary-bar">
        <div className="fw-count sebi">Critical {summary.critical}</div>
        <div className="fw-count audit">Warnings {summary.warning}</div>
        <div className="fw-count pledge">Watch {summary.watch}</div>
      </div>

      <div className="fw-body">
        <div className="fw-table-wrap">
          <table className="fw-table">
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Company</th>
                <th>Type</th>
                <th>Detail</th>
                <th>LTP</th>
                <th>Day %</th>
                <th>Since</th>
                <th>Severity</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan="9">Loading flags...</td>
                </tr>
              ) : error ? (
                <tr>
                  <td colSpan="9">{error}</td>
                </tr>
              ) : liveRows.length ? (
                liveRows.map((row) => (
                  <tr key={row.id}>
                    <td>{row.symbol}</td>
                    <td>{row.company}</td>
                    <td>{row.type}</td>
                    <td>{row.detail}</td>
                    <td>{Number.isFinite(row.price) ? formatCurrency(row.price) : '--'}</td>
                    <td className={(row.changePct ?? 0) >= 0 ? 'up' : 'dn'}>
                      {Number.isFinite(row.changePct) ? formatPercent(row.changePct) : '--'}
                    </td>
                    <td>{row.since}</td>
                    <td>
                      <span className={`sev-badge ${severityClass(row.severity)}`}>{row.severity}</span>
                    </td>
                    <td>{row.status}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="9">No flags stored in the backend.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <aside className="fw-side">
          <div className="fw-side-title">Notes</div>
          <div className="recent-item">
            <div className="ri-date">Backend source</div>
            <div className="ri-text">This screen shows only server-stored flag records.</div>
          </div>
          <div className="recent-item">
            <div className="ri-date">Current count</div>
            <div className="ri-text">{liveRows.length} records available.</div>
          </div>
        </aside>
      </div>
    </section>
  )
}

export default FlagsWarnings
