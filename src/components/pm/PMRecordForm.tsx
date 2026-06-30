'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { PMDelayReason, PM_DELAY_REASON_LABELS } from '@/types'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import { toast } from 'sonner'
import { Loader2, CheckCircle2, SkipForward } from 'lucide-react'
import { useI18n } from '@/lib/i18n'

const DELAY_REASONS = Object.keys(PM_DELAY_REASON_LABELS) as PMDelayReason[]

export default function PMRecordForm({ recordId, checklist }: { recordId: string; checklist: string[] }) {
  const router = useRouter()
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<'completed' | 'skipped'>('completed')
  const [findings, setFindings] = useState('')
  const [cost, setCost] = useState('')
  const [delayReason, setDelayReason] = useState<PMDelayReason | ''>('')
  const [checked, setChecked] = useState<Record<number, boolean>>({})
  const [submitting, setSubmitting] = useState(false)

  async function submit() {
    if (mode === 'skipped' && !delayReason) {
      toast.error(t('pm.skipReasonRequired', '請填寫跳過原因'))
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch(`/api/pm/records/${recordId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: mode,
          findings: findings || undefined,
          cost: cost ? Number(cost) : undefined,
          delay_reason: mode === 'skipped' ? delayReason : undefined,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || t('pm.saveFailed', '儲存失敗'))
      toast.success(mode === 'completed' ? t('pm.savedComplete', '已記錄保養完成') : t('pm.savedSkip', '已標記為跳過'))
      setOpen(false)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('pm.saveFailed', '儲存失敗'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className="inline-flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition">
        <CheckCircle2 className="w-4 h-4" /> {t('pm.logMaintenance', '記錄保養')}
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('pm.recordComplete', '記錄保養完成')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Mode toggle — two large, clearly distinct choices */}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setMode('completed')}
              className={`flex flex-col items-center justify-center gap-1 rounded-lg border px-3 py-3 text-sm font-medium transition ${
                mode === 'completed' ? 'border-green-500 bg-green-50 text-green-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
            >
              <CheckCircle2 className="w-5 h-5" /> {t('pm.completeMaintenance', '完成保養')}
            </button>
            <button
              type="button"
              onClick={() => setMode('skipped')}
              className={`flex flex-col items-center justify-center gap-1 rounded-lg border px-3 py-3 text-sm font-medium transition ${
                mode === 'skipped' ? 'border-orange-500 bg-orange-50 text-orange-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
            >
              <SkipForward className="w-5 h-5" /> {t('pm.skipWithReason', '跳過（填原因）')}
            </button>
          </div>

          {mode === 'completed' && (
            <>
              {checklist.length > 0 && (
                <div>
                  <Label>{t('pm.checklist', '檢查項目')}</Label>
                  <ul className="mt-1 space-y-1">
                    {checklist.map((item, idx) => (
                      <li key={idx}>
                        <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={!!checked[idx]}
                            onChange={e => setChecked({ ...checked, [idx]: e.target.checked })}
                            className="rounded border-gray-300"
                          />
                          {item}
                        </label>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div>
                <Label>{t('pm.findingsNotes', '保養發現 / 備註（可選）')}</Label>
                <Textarea
                  value={findings}
                  onChange={e => setFindings(e.target.value)}
                  placeholder={t('pm.notePlaceholder', '更換零件、調整項目、發現問題...')}
                  rows={2}
                  className="mt-1"
                />
              </div>
              <div>
                <Label>{t('pm.maintenanceCost', '保養費用（可選）')}</Label>
                <Input
                  type="number"
                  value={cost}
                  onChange={e => setCost(e.target.value)}
                  placeholder="0"
                  className="mt-1"
                />
              </div>
            </>
          )}

          {mode === 'skipped' && (
            <div>
              <Label>{t('pm.skipReason', '跳過原因')} <span className="text-red-500">*</span></Label>
              <Select value={delayReason} onValueChange={(v) => setDelayReason((v ?? '') as PMDelayReason)} items={Object.fromEntries(DELAY_REASONS.map(r => [r, t(`pm.delayReasons.${r}`, PM_DELAY_REASON_LABELS[r])]))}>
                <SelectTrigger className="mt-1"><SelectValue placeholder={t('pm.selectReason', '選擇原因')} /></SelectTrigger>
                <SelectContent>
                  {DELAY_REASONS.map(r => (
                    <SelectItem key={r} value={r}>{t(`pm.delayReasons.${r}`, PM_DELAY_REASON_LABELS[r])}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <Button
            onClick={submit}
            disabled={submitting}
            className={`w-full ${mode === 'skipped' ? 'bg-orange-600 hover:bg-orange-700' : 'bg-green-600 hover:bg-green-700'}`}
          >
            {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {mode === 'completed' ? t('pm.confirmComplete', '✅ 確認完成') : t('pm.confirmSkip', '⏭️ 確認跳過')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
