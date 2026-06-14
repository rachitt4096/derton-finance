import { useEffect, useMemo, useState } from 'react'
import { MetricTile, SignalBadge, TerminalPanel, WorkspaceShell } from '../../components/terminal/TerminalPrimitives'
import useMarketStore from '../../store/useMarketStore'
import { createAlert, deleteAlert, fetchAlerts, updateAlertStatus } from '../../utils/terminalApi'

const CONDITIONS = [
  { key: 'price_above', label: 'Price rises above' },
  { key: 'price_below', label: 'Price falls below' },
  { key: 'pct_up', label: 'Gains at least (%)' },
  { key: 'pct_down', label: 'Drops at least (%)' },
]
const SCOPES = [
  { key: 'symbol', label: 'A company' },
  { key: 'watchlist', label: 'My watchlist' },
  { key: 'nifty50', label: 'All NIFTY 50' },
]
const condLabel = (k) => CONDITIONS.find((c) => c.key === k)?.label ?? k

function Alerts() {
  const addToast = useMarketStore((state) => state.addToast)
  const selectedSymbol = useMarketStore((state) => state.selectedSymbol)

  const [rules, setRules] = useState([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState({
    scope: 'symbol',
    symbol: selectedSymbol || 'RELIANCE',
    condition: 'price_above',
    threshold: '',
  })
  const [saving, setSaving] = useState(false)

  const load = () => {
    setLoading(true)
    fetchAlerts()
      .then(setRules)
      .catch((err) => addToast(`Could not load alerts: ${err.message}`, 'l', 5000))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const activeCount = useMemo(() => rules.filter((r) => r.status === 'active').length, [rules])
  const triggered = useMemo(() => rules.filter((r) => r.status === 'triggered'), [rules])

  const submit = async (e) => {
    e.preventDefault()
    const threshold = Number(form.threshold)
    if (!Number.isFinite(threshold)) {
      addToast('Enter a valid threshold value.', 'w', 3500)
      return
    }
    setSaving(true)
    try {
      await createAlert({
        scope: form.scope,
        symbol: form.scope === 'symbol' ? form.symbol.toUpperCase() : null,
        condition: form.condition,
        threshold,
      })
      addToast('Alert created.', 'h', 3000)
      setForm((f) => ({ ...f, threshold: '' }))
      load()
    } catch (err) {
      addToast(`Failed to create alert: ${err.message}`, 'l', 5000)
    } finally {
      setSaving(false)
    }
  }

  const toggle = async (rule) => {
    const next = rule.status === 'active' ? 'disabled' : 'active'
    try {
      await updateAlertStatus(rule.id, next)
      load()
    } catch (err) {
      addToast(err.message, 'l', 4000)
    }
  }

  const remove = async (rule) => {
    try {
      await deleteAlert(rule.id)
      setRules((cur) => cur.filter((r) => r.id !== rule.id))
    } catch (err) {
      addToast(err.message, 'l', 4000)
    }
  }

  const scopeLabel = (rule) =>
    rule.scope === 'symbol' ? rule.symbol : rule.scope === 'nifty50' ? 'NIFTY 50' : 'Watchlist'

  return (
    <WorkspaceShell
      id="s-alerts"
      eyebrow="Terminal-native alerting"
      title="Alerts"
      subtitle="Price & % alerts per company, your watchlist, or all NIFTY 50 — or just ask the assistant to set one."
    >
      <div className="ix-kpi-row">
        <MetricTile label="Active Rules" value={activeCount} />
        <MetricTile label="Triggered" value={triggered.length} tone={triggered.length ? 'warn' : 'neutral'} />
        <MetricTile label="Total Rules" value={rules.length} />
        <MetricTile label="Delivery" value="Terminal + Slack" subvalue="Live during market hours" />
      </div>

      <div className="ix-alert-layout">
        <TerminalPanel title="Create Alert" subtitle="Tip: the floating assistant can also create these for you">
          <form className="alert-form" onSubmit={submit}>
            <label>
              <span>Scope</span>
              <select value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value })}>
                {SCOPES.map((s) => (
                  <option key={s.key} value={s.key}>{s.label}</option>
                ))}
              </select>
            </label>
            {form.scope === 'symbol' ? (
              <label>
                <span>Symbol</span>
                <input
                  value={form.symbol}
                  onChange={(e) => setForm({ ...form, symbol: e.target.value.toUpperCase() })}
                  placeholder="RELIANCE"
                />
              </label>
            ) : null}
            <label>
              <span>Condition</span>
              <select value={form.condition} onChange={(e) => setForm({ ...form, condition: e.target.value })}>
                {CONDITIONS.map((c) => (
                  <option key={c.key} value={c.key}>{c.label}</option>
                ))}
              </select>
            </label>
            <label>
              <span>{form.condition.startsWith('pct') ? 'Percent (%)' : 'Price (₹)'}</span>
              <input
                type="number"
                step="any"
                value={form.threshold}
                onChange={(e) => setForm({ ...form, threshold: e.target.value })}
                placeholder={form.condition.startsWith('pct') ? '2.5' : '1400'}
              />
            </label>
            <button type="submit" className="alert-create-btn" disabled={saving}>
              {saving ? 'Creating…' : 'Create Alert'}
            </button>
          </form>
        </TerminalPanel>

        <TerminalPanel title="Your Alerts" meta={loading ? 'Loading…' : `${rules.length} rules`}>
          <div className="ix-table-wrap compact">
            <table className="ix-table">
              <thead>
                <tr>
                  <th>Target</th>
                  <th>Condition</th>
                  <th>Threshold</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rules.map((rule) => (
                  <tr key={rule.id}>
                    <td className="strong">{scopeLabel(rule)}</td>
                    <td>{condLabel(rule.condition)}</td>
                    <td>{rule.condition.startsWith('pct') ? `${rule.threshold}%` : `₹${rule.threshold}`}</td>
                    <td>
                      <SignalBadge tone={rule.status === 'active' ? 'up' : rule.status === 'triggered' ? 'warn' : 'neutral'}>
                        {rule.status}
                        {rule.status === 'triggered' && rule.triggered_symbol ? ` · ${rule.triggered_symbol}` : ''}
                      </SignalBadge>
                    </td>
                    <td className="alert-actions">
                      <button className="ix-mini-btn" type="button" onClick={() => toggle(rule)}>
                        {rule.status === 'active' ? 'Pause' : 'Arm'}
                      </button>
                      <button className="ix-mini-btn danger" type="button" onClick={() => remove(rule)}>
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
                {!rules.length && !loading ? (
                  <tr>
                    <td colSpan="5" className="alert-empty">No alerts yet. Create one or ask the assistant.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </TerminalPanel>
      </div>
    </WorkspaceShell>
  )
}

export default Alerts
