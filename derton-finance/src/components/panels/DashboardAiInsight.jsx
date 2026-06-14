import { useEffect, useRef, useState } from 'react'
import useMarketStore from '../../store/useMarketStore'
import { fetchAiStatus, sendAiChat } from '../../utils/terminalApi'

const QUICK = [
  { key: 'snapshot', label: 'Snapshot', prompt: 'Give a 3-line snapshot of {sym} today: trend, key levels, and one risk. Be concise.' },
  { key: 'why', label: 'Why moving?', prompt: 'In 3 bullets, why is {sym} moving today? Use price action and any recent news.' },
  { key: 'levels', label: 'Key levels', prompt: 'Give intraday support and resistance levels for {sym} with one line of reasoning.' },
  { key: 'verdict', label: 'Quick verdict', prompt: 'Give a short analyst-style read on {sym} right now: bias (bullish/bearish/neutral) with 2 reasons. Not financial advice.' },
]

function DashboardAiInsight() {
  const selectedSymbol = useMarketStore((state) => state.selectedSymbol)
  const [enabled, setEnabled] = useState(null)
  const [loading, setLoading] = useState(false)
  const [active, setActive] = useState(null)
  const [text, setText] = useState('')
  const reqRef = useRef(0)

  useEffect(() => {
    fetchAiStatus().then((r) => setEnabled(Boolean(r?.enabled))).catch(() => setEnabled(false))
  }, [])

  // Clear stale insight when the symbol changes.
  useEffect(() => {
    setText('')
    setActive(null)
  }, [selectedSymbol])

  const run = async (item) => {
    if (loading || enabled === false) return
    const id = ++reqRef.current
    setActive(item.key)
    setLoading(true)
    setText('')
    try {
      const res = await sendAiChat({
        message: item.prompt.replaceAll('{sym}', selectedSymbol),
        context: { screen: 'dashboard', symbol: selectedSymbol },
        history: [],
      })
      if (id === reqRef.current) setText(res.reply)
    } catch (err) {
      if (id === reqRef.current) setText(`⚠️ ${err.message}`)
    } finally {
      if (id === reqRef.current) setLoading(false)
    }
  }

  return (
    <section className="dash-ai">
      <div className="dash-ai-head">
        <div className="dash-ai-title">
          <span className="dash-ai-spark">✦</span> AI Insight
          <span className="dash-ai-sym">{selectedSymbol}</span>
        </div>
        {enabled === false ? <span className="dash-ai-off">assistant off</span> : null}
      </div>

      <div className="dash-ai-actions">
        {QUICK.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`dash-ai-chip ${active === item.key ? 'on' : ''}`}
            onClick={() => run(item)}
            disabled={loading || enabled === false}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="dash-ai-body">
        {loading ? (
          <div className="dash-ai-loading">Analysing {selectedSymbol}…</div>
        ) : text ? (
          <div className="dash-ai-text">{text}</div>
        ) : (
          <div className="dash-ai-hint">
            {enabled === false
              ? 'Enable the AI assistant on the server to get live insights here.'
              : `Pick an action above for an AI read on ${selectedSymbol} — or open the floating assistant to ask anything.`}
          </div>
        )}
      </div>
    </section>
  )
}

export default DashboardAiInsight
