import { formatCurrency, formatShortTime } from '../../utils/formatters'

function Tooltip({ point, position }) {
  if (!point || !position) {
    return null
  }

  const change = point.c - point.o
  const changePct = point.o ? (change / point.o) * 100 : 0

  return (
    <div className="tooltip" style={{ display: 'block', left: position.x, top: position.y }}>
      <div className="tt-head">{formatShortTime(point.t)}</div>
      <div className="tt-row">
        <span className="tt-l">OPEN</span>
        <span className="tt-v">{formatCurrency(point.o)}</span>
      </div>
      <div className="tt-row">
        <span className="tt-l">HIGH</span>
        <span className="tt-v up">{formatCurrency(point.h)}</span>
      </div>
      <div className="tt-row">
        <span className="tt-l">LOW</span>
        <span className="tt-v dn">{formatCurrency(point.l)}</span>
      </div>
      <div className="tt-row">
        <span className="tt-l">CLOSE</span>
        <span className="tt-v">{formatCurrency(point.c)}</span>
      </div>
      <div className="tt-row">
        <span className="tt-l">VOL</span>
        <span className="tt-v">{point.v.toLocaleString('en-IN')}</span>
      </div>
      <div className="tt-row">
        <span className="tt-l">CHG</span>
        <span className={`tt-v ${change >= 0 ? 'up' : 'dn'}`}>
          {`${change >= 0 ? '+' : '-'}${formatCurrency(Math.abs(change))} (${changePct >= 0 ? '+' : '-'}${Math.abs(
            changePct,
          ).toFixed(2)}%)`}
        </span>
      </div>
    </div>
  )
}

export default Tooltip
