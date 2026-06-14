import { useEffect, useMemo, useRef, useState } from 'react'
import { EmptyTerminalState, SignalBadge, TerminalPanel, WorkspaceShell } from '../../components/terminal/TerminalPrimitives'
import useMarketStore from '../../store/useMarketStore'
import { formatCurrency, formatPercent, formatTime } from '../../utils/formatters'
import { buildMarketRows } from '../../utils/workstationSignals'

const starters = [
  'Show top NIFTY 50 gainers',
  'Alert me when RELIANCE crosses 2950',
  'What is the AI signal on HDFCBANK?',
  'Which stocks have unusual volume?',
]

const parseAlert = (text) => {
  const symbol = text.match(/\b[A-Z]{2,12}\b/)?.[0] ?? 'RELIANCE'
  const threshold = Number(text.match(/\d+(?:\.\d+)?/)?.[0] ?? 0)
  const direction = /below|under|falls|down/i.test(text) ? 'below' : 'above'
  return { symbol, threshold, direction }
}

function AICopilot() {
  const recognitionRef = useRef(null)
  const [messages, setMessages] = useState([
    {
      id: 'system',
      role: 'assistant',
      content: 'Terminal copilot online. I can summarize markets, explain signals, and draft real-time alert rules.',
      type: 'status',
    },
  ])
  const [input, setInput] = useState('')
  const [voiceState, setVoiceState] = useState('idle')
  const [voiceSupported] = useState(
    () =>
      typeof window !== 'undefined' &&
      Boolean(window.SpeechRecognition || window.webkitSpeechRecognition),
  )
  const addToast = useMarketStore((state) => state.addToast)
  const watchlistSymbols = useMarketStore((state) => state.watchlistSymbols)
  const prices = useMarketStore((state) => state.prices)
  const marketQuotes = useMarketStore((state) => state.marketQuotes)
  const feed = useMarketStore((state) => state.feed)
  const now = useMarketStore((state) => state.now)

  const rows = useMemo(
    () => buildMarketRows({ symbols: watchlistSymbols, prices, marketQuotes, feed, now }),
    [feed, marketQuotes, now, prices, watchlistSymbols],
  )
  const gainers = useMemo(() => [...rows].sort((a, b) => b.percent - a.percent).slice(0, 5), [rows])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognition) {
      return undefined
    }

    const recognition = new SpeechRecognition()
    recognition.lang = 'en-IN'
    recognition.interimResults = true
    recognition.continuous = false

    recognition.onstart = () => setVoiceState('listening')
    recognition.onerror = () => {
      setVoiceState('idle')
      addToast('Voice command was not captured. Please try again.', 'w', 3500)
    }
    recognition.onend = () => setVoiceState('idle')
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map((result) => result[0]?.transcript ?? '')
        .join(' ')
        .trim()

      if (transcript) {
        setInput(transcript)
      }
    }

    recognitionRef.current = recognition

    return () => {
      recognition.abort()
      recognitionRef.current = null
    }
  }, [addToast])

  const buildReply = (text) => {
    if (/alert|notify|tell me when/i.test(text)) {
      const alert = parseAlert(text.toUpperCase())
      const content = `Parsed alert: ${alert.symbol} price ${alert.direction} ${alert.threshold || 'your threshold'}. I would save this as a terminal alert rule and stream confirmations into the Alerts inbox.`
      addToast(`Drafted alert rule for ${alert.symbol}.`, 'h', 3500)
      return { content, type: 'alert', meta: alert }
    }

    if (/gainer|top|mover/i.test(text)) {
      return {
        type: 'market',
        content: `Top movers: ${gainers
          .map((row) => `${row.symbol} ${formatPercent(row.percent)}`)
          .join(', ')}. The tape is ${gainers[0]?.percent > 0 ? 'bid-led' : 'soft'} across the leading names.`,
      }
    }

    if (/signal|ai|ml|why/i.test(text)) {
      const row = rows.find((item) => text.toUpperCase().includes(item.symbol)) ?? rows[0]
      return {
        type: 'signal',
        content: `${row.symbol} signal is ${row.percent >= 0 ? 'constructive' : 'defensive'} with ${Math.min(96, Math.abs(row.percent) * 16 + 52).toFixed(0)}% confidence. Main drivers: price momentum ${formatPercent(row.percent)}, value traded ${row.valueCr.toFixed(1)}Cr, and venue spread ${formatCurrency(row.spread)}.`,
      }
    }

    return {
      type: 'answer',
      content: `Market snapshot at ${formatTime(now)}: ${gainers[0]?.symbol ?? 'NIFTY'} leads with ${formatPercent(gainers[0]?.percent ?? 0)}. Ask me to set alerts, explain a signal, or scan NSE/BSE arbitrage.`,
    }
  }

  const sendMessage = (text = input) => {
    const clean = text.trim()
    if (!clean) {
      return
    }

    const userMessage = { id: `${Date.now()}-u`, role: 'user', content: clean }
    const reply = { id: `${Date.now()}-a`, role: 'assistant', ...buildReply(clean) }
    setMessages((current) => [...current, userMessage, reply])
    setInput('')
  }

  const toggleVoice = () => {
    const recognition = recognitionRef.current
    if (!recognition) {
      addToast('Voice commands are not supported in this browser.', 'w', 3500)
      return
    }

    if (voiceState === 'listening') {
      recognition.stop()
      return
    }

    try {
      recognition.start()
    } catch {
      recognition.stop()
    }
  }

  return (
    <WorkspaceShell
      id="s-ai-copilot"
      eyebrow="Natural language terminal control"
      title="AI Copilot"
      subtitle="Ask market questions, draft alerts, explain signals and guide terminal workflows."
    >
      <div className="ix-chat-layout">
        <TerminalPanel title="Conversation" subtitle="Structured replies stay inside the trading workflow">
          <div className="ix-chat-stream">
            {messages.map((message) => (
              <div className={`ix-message ${message.role}`} key={message.id}>
                <div className="ix-message-meta">
                  <span>{message.role === 'user' ? 'You' : 'Copilot'}</span>
                  {message.type ? <SignalBadge tone={message.type === 'alert' ? 'warn' : 'accent'}>{message.type}</SignalBadge> : null}
                </div>
                <p>{message.content}</p>
              </div>
            ))}
          </div>
          <form
            className="ix-chat-input"
            onSubmit={(event) => {
              event.preventDefault()
              sendMessage()
            }}
          >
            <textarea value={input} onChange={(event) => setInput(event.target.value)} placeholder="Ask about markets, signals, alerts or a symbol..." />
            <button
              type="button"
              className={`ix-voice-btn ${voiceState === 'listening' ? 'listening' : ''}`}
              onClick={toggleVoice}
              disabled={!voiceSupported}
              title={voiceSupported ? 'Voice command' : 'Voice command is not supported in this browser'}
            >
              {voiceState === 'listening' ? 'Listening' : 'Voice'}
            </button>
            <button type="submit">Send</button>
          </form>
        </TerminalPanel>

        <TerminalPanel title="Shortcuts" subtitle="Fast commands for live market use">
          <div className="ix-command-list">
            {starters.map((starter) => (
              <button type="button" key={starter} onClick={() => sendMessage(starter)}>
                {starter}
              </button>
            ))}
          </div>
          <EmptyTerminalState title="Order guard" copy="Order commands should require explicit confirmation before any broker execution endpoint is called." />
        </TerminalPanel>
      </div>
    </WorkspaceShell>
  )
}

export default AICopilot
