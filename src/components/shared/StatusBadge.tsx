import { IncidentStatus, INCIDENT_STATUS_LABELS, INCIDENT_STATUS_COLORS, MACHINE_STATUS_LABELS, MACHINE_STATUS_COLORS, Machine } from '@/types'
import { cn } from '@/lib/utils'

interface Props {
  status: IncidentStatus | Machine['status']
  type?: 'incident' | 'machine'
}

export default function StatusBadge({ status, type = 'incident' }: Props) {
  let label = ''
  let color = ''

  if (type === 'machine') {
    label = MACHINE_STATUS_LABELS[status as Machine['status']]
    color = MACHINE_STATUS_COLORS[status as Machine['status']]
  } else {
    label = INCIDENT_STATUS_LABELS[status as IncidentStatus]
    color = INCIDENT_STATUS_COLORS[status as IncidentStatus]
  }

  return (
    <span
      className={cn(
        'inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold',
        color
      )}
    >
      {label}
    </span>
  )
}
