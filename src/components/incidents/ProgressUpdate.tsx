'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { usePhotoCapture } from '@/lib/hooks/usePhotoCapture'
import SpeechMicButton from '@/components/shared/SpeechMicButton'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { toast } from 'sonner'
import { Loader2, Camera, Images, X, ZoomIn } from 'lucide-react'
import type { IncidentStatus, UserRole } from '@/types'
import { STATUS_ZH } from '@/lib/incident-display'
import { PERMISSIONS } from '@/lib/permissions'
import { logAuditEvent } from '@/lib/audit'
import { useI18n } from '@/lib/i18n'

// Statuses a maintenance person can move an incident to (simplified set).
// All four waiting-states must be here so a blocked case can be unblocked.
const SELECTABLE: IncidentStatus[] = [
  'accepted', 'analyzing',
  'waiting_parts', 'waiting_approval', 'waiting_vendor', 'waiting_shutdown',
  'repairing', 'testing', 'observation', 'closed',
]

// Linear forward order of the main workflow. A case may only move to its
// current status or a status further along this line — never backwards.
const MAIN_ORDER: IncidentStatus[] = [
  'reported', 'accepted', 'analyzing', 'repairing', 'testing', 'observation', 'closed',
]

// "Waiting" side-states are temporary blocks reachable any time before close.
const WAITING_STATES: IncidentStatus[] = [
  'waiting_parts', 'waiting_approval', 'waiting_vendor', 'waiting_shutdown',
]

// Compute which statuses the form may offer given the case's current status.
// Forward-only on the main line; waiting states stay open until the case is
// closed; always intersected with SELECTABLE (the form's allowed targets).
function allowedStatuses(currentStatus: IncidentStatus, allowRollback: boolean = false): IncidentStatus[] {
  if (allowRollback) {
    // Rollback allowed: show all selectable statuses except 'reported'
    return SELECTABLE.filter(s => s !== 'reported')
  }

  // A "waiting" side-state isn't on the main line, so resume it at 處理中
  // (analyzing) — otherwise a case parked in e.g. waiting_parts could never
  // move forward without ticking rollback, contradicting the next-step hint.
  const effectiveStatus = WAITING_STATES.includes(currentStatus) ? 'analyzing' : currentStatus
  const currentIndex = MAIN_ORDER.indexOf(effectiveStatus)
  return SELECTABLE.filter(s => {
    if (WAITING_STATES.includes(s)) return currentStatus !== 'closed'
    const index = MAIN_ORDER.indexOf(s)
    return index >= 0 && currentIndex >= 0 && index >= currentIndex
  })
}

