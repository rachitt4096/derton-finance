import { cn } from '../../utils/formatters'

export function WorkspaceShell({ id, eyebrow, title, subtitle, actions, children, className = '' }) {
  return (
    <section id={id} className={cn('screen screen-col ix-workspace', className)}>
      <header className="ix-page-head">
        <div>
          {eyebrow ? <div className="ix-eyebrow">{eyebrow}</div> : null}
          <h1>{title}</h1>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        {actions ? <div className="ix-head-actions">{actions}</div> : null}
      </header>
      {children}
    </section>
  )
}

export function TerminalPanel({ title, subtitle, meta, children, className = '' }) {
  return (
    <article className={cn('ix-panel', className)}>
      {(title || subtitle || meta) ? (
        <div className="ix-panel-head">
          <div>
            {title ? <h2>{title}</h2> : null}
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          {meta ? <div className="ix-panel-meta">{meta}</div> : null}
        </div>
      ) : null}
      {children}
    </article>
  )
}

export function MetricTile({ label, value, subvalue, tone = 'neutral' }) {
  return (
    <div className={cn('ix-metric', `tone-${tone}`)}>
      <span>{label}</span>
      <strong>{value}</strong>
      {subvalue ? <small>{subvalue}</small> : null}
    </div>
  )
}

export function SignalBadge({ children, tone = 'neutral' }) {
  return <span className={cn('ix-badge', `tone-${tone}`)}>{children}</span>
}

export function ConfidenceBar({ value = 0, tone = 'accent', label }) {
  const width = Math.max(0, Math.min(100, Number(value) || 0))
  return (
    <div className="ix-confidence">
      {label ? (
        <div className="ix-confidence-top">
          <span>{label}</span>
          <strong>{width.toFixed(0)}%</strong>
        </div>
      ) : null}
      <div className="ix-confidence-track">
        <span className={cn('ix-confidence-fill', `tone-${tone}`)} style={{ width: `${width}%` }} />
      </div>
    </div>
  )
}

export function EmptyTerminalState({ title, copy }) {
  return (
    <div className="ix-empty">
      <strong>{title}</strong>
      <span>{copy}</span>
    </div>
  )
}
