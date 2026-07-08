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
import { loadFactories, type Factory } from '@/lib/useFactories'
import { loadMyFactoryId } from '@/lib/useMyFactory'

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

  const [factories, setFactories] = useState<Factory[]>([])
  const [factoryId, setFactoryId] = useState('')
  const [machines, setMachines] = useState<MachineOption[]>([])
  const [machineId, setMachineId] = useState('')
  const [pmType, setPmType] = useState<PMType | ''>('')
  const [description, setDescription] = useState('')
  const [firstDueDate, setFirstDueDate] = useState('')
  const [checklist, setChecklist] = useState<string[]>([])
  const [checklistInput, setChecklistInput] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Preselect the user's own factory (fall back to the first one) — same
  // behavior as the PM page, so the machine list below is factory-scoped.
  useEffect(() => {
    Promise.all([loadFactories(), loadMyFactoryId()]).then(([facs, myFactoryId]) => {
      setFactories(facs ?? [])
      if (!facs || facs.length === 0) return
      const preferred = myFactoryId && facs.some(f => f.id === myFactoryId)
        ? myFactoryId : facs[0].id
      setFactoryId(prev => prev || preferred)
    })
  }, [])

  // Machines scoped to the chosen factory — a schedule must never be created
  // against another factory's machine by accident.
  useEffect(() => {
    if (!factoryId) { setMachines([]); setMachineId(''); return }
    supabase
      .from('machines')
      .select('id, machine_code, machine_name')
      .eq('factory_id', factoryId)
      .neq('status', 'scrapped')
      .order('machine_code')
      .then(({ data }) => setMachines(data ?? []))
    setMachineId('')
  }, [factoryId])

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
      toast.error(t('pmForm.selectMachineType', '請選擇機器和保養類型'))
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
      if (!res.ok) throw new Error(json.error || t('pmForm.createFailed', '建立保養計畫失敗'))
      toast.success(t('pmForm.created', '保養計畫已建立'))
      router.push('/pm')
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('pmForm.createFailed', '建立保養計畫失敗'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
      <h2 className="text-lg font-semibold text-gray-900">{t('pmForm.title', '建立保養計畫')}</h2>

      <div>
        <Label>{t('settings.factory', '工廠')} <span className="text-red-500">*</span></Label>
        <Select value={factoryId} onValueChange={(v) => setFactoryId(v ?? '')} items={Object.fromEntries(factories.map(f => [f.id, f.name]))}>
          <SelectTrigger className="mt-1"><SelectValue placeholder={t('report.selectFactory', '選擇工廠')} /></SelectTrigger>
          <SelectContent>
            {factories.map(f => (
              <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <Label>{t('pmForm.machine', '機器')} <span className="text-red-500">*</span></Label>
          <Select value={machineId} onValueChange={(v) => setMachineId(v ?? '')} items={Object.fromEntries(machines.map(m => [m.id, `${m.machine_code} — ${m.machine_name}`]))}>
            <SelectTrigger className="mt-1"><SelectValue placeholder={t('pmForm.selectMachine', '選擇機器')} /></SelectTrigger>
            <SelectContent>
              {machines.map(m => (
                <SelectItem key={m.id} value={m.id}>
                  {m.machine_code} — {m.machine_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {factoryId && machines.length === 0 && (
            <p className="text-xs text-amber-600 mt-1">{t('pmForm.noMachines', '尚無機器，請先新增機器')}</p>
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
        <Label>{t('pmForm.firstDueDate', '首次預定日期')}</Label>
        <Input
          type="date"
          value={firstDueDate}
          onChange={e => setFirstDueDate(e.target.value)}
          className="mt-1"
        />
        <p className="text-xs text-gray-400 mt-1">
          {t('pmForm.firstDueDateHint', '留空則自動設為今天起一個週期後')}
        </p>
      </div>

      <div>
        <Label>{t('pmForm.description', '說明')}</Label>
        <Textarea
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder={t('pmForm.descriptionPlaceholder', '保養工作摘要...')}
          rows={2}
          className="mt-1"
        />
      </div>

      <div>
        <Label>{t('pmForm.checklistItem', '檢查清單項目')}</Label>
        <div className="flex gap-2 mt-1">
          <Input
            value={checklistInput}
            onChange={e => setChecklistInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addChecklistItem() } }}
            placeholder={t('pmForm.checklistPlaceholder', '例如：檢查 bearing 潤滑')}
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
        {t('pmForm.create', '建立計畫')}
      </Button>
    </div>
  )
}
