'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import imageCompression from 'browser-image-compression'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { toast } from 'sonner'
import { Loader2, Camera, X, ZoomIn } from 'lucide-react'
import type { IncidentStatus, UserRole } from '@/types'
import { STATUS_ZH } from '@/lib/incident-display'
import { PERMISSIONS } from '@/lib/permissions'
import { logAuditEvent } from '@/lib/audit'
import { useI18n } from '@/lib/i18n'

// Statuses a maintenance person can move an incident to (simplified set)
const SELECTABLE: IncidentStatus[] = [
  'accepted', 'analyzing', 'waiting_parts', 'repairing', 'testing', 'observation', 'closed',
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
  incidentId, currentStatus, userRole = 'technician', userName,
}: {
  incidentId: string
  currentStatus: IncidentStatus
  userRole?: UserRole
  userName?: string | null
}) {
  const router = useRouter()
  const supabase = createClient()
  const { t } = useI18n()
  const statusLabel = (s: IncidentStatus) => t(`boardStatus.${s}`, STATUS_ZH[s])
  const canClose = PERMISSIONS.closeIncident(userRole)

  const [newStatus, setNewStatus] = useState<string>(currentStatus)
  const [note, setNote] = useState('')
  const [updaterName, setUpdaterName] = useState(userName ?? '')
  const [photos, setPhotos] = useState<File[]>([])
  const [allowRollback, setAllowRollback] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [compressing, setCompressing] = useState(false)

  // Status options based on rollback setting. Only supervisors+ may move a case to "closed".
  const availableStatuses = allowedStatuses(currentStatus, allowRollback)
  const base = canClose ? availableStatuses : availableStatuses.filter(s => s !== 'closed')
  // Always include the current status as a (selected, no-op) option. Some
  // statuses aren't forward targets in SELECTABLE (e.g. 'reported', or the
  // waiting_vendor/approval/shutdown side-states), so without this the Select's
  // default value would not match any item and render blank.
  const selectableStatuses = base.includes(currentStatus) ? base : [currentStatus, ...base]

  async function addPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    if (files.length === 0) return

    setCompressing(true)
    try {
      const compressed: File[] = []
      for (const file of files) {
        if (!file.type.startsWith('image/')) continue
        try {
          const options = {
            maxSizeMB: 0.8,
            maxWidthOrHeight: 1280,
            useWebWorker: true,
          }
          const compressedFile = await imageCompression(file, options)
          compressed.push(compressedFile)
        } catch (fileErr) {
          // Skip individual files that fail compression (e.g., very large images on low-end devices)
          console.warn('Failed to compress individual file:', file.name, fileErr)
        }
      }
      if (compressed.length > 0) {
        setPhotos(prev => [...prev, ...compressed].slice(0, 5))
        toast.success(t('progressUpdate.compressedToast').replace('{count}', String(compressed.length)))
      }
      if (compressed.length < files.length) {
        toast.warning(`${files.length - compressed.length} ${t('progressUpdate.compressSkipped')}`)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('progressUpdate.compressFailed'))
    } finally {
      setCompressing(false)
    }
  }

  async function submit() {
    const statusChanged = newStatus !== currentStatus
    if (!note.trim() && !statusChanged) {
      toast.error(t('progressUpdate.needStatusOrNote'))
      return
    }
    if (newStatus === 'closed' && !canClose) {
      toast.error(t('progressUpdate.onlySupervisorClose'))
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
          body: JSON.stringify({ root_cause: note || undefined }),
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

      // Update incident status (+ stamp accepted_at). For 'closed' the close
      // API already updated status/closed_at above, so skip the raw update.
      if (statusChanged && newStatus !== 'closed') {
        const patch: Record<string, unknown> = { status: newStatus, updated_at: new Date().toISOString() }
        if (currentStatus === 'reported' && newStatus !== 'reported') {
          patch.accepted_at = new Date().toISOString()
          patch.accepted_by_id = user?.id ?? null
        }
        const { error: updErr } = await supabase.from('incidents').update(patch).eq('id', incidentId)
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
      setPhotos([])
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('progressUpdate.updateFailed'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-4">
      <h3 className="font-semibold text-gray-900">{t('progressUpdate.heading')}</h3>

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

      <div>
        <Label>{t('progressUpdate.note')}</Label>
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
                    src={URL.createObjectURL(p)}
                    alt=""
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
                    onClick={() => setPhotos(prev => prev.filter((_, j) => j !== i))}
                    className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center shadow-lg hover:bg-red-600"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
          {photos.length < 5 && (
            <label className={`flex items-center gap-2 border-2 border-dashed rounded-lg p-2.5 cursor-pointer transition-colors ${
              compressing ? 'border-blue-300 bg-blue-50' : 'border-gray-300 hover:border-blue-400'
            }`}>
              <Camera className="w-5 h-5 text-gray-400" />
              <span className="text-sm text-gray-500">
                {compressing ? t('progressUpdate.compressing') : t('progressUpdate.addPhoto')}
              </span>
              <input
                type="file"
                accept="image/*"
                multiple
                capture="environment"
                onChange={addPhoto}
                disabled={compressing}
                className="hidden"
              />
            </label>
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

      <Button onClick={submit} disabled={submitting} className="w-full h-11">
        {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
        {t('progressUpdate.submit')}
      </Button>
    </div>
  )
}
