'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { toast } from 'sonner'
import { Loader2, Trash2, Plus, Pencil } from 'lucide-react'
import { useI18n } from '@/lib/i18n'

interface Factory { id: string; name: string }
interface Area { id: string; factory_id: string; name: string }
interface Asset {
  id: string
  area_id: string
  machine_name: string
  machine_code: string | null
  asset_category: string | null
}

const CATEGORIES = [
  { value: 'machine', label: '機器', labelKey: 'settings.catMachine', prefix: 'MAC' },
  { value: 'item', label: '一般項目', labelKey: 'settings.catItem', prefix: 'ITM' },
  { value: 'pipe', label: '水管/管線', labelKey: 'settings.catPipe', prefix: 'PIP' },
  { value: 'electrical', label: '電力/照明', labelKey: 'settings.catElectrical', prefix: 'ELE' },
  { value: 'facility', label: '設施', labelKey: 'settings.catFacility', prefix: 'FAC' },
]

export default function AssetManager() {
  const { t } = useI18n()
  const supabase = createClient()
  const categoryLabel = (value: string | null) => {
    const c = CATEGORIES.find(c => c.value === value)
    return c ? t(c.labelKey, c.label) : ''
  }
  const [factories, setFactories] = useState<Factory[]>([])
  const [areas, setAreas] = useState<Area[]>([])
  const [assets, setAssets] = useState<Asset[]>([])
  const [loading, setLoading] = useState(true)

  const [factoryId, setFactoryId] = useState('')
  const [areaId, setAreaId] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [category, setCategory] = useState('machine')
  const [code, setCode] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    supabase.from('factories').select('id, name').order('name').then(({ data }) => {
      setFactories(data ?? [])
      if (data && data.length > 0) setFactoryId(data[0].id)
      setLoading(false)
    })
  }, [])

  useEffect(() => {
    if (!factoryId) { setAreas([]); setAreaId(''); return }
    supabase.from('areas').select('*').eq('factory_id', factoryId).order('name').then(({ data }) => {
      setAreas(data ?? [])
      if (data && data.length > 0) setAreaId(data[0].id)
      else setAreaId('')
    })
  }, [factoryId])

  useEffect(() => {
    if (!areaId) { setAssets([]); return }
    loadAssets()
  }, [areaId])

  async function loadAssets() {
    const { data } = await supabase
      .from('machines')
      .select('id, area_id, machine_name, machine_code, asset_category')
      .eq('area_id', areaId)
      .neq('status', 'scrapped')
      .order('machine_name')
    setAssets(data ?? [])
  }

  async function generateDefaultCode(cat: string): Promise<string> {
    const prefix = CATEGORIES.find(c => c.value === cat)?.prefix ?? 'AST'
    const { data } = await supabase
      .from('machines')
      .select('machine_code')
      .eq('asset_category', cat)
      .like('machine_code', `${prefix}-%`)
      .order('machine_code', { ascending: false })
      .limit(1)
    let next = 1
    if (data && data.length > 0 && data[0].machine_code) {
      const m = data[0].machine_code.match(/-(\d+)$/)
      if (m) next = parseInt(m[1]) + 1
    }
    return `${prefix}-${String(next).padStart(3, '0')}`
  }

  function startAdd() {
    setEditingId(null)
    setName('')
    setCode('')
    setCategory('machine')
    setShowForm(true)
  }

  function startEdit(a: Asset) {
    setEditingId(a.id)
    setName(a.machine_name)
    setCode(a.machine_code || '')
    setCategory(a.asset_category || 'machine')
    setShowForm(true)
  }

  function resetForm() {
    setShowForm(false)
    setEditingId(null)
    setName('')
    setCode('')
  }

  async function submit() {
    if (!areaId || !name.trim()) {
      toast.error(t('settings.selectAreaAndName'))
      return
    }
    setSubmitting(true)
    try {
      if (editingId) {
        const { error } = await supabase.from('machines').update({
          machine_name: name,
          machine_code: code.trim() || null,
          asset_category: category,
        }).eq('id', editingId)
        if (error) throw error
        toast.success(t('settings.updated'))
      } else {
        const finalCode = code.trim() || await generateDefaultCode(category)
        const { error } = await supabase.from('machines').insert({
          factory_id: factoryId,
          area_id: areaId,
          machine_name: name,
          machine_code: finalCode,
          asset_category: category,
          status: 'running',
        })
        if (error) throw error
        toast.success(t('settings.addedWithCode').replace('{code}', finalCode))
      }
      resetForm()
      loadAssets()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('settings.operationFailed'))
    } finally {
      setSubmitting(false)
    }
  }

  async function remove(id: string) {
    if (!confirm(t('settings.confirmDeleteAsset'))) return
    const { error } = await supabase.from('machines').delete().eq('id', id)
    if (error) { toast.error(error.message); return }
    toast.success(t('settings.deleted'))
    loadAssets()
  }

  if (loading) return <div className="text-center text-gray-500 text-sm">{t('settings.loading')}</div>

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        <Select value={factoryId} onValueChange={(v) => setFactoryId(v ?? '')}>
          <SelectTrigger><SelectValue placeholder={t('settings.factory')} /></SelectTrigger>
          <SelectContent>
            {factories.map(f => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={areaId} onValueChange={(v) => setAreaId(v ?? '')}>
          <SelectTrigger><SelectValue placeholder={t('settings.area')} /></SelectTrigger>
          <SelectContent>
            {areas.map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {!showForm && areaId && (
        <Button onClick={startAdd} className="gap-2 w-full">
          <Plus className="w-4 h-4" /> {t('settings.addAsset')}
        </Button>
      )}

      {showForm && (
        <div className="bg-gray-50 p-4 rounded-lg space-y-3">
          <p className="text-sm font-medium text-gray-700">{editingId ? t('settings.editAsset') : t('settings.addAsset')}</p>
          <div>
            <Label>{t('settings.assetCategory')}</Label>
            <Select value={category} onValueChange={(v) => setCategory(v ?? 'machine')}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{t(c.labelKey, c.label)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>{t('settings.name')}</Label>
            <Input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder={t('settings.assetNamePlaceholder')}
              className="mt-1"
            />
          </div>
          <div>
            <Label>{t('settings.assetCodeLabel')}</Label>
            <Input
              value={code}
              onChange={e => setCode(e.target.value.toUpperCase())}
              placeholder={t('settings.assetCodePlaceholder')}
              className="mt-1 font-mono"
            />
          </div>
          <div className="flex gap-2">
            <Button onClick={submit} disabled={submitting}>
              {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {editingId ? t('settings.update') : t('settings.create')}
            </Button>
            <Button variant="outline" onClick={resetForm}>{t('settings.cancel')}</Button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {assets.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-4">{t('settings.noAssetsInArea')}</p>
        ) : (
          assets.map(a => (
            <div key={a.id} className="flex items-center justify-between p-3 border rounded-lg bg-white">
              <div>
                <p className="font-medium text-sm">{a.machine_name}</p>
                <p className="text-xs text-gray-500 font-mono">
                  {a.machine_code || t('settings.noCode')}
                  {a.asset_category && ` · ${categoryLabel(a.asset_category)}`}
                </p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => startEdit(a)}>
                  <Pencil className="w-4 h-4" />
                </Button>
                <Button size="sm" variant="outline" onClick={() => remove(a.id)}>
                  <Trash2 className="w-4 h-4 text-red-600" />
                </Button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
