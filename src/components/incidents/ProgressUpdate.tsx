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

  // Only supervisors+ may move a case to "closed".
  const selectableStatuses = canClose ? SELECTABLE : SELECTABLE.filter(s => s !== 'closed')

  const [newStatus, setNewStatus] = useState<string>(currentStatus)
  const [note, setNote] = useState('')
  const [updaterName, setUpdaterName] = useState(userName ?? '')
  const [photos, setPhotos] = useState<File[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [compressing, setCompressing] = useState(false)

  async function addPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    if (files.length === 0) return

    setCompressing(true)
    try {
      const compressed: File[] = []
      for (const file of files) {
        if (!file.type.startsWith('image/')) continue
        const options = {
          maxSizeMB: 1,
          maxWidthOrHeight: 2000,
          useWebWorker: true,
        }
        const compressedFile = await imageCompression(file, options)
        compressed.push(compressedFile)
      }
      setPhotos(prev => [...prev, ...compressed].slice(0, 5))
      if (compressed.length > 0) {
        toast.success(t('progressUpdate.compressedToast').replace('{count}', String(compressed.length)))
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
        <Input
          value={updaterName}
          onChange={e => setUpdaterName(e.target.value)}
          placeholder={t('progressUpdate.updaterPlaceholder')}
          className="mt-1"
        />
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