export default function ProgressUpdate({
  incidentId, currentStatus, userRole = 'technician', userName, estimatedCompletionDate, hasMachine = false,
}: {
  incidentId: string
  currentStatus: IncidentStatus
  userRole?: UserRole
  userName?: string | null
  estimatedCompletionDate?: string | null
  // Whether this incident is attached to a machine — drives the food-safety
  // hygiene sign-off at close (maintenance work on equipment is itself a
  // contamination risk; facility/electrical incidents with no machine_id
  // never touch food product, so they skip it).
  hasMachine?: boolean
}) {
  const router = useRouter()
  const supabase = createClient()
  const { t } = useI18n()
  const statusLabel = (s: IncidentStatus) => t(`boardStatus.${s}`, STATUS_ZH[s])
  const canClose = PERMISSIONS.closeIncident(userRole)

  const [newStatus, setNewStatus] = useState<string>(currentStatus)
  const [note, setNote] = useState('')
  // The assignee's own ETA ("I expect to finish by…"), reported upward. NOT
  // due_date — that's the supervisor-set deadline the SLA measures against,
  // which technicians deliberately cannot move.
  const [eta, setEta] = useState(estimatedCompletionDate || '')
  const [updaterName, setUpdaterName] = useState(userName ?? '')
  const { photos, photoPreviews, compressing, addPhotos, removePhoto, resetPhotos } = usePhotoCapture(5)
  const [allowRollback, setAllowRollback] = useState(false)
  const [completionType, setCompletionType] = useState<'temporary_fix' | 'permanent_fix' | ''>('')
  // Post-maintenance hygiene sign-off (food-safety) — required to close a
  // MACHINE incident. All three must be ticked before the close can proceed.
  const [hygieneTools, setHygieneTools] = useState(false)
  const [hygieneLubricant, setHygieneLubricant] = useState(false)
  const [hygieneCleanArea, setHygieneCleanArea] = useState(false)
  const hygieneConfirmed = hygieneTools && hygieneLubricant && hygieneCleanArea
  // Optional close-time costs — the cheapest possible cost tracking: two
  // numbers at the moment the work is freshest in memory.
  const [laborCost, setLaborCost] = useState('')
  const [partsCost, setPartsCost] = useState('')
  // Save the fix into the knowledge base so the next technician can find it.
  const [saveToKb, setSaveToKb] = useState(true)
  const [repairMethod, setRepairMethod] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Status options based on rollback setting. Only supervisors+ may move a case to "closed".
  const availableStatuses = allowedStatuses(currentStatus, allowRollback)
  const base = canClose ? availableStatuses : availableStatuses.filter(s => s !== 'closed')
  // Always include the current status as a (selected, no-op) option. Some
  // statuses aren't forward targets in SELECTABLE (e.g. 'reported', or the
  // waiting_vendor/approval/shutdown side-states), so without this the Select's
  // default value would not match any item and render blank.
  const selectableStatuses = base.includes(currentStatus) ? base : [currentStatus, ...base]

  async function submit() {
    const statusChanged = newStatus !== currentStatus
    const etaChanged = eta !== (estimatedCompletionDate || '')
    if (!note.trim() && !statusChanged && !etaChanged) {
      toast.error(t('progressUpdate.needStatusOrNote'))
      return
    }
    if (newStatus === 'closed' && !canClose) {
      toast.error(t('progressUpdate.onlySupervisorClose'))
      return
    }
    if (newStatus === 'closed' && !completionType) {
      toast.error(t('progressUpdate.completionRequired', '結案前請選擇修復類型（臨時 / 永久）'))
      return
    }
    if (newStatus === 'closed' && hasMachine && !hygieneConfirmed) {
      toast.error(t('progressUpdate.hygieneRequired', '請完成復產衛生確認的三項勾選'))
      return
    }
    setSubmitting(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()

      // Upload photos
      const paths: string[] = []
      for (const photo of photos) {
        const ext = photo.name.split('.').pop()
        const path = `${incidentId}/updates/${Date.now()}-${paths.length}.${ext}`
        const { error: upErr } = await supabase.storage.from('incident-photos').upload(path, photo)
        if (!upErr) paths.push(path)
      }

      // Closing goes through the close API so the RCA gate is enforced and
      // closed_at / closed_by_id are stamped server-side.
      if (newStatus === 'closed') {
        const res = await fetch(`/api/incidents/${incidentId}/close`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            root_cause: note || undefined,
            completion_type: completionType || undefined,
            labor_cost: laborCost ? parseFloat(laborCost) : undefined,
            parts_cost: partsCost ? parseFloat(partsCost) : undefined,
            save_to_kb: saveToKb,
            repair_method: repairMethod || undefined,
            // Only sent when actually confirmed — the server independently
            // re-checks this for machine incidents, so this is not the only
            // gate, just the client-side UX for it.
            hygiene_confirmed: hasMachine && hygieneConfirmed ? true : undefined,
          }),
        })
        const json = await res.json().catch(() => ({}))
        if (!res.ok) {
          if (json?.rca_required) {
            throw new Error(t('progressUpdate.rcaRequired').replace('{count}', String(json.occurrence_count ?? '≥3')))
          }
          throw new Error(json?.error || t('progressUpdate.closeFailed'))
        }
      }

      // Log the update row (timeline)
      const { error: logErr } = await supabase.from('incident_updates').insert({
        incident_id: incidentId,
        new_status: statusChanged ? newStatus : null,
        note: note || null,
        updated_by: updaterName || null,
        updated_by_id: user?.id ?? null,
        photos: paths.length > 0 ? JSON.stringify(paths) : null,
      })
      if (logErr) throw logErr

      // Update incident status (+ stamp accepted_at) and/or the assignee's
      // ETA. For 'closed' the close API already updated status/closed_at
      // above, so skip the status part there.
      if ((statusChanged && newStatus !== 'closed') || etaChanged) {
        const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
        if (statusChanged && newStatus !== 'closed') {
          patch.status = newStatus
          if (currentStatus === 'reported' && newStatus !== 'reported') {
            patch.accepted_at = new Date().toISOString()
            patch.accepted_by_id = user?.id ?? null
          }
        }
        if (etaChanged) patch.estimated_completion_date = eta || null
        let { error: updErr } = await supabase.from('incidents').update(patch).eq('id', incidentId)
        // DB without the ETA column yet (SYNC_SCHEMA_LATEST not run): drop
        // just that field and retry, so a schema-drift DB can't block status
        // updates. Postgres says 42703; PostgREST's schema cache says PGRST204.
        if (updErr && etaChanged && (updErr.code === '42703' || updErr.code === 'PGRST204')) {
          delete patch.estimated_completion_date
          if (Object.keys(patch).length > 1) {
            ({ error: updErr } = await supabase.from('incidents').update(patch).eq('id', incidentId))
          } else {
            updErr = null
          }
        }
        if (updErr) throw updErr
      }

      // Audit trail
      if (statusChanged) {
        await logAuditEvent(supabase, {
          userId: user?.id ?? null,
          userName: updaterName || userName || null,
          actionType: 'status_change',
          resourceType: 'incident',
          resourceId: incidentId,
          oldValue: currentStatus,
          newValue: newStatus,
          changeSummary: `狀態從 "${STATUS_ZH[currentStatus]}" 變更為 "${STATUS_ZH[newStatus as IncidentStatus]}"`,
        })
      }

      toast.success(t('progressUpdate.updated'))
      setNote('')
      resetPhotos()
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('progressUpdate.updateFailed'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-4">
      <div>
        <h3 className="font-semibold text-gray-900">{t('progressUpdate.heading')}</h3>
        <p className="text-xs text-gray-500 mt-0.5">{t('progressUpdate.sectionHint', '記錄目前做了什麼、發現什麼問題，可附照片')}</p>
      </div>

      <div>
        <Label>{t('progressUpdate.updater')}</Label>
        {/* Auto-filled with the logged-in user's name and locked, so the
            handler is recorded accurately. If the account has no name on file
            we leave it editable as a fallback. */}
        <Input
          value={updaterName}
          onChange={e => setUpdaterName(e.target.value)}
          placeholder={t('progressUpdate.updaterPlaceholder')}
          readOnly={!!userName}
          className={`mt-1 ${userName ? 'bg-gray-50 text-gray-600 cursor-not-allowed' : ''}`}
        />
      </div>

      {/* Moving a case backwards is an exceptional action — supervisors+ only
          (same gate as closing), so technicians can't undo workflow progress. */}
      {canClose && (
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="allowRollback"
            checked={allowRollback}
            onChange={e => setAllowRollback(e.target.checked)}
            className="w-4 h-4 rounded border-gray-300"
          />
          <Label htmlFor="allowRollback" className="mb-0 text-sm cursor-pointer">
            {t('progressUpdate.allowRollback')}
          </Label>
        </div>
      )}

      <div>
        <Label>{t('progressUpdate.newStatus')}</Label>
        <Select value={newStatus} onValueChange={(v) => setNewStatus(v ?? currentStatus)} items={Object.fromEntries(selectableStatuses.map(s => [s, statusLabel(s)]))}>
          <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
          <SelectContent>
            {selectableStatuses.map(s => (
              <SelectItem key={s} value={s}>{statusLabel(s)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Assignee's own ETA — reported upward, never touches due_date (the
          supervisor-set SLA deadline technicians can't move). Hidden when
          closing: an ETA is meaningless on a case being closed right now. */}
      {newStatus !== 'closed' && (
        <div>
          <Label>{t('progressUpdate.etaLabel', '你預計什麼時候可以完成？（選填）')}</Label>
          <Input type="date" value={eta} onChange={e => setEta(e.target.value)} className="mt-1" />
          <p className="text-xs text-gray-400 mt-1">{t('progressUpdate.etaHint', '回報給主管參考，不會改動主管設定的截止日')}</p>
        </div>
      )}

      {/* Completion type — only when closing. Drives the first-fix / repeat KPI:
          a temporary fix re-arms repeat-failure detection for 30 days. */}
      {newStatus === 'closed' && (
        <div>
          <Label>{t('progressUpdate.completionType', '修復類型')} <span className="text-red-500">*</span></Label>
          <div className="grid grid-cols-1 gap-1.5 mt-1">
            <button
              type="button"
              onClick={() => setCompletionType('permanent_fix')}
              className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                completionType === 'permanent_fix'
                  ? 'border-green-500 bg-green-50 text-green-800'
                  : 'border-gray-200 bg-white text-gray-700'
              }`}
            >
              <span className="text-sm font-semibold block">✅ {t('progressUpdate.permanentFix', '永久修復')}</span>
              <span className="text-xs text-gray-500 block mt-0.5">{t('progressUpdate.permanentFixDesc', '已解決根本原因')}</span>
            </button>
            <button
              type="button"
              onClick={() => setCompletionType('temporary_fix')}
              className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                completionType === 'temporary_fix'
                  ? 'border-amber-500 bg-amber-50 text-amber-800'
                  : 'border-gray-200 bg-white text-gray-700'
              }`}
            >
              <span className="text-sm font-semibold block">⚠️ {t('progressUpdate.temporaryFix', '臨時修復')}</span>
              <span className="text-xs text-gray-500 block mt-0.5">{t('progressUpdate.temporaryFixDesc', '需觀察 30 天，根本原因未解決')}</span>
            </button>
          </div>

          {/* Post-maintenance hygiene sign-off — food-safety gate for MACHINE
              incidents. Maintenance is itself a contamination source (tools
              left behind, metal shavings, non-food-grade lubricant), so the
              case can't close until whoever worked on it confirms the area
              was left clean. Non-machine incidents never render this. */}
          {hasMachine && (
            <div className="mt-3 rounded-lg border border-gray-200 p-3 space-y-2">
              <Label className="text-sm">
                {t('progressUpdate.hygieneHeading', '復產衛生確認')} <span className="text-red-500">*</span>
              </Label>
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={hygieneTools}
                  onChange={e => setHygieneTools(e.target.checked)}
                  className="mt-0.5 w-4 h-4 accent-blue-600 shrink-0"
                />
                <span className="text-sm text-gray-700">
                  {t('progressUpdate.hygieneTools', '工具清點無缺，無遺留現場')}
                </span>
              </label>
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={hygieneLubricant}
                  onChange={e => setHygieneLubricant(e.target.checked)}
                  className="mt-0.5 w-4 h-4 accent-blue-600 shrink-0"
                />
                <span className="text-sm text-gray-700">
                  {t('progressUpdate.hygieneLubricant', '潤滑油/化學品為食品級或已徹底清除')}
                </span>
              </label>
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={hygieneCleanArea}
                  onChange={e => setHygieneCleanArea(e.target.checked)}
                  className="mt-0.5 w-4 h-4 accent-blue-600 shrink-0"
                />
                <span className="text-sm text-gray-700">
                  {t('progressUpdate.hygieneCleanArea', '現場清潔完成，無金屬屑/異物殘留')}
                </span>
              </label>
            </div>
          )}

          {/* Optional costs — feed the monthly report; skippable so closing
              never gets blocked on missing numbers. */}
          <div className="grid grid-cols-2 gap-2 mt-3">
            <div>
              <Label className="text-xs">{t('progressUpdate.laborCost', '工時費用（選填）')}</Label>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                value={laborCost}
                onChange={e => setLaborCost(e.target.value)}
                placeholder="0"
                className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              />
            </div>
            <div>
              <Label className="text-xs">{t('progressUpdate.partsCost', '零件/材料費用（選填）')}</Label>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                value={partsCost}
                onChange={e => setPartsCost(e.target.value)}
                placeholder="0"
                className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              />
            </div>
          </div>

          {/* Knowledge base capture */}
          <label className="mt-3 flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={saveToKb}
              onChange={e => setSaveToKb(e.target.checked)}
              className="mt-0.5 w-4 h-4 accent-blue-600 shrink-0"
            />
            <span className="text-sm text-gray-700">
              {t('progressUpdate.saveToKb', '存入知識庫（下次同樣問題可查到怎麼修）')}
            </span>
          </label>
          {saveToKb && (
            <div className="mt-2">
              <Label className="text-xs">{t('progressUpdate.repairMethod', '修理方法（選填，未填則使用下方備註）')}</Label>
              <Textarea
                value={repairMethod}
                onChange={e => setRepairMethod(e.target.value)}
                placeholder={t('progressUpdate.repairMethodPh', '例如：更換 bearing 6205、重新校正 sensor 位置…')}
                rows={2}
                className="mt-1"
              />
            </div>
          )}
        </div>
      )}

      <div>
        <div className="flex items-center justify-between gap-2">
          <Label>{t('progressUpdate.note')}</Label>
          {/* Dictation shortcut — technicians with dirty/gloved hands speak
              instead of typing; text lands in the editable field for review,
              never auto-submitted. Hidden when the browser can't do it. */}
          <SpeechMicButton onText={txt => setNote(prev => (prev ? prev + ' ' : '') + txt)} />
        </div>
        <Textarea
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder={t('progressUpdate.notePlaceholder')}
          className="mt-1"
          rows={3}
        />
      </div>

      <div>
        <Label>{t('progressUpdate.photos')}</Label>
        <div className="mt-1 space-y-2">
          {photos.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {photos.map((p, i) => (
                <div key={i} className="relative group">
                  <img
                    src={photoPreviews[i]}
                    alt={`${t('progressUpdate.photos')} ${i + 1}`}
                    className="w-20 h-20 object-cover rounded-lg border border-gray-200 group-hover:opacity-80 transition-opacity"
                  />
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/0 group-hover:bg-black/40 rounded-lg transition-all">
                    <ZoomIn className="w-4 h-4 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                    <span className="text-xs text-white opacity-0 group-hover:opacity-100 mt-0.5 transition-opacity">
                      {(p.size / 1024).toFixed(0)} KB
                    </span>
                  </div>
                  <button
                    type="button"
                    aria-label={`${t('common.delete')} ${i + 1}`}
                    onClick={() => removePhoto(i)}
                    className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center shadow-lg hover:bg-red-600"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
          {photos.length < 5 && (
            // Two explicit buttons instead of one merged picker: a single
            // <input type="file" accept="image/*"> without `capture` leaves it
            // up to the OS/browser which options appear in the chooser, and
            // that's unreliable across Android devices — sometimes camera is
            // missing, sometimes gallery is. Dedicated inputs (one with
            // `capture`, one without) guarantee both always work.
            <div className="flex gap-2">
              <label className={`flex-1 flex items-center justify-center gap-2 border-2 border-dashed rounded-lg p-2.5 cursor-pointer transition-colors ${
                compressing ? 'border-blue-300 bg-blue-50' : 'border-gray-300 hover:border-blue-400'
              }`}>
                <Camera className="w-5 h-5 text-gray-400" />
                <span className="text-sm text-gray-500">
                  {compressing ? t('progressUpdate.compressing') : t('progressUpdate.takePhoto', '拍照')}
                </span>
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={e => addPhotos(Array.from(e.target.files ?? []))}
                  disabled={compressing}
                  className="hidden"
                />
              </label>
              <label className={`flex-1 flex items-center justify-center gap-2 border-2 border-dashed rounded-lg p-2.5 cursor-pointer transition-colors ${
                compressing ? 'border-blue-300 bg-blue-50' : 'border-gray-300 hover:border-blue-400'
              }`}>
                <Images className="w-5 h-5 text-gray-400" />
                <span className="text-sm text-gray-500">
                  {compressing ? t('progressUpdate.compressing') : t('progressUpdate.addPhoto')}
                </span>
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={e => addPhotos(Array.from(e.target.files ?? []))}
                  disabled={compressing}
                  className="hidden"
                />
              </label>
            </div>
          )}
          {photos.length > 0 && (
            <p className="text-xs text-gray-400">
              {t('progressUpdate.photoCount')
                .replace('{count}', String(photos.length))
                .replace('{mb}', (photos.reduce((s, f) => s + f.size, 0) / 1024 / 1024).toFixed(1))}
            </p>
          )}
        </div>
      </div>

      <Button
        onClick={submit}
        disabled={submitting}
        className="w-full h-11 bg-blue-600 hover:bg-blue-700 text-white"
      >
        {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
        {t('progressUpdate.submit')}
      </Button>
    </div>
  )
}
