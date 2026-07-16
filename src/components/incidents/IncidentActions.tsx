'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useFactories } from '@/lib/useFactories'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import { toast } from 'sonner'
import { Loader2, Pencil, Trash2, Lock, X } from 'lucide-react'
import type { UserRole } from '@/types'
import { PERMISSIONS } from '@/lib/permissions'
import { logAuditEvent } from '@/lib/audit'
import { deadlineFromUrgency } from '@/lib/incident-display'
import { useIncidentTypes } from '@/lib/useIncidentTypes'
import { useIncidentTypeLabel } from '@/lib/incident-type-label'
import { useI18n } from '@/lib/i18n'
import { usePhotoCapture } from '@/lib/hooks/usePhotoCapture'
import ReportPhotoPicker from '@/components/incidents/report/ReportPhotoPicker'

// Fallback types used if the incident_types table is empty
const FALLBACK_ISSUE_TYPES = [
  { value: 'machine', label: '機器故障' },
  { value: 'pipe', label: '水管/管線' },
  { value: 'electrical', label: '電力/照明' },
  { value: 'facility', label: '設施/基礎建設' },
  { value: 'safety', label: '安全問題' },
  { value: 'cleanliness', label: '衛生/清潔' },
  { value: 'other', label: '其他' },
]

// Three urgency levels (A / C / D). Legacy "B" (High) is added back only when
// editing a case that already carries it, so it still displays and saves.
const URGENCY = [
  { value: 'A', label: '🔴 緊急' },
  { value: 'C', label: '🟡 中' },
  { value: 'D', label: '🟢 一般' },
]
const URGENCY_LEGACY = { value: 'B', label: '🟠 高' }

interface IncidentActionsProps {
  incidentId: string
  title: string | null
  description: string | null
  incidentType: string
  impact: string
  dueDate?: string | null
  userRole?: UserRole
  userName?: string | null
  factoryId?: string | null
  machineId?: string | null
  locationNote?: string | null
  photoCount?: number | null
  // Existing report photos (storage paths) — shown in the edit form so a
  // supervisor can remove a wrong/blurry one.
  reportPhotos?: string[]
  supabaseUrl?: string
  // The original reporter may ADD photos (retake a blurry shot) even without
  // edit permission; deleting stays supervisor+ (photos are field evidence).
  isReporter?: boolean
}

