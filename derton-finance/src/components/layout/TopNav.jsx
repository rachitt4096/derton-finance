import { useMemo } from 'react'
import { getTopScreenOptions } from '../../constants/navigation'
import useMarketStore from '../../store/useMarketStore'

function TopNav({ session }) {
  const screen = useMarketStore((state) => state.screen)
  const setScreen = useMarketStore((state) => state.setScreen)

  const items = useMemo(() => getTopScreenOptions(session?.role), [session?.role])

  return (
    <nav className="terminal-top-nav" aria-label="Primary workspaces">
      <div className="top-nav-tabs">
        {items.map((item) => (
          <button
            type="button"
            key={item.key}
            className={`top-nav-tab ${screen === item.key ? 'active' : ''}`}
            onClick={() => setScreen(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>
    </nav>
  )
}

export default TopNav
