import { useEffect, useRef, useState } from 'react'
import useMarketStore from '../../store/useMarketStore'
import { fetchAiStatus, sendAiChat } from '../../utils/terminalApi'

const SUGGESTIONS = [
  'How did this stock move today?',
  'Reliance ka aaj ka high low kya tha?',
  'Any recent news affecting this stock?',
  'Alert lagao agar NIFTY 50 me koi 3% gire',
]

function AssistantFab() {
  const screen = useMarketStore((state) => state.screen)
  const selectedSymbol = useMarketStore((state) => state.selectedSymbol)
  const selectedDateMain = useMarketStore((state) => state.calendar?.selectedDateMain)
  const selectedDateDetail = useMarketStore((state) => state.calendar?.selectedDateDetail)

  const [open, setOpen] = useState(false)
  const [enabled, setEnabled] = useState(null) // null = unknown
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [listening, setListening] = useState(false)
  const [speakReplies, setSpeakReplies] = useState(false)
  const [voiceLang, setVoiceLang] = useState('en-IN')
  const [pos, setPos] = useState(null) // {x,y} once opened/moved
  const [size, setSize] = useState({ w: 400, h: 560 })
  const scrollRef = useRef(null)
  const recognitionRef = useRef(null)
  const dragRef = useRef(null)

  const voiceSupported =
    typeof window !== 'undefined' && Boolean(window.SpeechRecognition || window.webkitSpeechRecognition)
  const ttsSupported = typeof window !== 'undefined' && 'speechSynthesis' in window

  // Place the panel bottom-right on first open (then it can be dragged/resized).
  useEffect(() => {
    if (open && !pos && typeof window !== 'undefined') {
      setPos({
        x: Math.max(12, window.innerWidth - size.w - 22),
        y: Math.max(12, window.innerHeight - size.h - 86),
      })
    }
  }, [open, pos, size.w, size.h])

  const clamp = (v, min, max) => Math.min(Math.max(v, min), max)

  const startDrag = (e) => {
    if (e.button !== 0) return
    e.preventDefault()
    const start = { mx: e.clientX, my: e.clientY, x: pos?.x ?? 0, y: pos?.y ?? 0 }
    dragRef.current = 'drag'
    const onMove = (ev) => {
      setPos({
        x: clamp(start.x + (ev.clientX - start.mx), 0, window.innerWidth - 80),
        y: clamp(start.y + (ev.clientY - start.my), 0, window.innerHeight - 40),
      })
    }
    const onUp = () => {
      dragRef.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const startResize = (e) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const start = { mx: e.clientX, my: e.clientY, w: size.w, h: size.h }
    const onMove = (ev) => {
      setSize({
        w: clamp(start.w + (ev.clientX - start.mx), 320, window.innerWidth - 40),
        h: clamp(start.h + (ev.clientY - start.my), 360, window.innerHeight - 40),
      })
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  useEffect(() => {
    fetchAiStatus()
      .then((res) => setEnabled(Boolean(res?.enabled)))
      .catch(() => setEnabled(false))
  }, [])

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, loading, open])

  const context = {
    screen,
    symbol: selectedSymbol,
    date: selectedDateDetail || selectedDateMain || null,
  }

  // Strip markdown so the reply reads cleanly aloud (tables/bold/etc.).
  const speak = (text) => {
    if (!ttsSupported || !text) return
    const clean = text
      .replace(/\|/g, ' ')
      .replace(/[*_#`>-]/g, ' ')
      .replace(/₹/g, ' rupees ')
      .replace(/\s+/g, ' ')
      .trim()
    window.speechSynthesis.cancel()
    const utter = new SpeechSynthesisUtterance(clean)
    utter.lang = voiceLang
    utter.rate = 1.02
    window.speechSynthesis.speak(utter)
  }

  const send = async (text) => {
    const message = (text ?? input).trim()
    if (!message || loading) return
    setInput('')
    const nextMessages = [...messages, { role: 'user', content: message }]
    setMessages(nextMessages)
    setLoading(true)
    try {
      const res = await sendAiChat({
        message,
        context,
        history: messages.slice(-6),
      })
      setMessages([
        ...nextMessages,
        { role: 'assistant', content: res.reply, tools: res.tools_used ?? [] },
      ])
      if (speakReplies) speak(res.reply)
    } catch (err) {
      setMessages([
        ...nextMessages,
        { role: 'assistant', content: `⚠️ ${err.message}`, error: true },
      ])
    } finally {
      setLoading(false)
    }
  }

  const toggleListening = () => {
    if (!voiceSupported) return
    if (listening) {
      recognitionRef.current?.stop()
      return
    }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    const recognition = new SR()
    recognition.lang = voiceLang
    recognition.interimResults = true
    recognition.continuous = false
    recognition.onstart = () => setListening(true)
    recognition.onerror = () => setListening(false)
    recognition.onend = () => setListening(false)
    recognition.onresult = (event) => {
      let transcript = ''
      for (let i = 0; i < event.results.length; i += 1) {
        transcript += event.results[i][0].transcript
      }
      setInput(transcript)
      if (event.results[event.results.length - 1].isFinal) {
        recognition.stop()
        void send(transcript)
      }
    }
    recognitionRef.current = recognition
    recognition.start()
  }

  return (
    <>
      <button
        type="button"
        className={`assistant-fab ${open ? 'open' : ''}`}
        onClick={() => setOpen((v) => !v)}
        title="Ask the Derton assistant"
        aria-label="Open assistant"
      >
        {open ? (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        ) : (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            <path d="M8 10h8M8 13h5" />
          </svg>
        )}
      </button>

      {open ? (
        <section
          className="assistant-panel"
          aria-label="Assistant"
          style={
            pos
              ? { left: pos.x, top: pos.y, right: 'auto', bottom: 'auto', width: size.w, height: size.h }
              : { width: size.w, height: size.h }
          }
        >
          <header className="assistant-head" onMouseDown={startDrag}>
            <div>
              <strong>Derton Assistant</strong>
              <span>
                {selectedSymbol}
                {context.date ? ` · ${context.date}` : ''}
              </span>
            </div>
            <div className="assistant-head-actions" onMouseDown={(e) => e.stopPropagation()}>
              <button
                type="button"
                className={`assistant-lang ${voiceLang === 'hi-IN' ? 'hi' : ''}`}
                onClick={() => setVoiceLang((l) => (l === 'en-IN' ? 'hi-IN' : 'en-IN'))}
                title="Voice language"
              >
                {voiceLang === 'hi-IN' ? 'हिं' : 'EN'}
              </button>
              {ttsSupported ? (
                <button
                  type="button"
                  className={`assistant-icon-btn ${speakReplies ? 'on' : ''}`}
                  onClick={() => {
                    if (speakReplies) window.speechSynthesis.cancel()
                    setSpeakReplies((v) => !v)
                  }}
                  title={speakReplies ? 'Mute spoken replies' : 'Speak replies aloud'}
                  aria-label="Toggle spoken replies"
                >
                  {speakReplies ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M11 5 6 9H2v6h4l5 4z" />
                      <path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a9 9 0 0 1 0 14" />
                    </svg>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M11 5 6 9H2v6h4l5 4z" />
                      <path d="m23 9-6 6M17 9l6 6" />
                    </svg>
                  )}
                </button>
              ) : null}
              <button type="button" className="assistant-close" onClick={() => setOpen(false)} aria-label="Close">
                ✕
              </button>
            </div>
          </header>

          <div className="assistant-body" ref={scrollRef}>
            {enabled === false ? (
              <div className="assistant-disabled">
                The assistant isn’t configured on the server yet. Set <code>AI_ENABLED</code>,{' '}
                <code>BEDROCK_MODEL_ID</code> and AWS credentials to enable it.
              </div>
            ) : null}

            {!messages.length && enabled !== false ? (
              <div className="assistant-welcome">
                <p>Ask anything about the markets — I can pull live candles, minute-by-minute history and search the web for news.</p>
                <div className="assistant-suggestions">
                  {SUGGESTIONS.map((s) => (
                    <button key={s} type="button" onClick={() => send(s)} disabled={loading}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {messages.map((m, i) => (
              <div key={i} className={`assistant-msg ${m.role} ${m.error ? 'error' : ''}`}>
                <div className="assistant-msg-body">{m.content}</div>
                {m.tools?.length ? (
                  <div className="assistant-tools">{m.tools.map((t) => `· ${t}`).join(' ')}</div>
                ) : null}
              </div>
            ))}

            {loading ? <div className="assistant-msg assistant typing">Thinking…</div> : null}
          </div>

          <form
            className="assistant-input"
            onSubmit={(e) => {
              e.preventDefault()
              void send()
            }}
          >
            {voiceSupported ? (
              <button
                type="button"
                className={`assistant-mic ${listening ? 'listening' : ''}`}
                onClick={toggleListening}
                disabled={enabled === false}
                title={listening ? 'Stop listening' : `Speak (${voiceLang === 'hi-IN' ? 'Hindi' : 'English'})`}
                aria-label="Voice input"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="2" width="6" height="11" rx="3" />
                  <path d="M5 10a7 7 0 0 0 14 0M12 17v4" />
                </svg>
              </button>
            ) : null}
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={
                enabled === false
                  ? 'Assistant disabled'
                  : listening
                    ? 'Listening…'
                    : 'Ask in English or Hindi…'
              }
              disabled={loading || enabled === false}
            />
            <button type="submit" disabled={loading || enabled === false || !input.trim()}>
              Send
            </button>
          </form>

          <div className="assistant-resize" onMouseDown={startResize} title="Drag to resize" />
        </section>
      ) : null}
    </>
  )
}

export default AssistantFab
