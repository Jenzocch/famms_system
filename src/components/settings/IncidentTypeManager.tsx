'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { toast } from 'sonner'
import { Loader2, Trash2, Plus, Pencil } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import { useIncidentTypes, invalidateIncidentTypes, type IncidentType } from '@/lib/useIncidentTypes'
import { pickIncidentTypeLabel } from '@/lib/incident-type-label'

// Trim, mapping blank -> null so the label fallback chain works.
const orNull = (s: string) => {
  const v = s.trim()
  return v.length > 0 ? v : null
}

export default function IncidentTypeManager() {
  const { t: tr, locale } = useI18n()
  const supabase = createClient()
  // Shared cache drives the list; mutations call invalidateIncidentTypes() so
  // the report/edit/search forms pick up changes without a reload.
  const { types, loading } = useIncidentTypes()
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [zh, setZh] = useState('')
  const [en, setEn] = useState('')
  const [id, setId] = useState('')
  const [submitting, setSubmitting] = useState(false)

  function startAdd() {
    setEditingId(null)
    setZh(''); setEn(''); setId('')
    setShowForm(true)
  }

  function startEdit(t: IncidentType) {
    setEditingId(t.id)
    setZh(t.label_zh ?? '')
    setEn(t.label_en ?? '')
    setId(t.label_id ?? t.label ?? '')
    setShowForm(true)
  }

  function closeForm() {
    setShowForm(false)
    setEditingId(null)
    setZh(''); setEn(''); setId('')
  }

  // Shared payload for insert/update. Returns null if every field is blank.
  function buildLabels() {
    const lZh = orNull(zh), lEn = orNull(en), lId = orNull(id)
    if (!lZh && !lEn && !lId) return null
    return {
      label_zh: lZh,
      label_en: lEn,
      label_id: lId,
      // Legacy single column / final fallback: prefer Bahasa, then zh, then en.
      label: lId || lZh || lEn!,
    }
  }

  async function add() {
    const labels = buildLabels()
    if (!labels) { toast.error(tr('settings.incidentTypeAtLeastOne')); return }
    setSubmitting(true)
    try {
      const maxOrder = types.reduce((m, t) => Math.max(m, t.sort_order), 0)
      // Stable opaque code; incidents store this, display reads label_* by code.
      const code = `custom_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
      const { error } = await supabase.from('incident_types').insert([{
        code,
        ...labels,
        sort_order: maxOrder + 1,
        is_active: true,
      }])
      if (error) throw error
      toast.success(tr('settings.incidentTypeAdded'))
      closeForm()
      await invalidateIncidentTypes()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tr('settings.addFailed'))
    } finally {
      setSubmitting(false)
    }
  }

  async function update() {
    const orig = types.find(t => t.id === editingId)
    if (!orig) return
    const labels = buildLabels()
    if (!labels) { toast.error(tr('settings.incidentTypeAtLeastOne')); return }
    setSubmitting(true)
    try {
      // code is stable, so existing incidents keep mapping correctly; only the
      // display labels change.
      const { error } = await supabase
        .from('incident_types')
        .update(labels)
        .eq('id', orig.id)
      if (error) throw error
      toast.success(tr('settings.incidentTypeUpdated'))
      closeForm()
      await invalidateIncidentTypes()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tr('settings.operationFailed'))
    } finally {
      setSubmitting(false)
    }
  }

  async function remove(id: string, code: string) {
    if (code === 'other') {
      toast.error(tr('settings.cannotDeleteOther'))
      return
    }
    if (!confirm(tr('settings.confirmDeleteIncidentType'))) return
    try {
      // Soft-delete so historical incidents keep their label mapping.
      const { error } = await supabase
        .from('incident_types')
        .update({ is_active: false })
        .eq('id', id)
      if (error) throw error
      toast.success(tr('settings.deleted'))
      await invalidateIncidentTypes()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tr('settings.deleteFailed'))
    }
  }

  if (loading) return <div className="text-center text-gray-500 text-sm py-2">{tr('settings.loading')}</div>

  return (
    <div className="space-y-4">
      {!showForm && (
        <Button onClick={startAdd} className="gap-2">
          <Plus className="w-4 h-4" /> {tr('settings.addIncidentType')}
        </Button>
      )}

      {showForm && (
        <div className="bg-gray-50 p-4 rounded-lg space-y-3">
          <p className="text-sm font-medium text-gray-700">
            {editingId ? tr('settings.editIncidentType') : tr('settings.addIncidentType')}
          </p>
          <p className="text-xs text-gray-500">{tr('settings.incidentTypeMultiHint')}</p>
          <div>
            <Label>中文</Label>
            <Input value={zh} onChange={e => setZh(e.target.value)} placeholder="🔥 火災風險" className="mt-1" />
          </div>
          <div>
            <Label>English</Label>
            <Input value={en} onChange={e => setEn(e.target.value)} placeholder="🔥 Fire risk" className="mt-1" />
          </div>
          <div>
            <Label>Bahasa Indonesia</Label>
            <Input value={id} onChange={e => setId(e.target.value)} placeholder="🔥 Risiko kebakaran" className="mt-1" />
          </div>
          <div className="flex gap-2">
            <Button onClick={editingId ? update : add} disabled={submitting}>
              {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {editingId ? tr('settings.update') : tr('settings.create')}
            </Button>
            <Button variant="outline" onClick={closeForm}>
              {tr('settings.cancel')}
            </Button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {types.map(t => (
          <div key={t.id} className="flex items-center justify-between p-3 border rounded-lg">
            <p className="font-medium text-sm">{pickIncidentTypeLabel(t, locale)}</p>
            <div className="flex gap-1">
              <Button size="sm" variant="outline" onClick={() => startEdit(t)}>
                <Pencil className="w-4 h-4" />
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => remove(t.id, t.code)}
                disabled={t.code === 'other'}
              >
                <Trash2 className={`w-4 h-4 ${t.code === 'other' ? 'text-gray-300' : 'text-red-600'}`} />
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
