'use client'

import { ArrowRight, Clock } from 'lucide-react'
import type { IncidentStatus, UserRole } from '@/types'
import { useI18n } from '@/lib/i18n'
import { PERMISSIONS } from '@/lib/permissions'
import { STATUS_ZH, STATUS_ZH_COLOR } from '@/lib/incident-display'
import { isTerminalStatus, nextStatusOf, nextHintKey } from '@/lib/incident-next-step'

// Small colored status pill, matching the chips used across the board / header.
function StatusPill({ status }: { status: IncidentStatus }) {
  const { t } = useI18n()
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_ZH_COLOR[status]}`}>
      {t(`boardStatus.${status}`, STATUS_ZH[status])}
    </span>
  )
}

/**
 * "Now → Next" guidance for a case's current status.
 *
 * - `banner` (default): a two-row card (現在 / 接下來) for the detail page.
 * - `inline`: a compact "current → next" line for dense board cards.
 *
 * Role-aware close handoff: an observation-period case is the supervisor's cue
 * to review and close. For someone who can close (supervisor+) it shows a
 * highlighted "awaiting your close" prompt; for everyone else it stays the
 * normal "→ closed (supervisor confirms)" hint. Closed cases show a green
 * "done / create KB" variant (banner only).
 */
export default function NextStepHint({
  status,
  variant = 'banner',
  userRole,
}: {
  status: IncidentStatus
  variant?: 'banner' | 'inline'
  userRole?: UserRole
}) {
  const { t } = useI18n()
  const done = isTerminalStatus(status)
  const next = nextStatusOf(status)
  const canClose = userRole ? PERMISSIONS.closeIncident(userRole) : false
  // An observation case is waiting for a supervisor to review and close.
  const awaitingClose = status === 'observation' && canClose

  // ---- Inline (board / dashboard card) ----
  if (variant === 'inline') {
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

  // Closed / terminal cases render nothing here — the detail page shows the
  // ClosedBanner (closure + KB suggestion) instead, so there's no banner to draw.
  if (done || !next) return null

  // ---- Banner: awaiting your close (supervisor on an observation case) ----
  if (awaitingClose) {
    return (
      <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 flex items-start gap-2.5">
        <Clock className="w-5 h-5 shrink-0 mt-0.5 text-amber-600" />
        <div>
          <p className="text-xs font-semibold text-amber-700">{t('nextStep.awaitClose')}</p>
          <p className="text-sm mt-0.5 text-amber-900">{t('nextStep.awaitCloseNote')}</p>
        </div>
      </div>
    )
  }

  // ---- Banner: now → next ----
  return (
    <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 space-y-1.5">
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-500 w-14 shrink-0">{t('nextStep.now')}</span>
        <StatusPill status={status} />
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-medium text-blue-700 w-14 shrink-0">{t('nextStep.next')}</span>
        <StatusPill status={next} />
        <span className="text-xs text-gray-600">（{t(nextHintKey(status))}）</span>
      </div>
    </div>
  )
}
