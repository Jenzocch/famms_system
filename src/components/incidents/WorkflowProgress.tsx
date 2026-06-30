'use client'

import type { IncidentStatus } from '@/types'
import { useI18n } from '@/lib/i18n'
import { STATUS_ZH } from '@/lib/incident-display'

// Linear main-flow steps (waiting states branch off, not shown inline)
const MAIN_STEPS: IncidentStatus[] = [
  'reported', 'accepted', 'analyzing', 'repairing', 'testing', 'observation', 'closed',
]

const WAITING_STATES: IncidentStatus[] = [
  'waiting_parts', 'waiting_approval', 'waiting_vendor', 'waiting_shutdown',
]

export default function WorkflowProgress({ status }: { status: IncidentStatus }) {
  const { t } = useI18n()

  const isWaiting = WAITING_STATES.includes(status)
  const activeIndex = isWaiting ? -1 : MAIN_STEPS.indexOf(status)
  const isClosed = status === 'closed'

  const stepLabel = (s: IncidentStatus) => {
    const key = `boardStatus.${s}`
    return t(key, STATUS_ZH[s])
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <p className="text-xs font-medium text-gray-500 mb-3">流程進度</p>

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

      {/* Waiting state notice */}
      {isWaiting && (
        <div className="mt-3 flex items-center gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
          <span className="text-sm">⏸</span>
          <span>
            <span className="font-semibold">{stepLabel(status)}</span>
            {' '}— menunggu sebelum melanjutkan ke Perbaikan
          </span>
        </div>
      )}
    </div>
  )
}
