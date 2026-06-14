import { MetricTile, TerminalPanel, WorkspaceShell } from '../../components/terminal/TerminalPrimitives'
import useMarketStore from '../../store/useMarketStore'
import useThemeStore from '../../store/useThemeStore'

function Settings() {
  const theme = useThemeStore((state) => state.theme)
  const setTheme = useThemeStore((state) => state.setTheme)
  const feed = useMarketStore((state) => state.feed)
  const watchlistSymbols = useMarketStore((state) => state.watchlistSymbols)

  return (
    <WorkspaceShell
      id="s-settings"
      eyebrow="Terminal preferences"
      title="Settings"
      subtitle="Control density, theme, feed visibility, alert behavior and future backend modules."
    >
      <div className="ix-kpi-row">
        <MetricTile label="Feed Source" value={feed.source ?? '--'} subvalue={feed.status ?? 'idle'} />
        <MetricTile label="Watchlist" value={watchlistSymbols.length} subvalue="active symbols" />
        <MetricTile label="Theme" value={theme} />
        <MetricTile label="Storage Target" value="ClickHouse + Postgres" subvalue="ticks + relational" />
      </div>

      <div className="ix-settings-grid">
        <TerminalPanel title="Appearance">
          <div className="ix-setting-row">
            <span>Theme</span>
            <div className="ix-segment">
              {['dark', 'light'].map((item) => (
                <button type="button" key={item} className={theme === item ? 'on' : ''} onClick={() => setTheme(item)}>
                  {item}
                </button>
              ))}
            </div>
          </div>
          <div className="ix-setting-row">
            <span>Terminal density</span>
            <strong>Compact institutional</strong>
          </div>
          <div className="ix-setting-row">
            <span>Motion</span>
            <strong>Subtle state transitions only</strong>
          </div>
        </TerminalPanel>

        <TerminalPanel title="Data Pipeline">
          <div className="ix-driver-list">
            <div><span>Tick storage</span><b>ClickHouse</b></div>
            <div><span>Alerts/users/chat</span><b>Postgres</b></div>
            <div><span>Hot rules/cache</span><b>Redis-ready</b></div>
            <div><span>Ingestion</span><b>Upstox WS</b></div>
          </div>
        </TerminalPanel>

        <TerminalPanel title="Alerts">
          <div className="ix-driver-list">
            <div><span>Terminal banner</span><b>Enabled</b></div>
            <div><span>Chat push</span><b>Enabled</b></div>
            <div><span>Telegram</span><b>Excluded</b></div>
            <div><span>Confirmation guard</span><b>Required for orders</b></div>
          </div>
        </TerminalPanel>
      </div>
    </WorkspaceShell>
  )
}

export default Settings
