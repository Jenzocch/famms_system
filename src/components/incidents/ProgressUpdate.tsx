'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { toast } from 'sonner'
import { Loader2, Camera, X } from 'lucide-react'
import type { IncidentStatus } from '@/types'
import { STATUS_ZH } from '@/lib/incident-display'

// Statuses a maintenance person can move an incident to (simplified set)
const SELECTABLE: IncidentStatus[] = [
  'accepted', 'analyzing', 'waiting_parts', 'repairing', 'testing', 'observation', 'closed',
]

export default function ProgressUpdate({
  incidentId, currentStatus,
}: {
  incidentId: string
  currentStatus: IncidentStatus
}) {
  const router = useRouter()
  const supabase = createClient()

  const [newStatus, setNewStatus] = useState<string>(currentStatus)
  const [note, setNote] = useState('')
  const [updaterName, setUpdaterName] = useState('')
  const [photos, setPhotos] = useState<File[]>([])
  const [submitting, setSubmitting] = useState(false)

  function addPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    setPhotos(prev => [...prev, ...files].slice(0, 5))
  }

  async function submit() {
    if (!note.trim() && newStatus === currentStatus) {
      toast.error('請更新狀態或填寫處理說明')
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

      // Log the update
      const { error: logErr } = await supabase.from('incident_updates').insert({
        incident_id: incidentId,
        new_status: newStatus !== currentStatus ? newStatus : null,
        note: note || null,
        updated_by: updaterName || null,
        updated_by_id: user?.id ?? null,
        photos: paths.length > 0 ? JSON.stringify(paths) : null,
      })
      if (logErr) throw logErr

      // Update incident status (+ stamp accepted_at / closed_at)
      if (newStatus !== currentStatus) {
        const patch: Record<string, unknown> = { status: newStatus, updated_at: new Date().toISOString() }
        if (currentStatus === 'reported' && newStatus !== 'reported') {
          patch.accepted_at = new Date().toISOString()
          patch.accepted_by_id = user?.id ?? null
        }
        if (newStatus === 'closed') {
          patch.closed_at = new Date().toISOString()
          patch.closed_by_id = user?.id ?? null
        }
        const { error: updErr } = await supabase.from('incidents').update(patch).eq('id', incidentId)
        if (updErr) throw updErr
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
            {SELECTABLE.map(s => (
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
        <Label>照片（最多 5 張）</Label>
        <div className="mt-1 space-y-2">
          {photos.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {photos.map((p, i) => (
                <div key={i} className="relative">
                  <img src={URL.createObjectURL(p)} alt="" className="w-16 h-16 object-cover rounded-lg border" />
                  <button
                    type="button"
                    onClick={() => setPhotos(prev => prev.filter((_, j) => j !== i))}
                    className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
          {photos.length < 5 && (
            <label className="flex items-center gap-2 border-2 border-dashed border-gray-300 rounded-lg p-2.5 cursor-pointer hover:border-blue-400">
              <Camera className="w-5 h-5 text-gray-400" />
              <span className="text-sm text-gray-500">新增照片</span>
              <input type="file" accept="image/*" multiple capture="environment" onChange={addPhoto} className="hidden" />
            </label>
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
