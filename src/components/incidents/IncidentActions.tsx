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
import { Loader2, Pencil, Trash2, Lock } from 'lucide-react'
import type { UserRole } from '@/types'
import { PERMISSIONS } from '@/lib/permissions'
import { logAuditEvent } from '@/lib/audit'
import { deadlineFromUrgency } from '@/lib/incident-display'
import { useIncidentTypes } from '@/lib/useIncidentTypes'

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

const URGENCY = [
  { value: 'A', label: '🔴 緊急' },
  { value: 'B', label: '🟠 高' },
  { value: 'C', label: '🟡 中' },
  { value: 'D', label: '🟢 低' },
]

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

  const [editing, setEditing] = useState(false)
  const [t, setT] = useState(title || '')
  const [d, setD] = useState(description || '')
  const [type, setType] = useState(incidentType)
  const [urg, setUrg] = useState(impact)
  const [due, setDue] = useState(dueDate || '')
  const [submitting, setSubmitting] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // Issue types from the shared cache; fall back to built-ins if empty.
  const { types: cachedTypes } = useIncidentTypes()
  const issueTypes = cachedTypes.length > 0
    ? cachedTypes.map(t => ({ value: t.code, label: t.label }))
    : FALLBACK_ISSUE_TYPES

  async function saveEdit() {
    if (!t.trim()) { toast.error('標題不可空白'); return }
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

      toast.success('案件已更新')
      setEditing(false)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '更新失敗')
    } finally {
      setSubmitting(false)
    }
  }

  async function remove() {
    if (!confirm('確認刪除此案件？此動作無法復原，所有處理紀錄也會一併刪除。')) return
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
      toast.success('案件已刪除')
      router.push('/incidents')
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '刪除失敗')
      setDeleting(false)
    }
  }

  if (!editing) {
    return (
      <div className="flex gap-2">
        <Button
          variant="outline"
          onClick={() => setEditing(true)}
          disabled={!canEdit}
          className="flex-1 gap-2"
          title={!canEdit ? '只有主管可以編輯案件' : ''}
        >
          {canEdit ? (
            <>
              <Pencil className="w-4 h-4" /> 編輯案件
            </>
          ) : (
            <>
              <Lock className="w-4 h-4" /> 編輯案件
            </>
          )}
        </Button>
        <Button
          variant="outline"
          onClick={remove}
          disabled={deleting || !canDelete}
          className="gap-2 text-red-600"
          title={!canDelete ? '只有主管可以刪除案件' : ''}
        >
          {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : canDelete ? <Trash2 className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
          刪除
        </Button>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
      <h3 className="font-semibold text-gray-900">編輯案件</h3>

      <div>
        <Label>標題</Label>
        <Input value={t} onChange={e => setT(e.target.value)} className="mt-1" />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label>問題類型</Label>
          <Select value={type} onValueChange={(v) => setType(v ?? type)}>
            <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              {issueTypes.map(it => <SelectItem key={it.value} value={it.value}>{it.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>緊急度</Label>
          <Select value={urg} onValueChange={(v) => setUrg(v ?? urg)}>
            <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              {URGENCY.map(u => <SelectItem key={u.value} value={u.value}>{u.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between gap-2">
          <Label>截止日</Label>
          <button
            type="button"
            onClick={() => setDue(deadlineFromUrgency(urg))}
            className="text-xs font-medium text-blue-600 hover:text-blue-700"
          >
            依緊急套用
          </button>
        </div>
        <Input type="date" value={due} onChange={e => setDue(e.target.value)} className="mt-1" />
      </div>

      <div>
        <Label>問題描述</Label>
        <Textarea value={d} onChange={e => setD(e.target.value)} rows={3} className="mt-1" />
      </div>

      <div className="flex gap-2">
        <Button onClick={saveEdit} disabled={submitting}>
          {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          儲存
        </Button>
        <Button variant="outline" onClick={() => setEditing(false)}>取消</Button>
      </div>
    </div>
  )
}
