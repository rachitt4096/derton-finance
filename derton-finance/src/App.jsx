import { useEffect, useState } from 'react'
import TerminalApp from './components/app/TerminalApp'
import LoginPage from './pages/LoginPage'
import { getApiUrl } from './utils/backend'

function App() {
  const [session, setSession] = useState(null)
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    fetch(getApiUrl('/api/auth/session'), { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.user) {
          setSession({ userId: data.user.username, role: data.user.role })
        }
      })
      .catch(() => {})
      .finally(() => setChecking(false))
  }, [])

  const handleLogin = (sessionData) => setSession(sessionData)

  const handleLogout = async () => {
    try {
      await fetch(getApiUrl('/api/auth/logout'), {
        method: 'POST',
        credentials: 'include',
      })
    } catch {
      // ignore
    }
    setSession(null)
  }

  if (checking) return null

  if (!session) {
    return <LoginPage onSuccess={handleLogin} />
  }

  return <TerminalApp session={session} onLogout={handleLogout} />
}

export default App
