'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { toast } from 'sonner'
import { Loader2, Trash2, Edit2, Plus } from 'lucide-react'
import { useI18n } from '@/lib/i18n'

interface Factory {
  id: string
  name: string
  code: string
}

export default function FactoryManager() {
  const { t } = useI18n()
  const supabase = createClient()
  const [factories, setFactories] = useState<Factory[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [formData, setFormData] = useState({ name: '', code: '' })
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    loadFactories()
  }, [])

  async function loadFactories() {
    setLoading(true)
    try {
      const { data } = await supabase.from('factories').select('*').order('code')
      setFactories(data ?? [])
    } catch (err) {
      toast.error(t('settings.loadFactoriesFailed'))
    } finally {
      setLoading(false)
    }
  }

  async function submit() {
    if (!formData.name.trim() || !formData.code.trim()) {
      toast.error(t('settings.nameCodeRequired'))
      return
    }

    setSubmitting(true)
    try {
      if (editing) {
        const { error } = await supabase
          .from('factories')
          .update({ name: formData.name, code: formData.code })
          .eq('id', editing)
        if (error) throw error
        toast.success(t('settings.factoryUpdated'))
      } else {
        const { error } = await supabase
          .from('factories')
          .insert([{ name: formData.name, code: formData.code }])
        if (error) throw error
        toast.success(t('settings.factoryAdded'))
      }
      setFormData({ name: '', code: '' })
      setEditing(null)
      setShowForm(false)
      loadFactories()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('settings.operationFailed'))
    } finally {
      setSubmitting(false)
    }
  }

  async function deleteFactory(id: string) {
    if (!confirm(t('settings.confirmDeleteFactory'))) return
    try {
      const { error } = await supabase.from('factories').delete().eq('id', id)
      if (error) throw error
      toast.success(t('settings.factoryDeleted'))
      loadFactories()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('settings.deleteFailed'))
    }
  }

  function editFactory(f: Factory) {
    setFormData({ name: f.name, code: f.code })
    setEditing(f.id)
    setShowForm(true)
  }

  if (loading) return <div className="text-center text-gray-500">{t('settings.loading')}</div>

  return (
    <div className="space-y-4">
      {!showForm && (
        <Button onClick={() => setShowForm(true)} className="gap-2">
          <Plus className="w-4 h-4" /> {t('settings.addFactory')}
        </Button>
      )}

      {showForm && (
        <div className="bg-gray-50 p-4 rounded-lg space-y-3">
          <div>
            <Label>{t('settings.name')}</Label>
            <Input
              value={formData.name}
              onChange={e => setFormData({ ...formData, name: e.target.value })}
              placeholder="e.g., SJA"
              className="mt-1"
            />
          </div>
          <div>
            <Label>{t('settings.code')}</Label>
            <Input
              value={formData.code}
              onChange={e => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
              placeholder="e.g., SJA"
              maxLength={10}
              className="mt-1"
            />
          </div>
          <div className="flex gap-2">
            <Button onClick={submit} disabled={submitting}>
              {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {editing ? t('settings.update') : t('settings.create')}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setShowForm(false)
                setEditing(null)
                setFormData({ name: '', code: '' })
              }}
            >
              {t('settings.cancel')}
            </Button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {factories.map(f => (
          <div key={f.id} className="flex items-center justify-between p-3 border rounded-lg">
            <div>
              <p className="font-semibold">{f.name}</p>
              <p className="text-xs text-gray-500">{t('settings.codeLabel').replace('{code}', f.code)}</p>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => editFactory(f)}
                disabled={submitting}
              >
                <Edit2 className="w-4 h-4" />
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => deleteFactory(f.id)}
                disabled={submitting}
              >
                <Trash2 className="w-4 h-4 text-red-600" />
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
