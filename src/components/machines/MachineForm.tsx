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
import { Loader2, Zap } from 'lucide-react'

interface Area {
  id: string
  code: string
  factory_id: string
  name: string
}

interface Factory {
  id: string
  code: string
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

  const [areas, setAreas] = useState<Area[]>([])
  const [factories, setFactories] = useState<Factory[]>([])
  const [owners, setOwners] = useState<Profile[]>([])

  const [areaId, setAreaId] = useState(machine?.area_id || '')
  const [typeCode, setTypeCode] = useState('')
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
  const [generating, setGenerating] = useState(false)

  useEffect(() => {
    async function load() {
      const [{ data: a }, { data: f }, { data: p }] = await Promise.all([
        supabase.from('areas').select('*, factory_id').order('name'),
        supabase.from('factories').select('*').order('code'),
        supabase.from('profiles').select('*').eq('is_active', true).order('full_name'),
      ])
      setAreas(a ?? [])
      setFactories(f ?? [])
      setOwners(p ?? [])
    }
    load()
  }, [])

  const currentArea = areas.find(a => a.id === areaId)
  const currentFactory = currentArea ? factories.find(f => f.id === currentArea.factory_id) : null
  const factoryCode = currentFactory?.code || ''

  async function generateCode() {
    if (!factoryCode || !typeCode.trim()) {
      toast.error('Pilih area dan masukkan kode tipe mesin')
      return
    }

    setGenerating(true)
    try {
      // Find highest sequence for this prefix
      const prefix = `${factoryCode}-${typeCode.toUpperCase()}-`
      const { data: existing } = await supabase
        .from('machines')
        .select('machine_code')
        .like('machine_code', `${prefix}%`)
        .order('machine_code', { ascending: false })
        .limit(1)

      let nextSeq = 1
      if (existing && existing.length > 0) {
        const last = existing[0].machine_code
        const match = last.match(/-(\d+)$/)
        if (match) {
          nextSeq = parseInt(match[1]) + 1
        }
      }

      const newCode = `${prefix}${String(nextSeq).padStart(3, '0')}`
      setCode(newCode)
      toast.success(`編號 ${newCode} 已生成`)
    } catch (err) {
      toast.error('生成編號失敗')
    } finally {
      setGenerating(false)
    }
  }

  async function submit() {
    if (!areaId || !code || !name) {
      toast.error('Lengkapi area, kode, dan nama mesin')
      return
    }
    setSubmitting(true)
    try {
      const payload = {
        area_id: areaId,
        machine_code: code,
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
        toast.success('Mesin diperbarui')
      } else {
        const { error } = await supabase.from('machines').insert([payload])
        if (error) throw error
        toast.success('Mesin ditambahkan')
      }
      router.push('/machines')
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menyimpan mesin')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
      <h2 className="text-lg font-semibold text-gray-900">
        {machine ? 'Edit Mesin' : 'Tambah Mesin Baru'}
      </h2>

      {/* Area Selection */}
      <div>
        <Label>Daerah / Area <span className="text-red-500">*</span></Label>
        <Select value={areaId} onValueChange={(v) => setAreaId(v ?? '')} disabled={!!machine}>
          <SelectTrigger className="mt-1"><SelectValue placeholder="Pilih area" /></SelectTrigger>
          <SelectContent>
            {areas.map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
          </SelectContent>
        </Select>
        {factoryCode && (
          <p className="text-xs text-gray-500 mt-1">
            Pabrik: <span className="font-mono font-bold">{factoryCode}</span>
          </p>
        )}
      </div>

      {/* Auto-Generate Code */}
      {!machine && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-blue-600" />
            <span className="text-sm font-medium text-blue-900">Auto-Generate Kode Mesin</span>
          </div>
          <div className="space-y-2">
            <Label htmlFor="typeCode">Kode Tipe (2-3 huruf)</Label>
            <div className="flex gap-2">
              <Input
                id="typeCode"
                value={typeCode}
                onChange={e => setTypeCode(e.target.value.toUpperCase())}
                placeholder="e.g., HMG, PMP, MIX, MTR, CMP, CNV"
                maxLength={3}
                disabled={!factoryCode}
                className="flex-1"
              />
              <Button
                type="button"
                onClick={generateCode}
                disabled={!factoryCode || !typeCode.trim() || generating}
                variant="outline"
              >
                {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Generate'}
              </Button>
            </div>
            <p className="text-xs text-gray-500">
              Contoh: HMG=Homogenizer, PMP=Pump, MIX=Mixer, MTR=Motor, CMP=Compressor, CNV=Conveyor
            </p>
          </div>
        </div>
      )}

      {/* Machine Code */}
      <div>
        <Label>Kode Mesin <span className="text-red-500">*</span></Label>
        <Input
          value={code}
          onChange={e => setCode(e.target.value.toUpperCase())}
          placeholder="e.g., DIN-HMG-001"
          disabled={!!machine}
          className="mt-1 font-mono"
        />
      </div>

      {/* Machine Name */}
      <div>
        <Label>Nama Mesin <span className="text-red-500">*</span></Label>
        <Input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="e.g., Homogenizer Line 1"
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
          <Label>No. Seri</Label>
          <Input value={serial} onChange={e => setSerial(e.target.value)} placeholder="Serial" className="mt-1" />
        </div>
      </div>

      {/* Dates */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <Label>Tanggal Pembelian</Label>
          <Input type="date" value={purchaseDate} onChange={e => setPurchaseDate(e.target.value)} className="mt-1" />
        </div>
        <div>
          <Label>Tanggal Instalasi</Label>
          <Input type="date" value={installDate} onChange={e => setInstallDate(e.target.value)} className="mt-1" />
        </div>
      </div>

      {/* Owner & Maintenance */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <Label>PIC (Person in Charge)</Label>
          <Select value={ownerId} onValueChange={(v) => setOwnerId(v ?? '')}>
            <SelectTrigger className="mt-1"><SelectValue placeholder="Optional" /></SelectTrigger>
            <SelectContent>
              {owners.map(o => <SelectItem key={o.id} value={o.id}>{o.full_name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Siklus Maintenance (hari)</Label>
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
        <Label>Status</Label>
        <Select value={status} onValueChange={(v) => setStatus(v ?? '')}>
          <SelectTrigger className="mt-1"><SelectValue placeholder="running" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="running">🟢 Running</SelectItem>
            <SelectItem value="repairing">🟡 Repairing</SelectItem>
            <SelectItem value="standby">⚪ Standby</SelectItem>
            <SelectItem value="scrapped">⛔ Scrapped</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Remarks */}
      <div>
        <Label>Catatan</Label>
        <Textarea
          value={remarks}
          onChange={e => setRemarks(e.target.value)}
          placeholder="Informasi tambahan tentang mesin..."
          className="mt-1"
          rows={2}
        />
      </div>

      <Button onClick={submit} disabled={submitting} className="w-full">
        {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
        {machine ? 'Perbarui Mesin' : 'Tambah Mesin'}
      </Button>
    </div>
  )
}