export default function IncidentActions({
  incidentId, title, description, incidentType, impact, dueDate, userRole = 'technician',
  userName, factoryId, machineId, locationNote, photoCount,
  reportPhotos = [], supabaseUrl = '', isReporter = false,
}: IncidentActionsProps) {
  const canEdit = PERMISSIONS.editIncident(userRole)
  const canDelete = PERMISSIONS.deleteIncident(userRole)
  const canAddPhotos = canEdit || isReporter
  const router = useRouter()
  const supabase = createClient()
  const { t: tr } = useI18n()

  const [editing, setEditing] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [t, setT] = useState(title || '')
  const [d, setD] = useState(description || '')
  const [type, setType] = useState(incidentType)
  const [urg, setUrg] = useState(impact)
  const [due, setDue] = useState(dueDate || '')
  const [submitting, setSubmitting] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // Location (factory → area → machine) — editable, mirroring the report
  // form's "where first, then what" order. Option lists load on demand;
  // selections only reset when the USER changes a parent (in the onChange
  // handlers), never in the loading effects, so the incident's current
  // location survives the initial load.
  const { factories } = useFactories()
  const [fId, setFId] = useState(factoryId || '')
  const [areaId, setAreaId] = useState('')
  const [mId, setMId] = useState(machineId || '')
  const [locNote, setLocNote] = useState(locationNote || '')
  const [areas, setAreas] = useState<{ id: string; name: string }[]>([])
  const [machines, setMachines] = useState<{ id: string; machine_name: string; machine_code: string | null }[]>([])

  // Photos added while editing land in the same top-level incident-photos/{id}/
  // folder as the original report's photos (no DB row needed — the detail
  // page already lists that folder), so they just show up alongside them.
  // Capped at 5 per edit, same as the report form; not cumulative across
  // separate edits since the picker resets after each save.
  const photoCapture = usePhotoCapture(5)
  const [deletingPhoto, setDeletingPhoto] = useState<string | null>(null)

  async function deletePhoto(path: string) {
    if (!confirm(tr('caseEdit.confirmDeletePhoto', '確定刪除這張照片？'))) return
    setDeletingPhoto(path)
    try {
      const res = await fetch(`/api/incidents/${incidentId}/photos`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || tr('caseEdit.deletePhotoFailed', '刪除照片失敗'))
      toast.success(tr('caseEdit.photoDeleted', '照片已刪除'))
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tr('caseEdit.deletePhotoFailed', '刪除照片失敗'))
    } finally {
      setDeletingPhoto(null)
    }
  }

  // Preselect the area from the current machine once, when editing opens.
  useEffect(() => {
    if (!editing || !machineId) return
    supabase.from('machines').select('area_id').eq('id', machineId).maybeSingle()
      .then(({ data }) => { if (data?.area_id) setAreaId(prev => prev || data.area_id) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing])

  useEffect(() => {
    if (!editing || !fId) { setAreas([]); return }
    supabase.from('areas').select('id, name').eq('factory_id', fId).order('name')
      .then(({ data }) => setAreas(data ?? []))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, fId])

  useEffect(() => {
    if (!editing || !areaId) { setMachines([]); return }
    supabase.from('machines').select('id, machine_name, machine_code').eq('area_id', areaId).order('machine_name')
      .then(({ data }) => setMachines(data ?? []))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, areaId])

  // Issue types from the shared cache; fall back to built-ins if empty.
  // Labels follow the active app language.
  const { types: cachedTypes } = useIncidentTypes()
  const typeLabel = useIncidentTypeLabel()
  const issueTypes = cachedTypes.length > 0
    ? cachedTypes.map(t => ({ value: t.code, label: typeLabel(t.code) }))
    : FALLBACK_ISSUE_TYPES

  async function saveEdit() {
    if (canEdit && !t.trim()) { toast.error(tr('caseEdit.titleRequired')); return }
    setSubmitting(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      // Text/field changes are supervisor+ only. A reporter without edit
      // permission reaches this save purely to attach photos — skipping the
      // update also avoids a guaranteed rejection from the DB field-guard
      // trigger (migration_rls_5).
      if (canEdit) {
        const { error } = await supabase
          .from('incidents')
          .update({
            factory_id: fId || null,
            machine_id: mId || null,
            location_note: locNote.trim() || null,
            title: t,
            description: d || null,
            incident_type: type,
            downtime_impact: urg,
            due_date: due || null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', incidentId)
        if (error) throw error

        await logAuditEvent(supabase, {
          userId: user?.id ?? null,
          userName: userName || null,
          actionType: 'update',
          resourceType: 'incident',
          resourceId: incidentId,
          oldValue: { factory_id: factoryId, machine_id: machineId, location_note: locationNote, title, description, incident_type: incidentType, downtime_impact: impact, due_date: dueDate },
          newValue: { factory_id: fId || null, machine_id: mId || null, location_note: locNote.trim() || null, title: t, description: d || null, incident_type: type, downtime_impact: urg, due_date: due || null },
          changeSummary: '工單內容已更新',
          factoryId: fId || factoryId || undefined,
        })
      }

      // Photos, if any were added — best-effort: the text edit is already
      // saved, so a storage hiccup here must not surface as a failed save.
      // Uploaded straight into the folder the detail page already lists for
      // the original report's photos, so they appear there with no new
      // column/table needed.
      if (photoCapture.photos.length > 0) {
        let uploaded = 0
        try {
          for (const [i, photo] of photoCapture.photos.entries()) {
            const ext = photo.name.split('.').pop()
            const path = `${incidentId}/${Date.now()}-${i}.${ext}`
            const { error: upErr } = await supabase.storage.from('incident-photos').upload(path, photo)
            if (upErr) throw upErr
            uploaded++
          }
        } catch (photoErr) {
          console.error('Photo upload failed:', photoErr)
          toast.warning(tr('caseEdit.photoUploadFailed', '工單已更新，但照片上傳失敗'))
        }
        if (uploaded > 0) {
          await supabase.from('incidents').update({ photo_count: (photoCount ?? 0) + uploaded }).eq('id', incidentId)
        }
        photoCapture.resetPhotos()
      }

      toast.success(tr('caseEdit.updated'))
      setEditing(false)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tr('caseEdit.updateFailed'))
    } finally {
      setSubmitting(false)
    }
  }

  async function confirmDelete() {
    setDeleting(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      // Log before delete so the audit record is created while the row exists.
      await logAuditEvent(supabase, {
        userId: user?.id ?? null,
        userName: userName || null,
        actionType: 'delete',
        resourceType: 'incident',
        resourceId: incidentId,
        oldValue: { title },
        changeSummary: `工單已刪除${title ? `：${title}` : ''}`,
        factoryId: factoryId ?? undefined,
      })
      const { error } = await supabase.from('incidents').delete().eq('id', incidentId)
      if (error) throw error
      toast.success(tr('caseEdit.deleted'))
      setShowDeleteConfirm(false)
      router.push('/incidents')
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tr('caseEdit.deleteFailed'))
      setDeleting(false)
      setShowDeleteConfirm(false)
    }
  }

  if (!editing) {
    return (
      <div className="flex gap-2">
        <Button
          variant="outline"
          onClick={() => setEditing(true)}
          className="flex-1 gap-2 border-gray-300 font-medium"
        >
          <Pencil className="w-4 h-4" /> {tr('caseEdit.edit')}
        </Button>
        <Button
          variant="outline"
          onClick={() => setShowDeleteConfirm(true)}
          disabled={!canDelete}
          className="gap-2 border-red-300 text-red-600 font-medium hover:bg-red-50 hover:text-red-700"
          title={!canDelete ? tr('caseEdit.onlySupervisorDelete') : ''}
        >
          {canDelete ? <Trash2 className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
          {tr('caseEdit.delete')}
        </Button>

        {/* Delete confirmation dialog */}
        <Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="text-red-600">{tr('caseEdit.delete')}</DialogTitle>
              <DialogDescription>{tr('caseEdit.confirmDelete')}</DialogDescription>
            </DialogHeader>
            {title && <p className="text-sm text-gray-600 px-6">{title}</p>}
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setShowDeleteConfirm(false)}
                disabled={deleting}
              >
                {tr('common.cancel')}
              </Button>
              <Button
                onClick={confirmDelete}
                disabled={deleting}
                className="bg-red-600 hover:bg-red-700 text-white"
              >
                {deleting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                {tr('caseEdit.delete')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
      <h3 className="font-semibold text-gray-900">{tr('caseEdit.edit')}</h3>

      {/* WHERE first, WHAT second — same reading order as the report form
          (①在哪裡 ②什麼問題), so editing feels like re-walking the report. */}
      {canEdit && (
        <div>
          <Label>{tr('report.location', '位置')}</Label>
          <div className="mt-1 space-y-2">
            <Select
              value={fId}
              onValueChange={(v) => { const nv = v ?? ''; if (nv !== fId) { setFId(nv); setAreaId(''); setMId('') } }}
              items={Object.fromEntries(factories.map(f => [f.id, f.name]))}
            >
              <SelectTrigger><SelectValue placeholder={tr('report.selectFactory', '選擇工廠')} /></SelectTrigger>
              <SelectContent>
                {factories.map(f => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
              </SelectContent>
            </Select>
            {areas.length > 0 && (
              <Select
                value={areaId}
                onValueChange={(v) => { const nv = v ?? ''; if (nv !== areaId) { setAreaId(nv); setMId('') } }}
                items={Object.fromEntries(areas.map(a => [a.id, a.name]))}
              >
                <SelectTrigger><SelectValue placeholder={tr('report.selectArea', '選擇區域（可選）')} /></SelectTrigger>
                <SelectContent>
                  {areas.map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
            {machines.length > 0 && (
              <Select
                value={mId}
                onValueChange={(v) => setMId(v ?? '')}
                items={Object.fromEntries(machines.map(m => [m.id, `${m.machine_code ? `[${m.machine_code}] ` : ''}${m.machine_name}`]))}
              >
                <SelectTrigger><SelectValue placeholder={tr('report.selectMachine', '選擇機器/項目（可選）')} /></SelectTrigger>
                <SelectContent>
                  {machines.map(m => (
                    <SelectItem key={m.id} value={m.id}>{m.machine_code ? `[${m.machine_code}] ` : ''}{m.machine_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Input
              value={locNote}
              onChange={e => setLocNote(e.target.value)}
              placeholder={tr('report.locationOther', '其他位置（自行填寫，選填）')}
            />
          </div>
        </div>
      )}

      {/* Title/description are guarded by the same DB trigger as the fields
          below (migration_rls_5) — an editable input for a technician just
          means a raw Postgres error at save time. Read-only unless canEdit. */}
      <div>
        <Label>{tr('caseEdit.title')}</Label>
        {canEdit ? (
          <Input value={t} onChange={e => setT(e.target.value)} className="mt-1" />
        ) : (
          <p className="mt-1 text-sm text-gray-700 bg-gray-50 rounded-md px-3 py-2">{t || '-'}</p>
        )}
      </div>

      {canEdit && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>{tr('caseEdit.issueType')}</Label>
              <Select value={type} onValueChange={(v) => setType(v ?? type)} items={Object.fromEntries(issueTypes.map(it => [it.value, it.label]))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {issueTypes.map(it => <SelectItem key={it.value} value={it.value}>{it.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>{tr('caseEdit.urgency')}</Label>
              {(() => {
                const choices = URGENCY.some(u => u.value === urg) ? URGENCY : [...URGENCY, URGENCY_LEGACY]
                return (
                  <Select value={urg} onValueChange={(v) => setUrg(v ?? urg)} items={Object.fromEntries(choices.map(u => [u.value, tr(`urgency.${u.value}`, u.label)]))}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {choices.map(u => <SelectItem key={u.value} value={u.value}>{tr(`urgency.${u.value}`, u.label)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )
              })()}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between gap-2">
              <Label>{tr('caseEdit.dueDate')}</Label>
              <button
                type="button"
                onClick={() => setDue(deadlineFromUrgency(urg))}
                className="text-xs font-medium text-blue-600 hover:text-blue-700"
              >
                {tr('caseEdit.applyByUrgency')}
              </button>
            </div>
            <Input type="date" value={due} onChange={e => setDue(e.target.value)} className="mt-1" />
          </div>
        </>
      )}

      <div>
        <Label>{tr('caseEdit.description')}</Label>
        {canEdit ? (
          <Textarea value={d} onChange={e => setD(e.target.value)} rows={3} className="mt-1" />
        ) : (
          <p className="mt-1 text-sm text-gray-700 bg-gray-50 rounded-md px-3 py-2 whitespace-pre-wrap">{d || '-'}</p>
        )}
      </div>

      {/* Existing report photos — supervisor+ can remove a wrong/blurry one
          (audit-logged, via API); everyone else just sees them for context. */}
      {reportPhotos.length > 0 && (
        <div>
          <Label>{tr('caseEdit.existingPhotos', '已上傳的照片')}</Label>
          <div className="mt-1 flex flex-wrap gap-2">
            {reportPhotos.map(path => (
              <div key={path} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`${supabaseUrl}/storage/v1/object/public/incident-photos/${path}`}
                  alt=""
                  className="w-20 h-20 object-cover rounded-lg border border-gray-200"
                />
                {canEdit && (
                  <button
                    type="button"
                    aria-label={tr('caseEdit.deletePhoto', '刪除照片')}
                    onClick={() => deletePhoto(path)}
                    disabled={deletingPhoto === path}
                    className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center shadow-lg hover:bg-red-600 disabled:opacity-50"
                  >
                    {deletingPhoto === path
                      ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      : <X className="w-3.5 h-3.5" />}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Adding photos is open to the original reporter too — a blurry or
          wrong shot gets FIXED by adding a clearer one, not by deletion
          (which stays supervisor-only above). */}
      {canAddPhotos && (
        <ReportPhotoPicker
          photos={photoCapture.photos}
          photoPreviews={photoCapture.photoPreviews}
          compressing={photoCapture.compressing}
          maxPhotos={5}
          onAddPhotos={photoCapture.addPhotos}
          onRemovePhoto={photoCapture.removePhoto}
        />
      )}

      <div className="flex gap-2">
        {canAddPhotos && (
          <Button
            onClick={saveEdit}
            // A photo-only editor (the reporter) has nothing to save until
            // they've actually picked a photo.
            disabled={submitting || (!canEdit && photoCapture.photos.length === 0)}
            className="bg-blue-600 hover:bg-blue-700 text-white"
          >
            {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {tr('caseEdit.save')}
          </Button>
        )}
        <Button variant="outline" onClick={() => { photoCapture.resetPhotos(); setEditing(false) }}>{tr('caseEdit.cancel')}</Button>
      </div>
    </div>
  )
}
