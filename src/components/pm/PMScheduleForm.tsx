'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { PMType, PM_TYPE_LABELS } from '@/types'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { toast } from 'sonner'
import { Loader2, Plus, X } from 'lucide-react'
import { useI18n } from '@/lib/i18n'

interface MachineOption {
  id: string
  machine_code: string
  machine_name: string
}

const PM_TYPES = Object.keys(PM_TYPE_LABELS) as PMType[]

export default function PMScheduleForm() {
  const router = useRouter()
  const supabase = createClient()
  const { t } = useI18n()

  const [machines, setMachines] = useState<MachineOption[]>([])
  const [machineId, setMachineId] = useState('')
  const [pmType, setPmType] = useState<PMType | ''>('')
  const [description, setDescription] = useState('')
  const [firstDueDate, setFirstDueDate] = useState('')
  const [checklist, setChecklist] = useState<string[]>([])
  const [checklistInput, setChecklistInput] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('machines')
        .select('id, machine_code, machine_name')
        .neq('status', 'scrapped')
        .order('machine_code')
      setMachines(data ?? [])
    }
    load()
  }, [])

  function addChecklistItem() {
    const item = checklistInput.trim()
    if (!item) return
    setChecklist([...checklist, item])
    setChecklistInput('')
  }

  function removeChecklistItem(idx: number) {
    setChecklist(checklist.filter((_, i) => i !== idx))
  }

  async function submit() {
    if (!machineId || !pmType) {
      toast.error('Pilih mesin dan tipe PM')
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch('/api/pm/schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          machine_id: machineId,
          pm_type: pmType,
          description: description || undefined,
          checklist: checklist.length ? checklist : undefined,
          first_due_date: firstDueDate || undefined,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Gagal membuat jadwal PM')
      toast.success('Jadwal PM dibuat')
      router.push('/pm')
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal membuat jadwal PM')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
      <h2 className="text-lg font-semibold text-gray-900">Buat Jadwal PM</h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <Label>Mesin <span className="text-red-500">*</span></Label>
          <Select value={machineId} onValueChange={(v) => setMachineId(v ?? '')} items={Object.fromEntries(machines.map(m => [m.id, `${m.machine_code} — ${m.machine_name}`]))}>
            <SelectTrigger className="mt-1"><SelectValue placeholder="Pilih mesin" /></SelectTrigger>
            <SelectContent>
              {machines.map(m => (
                <SelectItem key={m.id} value={m.id}>
                  {m.machine_code} — {m.machine_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {machines.length === 0 && (
            <p className="text-xs text-amber-600 mt-1">Belum ada mesin. Tambah mesin dulu.</p>
          )}
        </div>
        <div>
          <Label>{t('pm.typeLabel', '保養類型')} <span className="text-red-500">*</span></Label>
          <Select value={pmType} onValueChange={(v) => setPmType((v ?? '') as PMType)} items={Object.fromEntries(PM_TYPES.map(pt => [pt, t(`pmType.${pt}`, PM_TYPE_LABELS[pt])]))}>
            <SelectTrigger className="mt-1"><SelectValue placeholder={t('pm.selectFrequency', '選擇頻率')} /></SelectTrigger>
            <SelectContent>
              {PM_TYPES.map(pt => <SelectItem key={pt} value={pt}>{t(`pmType.${pt}`, PM_TYPE_LABELS[pt])}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div>
        <Label>Tanggal Jadwal Pertama</Label>
        <Input
          type="date"
          value={firstDueDate}
          onChange={e => setFirstDueDate(e.target.value)}
          className="mt-1"
        />
        <p className="text-xs text-gray-400 mt-1">
          Kosongkan untuk otomatis (1 interval dari hari ini).
        </p>
      </div>

      <div>
        <Label>Deskripsi</Label>
        <Textarea
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="Ringkasan pekerjaan PM..."
          rows={2}
          className="mt-1"
        />
      </div>

      <div>
        <Label>Checklist Item</Label>
        <div className="flex gap-2 mt-1">
          <Input
            value={checklistInput}
            onChange={e => setChecklistInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addChecklistItem() } }}
            placeholder="e.g., Cek pelumasan bearing"
          />
          <Button type="button" variant="outline" onClick={addChecklistItem}>
            <Plus className="w-4 h-4" />
          </Button>
        </div>
        {checklist.length > 0 && (
          <ul className="mt-3 space-y-2">
            {checklist.map((item, idx) => (
              <li key={idx} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2 text-sm">
                <span className="text-gray-700">{idx + 1}. {item}</span>
                <button
                  type="button"
                  onClick={() => removeChecklistItem(idx)}
                  className="text-gray-400 hover:text-red-500"
                >
                  <X className="w-4 h-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Button onClick={submit} disabled={submitting} className="w-full">
        {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
        Buat Jadwal PM
      </Button>
    </div>
  )
}
