import { cn } from '../../utils/formatters'

const toneClass = {
  sebi: 'f-sebi',
  case: 'f-case',
  audit: 'f-audit',
  pledge: 'f-pledge',
  down: 'f-down',
  bad: 'f-bad',
  ban: 'f-ban',
}

function Badge({ label, tone }) {
  return <span className={cn('flag', toneClass[tone] ?? '')}>{label}</span>
}

export default Badge
