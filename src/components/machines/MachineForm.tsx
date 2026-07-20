'use client'

import { useEffect, useState } from 'react'
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
import { Loader2 } from 'lucide-react'
import { useI18n } from '@/lib/i18n'

interface Area {
  id: string
  code: string
  factory_id: string
  name: string
}

interface Profile {
  id: string
  full_name: string
}

interface Machine {
  id: string
  area_id: string
  machine_code: string
  machine_name: string
  brand: string | null
  model: string | null
  serial_number: string | null
  purchase_date: string | null
  install_date: string | null
  owner_id: string | null
  maintenance_cycle: number
  status: string
  remarks: string | null
}

interface Props {
  machine?: Machine
}

export default function MachineForm({ machine }: Props) {
  const router = useRouter()
  const supabase = createClient()
  const { t } = useI18n()

  const [areas, setAreas] = useState<Area[]>([])
  const [owners, setOwners] = useState<Profile[]>([])

  const [areaId, setAreaId] = useState(machine?.area_id || '')
  const [code, setCode] = useState(machine?.machine_code || '')
  const [name, setName] = useState(machine?.machine_name || '')
  const [brand, setBrand] = useState(machine?.brand || '')
  const [model, setModel] = useState(machine?.model || '')
  const [serial, setSerial] = useState(machine?.serial_number || '')
  const [purchaseDate, setPurchaseDate] = useState(machine?.purchase_date || '')
  const [installDate, setInstallDate] = useState(machine?.install_date || '')
  const [ownerId, setOwnerId] = useState(machine?.owner_id || '')
  const [maintenanceCycle, setMaintenanceCycle] = useState(machine?.maintenance_cycle?.toString() || '30')
  const [status, setStatus] = useState(machine?.status || 'running')
  const [remarks, setRemarks] = useState(machine?.remarks || '')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    async function load() {
      const [{ data: a }, { data: p }] = await Promise.all([
        supabase.from('areas').select('*, factory_id').order('name'),
        supabase.from('profiles').select('*').eq('is_active', true).order('full_name'),
      ])
      setAreas(a ?? [])
      setOwners(p ?? [])
    }
    load()
    // Mount-only load. `supabase` is intentionally omitted: createClient()
    // returns a new client instance every call (not memoized), so adding it
    // here would re-run this effect on every render instead of once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])


  async function submit() {
    if (!areaId || !name) {
      toast.error(t('machineForm.completeAreaName', '請填寫區域和機器名稱'))
      return
    }
    // machines.factory_id is NOT NULL with no default and no trigger deriving
    // it from area_id — omitting it made every insert from this form fail.
    const factoryId = areas.find(a => a.id === areaId)?.factory_id
    if (!factoryId) {
      toast.error(t('machineForm.completeAreaName', '請填寫區域和機器名稱'))
      return
    }
    setSubmitting(true)
    try {
      const payload = {
        factory_id: factoryId,
        area_id: areaId,
        machine_code: code || null,
        machine_name: name,
        brand: brand || null,
        model: model || null,
        serial_number: serial || null,
        purchase_date: purchaseDate || null,
        install_date: installDate || null,
        owner_id: ownerId || null,
        maintenance_cycle: Number(maintenanceCycle),
        status,
        remarks: remarks || null,
      }

      if (machine) {
        const { error } = await supabase.from('machines').update(payload).eq('id', machine.id)
        if (error) throw error
        toast.success(t('machineForm.updated', '機器已更新'))
      } else {
        const { error } = await supabase.from('machines').insert([payload])
        if (error) throw error
        toast.success(t('machineForm.added', '機器已新增'))
      }
      router.push('/machines')
      router.refresh()
    } catch (err) {
      // 23505 on (factory_id, machine_code) — say what's wrong instead of
      // showing the raw Postgres unique-violation message.
      const isDupCode = !!err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === '23505'
      toast.error(
        isDupCode
          ? t('machineForm.dupCode', '此機器代碼在此工廠已被使用')
          : err instanceof Error ? err.message : t('machineForm.saveFailed', '儲存機器失敗')
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
      <h2 className="text-lg font-semibold text-gray-900">
        {machine ? t('machineForm.editTitle', '編輯機器') : t('machineForm.addTitle', '新增機器')}
      </h2>

      {/* Area Selection */}
      <div>
        <Label>{t('machineForm.area', '區域 / Area')} <span className="text-red-500">*</span></Label>
        <Select value={areaId} onValueChange={(v) => setAreaId(v ?? '')} disabled={!!machine} items={Object.fromEntries(areas.map(a => [a.id, a.name]))}>
          <SelectTrigger className="mt-1"><SelectValue placeholder={t('machineForm.selectArea', '選擇區域')} /></SelectTrigger>
          <SelectContent>
            {areas.map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>


      {/* Machine Code */}
      <div>
        <Label>{t('machineForm.code', '機器代碼（選填）')}</Label>
        <Input
          value={code}
          onChange={e => setCode(e.target.value.toUpperCase())}
          placeholder={t('machineForm.codePlaceholder', '例如 M001、PUMP-01（可留空）')}
          className="mt-1 font-mono"
        />
      </div>

      {/* Machine Name */}
      <div>
        <Label>{t('machineForm.name', '機器名稱')} <span className="text-red-500">*</span></Label>
        <Input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder={t('machineForm.namePlaceholder', '例如 Homogenizer Line 1')}
          className="mt-1"
        />
      </div>

      {/* Brand, Model, Serial */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <Label>Brand</Label>
          <Input value={brand} onChange={e => setBrand(e.target.value)} placeholder="e.g., GEA" className="mt-1" />
        </div>
        <div>
          <Label>Model</Label>
          <Input value={model} onChange={e => setModel(e.target.value)} placeholder="e.g., Ariete 3160" className="mt-1" />
        </div>
        <div>
          <Label>{t('machineForm.serial', '序號')}</Label>
          <Input value={serial} onChange={e => setSerial(e.target.value)} placeholder="Serial" className="mt-1" />
        </div>
      </div>

      {/* Dates */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <Label>{t('machineForm.purchaseDate', '購買日期')}</Label>
          <Input type="date" value={purchaseDate} onChange={e => setPurchaseDate(e.target.value)} className="mt-1" />
        </div>
        <div>
          <Label>{t('machineForm.installDate', '安裝日期')}</Label>
          <Input type="date" value={installDate} onChange={e => setInstallDate(e.target.value)} className="mt-1" />
        </div>
      </div>

      {/* Owner & Maintenance */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <Label>{t('machineForm.pic', '負責人 (PIC)')}</Label>
          <Select value={ownerId} onValueChange={(v) => setOwnerId(v ?? '')} items={Object.fromEntries(owners.map(o => [o.id, o.full_name]))}>
            <SelectTrigger className="mt-1"><SelectValue placeholder={t('machineForm.optional', '選填')} /></SelectTrigger>
            <SelectContent>
              {owners.map(o => <SelectItem key={o.id} value={o.id}>{o.full_name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>{t('machineForm.maintenanceCycle', '保養週期（天）')}</Label>
          <Input
            type="number"
            value={maintenanceCycle}
            onChange={e => setMaintenanceCycle(e.target.value)}
            min="1"
            max="365"
            className="mt-1"
          />
        </div>
      </div>

      {/* Status */}
      <div>
        <Label>{t('machineForm.status', '狀態')}</Label>
        <Select value={status} onValueChange={(v) => setStatus(v ?? '')} items={{ running: `🟢 ${t('machineStatus.running', 'Running')}`, repairing: `🟡 ${t('machineStatus.repairing', 'Repairing')}`, standby: `⚪ ${t('machineStatus.standby', 'Standby')}`, scrapped: `⛔ ${t('machineStatus.scrapped', 'Scrapped')}` }}>
          <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="running">🟢 {t('machineStatus.running', 'Running')}</SelectItem>
            <SelectItem value="repairing">🟡 {t('machineStatus.repairing', 'Repairing')}</SelectItem>
            <SelectItem value="standby">⚪ {t('machineStatus.standby', 'Standby')}</SelectItem>
            <SelectItem value="scrapped">⛔ {t('machineStatus.scrapped', 'Scrapped')}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Remarks */}
      <div>
        <Label>{t('machineForm.remarks', '備註')}</Label>
        <Textarea
          value={remarks}
          onChange={e => setRemarks(e.target.value)}
          placeholder={t('machineForm.remarksPlaceholder', '關於機器的額外資訊...')}
          className="mt-1"
          rows={2}
        />
      </div>

      <Button onClick={submit} disabled={submitting} className="w-full">
        {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
        {machine ? t('machineForm.update', '更新機器') : t('machineForm.add', '新增機器')}
      </Button>
    </div>
  )
}
