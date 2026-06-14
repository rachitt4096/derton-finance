import { useEffect, useMemo, useState } from 'react'
import {
  createAdminUser,
  fetchAdminOverview,
  fetchAdminUsers,
  resetAdminUserPassword,
  revokeAdminUserSessions,
  updateAdminUser,
} from '../utils/terminalApi'
import { formatDateShort } from '../utils/formatters'
import useMarketStore from '../store/useMarketStore'

const ADMIN_REFRESH_MS = 30000

const emptyForm = {
  displayName: '',
  username: '',
  password: '',
  role: 'analyst',
}

const formatDateTime = (value) => {
  if (!value) {
    return '--'
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return '--'
  }

  return `${formatDateShort(date)} ${date.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })}`
}

function AdminTerminal({ session }) {
  const addToast = useMarketStore((state) => state.addToast)
  const [overview, setOverview] = useState(null)
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState(emptyForm)
  const [creating, setCreating] = useState(false)
  const [actingUserId, setActingUserId] = useState('')
  const [passwordDrafts, setPasswordDrafts] = useState({})

  useEffect(() => {
    let isMounted = true

    const load = async ({ silent = false } = {}) => {
      if (!session?.role || session.role !== 'admin') {
        return
      }

      if (!silent) {
        setLoading(true)
      } else if (isMounted) {
        setRefreshing(true)
      }

      setError('')

      try {
        const [nextOverview, nextUsers] = await Promise.all([fetchAdminOverview(), fetchAdminUsers()])

        if (!isMounted) {
          return
        }

        setOverview(nextOverview)
        setUsers(nextUsers)
      } catch (nextError) {
        if (isMounted) {
          setError(nextError instanceof Error ? nextError.message : 'Unable to load admin console.')
        }
      } finally {
        if (isMounted) {
          setLoading(false)
          setRefreshing(false)
        }
      }
    }

    const refresh = () => {
      void load({ silent: true })
    }

    void load()
    const intervalId = window.setInterval(refresh, ADMIN_REFRESH_MS)

    return () => {
      isMounted = false
      window.clearInterval(intervalId)
    }
  }, [session?.role])

  const onlineUsers = useMemo(() => users.filter((user) => user.activeSessionCount > 0), [users])
  const sortedUsers = useMemo(
    () =>
      [...users].sort((left, right) => {
        const leftOnline = left.activeSessionCount > 0 ? 1 : 0
        const rightOnline = right.activeSessionCount > 0 ? 1 : 0

        if (leftOnline !== rightOnline) {
          return rightOnline - leftOnline
        }

        const leftTime = left.lastSessionAt ? new Date(left.lastSessionAt).getTime() : 0
        const rightTime = right.lastSessionAt ? new Date(right.lastSessionAt).getTime() : 0
        return rightTime - leftTime
      }),
    [users],
  )

  const overviewCards = useMemo(
    () => [
      {
        id: 'online',
        label: 'Online Users',
        value: onlineUsers.length,
        sub: `${overview?.sessions?.active ?? 0} live session${(overview?.sessions?.active ?? 0) === 1 ? '' : 's'}`,
      },
      {
        id: 'users',
        label: 'Total Users',
        value: overview?.users?.total ?? users.length,
        sub: `${overview?.users?.active ?? 0} active accounts`,
      },
      {
        id: 'admins',
        label: 'Owner / Admin',
        value: overview?.users?.admins ?? 0,
        sub: 'Protected owner access',
      },
      {
        id: 'history',
        label: 'Market Retention',
        value: overview?.marketRetentionDays ?? '--',
        sub: 'days of stored history',
      },
    ],
    [onlineUsers.length, overview, users.length],
  )

  const handleRefresh = async () => {
    setRefreshing(true)
    setError('')

    try {
      const [nextOverview, nextUsers] = await Promise.all([fetchAdminOverview(), fetchAdminUsers()])
      setOverview(nextOverview)
      setUsers(nextUsers)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Unable to refresh admin console.')
    } finally {
      setRefreshing(false)
    }
  }

  const handleCreateUser = async (event) => {
    event.preventDefault()

    if (creating) {
      return
    }

    setCreating(true)
    setError('')

    try {
      await createAdminUser({
        username: form.username.trim(),
        password: form.password,
        role: form.role,
        ...(form.displayName.trim() ? { displayName: form.displayName.trim() } : {}),
      })

      setForm(emptyForm)
      addToast('User created successfully.', 'h', 3500)
      await handleRefresh()
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Unable to create user.')
    } finally {
      setCreating(false)
    }
  }

  const handleToggleActive = async (user) => {
    if (actingUserId) {
      return
    }

    setActingUserId(user.id)
    setError('')

    try {
      await updateAdminUser(user.id, { isActive: !user.isActive })
      addToast(user.isActive ? 'User access disabled.' : 'User access restored.', 'h', 3500)
      await handleRefresh()
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Unable to update user.')
    } finally {
      setActingUserId('')
    }
  }

  const handleResetPassword = async (user) => {
    const nextPassword = passwordDrafts[user.id]?.trim() ?? ''
    if (!nextPassword || actingUserId) {
      return
    }

    setActingUserId(user.id)
    setError('')

    try {
      await resetAdminUserPassword(user.id, nextPassword)
      setPasswordDrafts((current) => ({
        ...current,
        [user.id]: '',
      }))
      addToast(`Password reset for ${user.username}.`, 'h', 3500)
      await handleRefresh()
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Unable to reset password.')
    } finally {
      setActingUserId('')
    }
  }

  const handleRevokeSessions = async (user) => {
    if (actingUserId) {
      return
    }

    setActingUserId(user.id)
    setError('')

    try {
      await revokeAdminUserSessions(user.id)
      addToast(`Logged out active sessions for ${user.username}.`, 'h', 3500)
      await handleRefresh()
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Unable to revoke sessions.')
    } finally {
      setActingUserId('')
    }
  }

  if (session?.role !== 'admin') {
    return (
      <section id="s7" className="screen screen-col admin-screen">
        <div className="admin-empty-state">
          <div className="admin-empty-title">Owner Access Only</div>
          <div className="admin-empty-copy">This terminal page is only available to the owner account.</div>
        </div>
      </section>
    )
  }

  return (
    <section id="s7" className="screen screen-col admin-screen">
      <div className="admin-top">
        <div>
          <div className="admin-title">Owner Console</div>
          <div className="admin-subtitle">
            See who is online, who logged in recently, and create user credentials from one terminal page.
          </div>
        </div>

        <button type="button" className="admin-refresh-btn" onClick={() => void handleRefresh()} disabled={refreshing}>
          {refreshing ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      <div className="admin-card-grid">
        {overviewCards.map((card) => (
          <article className="admin-card" key={card.id}>
            <div className="admin-card-label">{card.label}</div>
            <div className="admin-card-value">{card.value}</div>
            <div className="admin-card-sub">{card.sub}</div>
          </article>
        ))}
      </div>

      <div className="admin-body">
        <div className="admin-main">
          <section className="admin-panel">
            <div className="admin-panel-head">
              <div>
                <div className="admin-panel-title">Online / Logged In Users</div>
                <div className="admin-panel-subtitle">
                  Green rows are online now. Last login shows the latest recorded session start.
                </div>
              </div>
            </div>

            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Status</th>
                    <th>User</th>
                    <th>Role</th>
                    <th>Email</th>
                    <th>Created</th>
                    <th>Last Login</th>
                    <th>Sessions</th>
                    <th>Password</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan="9">Loading owner console...</td>
                    </tr>
                  ) : sortedUsers.length ? (
                    sortedUsers.map((user) => {
                      const isOnline = user.activeSessionCount > 0
                      const isBusy = actingUserId === user.id

                      return (
                        <tr key={user.id} className={isOnline ? 'is-online' : ''}>
                          <td>
                            <span className={`admin-status ${isOnline ? 'online' : user.isActive ? 'offline' : 'disabled'}`}>
                              {isOnline ? 'Online' : user.isActive ? 'Offline' : 'Disabled'}
                            </span>
                          </td>
                          <td>
                            <div className="admin-user-cell">
                              <strong>{user.username}</strong>
                              <span>{user.displayName || '--'}</span>
                            </div>
                          </td>
                          <td>{user.role}</td>
                          <td>{user.email}</td>
                          <td>{formatDateTime(user.createdAt)}</td>
                          <td>{formatDateTime(user.lastSessionAt)}</td>
                          <td>{user.activeSessionCount}</td>
                          <td>
                            <input
                              type="text"
                              className="admin-inline-input"
                              placeholder="New password"
                              value={passwordDrafts[user.id] ?? ''}
                              onChange={(event) =>
                                setPasswordDrafts((current) => ({
                                  ...current,
                                  [user.id]: event.target.value,
                                }))
                              }
                            />
                          </td>
                          <td>
                            <div className="admin-row-actions">
                              <button type="button" className="admin-action-btn" disabled={isBusy} onClick={() => void handleResetPassword(user)}>
                                {isBusy ? 'Saving...' : 'Reset'}
                              </button>
                              <button type="button" className="admin-action-btn" disabled={isBusy} onClick={() => void handleRevokeSessions(user)}>
                                Logout
                              </button>
                              <button
                                type="button"
                                className={`admin-action-btn ${user.isActive ? 'warn' : 'ok'}`}
                                disabled={isBusy}
                                onClick={() => void handleToggleActive(user)}
                              >
                                {user.isActive ? 'Disable' : 'Enable'}
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    })
                  ) : (
                    <tr>
                      <td colSpan="9">No users found.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <aside className="admin-side">
          <section className="admin-panel admin-create-panel">
            <div className="admin-panel-head">
              <div>
                <div className="admin-panel-title">Create User</div>
                <div className="admin-panel-subtitle">Owner can issue login IDs and passwords from here.</div>
              </div>
            </div>

            <form className="admin-form" onSubmit={handleCreateUser}>
              <label className="admin-field">
                <span>Display Name</span>
                <input
                  type="text"
                  value={form.displayName}
                  onChange={(event) => setForm((current) => ({ ...current, displayName: event.target.value }))}
                  placeholder="Optional display name"
                />
              </label>

              <label className="admin-field">
                <span>User ID</span>
                <input
                  type="text"
                  value={form.username}
                  onChange={(event) => setForm((current) => ({ ...current, username: event.target.value.toUpperCase() }))}
                  placeholder="Example: ANALYST02"
                  required
                />
              </label>

              <label className="admin-field">
                <span>Password</span>
                <input
                  type="text"
                  value={form.password}
                  onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
                  placeholder="Minimum 8 characters"
                  required
                />
              </label>

              <div className="admin-field-note">Email is generated automatically from the User ID.</div>

              <label className="admin-field">
                <span>Access</span>
                <select value={form.role} onChange={(event) => setForm((current) => ({ ...current, role: event.target.value }))}>
                  <option value="analyst">Analyst</option>
                  <option value="admin">Admin / Owner</option>
                </select>
              </label>

              <div className="admin-form-actions">
                <button type="submit" className="admin-submit-btn" disabled={creating}>
                  {creating ? 'Creating...' : 'Create User'}
                </button>
              </div>
            </form>
          </section>

          <section className="admin-panel admin-snapshot-panel">
            <div className="admin-panel-head">
              <div>
                <div className="admin-panel-title">Live Snapshot</div>
                <div className="admin-panel-subtitle">Quick visibility for the owner.</div>
              </div>
            </div>

            <div className="admin-mini-list">
              <div className="admin-mini-row">
                <span>Online Users</span>
                <strong>{onlineUsers.length}</strong>
              </div>
              <div className="admin-mini-row">
                <span>Active Sessions</span>
                <strong>{overview?.sessions?.active ?? '--'}</strong>
              </div>
              <div className="admin-mini-row">
                <span>Broker</span>
                <strong>{String(overview?.broker?.status ?? '--').toUpperCase()}</strong>
              </div>
              <div className="admin-mini-row">
                <span>Last Tick</span>
                <strong>{overview?.broker?.lastTickAt ? formatDateTime(overview.broker.lastTickAt) : '--'}</strong>
              </div>
            </div>
          </section>

          {error ? <div className="admin-error">{error}</div> : null}
        </aside>
      </div>
    </section>
  )
}

export default AdminTerminal
