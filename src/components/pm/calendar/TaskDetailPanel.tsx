'use client'

import { useState } from 'react'
import { X, CheckCircle, SkipForward, Loader2, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { toast } from 'sonner'
import { useI18n } from '@/lib/i18n'
import {
  PM_TYPE_LABELS, PM_TYPE_KEYS, STATUS_DOT, STATUS_BADGE, STATUS_KEYS, STATUS_LABELS,
  isActionable, type PMTask, type PMTaskAction,
} from './types'

export interface TaskActionPayload {
  findings: string
  cost: string
  reason: string
  checks: boolean[]
}

// Detail panel for the selected calendar day: task list + inline
// complete/skip forms. Owns its own in-progress action state; the actual
// network call (and reload) lives in the parent, which we call via
// onSubmitAction and report back whether it succeeded.
export default function TaskDetailPanel({
  selectedDate, tasks, onClose, onSubmitAction,
}: {
  selectedDate: string
  tasks: PMTask[]
  onClose: () => void
  onSubmitAction: (task: PMTask, mode: 'complete' | 'skip', payload: TaskActionPayload) => Promise<boolean>
}) {
  const { t } = useI18n()
  const [action, setAction] = useState<PMTaskAction | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const typeLabel = (task: PMTask): string => {
    if (task.ad_hoc) return t('pm.adhocLabel')
    const key = PM_TYPE_KEYS[task.pm_type || '']
    return key ? t(key, PM_TYPE_LABELS[task.pm_type || ''] || task.pm_type || '') : (task.pm_type || '')
  }
  const statusLabel = (status: string) =>
    t(STATUS_KEYS[status] ?? '', STATUS_LABELS[status] || status)

  async function submit() {
    if (!action) return
    if (action.mode === 'skip' && !action.reason.trim()) {
      toast.error(t('pm.skipReasonRequired2'))
      return
    }
    setSubmitting(true)
    try {
      const ok = await onSubmitAction(action.task, action.mode, {
        findings: action.findings, cost: action.cost, reason: action.reason, checks: action.checks,
      })
      if (ok) setAction(null)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="bg-white rounded-xl border border-blue-200 shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 bg-blue-50 border-b border-blue-100">
        <h4 className="font-semibold text-sm text-blue-900">{selectedDate}</h4>
        <button onClick={() => { onClose(); setAction(null) }} aria-label="Close" className="text-blue-400 hover:text-blue-600 p-1 -m-1">
          <X className="w-4 h-4" />
        </button>
      </div>
      {tasks.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-5">{t('pm.noPlanToday')}</p>
      ) : (
        <div className="divide-y divide-gray-100">
          {tasks.map(task => {
            const acting = action?.taskId === task.record_id ? action : null
            return (
              <div key={task.record_id} className="px-4 py-3">
                <div className="flex items-start gap-3">
                  <div className={`mt-1.5 w-2.5 h-2.5 rounded-full shrink-0 ${STATUS_DOT[task.status] || 'bg-gray-400'}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-semibold text-sm text-gray-800 truncate">
                        {task.machine_code ? `[${task.machine_code}] ` : ''}{task.machine_name}
                      </span>
                      <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 shrink-0">
                        {typeLabel(task)}
                      </span>
                      <span className={`text-xs px-1.5 py-0.5 rounded font-medium shrink-0 ${STATUS_BADGE[task.status] || 'bg-gray-100 text-gray-600'}`}>
                        {statusLabel(task.status)}
                      </span>
                    </div>
                    {task.description && (
                      <p className="text-xs text-gray-500 mt-1 line-clamp-2">{task.description}</p>
                    )}
                    {task.assigned_to && (
                      <p className="text-xs text-blue-600 mt-0.5 flex items-center gap-1">
                        <Users className="w-3 h-3 shrink-0" /> {task.assigned_to}
                      </p>
                    )}
                    {task.completed_at && (
                      <p className="text-xs text-green-600 mt-0.5">✓ {task.completed_at.slice(0, 10)}</p>
                    )}
                    {task.delay_reason && (
                      <p className="text-xs text-orange-600 mt-0.5">{task.delay_reason}</p>
                    )}

                    {/* Action buttons for real, not-yet-done tasks — this is the
                        primary thing a technician taps here, so it gets a large,
                        near-full-width target on mobile and reverts to compact
                        inline buttons from `sm:` up. */}
                    {isActionable(task) && !acting && (
                      <div className="flex flex-col sm:flex-row gap-2 mt-3 sm:mt-2">
                        <Button
                          size="lg"
                          className="h-11 sm:h-7 w-full sm:w-auto gap-1.5 bg-green-600 hover:bg-green-700 text-sm sm:text-xs"
                          onClick={() => setAction({ taskId: task.record_id, task, mode: 'complete', findings: '', cost: '', reason: '', checks: (task.checklist ?? []).map(() => false) })}
                        >
                          <CheckCircle className="w-4 h-4 sm:w-3.5 sm:h-3.5" /> {t('pm.complete')}
                        </Button>
                        <Button
                          size="lg"
                          variant="outline"
                          className="h-11 sm:h-7 w-full sm:w-auto gap-1.5 border-orange-300 text-orange-600 hover:bg-orange-50 text-sm sm:text-xs"
                          onClick={() => setAction({ taskId: task.record_id, task, mode: 'skip', findings: '', cost: '', reason: '', checks: [] })}
                        >
                          <SkipForward className="w-4 h-4 sm:w-3.5 sm:h-3.5" /> {t('pm.skip')}
                        </Button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Inline complete form */}
                {acting?.mode === 'complete' && (
                  <div className="mt-3 ml-5 space-y-2 bg-green-50 rounded-lg p-3 border border-green-200">
                    {(acting.task.checklist ?? []).length > 0 && (
                      <div className="space-y-1.5">
                        <p className="text-xs font-medium text-green-900">{t('pm.checklistHeading', '檢查清單 Checklist')}</p>
                        {(acting.task.checklist ?? []).map((item, i) => (
                          <label key={i} className="flex items-start gap-2.5 text-sm text-gray-700 bg-white active:bg-gray-50 rounded-lg border border-green-100 px-3 py-2.5 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={acting.checks[i] ?? false}
                              onChange={e => {
                                const checks = [...acting.checks]
                                checks[i] = e.target.checked
                                setAction({ ...acting, checks })
                              }}
                              className="mt-0.5 w-5 h-5 accent-green-600 shrink-0"
                            />
                            <span className={acting.checks[i] ? 'line-through text-gray-400' : ''}>{item}</span>
                          </label>
                        ))}
                      </div>
                    )}
                    <Textarea
                      value={acting.findings}
                      onChange={e => setAction({ ...acting, findings: e.target.value })}
                      placeholder={t('pm.findingsPlaceholder')}
                      rows={2}
                      className="text-sm"
                    />
                    <Input
                      type="number"
                      value={acting.cost}
                      onChange={e => setAction({ ...acting, cost: e.target.value })}
                      placeholder={t('pm.costPlaceholder')}
                      className="text-sm"
                    />
                    <div className="flex flex-col sm:flex-row gap-2">
                      <Button size="lg" className="h-11 sm:h-7 w-full sm:w-auto bg-green-600 hover:bg-green-700 text-sm sm:text-xs" onClick={submit} disabled={submitting}>
                        {submitting && <Loader2 className="w-4 h-4 sm:w-3.5 sm:h-3.5 mr-1 animate-spin" />}
                        {t('pm.confirmComplete2')}
                      </Button>
                      <Button size="lg" variant="outline" className="h-11 sm:h-7 w-full sm:w-auto text-sm sm:text-xs" onClick={() => setAction(null)}>{t('pm.cancelBtn')}</Button>
                    </div>
                  </div>
                )}

                {/* Inline skip form */}
                {acting?.mode === 'skip' && (
                  <div className="mt-3 ml-5 space-y-2 bg-orange-50 rounded-lg p-3 border border-orange-200">
                    <Textarea
                      value={acting.reason}
                      onChange={e => setAction({ ...acting, reason: e.target.value })}
                      placeholder={t('pm.skipReasonPlaceholder')}
                      rows={2}
                      className="text-sm"
                    />
                    <div className="flex flex-col sm:flex-row gap-2">
                      <Button size="lg" variant="outline" className="h-11 sm:h-7 w-full sm:w-auto border-orange-400 text-orange-700 hover:bg-orange-100 text-sm sm:text-xs" onClick={submit} disabled={submitting || !acting.reason.trim()}>
                        {submitting && <Loader2 className="w-4 h-4 sm:w-3.5 sm:h-3.5 mr-1 animate-spin" />}
                        {t('pm.confirmSkip2')}
                      </Button>
                      <Button size="lg" variant="outline" className="h-11 sm:h-7 w-full sm:w-auto text-sm sm:text-xs" onClick={() => setAction(null)}>{t('pm.cancelBtn')}</Button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
