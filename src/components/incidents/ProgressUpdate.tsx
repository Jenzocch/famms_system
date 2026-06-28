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
        toast.success(`壓縮 ${compressed.length} 張圖片完成`)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '圖片壓縮失敗')
    } finally {
      setCompressing(false)
    }
  }

  async function submit() {
    const statusChanged = newStatus !== currentStatus
    if (!note.trim() && !statusChanged) {
      toast.error('請更新狀態或填寫處理說明')
      return
    }
    if (newStatus === 'closed' && !canClose) {
      toast.error('只有主管可以結案')
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
            throw new Error(`需先完成 RCA 才能結案（同故障在90天內已發生 ${json.occurrence_count ?? '≥3'} 次）`)
          }
          throw new Error(json?.error || '結案失敗')
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

      toast.success('進度已更新')
      setNote('')
      setPhotos([])
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '更新失敗')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-4">
      <h3 className="font-semibold text-gray-900">更新處理進度</h3>

      <div>
        <Label>更新人員</Label>
        <Input
          value={updaterName}
          onChange={e => setUpdaterName(e.target.value)}
          placeholder="維修人員姓名"
          className="mt-1"
        />
      </div>

      <div>
        <Label>新狀態</Label>
        <Select value={newStatus} onValueChange={(v) => setNewStatus(v ?? currentStatus)}>
          <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
          <SelectContent>
            {selectableStatuses.map(s => (
              <SelectItem key={s} value={s}>{STATUS_ZH[s]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label>處理說明</Label>
        <Textarea
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder="說明處理內容、發現的問題、更換的零件..."
          className="mt-1"
          rows={3}
        />
      </div>

      <div>
        <Label>照片（最多 5 張，自動壓縮）</Label>
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
                {compressing ? '壓縮中...' : '新增照片'}
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
              共 {photos.length} 張（{(photos.reduce((s, f) => s + f.size, 0) / 1024 / 1024).toFixed(1)} MB）
            </p>
          )}
        </div>
      </div>

      <Button onClick={submit} disabled={submitting} className="w-full h-11">
        {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
        送出更新
      </Button>
    </div>
  )
}
