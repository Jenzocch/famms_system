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
import { Loader2, AlertTriangle } from 'lucide-react'
import { useI18n } from '@/lib/i18n'

interface Account { id: string; full_name: string | null }

// Mandatory RCA capture — rendered inline by ProgressUpdate when a close
// attempt is rejected with rca_required. Filing the RCA record here is what
// satisfies checkRCARequirement() so the SAME close attempt can be retried;
// see src/lib/rca.ts for the (machine_id, incident_type) trigger rule.
export default function RCAForm({
  machineId, incidentType, factoryId, occurrenceCount, onSaved,
}: {
  machineId: string
  incidentType: string
  factoryId: string
  occurrenceCount: number
  onSaved: () => void
}) {
  const supabase = createClient()
  const { t } = useI18n()

  const [accounts, setAccounts] = useState<Account[]>([])
  const [rootCause, setRootCause] = useState('')
  const [correctiveAction, setCorrectiveAction] = useState('')
  const [preventiveAction, setPreventiveAction] = useState('')
  const [responsiblePersonId, setResponsiblePersonId] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    supabase
      .from('profiles')
      .select('id, full_name')
      .eq('is_active', true)
      .order('full_name')
      .then(({ data }) => setAccounts((data ?? []) as Account[]))
    // Mount-only load. `supabase` is intentionally omitted: createClient()
    // returns a new client instance every call (not memoized), so adding it
    // here would re-run this effect on every render instead of once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function submit() {
    if (!rootCause.trim() || !correctiveAction.trim() || !preventiveAction.trim() || !responsiblePersonId || !dueDate) {
      toast.error(t('rca.fillRequired', '請完整填寫 RCA 所有欄位'))
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch('/api/rca', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          machine_id: machineId,
          incident_type: incidentType,
          factory_id: factoryId,
          root_cause: rootCause.trim(),
          corrective_action: correctiveAction.trim(),
          preventive_action: preventiveAction.trim(),
          responsible_person_id: responsiblePersonId,
          due_date: dueDate,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error || t('rca.saveFailed', 'RCA 儲存失敗'))
      toast.success(t('rca.saved', 'RCA 已儲存，正在繼續關閉工單…'))
      onSaved()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('rca.saveFailed', 'RCA 儲存失敗'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="rounded-lg border-2 border-red-300 bg-red-50 p-3 space-y-3">
      <div className="flex items-start gap-2">
        <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-red-800">
            {t('rca.gateHeading', '需先完成根本原因分析（RCA）')}
          </p>
          <p className="text-xs text-red-700 mt-0.5">
            {t('rca.gateHint', '同一台機器的同類問題在 90 天內已發生 {count} 次，請完成以下分析後才能結案').replace('{count}', String(occurrenceCount))}
          </p>
        </div>
      </div>

      <div>
        <Label className="text-sm">{t('rca.rootCause', '根本原因（為什麼會發生？）')} <span className="text-red-500">*</span></Label>
        <Textarea value={rootCause} onChange={e => setRootCause(e.target.value)} rows={2} className="mt-1" />
      </div>
      <div>
        <Label className="text-sm">{t('rca.correctiveAction', '矯正措施（如何修好？）')} <span className="text-red-500">*</span></Label>
        <Textarea value={correctiveAction} onChange={e => setCorrectiveAction(e.target.value)} rows={2} className="mt-1" />
      </div>
      <div>
        <Label className="text-sm">{t('rca.preventiveAction', '預防措施（如何避免再發生？）')} <span className="text-red-500">*</span></Label>
        <Textarea value={preventiveAction} onChange={e => setPreventiveAction(e.target.value)} rows={2} className="mt-1" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-sm">{t('rca.responsiblePerson', '負責人')} <span className="text-red-500">*</span></Label>
          <Select
            value={responsiblePersonId}
            onValueChange={v => setResponsiblePersonId(v ?? '')}
            items={Object.fromEntries(accounts.map(a => [a.id, a.full_name || t('report.unnamedAccount', '(未命名帳號)')]))}
          >
            <SelectTrigger className="mt-1"><SelectValue placeholder={t('rca.selectPerson', '選擇負責人')} /></SelectTrigger>
            <SelectContent>
              {accounts.map(a => (
                <SelectItem key={a.id} value={a.id}>{a.full_name || t('report.unnamedAccount', '(未命名帳號)')}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-sm">{t('rca.dueDate', '完成期限')} <span className="text-red-500">*</span></Label>
          <Input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className="mt-1" />
        </div>
      </div>

      <Button onClick={submit} disabled={submitting} className="w-full h-10 bg-red-600 hover:bg-red-700 text-white">
        {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
        {t('rca.submitAndClose', '送出 RCA 並繼續關閉')}
      </Button>
    </div>
  )
}
