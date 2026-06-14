import { useEffect, useRef, useState } from 'react'
import { backendEnabled, getApiUrl } from '../utils/backend'
import { getNseMarketWindowState } from '../utils/marketSession'

const USER_ROLES = {
  SACHINSHAH: 'admin',
}

const FALLBACK_SYSTEM_STATUS = {
  backend: { label: 'Backend', tone: 'warn', value: 'Requires config' },
  database: { label: 'Database', tone: 'warn', value: 'Unknown' },
  broker: { label: 'Broker Feed', tone: 'warn', value: 'Unknown' },
}

function getMarketSessionLabel(date) {
  const state = getNseMarketWindowState(date)
  if (state.label === 'Live') {
    return 'Market Session Live'
  }

  if (state.label === 'Pre Open') {
    return 'Pre-Open Preparation'
  }

  return 'Post-Market Review'
}

function LoginPage({ onSuccess }) {
  const canvasRef = useRef(null)
  const timersRef = useRef([])

  const [userId, setUserId] = useState('')
  const [password, setPassword] = useState('')
  const [passwordVisible, setPasswordVisible] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [successOpen, setSuccessOpen] = useState(false)
  const [successUserId, setSuccessUserId] = useState('USER')
  const [successRole, setSuccessRole] = useState('WORKSPACE')
  const [clock, setClock] = useState(new Date())
  const [systemStatus, setSystemStatus] = useState(FALLBACK_SYSTEM_STATUS)

  const marketSessionLabel = getMarketSessionLabel(clock)
  const loginReady = Boolean(userId.trim() && password.trim() && !loading && backendEnabled)
  const dateLabel = new Intl.DateTimeFormat('en-IN', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  }).format(clock)
  const timeLabel = clock.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
  const backendTone = systemStatus.backend.tone
  const backendBadgeLabel =
    backendTone === 'live' ? 'System online' : backendTone === 'down' ? 'Backend unavailable' : 'Backend required'
  const panelNote =
    backendTone === 'live'
      ? `System live ${timeLabel} IST`
      : backendTone === 'down'
        ? 'Backend unreachable. Start the server to enable sign-in.'
        : 'Configure VITE_BACKEND_URL to enable server sign-in.'

  const toLoginErrorMessage = (loginError) => {
    if (!(loginError instanceof Error)) {
      return 'Unable to sign in right now.'
    }

    const message = loginError.message.trim()
    if (/networkerror|failed to fetch|load failed/i.test(message)) {
      const currentOrigin = typeof window !== 'undefined' ? window.location.origin : 'frontend origin'
      return `Cannot reach backend at ${getApiUrl('/api/auth/login')}. Ensure backend + DB are running and APP_ORIGIN allows ${currentOrigin}.`
    }

    return message || 'Unable to sign in right now.'
  }

  const schedule = (fn, delayMs) => {
    const timer = window.setTimeout(fn, delayMs)
    timersRef.current.push(timer)
  }

  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!backendEnabled) {
      setSystemStatus(FALLBACK_SYSTEM_STATUS)
      return undefined
    }

    let isMounted = true

    const readHealth = async () => {
      try {
        const [healthResponse, brokerResponse] = await Promise.all([
          fetch(getApiUrl('/api/health')),
          fetch(getApiUrl('/api/broker/status')),
        ])

        const healthPayload = healthResponse.ok ? await healthResponse.json() : null
        const brokerPayload = brokerResponse.ok ? await brokerResponse.json() : null

        if (!isMounted) {
          return
        }

        const backendHealthy = Boolean(healthResponse.ok && healthPayload?.ok)
        const dbUp = healthPayload?.db === 'up'
        const brokerStatusValue = String(brokerPayload?.status ?? healthPayload?.broker?.status ?? 'offline')
        const brokerOnline = ['live', 'connecting', 'idle'].includes(brokerStatusValue)

        setSystemStatus({
          backend: {
            label: 'Backend',
            tone: backendHealthy ? 'live' : 'down',
            value: backendHealthy ? 'Online' : 'Unavailable',
          },
          database: {
            label: 'Database',
            tone: dbUp ? 'live' : 'down',
            value: dbUp ? 'Connected' : 'Issue detected',
          },
          broker: {
            label: 'Broker Feed',
            tone: brokerOnline ? 'live' : 'warn',
            value: brokerStatusValue.replace(/_/g, ' '),
          },
        })
      } catch {
        if (!isMounted) {
          return
        }

        setSystemStatus({
          backend: { label: 'Backend', tone: 'down', value: 'Unavailable' },
          database: { label: 'Database', tone: 'warn', value: 'Unknown' },
          broker: { label: 'Broker Feed', tone: 'warn', value: 'Offline' },
        })
      }
    }

    void readHealth()
    const interval = window.setInterval(() => {
      void readHealth()
    }, 20_000)

    return () => {
      isMounted = false
      window.clearInterval(interval)
    }
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) {
      return undefined
    }

    const context = canvas.getContext('2d')
    if (!context) {
      return undefined
    }

    let width = 0
    let height = 0
    let animationFrame = 0
    const points = []

    const createPoints = () => {
      points.length = 0
      const count = Math.max(24, Math.min(56, Math.round((width * height) / 52000)))
      for (let index = 0; index < count; index += 1) {
        const isGreen = Math.random() > 0.7
        points.push({
          x: Math.random() * width,
          y: Math.random() * height,
          vx: (Math.random() - 0.5) * 0.18,
          vy: (Math.random() - 0.5) * 0.18,
          r: Math.random() * 1.5 + 0.3,
          a: Math.random() * 0.18 + 0.04,
          c: isGreen ? '94, 234, 168' : '104, 196, 255',
        })
      }
    }

    const resize = () => {
      width = canvas.width = window.innerWidth
      height = canvas.height = window.innerHeight
      createPoints()
    }

    const draw = () => {
      context.clearRect(0, 0, width, height)

      points.forEach((point) => {
        point.x += point.vx
        point.y += point.vy

        if (point.x < 0 || point.x > width) {
          point.vx *= -1
        }

        if (point.y < 0 || point.y > height) {
          point.vy *= -1
        }

        context.beginPath()
        context.arc(point.x, point.y, point.r, 0, Math.PI * 2)
        context.fillStyle = `rgba(${point.c}, ${point.a})`
        context.fill()
      })

      animationFrame = window.requestAnimationFrame(draw)
    }

    resize()
    draw()
    window.addEventListener('resize', resize)

    return () => {
      window.cancelAnimationFrame(animationFrame)
      window.removeEventListener('resize', resize)
    }
  }, [])

  useEffect(
    () => () => {
      timersRef.current.forEach((timer) => window.clearTimeout(timer))
      timersRef.current = []
    },
    [],
  )

  const runLogin = async () => {
    const activeUserId = userId.trim().toUpperCase()
    const activePassword = password.trim()

    if (!activeUserId) {
      setError('Please enter your User ID.')
      return
    }

    if (!activePassword) {
      setError('Please enter your password.')
      return
    }

    setError('')
    setLoading(true)

    if (!backendEnabled) {
      setLoading(false)
      setError('Backend is not configured. Set VITE_BACKEND_URL and sign in with a server account.')
      return
    }

    try {
      const response = await fetch(getApiUrl('/api/auth/login'), {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          identifier: activeUserId,
          password: activePassword,
        }),
      })

      const payload = await response.json().catch(() => null)
      if (!response.ok || !payload?.user) {
        throw new Error(payload?.error ?? 'Invalid credentials')
      }

      const resolvedUserId = payload.user.username ?? activeUserId
      const resolvedRole = payload.user.role ?? USER_ROLES[activeUserId] ?? 'analyst'

      setLoading(false)
      setSuccessUserId(resolvedUserId)
      setSuccessRole(String(resolvedRole).toUpperCase())
      setSuccessOpen(true)

      schedule(
        () =>
          onSuccess({
            userId: resolvedUserId,
            role: resolvedRole,
          }),
        900,
      )
    } catch (loginError) {
      setLoading(false)
      setError(toLoginErrorMessage(loginError))
    }
  }

  return (
    <div className="lv2-root">
      <canvas id="bg" ref={canvasRef} />
      <div className="lv2-atm-grid" />
      <div className="lv2-atm-vignette" />
      <div className="lv2-orb lv2-orb-a" />
      <div className="lv2-orb lv2-orb-b" />

      <div className={`lv2-sov ${successOpen ? 'show' : ''}`}>
        <div className="lv2-sring">
          <div className="lv2-spulse" />
          <div className="lv2-sinner">
            <div className="lv2-scheck">OK</div>
          </div>
        </div>
        <div className="lv2-stitle">ACCESS GRANTED</div>
        <div className="lv2-ssub">Launching workspace</div>
        <div className="lv2-suser">
          <div className="lv2-sav">{successUserId.charAt(0)}</div>
          <div>
            <div className="lv2-snm">{successUserId}</div>
            <div className="lv2-srl">{successRole}</div>
          </div>
        </div>
        <div className="lv2-sprog">
          <div className="lv2-sprogf" />
        </div>
      </div>

      <div className="lv2-shell">
        <section className="lv2-brand">
          <div className="lv2-brand-mark">
            <div className="lv2-mark-badge">DF</div>
            <div className="lv2-mark-copy">
              <div className="lv2-brand-name">Derton Finance</div>
              <div className="lv2-brand-sub">Analysis Terminal</div>
            </div>
          </div>

          <div className="lv2-brand-copy">
            <div className="lv2-brand-kicker">{marketSessionLabel}</div>
            <h1 className="lv2-brand-title">Market workspace, simplified.</h1>
            <p className="lv2-brand-desc">Live charts, watchlists, and portfolio context with a cleaner entry point.</p>
          </div>

          <div className="lv2-brand-meta">
            <div className="lv2-meta-chip">{dateLabel}</div>
            <div className={`lv2-meta-chip is-${backendTone}`}>
              {backendBadgeLabel}
            </div>
          </div>

          <div className="lv2-status-stack">
            {Object.values(systemStatus).map((item) => (
              <div key={item.label} className="lv2-status-row">
                <div className="lv2-status-copy">
                  <span className="lv2-status-label">{item.label}</span>
                  <span className={`lv2-status-dot is-${item.tone}`} />
                </div>
                <div className={`lv2-status-value is-${item.tone}`}>{item.value}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="lv2-panel">
          <div className="lv2-panel-head">
            <div className="lv2-panel-kicker">Sign In</div>
            <h2 className="lv2-panel-title">Access your workspace</h2>
            <p className="lv2-panel-sub">Use your server credentials to continue.</p>
          </div>

          <form
            className="lv2-form"
            onSubmit={(event) => {
              event.preventDefault()
              runLogin()
            }}
          >
            <div className="lv2-ff">
              <label className="lv2-fl" htmlFor="uid">
                User ID
              </label>
              <div className="lv2-fw">
                <input
                  type="text"
                  id="uid"
                  placeholder="Enter user ID"
                  autoComplete="username"
                  spellCheck={false}
                  value={userId}
                  onChange={(event) => setUserId(event.target.value.toUpperCase())}
                />
                <div className="lv2-fw-line" />
              </div>
            </div>

            <div className="lv2-ff">
              <label className="lv2-fl" htmlFor="pwd">
                Password
              </label>
              <div className="lv2-fw">
                <input
                  type={passwordVisible ? 'text' : 'password'}
                  id="pwd"
                  placeholder="Enter password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
                <div className="lv2-fw-line" />
                <button className="lv2-eye" onClick={() => setPasswordVisible((current) => !current)} type="button">
                  {passwordVisible ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>

            <div className={`lv2-err ${error ? 'show' : ''}`}>
              <span>!</span>
              <span>{error || 'Invalid credentials. Please try again.'}</span>
            </div>

            <button className={`lv2-loginbtn ${loading ? 'loading' : ''}`} id="loginBtn" type="submit" disabled={!loginReady}>
              <span className="lv2-btn-txt">Continue</span>
              <div className="lv2-btn-load">
                <div className="lv2-spin" />
              </div>
            </button>
          </form>

          <div className="lv2-panel-note">
            {panelNote}
          </div>
        </section>
      </div>
    </div>
  )
}

export default LoginPage
