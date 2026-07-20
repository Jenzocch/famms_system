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
import { Loader2, Trash2, Plus, Pencil, Archive } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import { useFactories } from '@/lib/useFactories'

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
  // Shared factory cache — reflects renames/adds from FactoryManager without a
  // page reload (its own on-mount fetch went stale after an edit).
  const { factories, loading: factoriesLoading } = useFactories()
  const [areas, setAreas] = useState<Area[]>([])
  const [assets, setAssets] = useState<Asset[]>([])

  const [factoryId, setFactoryId] = useState('')
  const [areaId, setAreaId] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [category, setCategory] = useState('machine')
  const [code, setCode] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Preselect the first factory once the shared list arrives (and keep the
  // selection valid if the current one disappears, e.g. after a delete).
  useEffect(() => {
    if (factories.length === 0) return
    if (!factoryId || !factories.some(f => f.id === factoryId)) {
      // Intentional reset-on-list-change: keeps the selection valid (or
      // preselects the first factory) whenever the shared factory list
      // changes, not an external-data sync.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFactoryId(factories[0].id)
    }
  }, [factories, factoryId])

  useEffect(() => {
    // Intentional reset-before-refetch: clears the stale option list
    // synchronously so the dropdown doesn't show the previous factory's
    // areas while the new factory's areas are loading.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!factoryId) { setAreas([]); setAreaId(''); return }
    supabase.from('areas').select('*').eq('factory_id', factoryId).order('name').then(({ data }) => {
      setAreas(data ?? [])
      if (data && data.length > 0) setAreaId(data[0].id)
      else setAreaId('')
    })
    // `supabase` is intentionally omitted: createClient() returns a new
    // client instance every call (not memoized), so adding it here would
    // re-run this effect on every render instead of only when factoryId
    // changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [factoryId])

  useEffect(() => {
    // Intentional reset-before-refetch (see areas effect above).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!areaId) { setAssets([]); return }
    loadAssets()
    // `loadAssets` is intentionally omitted: it's a fresh function reference
    // every render (closes over the unstable `supabase` client), so adding
    // it would re-run this effect on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      const isDupCode = !!err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === '23505'
      toast.error(
        isDupCode
          ? t('machineForm.dupCode', '此機器代碼在此工廠已被使用')
          : err instanceof Error ? err.message : t('settings.operationFailed')
      )
    } finally {
      setSubmitting(false)
    }
  }

  async function remove(id: string) {
    // A machine with repair history must be scrapped, not deleted — the DB
    // (migration_delete_protection) would RESTRICT it anyway; check first so
    // the user gets a real explanation instead of a raw FK error.
    const { count } = await supabase
      .from('incidents')
      .select('id', { count: 'exact', head: true })
      .eq('machine_id', id)
    if ((count ?? 0) > 0) {
      toast.error(t('settings.machineHasHistory', '此機器有維修紀錄，無法刪除。請改按「報廢」以保留歷史。').replace('{n}', String(count)))
      return
    }
    if (!confirm(t('settings.confirmDeleteAsset'))) return
    const { error } = await supabase.from('machines').delete().eq('id', id)
    if (error) {
      // Incidents was clear, but the DB RESTRICT also guards PM schedules, QR
      // codes, costs, etc. Any of those turns delete into a raw FK error —
      // point the user at 報廢 instead of showing the Postgres message.
      const isFk = typeof error === 'object' && 'code' in error && (error as { code: string }).code === '23503'
      toast.error(isFk
        ? t('settings.machineHasLinks', '此機器已被其他紀錄（保養排程、QR 等）引用，無法刪除。請改按「報廢」。')
        : error.message)
      return
    }
    toast.success(t('settings.deleted'))
    loadAssets()
  }

  // Retire a machine that can't be deleted (has history/links). Sets status
  // 'scrapped', which drops it from every picker and list (all queries filter
  // scrapped out) while keeping its history intact — the intended path the
  // delete guard keeps pointing at, now actually available here.
  async function scrap(id: string, name: string) {
    if (!confirm(t('settings.confirmScrapAsset', '確定將「{name}」設為報廢？它會從所有列表與選單消失，但維修歷史會保留。').replace('{name}', name))) return
    const { error } = await supabase.from('machines').update({ status: 'scrapped' }).eq('id', id)
    if (error) { toast.error(error.message); return }
    toast.success(t('settings.scrapped', '已設為報廢'))
    loadAssets()
  }

  if (factoriesLoading) return <div className="text-center text-gray-500 text-sm">{t('settings.loading')}</div>

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        <Select value={factoryId} onValueChange={(v) => setFactoryId(v ?? '')} items={Object.fromEntries(factories.map(f => [f.id, f.name]))}>
          <SelectTrigger><SelectValue placeholder={t('settings.factory')} /></SelectTrigger>
          <SelectContent>
            {factories.map(f => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={areaId} onValueChange={(v) => setAreaId(v ?? '')} items={Object.fromEntries(areas.map(a => [a.id, a.name]))}>
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

      {/* No areas under this factory → the add button can't show (a machine
          needs an area). Say why instead of just hiding it, which read as
          "adding assets is broken". */}
      {!showForm && factoryId && areas.length === 0 && (
        <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
          {t('settings.noAreaAddFirst', '此工廠尚無區域，請先到「工廠與區域管理」新增區域，才能在此新增機器/項目。')}
        </p>
      )}

      {showForm && (
        <div className="bg-gray-50 p-4 rounded-lg space-y-3">
          <p className="text-sm font-medium text-gray-700">{editingId ? t('settings.editAsset') : t('settings.addAsset')}</p>
          <div>
            <Label>{t('settings.assetCategory')}</Label>
            <Select value={category} onValueChange={(v) => setCategory(v ?? 'machine')} items={Object.fromEntries(CATEGORIES.map(c => [c.value, t(c.labelKey, c.label)]))}>
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
                <Button size="icon" className="h-10 w-10" variant="outline" onClick={() => startEdit(a)}>
                  <Pencil className="w-4 h-4" />
                </Button>
                <Button
                  size="icon" className="h-10 w-10" variant="outline"
                  onClick={() => scrap(a.id, a.machine_name)}
                  title={t('settings.scrapAsset', '報廢（保留歷史，從列表移除）')}
                >
                  <Archive className="w-4 h-4 text-amber-600" />
                </Button>
                <Button size="icon" className="h-10 w-10" variant="outline" onClick={() => remove(a.id)}>
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
