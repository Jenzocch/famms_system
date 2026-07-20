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
import { Loader2, Trash2, Plus } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import { useVendors, invalidateVendors } from '@/lib/useVendors'

interface Factory { id: string; name: string }

const ALL_FACTORIES = '__all__'

export default function VendorManager() {
  const { t } = useI18n()
  const supabase = createClient()
  const { vendors, loading } = useVendors()
  const [factories, setFactories] = useState<Factory[]>([])
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [factoryId, setFactoryId] = useState(ALL_FACTORIES)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    supabase.from('factories').select('id, name').order('name').then(({ data }) => setFactories(data ?? []))
    // Mount-only load. `supabase` is intentionally omitted: createClient()
    // returns a new client instance every call (not memoized), so adding it
    // here would re-run this effect on every render instead of once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const factoryName = (id: string | null) =>
    id ? (factories.find(f => f.id === id)?.name ?? id) : t('settings.vendorAllFactories', '所有工廠')

  function startAdd() {
    setName('')
    setFactoryId(ALL_FACTORIES)
    setShowForm(true)
  }

  async function add() {
    const trimmed = name.trim()
    if (!trimmed) { toast.error(t('settings.vendorNameRequired', '請輸入廠商名稱')); return }
    setSubmitting(true)
    try {
      const { error } = await supabase.from('vendors').insert([{
        name: trimmed,
        factory_id: factoryId === ALL_FACTORIES ? null : factoryId,
        is_active: true,
      }])
      if (error) throw error
      toast.success(t('settings.vendorAdded', '廠商已新增'))
      setShowForm(false)
      await invalidateVendors()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('settings.addFailed'))
    } finally {
      setSubmitting(false)
    }
  }

  async function remove(id: string) {
    if (!confirm(t('settings.vendorConfirmDelete', '確定要移除這個廠商嗎？'))) return
    try {
      // Soft-delete so past incidents' assigned_to text (already saved) is
      // unaffected — only the roster picker stops offering it.
      const { error } = await supabase.from('vendors').update({ is_active: false }).eq('id', id)
      if (error) throw error
      toast.success(t('settings.deleted'))
      await invalidateVendors()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('settings.deleteFailed'))
    }
  }

  if (loading) return <div className="text-center text-gray-500 text-sm py-2">{t('settings.loading')}</div>

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500">{t('settings.vendorHint', '外包/廠商名冊 — 派工時可重複選用，取代每次手打名字')}</p>

      {!showForm && (
        <Button onClick={startAdd} className="gap-2">
          <Plus className="w-4 h-4" /> {t('settings.addVendor', '新增廠商')}
        </Button>
      )}

      {showForm && (
        <div className="bg-gray-50 p-4 rounded-lg space-y-3">
          <div>
            <Label>{t('settings.vendorName', '廠商名稱')}</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g., ABC 外包" className="mt-1" />
          </div>
          <div>
            <Label>{t('settings.vendorFactoryScope', '適用工廠')}</Label>
            <Select value={factoryId} onValueChange={(v) => setFactoryId(v ?? ALL_FACTORIES)} items={{ [ALL_FACTORIES]: t('settings.vendorAllFactories', '所有工廠'), ...Object.fromEntries(factories.map(f => [f.id, f.name])) }}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_FACTORIES}>{t('settings.vendorAllFactories', '所有工廠')}</SelectItem>
                {factories.map(f => (
                  <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-2">
            <Button onClick={add} disabled={submitting}>
              {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {t('settings.create')}
            </Button>
            <Button variant="outline" onClick={() => setShowForm(false)}>
              {t('settings.cancel')}
            </Button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {vendors.map(v => (
          <div key={v.id} className="flex items-center justify-between p-3 border rounded-lg">
            <div>
              <p className="font-medium text-sm">{v.name}</p>
              <p className="text-xs text-gray-500">{factoryName(v.factory_id)}</p>
            </div>
            <Button size="icon" className="h-10 w-10" variant="outline" onClick={() => remove(v.id)}>
              <Trash2 className="w-4 h-4 text-red-600" />
            </Button>
          </div>
        ))}
        {vendors.length === 0 && (
          <p className="text-center text-sm text-gray-400 py-4">{t('settings.vendorEmpty', '尚無廠商，點擊上方新增')}</p>
        )}
      </div>
    </div>
  )
}
