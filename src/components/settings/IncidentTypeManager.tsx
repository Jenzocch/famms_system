'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { toast } from 'sonner'
import { Loader2, Trash2, Plus } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import { useIncidentTypes, invalidateIncidentTypes } from '@/lib/useIncidentTypes'

export default function IncidentTypeManager() {
  const { t: tr } = useI18n()
  const supabase = createClient()
  // Shared cache drives the list; mutations call invalidateIncidentTypes() so
  // the report/edit/search forms pick up changes without a reload.
  const { types, loading } = useIncidentTypes()
  const [showForm, setShowForm] = useState(false)
  const [label, setLabel] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function add() {
    if (!label.trim()) {
      toast.error(tr('settings.incidentTypeNameRequired'))
      return
    }
    setSubmitting(true)
    try {
      const maxOrder = types.reduce((m, t) => Math.max(m, t.sort_order), 0)
      // code = label for user-added types, so the board shows the label directly.
      const { error } = await supabase.from('incident_types').insert([{
        code: label.trim(),
        label: label.trim(),
        sort_order: maxOrder + 1,
        is_active: true,
      }])
      if (error) throw error
      toast.success(tr('settings.incidentTypeAdded'))
      setLabel('')
      setShowForm(false)
      await invalidateIncidentTypes()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tr('settings.addFailed'))
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
        <Button onClick={() => setShowForm(true)} className="gap-2">
          <Plus className="w-4 h-4" /> {tr('settings.addIncidentType')}
        </Button>
      )}

      {showForm && (
        <div className="bg-gray-50 p-4 rounded-lg space-y-3">
          <div>
            <Label>{tr('settings.incidentTypeName')}</Label>
            <Input
              value={label}
              onChange={e => setLabel(e.target.value)}
              placeholder={tr('settings.incidentTypeNamePlaceholder')}
              className="mt-1"
            />
          </div>
          <div className="flex gap-2">
            <Button onClick={add} disabled={submitting}>
              {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {tr('settings.create')}
            </Button>
            <Button variant="outline" onClick={() => { setShowForm(false); setLabel('') }}>
              {tr('settings.cancel')}
            </Button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {types.map(t => (
          <div key={t.id} className="flex items-center justify-between p-3 border rounded-lg">
            <p className="font-medium text-sm">{t.label}</p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => remove(t.id, t.code)}
              disabled={t.code === 'other'}
            >
              <Trash2 className="w-4 h-4 text-red-600" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  )
}
