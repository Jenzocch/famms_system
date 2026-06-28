'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { toast } from 'sonner'
import { Loader2, Plus, Trash2, Edit2 } from 'lucide-react'

interface Factory { id: string; name: string }
interface Area { id: string; factory_id: string; name: string }
interface Machine {
  id: string
  machine_name: string
  machine_code: string | null
  maintenance_cycle: number
}
interface PMSchedule {
  id: string
  machine_id: string
  pm_type: string
  interval_days: number | null
  description: string | null
  is_active: boolean
  machine_name?: string
  machine_code?: string | null
}

const PM_TYPES = [
  { value: 'daily', label: '每日' },
  { value: 'weekly', label: '每週' },
  { value: 'monthly', label: '每月' },
  { value: 'quarterly', label: '每季' },
  { value: 'half_yearly', label: '每半年' },
  { value: 'yearly', label: '每年' },
  { value: 'custom', label: '自訂天數' },
]

// Human label for a schedule's cadence, including custom "每 N 天".
function pmTypeLabel(pmType: string, intervalDays?: number | null): string {
  if (pmType === 'custom') return intervalDays ? `每 ${intervalDays} 天` : '自訂天數'
  return PM_TYPES.find(t => t.value === pmType)?.label || pmType
}

export default function PMScheduleManager() {
  const supabase = createClient()

  const [factories, setFactories] = useState<Factory[]>([])
  const [areas, setAreas] = useState<Area[]>([])
  const [machines, setMachines] = useState<Machine[]>([])
  const [schedules, setSchedules] = useState<PMSchedule[]>([])
  const [loading, setLoading] = useState(true)

  const [factoryId, setFactoryId] = useState('')
  const [areaId, setAreaId] = useState('')
  const [machineId, setMachineId] = useState('')
  const [pmType, setPmType] = useState('monthly')
  const [intervalDays, setIntervalDays] = useState('')
  const [description, setDescription] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  useEffect(() => {
    supabase.from('factories').select('*').order('name').then(({ data }) => {
      setFactories(data ?? [])
      if (data && data.length > 0) setFactoryId(data[0].id)
      setLoading(false)
    })
    loadSchedules()
  }, [])

  useEffect(() => {
    if (!factoryId) { setAreas([]); setAreaId(''); return }
    supabase.from('areas').select('*').eq('factory_id', factoryId).order('name')
      .then(({ data }) => setAreas(data ?? []))
    setAreaId('')
  }, [factoryId])

  useEffect(() => {
    if (!areaId) { setMachines([]); setMachineId(''); return }
    supabase.from('machines').select('id, machine_name, machine_code, maintenance_cycle')
      .eq('area_id', areaId).neq('status', 'scrapped').order('machine_name')
      .then(({ data }) => setMachines(data ?? []))
    setMachineId('')
  }, [areaId])

  async function loadSchedules() {
    const { data } = await supabase
      .from('pm_schedules')
      .select(`
        id, machine_id, pm_type, interval_days, description, is_active,
        machines:machines(machine_name, machine_code)
      `)
      .eq('is_active', true)
      .order('created_at', { ascending: false })

    if (data) {
      const mapped = (data as any[]).map(s => ({
        id: s.id,
        machine_id: s.machine_id,
        pm_type: s.pm_type,
        interval_days: s.interval_days ?? null,
        description: s.description,
        is_active: s.is_active,
        machine_name: s.machines?.machine_name || '',
        machine_code: s.machines?.machine_code || null,
      }))
      setSchedules(mapped)
    }
  }

  async function submit() {
    if (!machineId) {
      toast.error('請選擇機器')
      return
    }

    const days = parseInt(intervalDays, 10)
    if (pmType === 'custom' && (!days || days < 1)) {
      toast.error('請輸入自訂天數（至少 1 天）')
      return
    }
    const intervalValue = pmType === 'custom' ? days : null

    setSubmitting(true)
    try {
      if (editingId) {
        const { error } = await supabase
          .from('pm_schedules')
          .update({ pm_type: pmType, interval_days: intervalValue, description: description || null })
          .eq('id', editingId)
        if (error) throw error
        toast.success('已更新保養計畫')
      } else {
        const { error } = await supabase
          .from('pm_schedules')
          .insert({
            machine_id: machineId,
            pm_type: pmType,
            interval_days: intervalValue,
            description: description || null,
            is_active: true,
          })
        if (error) throw error
        toast.success('已建立保養計畫')
      }
      setMachineId('')
      setPmType('monthly')
      setIntervalDays('')
      setDescription('')
      setShowForm(false)
      setEditingId(null)
      loadSchedules()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '操作失敗')
    } finally {
      setSubmitting(false)
    }
  }

  async function removeSchedule(id: string) {
    if (!confirm('確認停用此保養計畫？')) return
    try {
      const { error } = await supabase
        .from('pm_schedules')
        .update({ is_active: false })
        .eq('id', id)
      if (error) throw error
      toast.success('已停用')
      loadSchedules()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '刪除失敗')
    }
  }

  if (loading) return <div className="text-center text-gray-500 text-sm py-4">載入中...</div>

  // value→label maps so Base UI <SelectValue> shows names, not raw IDs/codes
  const factoryItems = Object.fromEntries(factories.map(f => [f.id, f.name]))
  const areaItems = Object.fromEntries(areas.map(a => [a.id, a.name]))
  const machineItems = Object.fromEntries(
    machines.map(m => [m.id, `${m.machine_code ? `[${m.machine_code}] ` : ''}${m.machine_name}`])
  )
  const pmTypeItems = Object.fromEntries(PM_TYPES.map(t => [t.value, t.label]))

  return (
    <div className="space-y-4">
      {!showForm && (
        <Button onClick={() => setShowForm(true)} className="gap-2 w-full">
          <Plus className="w-4 h-4" /> 新增保養計畫
        </Button>
      )}

      {showForm && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-3">
          <p className="text-sm font-medium text-blue-900">
            {editingId ? '編輯保養計畫' : '新增保養計畫'}
          </p>

          <Select value={factoryId} onValueChange={(v) => setFactoryId(v ?? '')} items={factoryItems}>
            <SelectTrigger><SelectValue placeholder="選擇工廠" /></SelectTrigger>
            <SelectContent>
              {factories.map(f => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
            </SelectContent>
          </Select>

          {areas.length > 0 && (
            <Select value={areaId} onValueChange={(v) => setAreaId(v ?? '')} items={areaItems}>
              <SelectTrigger><SelectValue placeholder="選擇區域" /></SelectTrigger>
              <SelectContent>
                {areas.map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}

          {machines.length > 0 && (
            <Select value={machineId} onValueChange={(v) => setMachineId(v ?? '')} items={machineItems}>
              <SelectTrigger><SelectValue placeholder="選擇機器 *" /></SelectTrigger>
              <SelectContent>
                {machines.map(m => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.machine_code ? `[${m.machine_code}] ` : ''}{m.machine_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <div>
            <Label>保養頻率</Label>
            <Select value={pmType} onValueChange={(v) => setPmType(v ?? 'monthly')} items={pmTypeItems}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PM_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {pmType === 'custom' && (
            <div>
              <Label>每幾天保養一次</Label>
              <div className="mt-1 flex items-center gap-2">
                <span className="text-sm text-gray-500">每</span>
                <input
                  type="number"
                  min={1}
                  value={intervalDays}
                  onChange={e => setIntervalDays(e.target.value)}
                  placeholder="例如 45"
                  className="w-24 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                />
                <span className="text-sm text-gray-500">天</span>
              </div>
            </div>
          )}

          <div>
            <Label>備註（可選）</Label>
            <input
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="例如：檢查潤滑油、校正參數..."
              className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            />
          </div>

          <div className="flex gap-2">
            <Button onClick={submit} disabled={submitting || !machineId}>
              {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {editingId ? '更新' : '建立'}
            </Button>
            <Button variant="outline" onClick={() => { setShowForm(false); setEditingId(null) }}>取消</Button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {schedules.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-4">尚無保養計畫</p>
        ) : (
          schedules.map(s => (
            <div key={s.id} className="flex items-center justify-between p-3 border rounded-lg bg-white">
              <div className="flex-1">
                <p className="text-sm font-medium">
                  {s.machine_code ? `[${s.machine_code}] ` : ''}{s.machine_name}
                </p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {pmTypeLabel(s.pm_type, s.interval_days)}
                  {s.description && ` · ${s.description}`}
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setEditingId(s.id)
                    setMachineId(s.machine_id)
                    setPmType(s.pm_type)
                    setIntervalDays(s.interval_days ? String(s.interval_days) : '')
                    setDescription(s.description || '')
                    setShowForm(true)
                  }}
                >
                  <Edit2 className="w-4 h-4" />
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => removeSchedule(s.id)}
                >
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
