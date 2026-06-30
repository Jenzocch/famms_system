'use client'

import { IncidentStatus, INCIDENT_STATUS_LABELS, INCIDENT_STATUS_COLORS, MACHINE_STATUS_LABELS, MACHINE_STATUS_COLORS, Machine } from '@/types'
import { cn } from '@/lib/utils'
import { useI18n } from '@/lib/i18n'

interface Props {
  status: IncidentStatus | Machine['status']
  type?: 'incident' | 'machine'
}

export default function StatusBadge({ status, type = 'incident' }: Props) {
  const { t } = useI18n()
  let label = ''
  let color = ''

  if (type === 'machine') {
    // i18n with the static label as a fallback (covers any unknown status).
    label = t(`machineStatus.${status}`, MACHINE_STATUS_LABELS[status as Machine['status']])
    color = MACHINE_STATUS_COLORS[status as Machine['status']]
  } else {
    label = t(`boardStatus.${status}`, INCIDENT_STATUS_LABELS[status as IncidentStatus])
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
