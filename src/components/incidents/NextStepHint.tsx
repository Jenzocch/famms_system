'use client'

import { ArrowRight, Clock } from 'lucide-react'
import type { IncidentStatus, UserRole } from '@/types'
import { useI18n } from '@/lib/i18n'
import { PERMISSIONS } from '@/lib/permissions'
import { STATUS_ZH } from '@/lib/incident-display'
import { isTerminalStatus, nextStatusOf } from '@/lib/incident-next-step'

/**
 * Compact "current → next" hint for dense board / dashboard cards.
 *
 * The incident detail page no longer uses this — its role-aware "what do I do
 * next" guidance is merged into WorkflowProgress's card instead (see
 * WorkflowProgress.tsx), which avoided two cards repeating the same guidance.
 *
 * Role-aware close handoff: an observation-period case is the supervisor's cue
 * to review and close, so for someone who can close (supervisor+) this shows
 * a highlighted "awaiting your close" prompt instead of the normal arrow hint.
 */
export default function NextStepHint({
  status,
  userRole,
}: {
  status: IncidentStatus
  userRole?: UserRole
}) {
  const { t } = useI18n()
  const done = isTerminalStatus(status)
  const next = nextStatusOf(status)
  const canClose = userRole ? PERMISSIONS.closeIncident(userRole) : false
  // An observation case is waiting for a supervisor to review and close.
  const awaitingClose = status === 'observation' && canClose

  if (done || !next) return null
  if (awaitingClose) {
    return (
      <p className="flex items-center gap-1 text-xs font-medium text-amber-700">
        <Clock className="w-3.5 h-3.5 shrink-0" />
        {t('nextStep.awaitClose')}
      </p>
    )
  }
  return (
    <p className="flex items-center gap-1 text-xs text-gray-500">
      {t(`boardStatus.${status}`, STATUS_ZH[status])}
      <ArrowRight className="w-3 h-3 shrink-0 text-blue-500" />
      <span className="font-medium text-gray-700">
        {t(`boardStatus.${next}`, STATUS_ZH[next])}
      </span>
    </p>
  )
}
