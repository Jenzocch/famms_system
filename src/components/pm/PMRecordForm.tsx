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

const DELAY_REASONS = Object.keys(PM_DELAY_REASON_LABELS) as PMDelayReason[]

export default function PMRecordForm({ recordId, checklist }: { recordId: string; checklist: string[] }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<'completed' | 'skipped'>('completed')
  const [findings, setFindings] = useState('')
  const [cost, setCost] = useState('')
  const [delayReason, setDelayReason] = useState<PMDelayReason | ''>('')
  const [checked, setChecked] = useState<Record<number, boolean>>({})
  const [submitting, setSubmitting] = useState(false)

  async function submit() {
    if (mode === 'skipped' && !delayReason) {
      toast.error('Pilih alasan skip')
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
      if (!res.ok) throw new Error(json.error || 'Gagal menyimpan')
      toast.success(mode === 'completed' ? 'PM selesai dicatat' : 'PM ditandai skip')
      setOpen(false)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menyimpan')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className="inline-flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition">
        <CheckCircle2 className="w-4 h-4" /> Catat PM
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Catat Pelaksanaan PM</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Mode toggle */}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setMode('completed')}
              className={`flex items-center justify-center gap-1 rounded-lg border px-3 py-2 text-sm transition ${
                mode === 'completed' ? 'border-green-500 bg-green-50 text-green-700' : 'border-gray-200 hover:bg-gray-50'
              }`}
            >
              <CheckCircle2 className="w-4 h-4" /> Selesai
            </button>
            <button
              type="button"
              onClick={() => setMode('skipped')}
              className={`flex items-center justify-center gap-1 rounded-lg border px-3 py-2 text-sm transition ${
                mode === 'skipped' ? 'border-orange-500 bg-orange-50 text-orange-700' : 'border-gray-200 hover:bg-gray-50'
              }`}
            >
              <SkipForward className="w-4 h-4" /> Skip / Tunda
            </button>
          </div>

          {mode === 'completed' && (
            <>
              {checklist.length > 0 && (
                <div>
                  <Label>Checklist</Label>
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
                <Label>Temuan / Findings</Label>
                <Textarea
                  value={findings}
                  onChange={e => setFindings(e.target.value)}
                  placeholder="Kondisi mesin, masalah ditemukan, dll."
                  rows={2}
                  className="mt-1"
                />
              </div>
              <div>
                <Label>Biaya (IDR)</Label>
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
              <Label>Alasan Skip <span className="text-red-500">*</span></Label>
              <Select value={delayReason} onValueChange={(v) => setDelayReason((v ?? '') as PMDelayReason)}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Pilih alasan" /></SelectTrigger>
                <SelectContent>
                  {DELAY_REASONS.map(r => (
                    <SelectItem key={r} value={r}>{PM_DELAY_REASON_LABELS[r]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <Button onClick={submit} disabled={submitting} className="w-full">
            {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Simpan
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
