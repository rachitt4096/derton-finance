import { useEffect, useMemo, useRef, useState } from 'react'
import { MetricTile, TerminalPanel, WorkspaceShell } from '../../components/terminal/TerminalPrimitives'
import { fetchOptionChain, fetchOptionExpiries } from '../../utils/terminalApi'
import { cn, formatPercent } from '../../utils/formatters'

const UNDERLYINGS = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY', 'SENSEX']
const REFRESH_MS = 15_000

const fmt = (v, d = 2) =>
  v === null || v === undefined || Number.isNaN(Number(v))
    ? '--'
    : Number(v).toLocaleString('en-IN', { maximumFractionDigits: d, minimumFractionDigits: d })

const fmtInt = (v) =>
  v === null || v === undefined || Number.isNaN(Number(v))
    ? '--'
    : Number(v).toLocaleString('en-IN', { maximumFractionDigits: 0 })

const fmtLakh = (v) => {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return '--'
  const n = Number(v)
  if (Math.abs(n) >= 1e7) return `${(n / 1e7).toFixed(2)}Cr`
  if (Math.abs(n) >= 1e5) return `${(n / 1e5).toFixed(2)}L`
  return fmtInt(n)
}

function Options() {
  const [underlying, setUnderlying] = useState('NIFTY')
  const [expiries, setExpiries] = useState([])
  const [expiry, setExpiry] = useState('')
  const [chain, setChain] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const atmRowRef = useRef(null)

  // Load expiries when underlying changes
  useEffect(() => {
    let active = true
    setError(null)
    setChain(null)
    setExpiry('')
    fetchOptionExpiries(underlying)
      .then((res) => {
        if (!active) return
        const list = res.expiries ?? []
        setExpiries(list)
        setExpiry(list[0] ?? '')
      })
      .catch((err) => active && setError(err.message))
    return () => {
      active = false
    }
  }, [underlying])

  // Load + auto-refresh chain when expiry set
  useEffect(() => {
    if (!expiry) return undefined
    let active = true
    const load = () => {
      setLoading(true)
      fetchOptionChain(underlying, expiry)
        .then((res) => active && (setChain(res), setError(null)))
        .catch((err) => active && setError(err.message))
        .finally(() => active && setLoading(false))
    }
    load()
    const timer = setInterval(load, REFRESH_MS)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [underlying, expiry])

  const spot = chain?.spot_price ?? null

  const atmStrike = useMemo(() => {
    if (!chain?.strikes?.length || spot == null) return null
    return chain.strikes.reduce((best, row) =>
      Math.abs(row.strike_price - spot) < Math.abs(best.strike_price - spot) ? row : best,
    ).strike_price
  }, [chain, spot])

  // Max OI strikes (support/resistance)
  const { maxCallOiStrike, maxPutOiStrike } = useMemo(() => {
    if (!chain?.strikes?.length) return {}
    let mc = null
    let mp = null
    for (const r of chain.strikes) {
      if (mc == null || (r.call.oi ?? 0) > (mc.call.oi ?? 0)) mc = r
      if (mp == null || (r.put.oi ?? 0) > (mp.put.oi ?? 0)) mp = r
    }
    return { maxCallOiStrike: mc?.strike_price, maxPutOiStrike: mp?.strike_price }
  }, [chain])

  useEffect(() => {
    if (atmRowRef.current) {
      atmRowRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }
  }, [atmStrike])

  const pcr = chain?.pcr
  const pcrTone = pcr == null ? 'neutral' : pcr > 1 ? 'up' : pcr < 0.7 ? 'warn' : 'neutral'

  return (
    <WorkspaceShell
      id="options"
      eyebrow="Derivatives"
      title="Option Chain"
      subtitle="Live OI, IV & Greeks · auto-refresh 15s"
      actions={
        <div className="opt-controls">
          <div className="opt-underlying-group">
            {UNDERLYINGS.map((u) => (
              <button
                key={u}
                type="button"
                className={cn('opt-pill', underlying === u && 'active')}
                onClick={() => setUnderlying(u)}
              >
                {u}
              </button>
            ))}
          </div>
          <select
            className="opt-expiry-select"
            value={expiry}
            onChange={(e) => setExpiry(e.target.value)}
            disabled={!expiries.length}
          >
            {expiries.length ? (
              expiries.map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))
            ) : (
              <option>—</option>
            )}
          </select>
        </div>
      }
    >
      <div className="ix-kpi-row">
        <MetricTile label="Spot" value={fmt(spot)} subvalue={underlying} />
        <MetricTile label="PCR (OI)" value={fmt(pcr)} tone={pcrTone} subvalue={pcr > 1 ? 'Bullish bias' : pcr < 0.7 ? 'Bearish bias' : 'Neutral'} />
        <MetricTile label="Total Call OI" value={fmtLakh(chain?.total_call_oi)} tone="warn" subvalue={`Max @ ${fmtInt(maxCallOiStrike)}`} />
        <MetricTile label="Total Put OI" value={fmtLakh(chain?.total_put_oi)} tone="up" subvalue={`Max @ ${fmtInt(maxPutOiStrike)}`} />
        <MetricTile label="ATM Strike" value={fmtInt(atmStrike)} subvalue={expiry || '—'} />
      </div>

      {error ? (
        <TerminalPanel title="Option chain unavailable">
          <div className="opt-error">{error}</div>
        </TerminalPanel>
      ) : null}

      <TerminalPanel
        title={`${underlying} Option Chain`}
        subtitle="CALLS (left) · STRIKE · PUTS (right)"
        meta={loading ? 'Refreshing…' : chain ? `${chain.strikes.length} strikes` : ''}
        className="opt-panel"
      >
        <div className="opt-chain-scroll">
          <table className="opt-chain-table">
            <thead>
              <tr className="opt-side-head">
                <th colSpan={6} className="call-head">CALLS</th>
                <th className="strike-head">STRIKE</th>
                <th colSpan={6} className="put-head">PUTS</th>
              </tr>
              <tr className="opt-col-head">
                <th>OI</th><th>Chg</th><th>Vol</th><th>IV</th><th>Δ</th><th>LTP</th>
                <th className="strike-col">Price</th>
                <th>LTP</th><th>Δ</th><th>IV</th><th>Vol</th><th>Chg</th><th>OI</th>
              </tr>
            </thead>
            <tbody>
              {chain?.strikes?.map((row) => {
                const isAtm = row.strike_price === atmStrike
                const callItm = spot != null && row.strike_price < spot
                const putItm = spot != null && row.strike_price > spot
                return (
                  <tr
                    key={row.strike_price}
                    ref={isAtm ? atmRowRef : null}
                    className={cn('opt-row', isAtm && 'atm')}
                  >
                    <td className={cn('c-oi', callItm && 'itm')}>{fmtLakh(row.call.oi)}</td>
                    <td className={cn(callItm && 'itm', (row.call.oi_change ?? 0) >= 0 ? 'up' : 'dn')}>{fmtLakh(row.call.oi_change)}</td>
                    <td className={cn(callItm && 'itm')}>{fmtLakh(row.call.volume)}</td>
                    <td className={cn(callItm && 'itm')}>{fmt(row.call.iv, 1)}</td>
                    <td className={cn(callItm && 'itm')}>{fmt(row.call.delta, 2)}</td>
                    <td className={cn('c-ltp', callItm && 'itm')}>{fmt(row.call.ltp)}</td>

                    <td className="strike-col">{fmtInt(row.strike_price)}</td>

                    <td className={cn('p-ltp', putItm && 'itm')}>{fmt(row.put.ltp)}</td>
                    <td className={cn(putItm && 'itm')}>{fmt(row.put.delta, 2)}</td>
                    <td className={cn(putItm && 'itm')}>{fmt(row.put.iv, 1)}</td>
                    <td className={cn(putItm && 'itm')}>{fmtLakh(row.put.volume)}</td>
                    <td className={cn(putItm && 'itm', (row.put.oi_change ?? 0) >= 0 ? 'up' : 'dn')}>{fmtLakh(row.put.oi_change)}</td>
                    <td className={cn('p-oi', putItm && 'itm')}>{fmtLakh(row.put.oi)}</td>
                  </tr>
                )
              })}
              {!chain && !error ? (
                <tr>
                  <td colSpan={13} className="opt-loading-cell">
                    {loading ? 'Loading option chain…' : 'Select an expiry'}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </TerminalPanel>
    </WorkspaceShell>
  )
}

export default Options
