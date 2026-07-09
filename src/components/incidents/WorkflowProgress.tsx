'use client'

import type { IncidentStatus, UserRole } from '@/types'
import { useI18n } from '@/lib/i18n'
import { STATUS_ZH } from '@/lib/incident-display'
import { PERMISSIONS } from '@/lib/permissions'

// Linear main-flow steps (waiting states branch off, not shown inline)
const MAIN_STEPS: IncidentStatus[] = [
  'reported', 'accepted', 'analyzing', 'repairing', 'testing', 'observation', 'closed',
]

const WAITING_STATES: IncidentStatus[] = [
  'waiting_parts', 'waiting_approval', 'waiting_vendor', 'waiting_shutdown',
]

// Combined "where is this case / what happens next" card: the 7-step bar plus
// ONE actionable hint line directly under it (previously a separate
// NextStepHint card duplicated this as a second "now → next" block — merged
// here so there's a single source of "what do I do next" on the page).
export default function WorkflowProgress({ status, userRole }: { status: IncidentStatus; userRole?: UserRole }) {
  const { t } = useI18n()

  const isWaiting = WAITING_STATES.includes(status)
  const activeIndex = isWaiting ? -1 : MAIN_STEPS.indexOf(status)
  const isClosed = status === 'closed'

  // An observation-period case is the supervisor's cue to review and close —
  // role-aware hint, same logic the old NextStepHint banner used.
  const canClose = userRole ? PERMISSIONS.closeIncident(userRole) : false
  const awaitingClose = status === 'observation' && canClose

  // Use workflowStep labels so the 7 linear steps stay distinct — the board
  // deliberately collapses analyzing/repairing to one "In Progress" label, but
  // in a step-by-step progress bar two identical steps look like a bug.
  const stepLabel = (s: IncidentStatus) => t(`workflowStep.${s}`, STATUS_ZH[s])

  const hintIcon = isClosed ? '✅' : awaitingClose ? '⏰' : isWaiting ? '⏸' : '👉'
  const hintBoxClass = isClosed
    ? 'bg-green-50 border-green-200 text-green-800'
    : awaitingClose || isWaiting
    ? 'bg-amber-50 border-amber-200 text-amber-800'
    : 'bg-blue-50 border-blue-200 text-blue-800'
  const hintLabel = awaitingClose ? t('nextStep.awaitClose') : t('nextStepLabel', '下一步')
  const hintText = awaitingClose ? t('nextStep.awaitCloseNote') : t(`nextStep.${status}`)

  // Clickable hint → scroll to + briefly highlight the section this hint is
  // actually about. 'reported' needs an owner assigned first (section-assign);
  // every other open status (including awaitingClose — observation+supervisor
  // — since closing happens via ProgressUpdate's own close flow, there's no
  // separate close section on this page) is about logging progress
  // (section-update). Closed has nothing left to jump to.
  const targetId = isClosed ? null : status === 'reported' ? 'section-assign' : 'section-update'

  function handleHintClick() {
    if (!targetId) return
    const el = document.getElementById(targetId)
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    el.classList.add('ring-2', 'ring-blue-400')
    setTimeout(() => el.classList.remove('ring-2', 'ring-blue-400'), 1500)
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <p className="text-xs font-medium text-gray-500 mb-3">{t('workflowStep.heading', '流程進度')}</p>

      {/* Main flow steps */}
      <div className="flex items-center gap-0">
        {MAIN_STEPS.map((step, i) => {
          const isDone = isClosed
            ? true
            : !isWaiting && i < activeIndex
          const isActive = !isWaiting && i === activeIndex
          const isFuture = isWaiting ? step !== 'reported' : i > activeIndex

          return (
            <div key={step} className="flex items-center flex-1 min-w-0">
              {/* Circle */}
              <div className="flex flex-col items-center flex-shrink-0">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-colors ${
                  isDone && !isActive
                    ? 'bg-green-500 border-green-500 text-white'
                    : isActive
                    ? 'bg-blue-600 border-blue-600 text-white ring-2 ring-blue-200'
                    : 'bg-white border-gray-300 text-gray-400'
                }`}>
                  {isDone && !isActive ? '✓' : i + 1}
                </div>
                <span className={`text-center mt-1 leading-tight ${
                  isActive ? 'text-blue-700 font-semibold' :
                  isDone && !isActive ? 'text-green-700' :
                  'text-gray-400'
                }`} style={{ fontSize: '9px', maxWidth: '48px' }}>
                  {stepLabel(step)}
                </span>
              </div>

              {/* Connector line (not after last step) */}
              {i < MAIN_STEPS.length - 1 && (
                <div className={`flex-1 h-0.5 mx-0.5 mb-4 ${
                  isDone && !isActive ? 'bg-green-400' : 'bg-gray-200'
                }`} />
              )}
            </div>
          )
        })}
      </div>

      {/* Single "what to do next" hint line — role-aware (supervisor sees the
          awaiting-close cue on an observation case), suppressed to nothing
          extra beyond this line since the bar above already shows position.
          Clickable (scrolls to + briefly highlights the relevant section)
          whenever there's an actual target; plain/non-interactive otherwise. */}
      <div
        onClick={targetId ? handleHintClick : undefined}
        role={targetId ? 'button' : undefined}
        tabIndex={targetId ? 0 : undefined}
        onKeyDown={targetId ? (e) => { if (e.key === 'Enter' || e.key === ' ') handleHintClick() } : undefined}
        className={`mt-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${hintBoxClass} ${targetId ? 'cursor-pointer hover:brightness-95' : ''}`}
      >
        <span className="shrink-0">{hintIcon}</span>
        <span>
          <span className="font-semibold">{hintLabel}：</span>
          {hintText}
        </span>
      </div>
    </div>
  )
}
