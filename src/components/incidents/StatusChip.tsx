'use client'

import { STATUS_ZH, STATUS_ZH_COLOR } from '@/lib/incident-display'
import type { IncidentStatus } from '@/types'
import { useI18n } from '@/lib/i18n'

// Localized status pill for the incident header. Mirrors the timeline labels so
// the detail page follows the active app language end-to-end.
export default function StatusChip({ status }: { status: IncidentStatus }) {
  const { t } = useI18n()
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_ZH_COLOR[status]}`}>
      {t(`boardStatus.${status}`, STATUS_ZH[status])}
    </span>
  )
}
