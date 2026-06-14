function LoadingPanel({
  title = 'Loading workspace',
  subtitle = 'Preparing terminal modules...',
  compact = false,
}) {
  return (
    <div className={`loading-panel ${compact ? 'compact' : ''}`}>
      <div className="loading-panel-orb" />
      <div className="loading-panel-copy">
        <div className="loading-panel-title">{title}</div>
        <div className="loading-panel-subtitle">{subtitle}</div>
      </div>
    </div>
  )
}

export default LoadingPanel
