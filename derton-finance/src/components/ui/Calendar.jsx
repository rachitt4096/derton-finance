import { useMemo, useState } from 'react'
import Modal from './Modal'

const DAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
const formatIsoDate = (date) => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function Calendar({ open, onClose, onPick }) {
  const [monthCursor, setMonthCursor] = useState(new Date())

  const { monthLabel, cells } = useMemo(() => {
    const today = new Date()
    const year = monthCursor.getFullYear()
    const month = monthCursor.getMonth()
    const firstDayIndex = new Date(year, month, 1).getDay()
    const monthDays = new Date(year, month + 1, 0).getDate()
    const lowerBound = new Date(today)
    lowerBound.setMonth(lowerBound.getMonth() - 3)

    const generated = []
    for (let index = 0; index < firstDayIndex; index += 1) {
      generated.push({ empty: true, key: `empty-${index}` })
    }

    for (let day = 1; day <= monthDays; day += 1) {
      const date = new Date(year, month, day)
      const isWeekend = date.getDay() === 0 || date.getDay() === 6
      const allowed = date <= today && date >= lowerBound && !isWeekend
      const isToday = date.toDateString() === today.toDateString()
      generated.push({
        key: `day-${day}`,
        day,
        date,
        allowed,
        isToday,
      })
    }

    return {
      monthLabel: monthCursor.toLocaleDateString('en-IN', {
        month: 'long',
        year: 'numeric',
      }),
      cells: generated,
    }
  }, [monthCursor])

  return (
    <Modal open={open} onClose={onClose} className="cal-modal">
      <div className="cal-h">Select Date - Last 3 Months</div>
      <div className="cal-nav">
        <button type="button" onClick={() => setMonthCursor(new Date(monthCursor.getFullYear(), monthCursor.getMonth() - 1, 1))}>
          {'<'}
        </button>
        <span className="cal-month-lbl">{monthLabel}</span>
        <button type="button" onClick={() => setMonthCursor(new Date(monthCursor.getFullYear(), monthCursor.getMonth() + 1, 1))}>
          {'>'}
        </button>
      </div>

      <div className="cal-grid">
        {DAY_LABELS.map((label) => (
          <div className="cal-dh" key={label}>
            {label}
          </div>
        ))}

        {cells.map((cell) => {
          if (cell.empty) {
            return (
              <div className="cal-d empty" key={cell.key}>
                .
              </div>
            )
          }

          return (
            <button
              key={cell.key}
              type="button"
              className={`cal-d ${cell.isToday ? 'today' : ''} ${cell.allowed ? '' : 'empty'}`}
              disabled={!cell.allowed}
              onClick={() => {
                onPick(formatIsoDate(cell.date))
                onClose()
              }}
            >
              {cell.day}
            </button>
          )
        })}
      </div>

      <button type="button" className="cal-close" onClick={onClose}>
        Close
      </button>
    </Modal>
  )
}

export default Calendar
