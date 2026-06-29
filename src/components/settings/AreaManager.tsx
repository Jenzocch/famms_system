'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { toast } from 'sonner'
import { Loader2, Trash2, Edit2, Plus } from 'lucide-react'
import { useI18n } from '@/lib/i18n'

interface Factory {
  id: string
  name: string
  code: string
}

interface Area {
  id: string
  factory_id: string
  name: string
  code: string
  description: string | null
}

export default function AreaManager() {
  const { t } = useI18n()
  const supabase = createClient()
  const [factories, setFactories] = useState<Factory[]>([])
  const [areas, setAreas] = useState<Area[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedFactoryId, setSelectedFactoryId] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [formData, setFormData] = useState({ name: '', code: '', description: '' })
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    loadFactories()
  }, [])

  useEffect(() => {
    if (selectedFactoryId) loadAreas()
  }, [selectedFactoryId])

  async function loadFactories() {
    setLoading(true)
    try {
      const { data } = await supabase.from('factories').select('*').order('code')
      setFactories(data ?? [])
      if (data && data.length > 0) {
        setSelectedFactoryId(data[0].id)
      }
    } catch (err) {
      toast.error(t('settings.loadFactoriesFailed'))
    } finally {
      setLoading(false)
    }
  }

  async function loadAreas() {
    try {
      const { data } = await supabase
        .from('areas')
        .select('*')
        .eq('factory_id', selectedFactoryId)
        .order('name')
      setAreas(data ?? [])
    } catch (err) {
      toast.error(t('settings.loadAreasFailed'))
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
          .from('areas')
          .update({
            name: formData.name,
            code: formData.code,
            description: formData.description || null,
          })
          .eq('id', editing)
        if (error) throw error
        toast.success(t('settings.areaUpdated'))
      } else {
        const { error } = await supabase
          .from('areas')
          .insert([{
            factory_id: selectedFactoryId,
            name: formData.name,
            code: formData.code,
            description: formData.description || null,
          }])
        if (error) throw error
        toast.success(t('settings.areaAdded'))
      }
      setFormData({ name: '', code: '', description: '' })
      setEditing(null)
      setShowForm(false)
      loadAreas()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('settings.operationFailed'))
    } finally {
      setSubmitting(false)
    }
  }

  async function deleteArea(id: string) {
    if (!confirm(t('settings.confirmDeleteArea'))) return
    try {
      const { error } = await supabase.from('areas').delete().eq('id', id)
      if (error) throw error
      toast.success(t('settings.areaDeleted'))
      loadAreas()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('settings.deleteFailed'))
    }
  }

  function editArea(a: Area) {
    setFormData({
      name: a.name,
      code: a.code,
      description: a.description || '',
    })
    setEditing(a.id)
    setShowForm(true)
  }

  if (loading) return <div className="text-center text-gray-500">{t('settings.loading')}</div>

  return (
    <div className="space-y-4">
      <div>
        <Label>{t('settings.selectFactory')}</Label>
        <Select value={selectedFactoryId} onValueChange={(v) => setSelectedFactoryId(v ?? '')}>
          <SelectTrigger className="mt-1">
            <SelectValue placeholder={t('settings.selectFactory')} />
          </SelectTrigger>
          <SelectContent>
            {factories.map(f => (
              <SelectItem key={f.id} value={f.id}>
                {f.name} ({f.code})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {!showForm && (
        <Button onClick={() => setShowForm(true)} className="gap-2">
          <Plus className="w-4 h-4" /> {t('settings.addArea')}
        </Button>
      )}

      {showForm && (
        <div className="bg-gray-50 p-4 rounded-lg space-y-3">
          <div>
            <Label>{t('settings.name')}</Label>
            <Input
              value={formData.name}
              onChange={e => setFormData({ ...formData, name: e.target.value })}
              placeholder="e.g., 生產區"
              className="mt-1"
            />
          </div>
          <div>
            <Label>{t('settings.code')}</Label>
            <Input
              value={formData.code}
              onChange={e => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
              placeholder="e.g., PROD"
              maxLength={10}
              className="mt-1"
            />
          </div>
          <div>
            <Label>{t('settings.descriptionOptional')}</Label>
            <Textarea
              value={formData.description}
              onChange={e => setFormData({ ...formData, description: e.target.value })}
              placeholder={t('settings.areaDescPlaceholder')}
              className="mt-1"
              rows={2}
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
                setFormData({ name: '', code: '', description: '' })
              }}
            >
              {t('settings.cancel')}
            </Button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {areas.map(a => (
          <div key={a.id} className="flex items-center justify-between p-3 border rounded-lg">
            <div>
              <p className="font-semibold">{a.name}</p>
              <p className="text-xs text-gray-500">{t('settings.codeLabel').replace('{code}', a.code)}</p>
              {a.description && <p className="text-xs text-gray-600">{a.description}</p>}
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => editArea(a)}
                disabled={submitting}
              >
                <Edit2 className="w-4 h-4" />
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => deleteArea(a.id)}
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
