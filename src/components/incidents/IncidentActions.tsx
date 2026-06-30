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
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import { toast } from 'sonner'
import { Loader2, Pencil, Trash2, Lock } from 'lucide-react'
import type { UserRole } from '@/types'
import { PERMISSIONS } from '@/lib/permissions'
import { logAuditEvent } from '@/lib/audit'
import { deadlineFromUrgency } from '@/lib/incident-display'
import { useIncidentTypes } from '@/lib/useIncidentTypes'
import { useIncidentTypeLabel } from '@/lib/incident-type-label'
import { useI18n } from '@/lib/i18n'

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
  { value: 'D', label: '🟢 低' },
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
}

export default function IncidentActions({
  incidentId, title, description, incidentType, impact, dueDate, userRole = 'technician',
  userName, factoryId,
}: IncidentActionsProps) {
  const canEdit = PERMISSIONS.editIncident(userRole)
  const canDelete = PERMISSIONS.deleteIncident(userRole)
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

  // Issue types from the shared cache; fall back to built-ins if empty.
  // Labels follow the active app language.
  const { types: cachedTypes } = useIncidentTypes()
  const typeLabel = useIncidentTypeLabel()
  const issueTypes = cachedTypes.length > 0
    ? cachedTypes.map(t => ({ value: t.code, label: typeLabel(t.code) }))
    : FALLBACK_ISSUE_TYPES

  async function saveEdit() {
    if (!t.trim()) { toast.error(tr('caseEdit.titleRequired')); return }
    setSubmitting(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const { error } = await supabase
        .from('incidents')
        .update({
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
        oldValue: { title, description, incident_type: incidentType, downtime_impact: impact, due_date: dueDate },
        newValue: { title: t, description: d || null, incident_type: type, downtime_impact: urg, due_date: due || null },
        changeSummary: '案件內容已更新',
        factoryId: factoryId ?? undefined,
      })

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
        changeSummary: `案件已刪除${title ? `：${title}` : ''}`,
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
          className="flex-1 gap-2"
        >
          <Pencil className="w-4 h-4" /> {tr('caseEdit.edit')}
        </Button>
        <Button
          variant="outline"
          onClick={() => setShowDeleteConfirm(true)}
          disabled={!canDelete}
          className="gap-2 text-red-600"
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

      <div>
        <Label>{tr('caseEdit.title')}</Label>
        <Input value={t} onChange={e => setT(e.target.value)} className="mt-1" />
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
        <Textarea value={d} onChange={e => setD(e.target.value)} rows={3} className="mt-1" />
      </div>

      <div className="flex gap-2">
        <Button onClick={saveEdit} disabled={submitting}>
          {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          {tr('caseEdit.save')}
        </Button>
        <Button variant="outline" onClick={() => setEditing(false)}>{tr('caseEdit.cancel')}</Button>
      </div>
    </div>
  )
}
