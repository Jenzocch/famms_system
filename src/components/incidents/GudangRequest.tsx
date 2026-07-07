'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Loader2, Package, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useI18n } from '@/lib/i18n'

type ItemRow = { name: string; part_no: string; qty: string; unit: string }
const EMPTY_ROW: ItemRow = { name: '', part_no: '', qty: '', unit: 'pcs' }

// Request spare parts / materials from the Gudang One warehouse system for
// this incident. Collapsed by default; posts to /api/gudang/request which
// forwards server-side (shared secret never reaches the browser).
export default function GudangRequest({ incidentId }: { incidentId: string }) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<ItemRow[]>([{ ...EMPTY_ROW }])
  const [urgency, setUrgency] = useState<'low' | 'normal' | 'urgent'>('normal')
  const [note, setNote] = useState('')
  const [sending, setSending] = useState(false)

  function setRow(i: number, patch: Partial<ItemRow>) {
    setRows(rs => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  }

  async function submit() {
    const items = rows
      .map(r => ({ name: r.name.trim(), part_no: r.part_no.trim(), qty: Number(r.qty), unit: r.unit.trim() || 'pcs' }))
      .filter(r => r.name && r.qty > 0)
    if (!items.length) {
      toast.error(t('gudang.noItems', '至少填一項零件（名稱＋數量）'))
      return
    }
    setSending(true)
    try {
      const res = await fetch('/api/gudang/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ incident_id: incidentId, items, urgency, note }),
      })
      const out = await res.json().catch(() => ({}))
      if (!res.ok || !out.ok) {
        toast.error(out.error || t('gudang.failed', '叫料失敗，稍後再試'))
        return
      }
      toast.success(t('gudang.sent', '已送到倉庫（Gudang One），倉管會收到 Telegram 通知'))
      setRows([{ ...EMPTY_ROW }])
      setNote('')
      setOpen(false)
    } finally {
      setSending(false)
    }
  }

  if (!open) {
    return (
      <Button
        onClick={() => setOpen(true)}
        variant="outline"
        className="w-full h-11 text-base border-emerald-300 text-emerald-700 hover:bg-emerald-50"
      >
        <Package className="w-4 h-4 mr-2" />
        {t('gudang.open', '向倉庫叫料（Gudang One）')}
      </Button>
    )
  }

  return (
    <div className="bg-white rounded-xl border border-emerald-200 p-4 space-y-3">
      <div className="flex items-center gap-2 font-semibold text-gray-900">
        <Package className="w-4 h-4 text-emerald-600" />
        {t('gudang.title', '向倉庫叫料（Gudang One）')}
      </div>

      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="flex gap-2 items-center">
            <Input
              value={r.name}
              onChange={e => setRow(i, { name: e.target.value })}
              placeholder={t('gudang.itemName', '零件/物料名稱')}
              className="flex-[3]"
              maxLength={120}
            />
            <Input
              value={r.part_no}
              onChange={e => setRow(i, { part_no: e.target.value })}
              placeholder={t('gudang.partNo', '料號(選填)')}
              className="flex-[2]"
              maxLength={60}
            />
            <Input
              value={r.qty}
              onChange={e => setRow(i, { qty: e.target.value })}
              placeholder="Qty"
              type="number"
              min={1}
              className="w-20"
            />
            <Input
              value={r.unit}
              onChange={e => setRow(i, { unit: e.target.value })}
              placeholder="pcs"
              className="w-20"
              maxLength={20}
            />
            {rows.length > 1 && (
              <button
                type="button"
                onClick={() => setRows(rs => rs.filter((_, j) => j !== i))}
                className="text-gray-400 hover:text-red-500 shrink-0"
                aria-label={t('gudang.removeRow', '刪除此列')}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        ))}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setRows(rs => [...rs, { ...EMPTY_ROW }])}
          className="text-emerald-700"
        >
          <Plus className="w-4 h-4 mr-1" />
          {t('gudang.addRow', '加一項')}
        </Button>
      </div>

      <div className="flex gap-2">
        {(['low', 'normal', 'urgent'] as const).map(u => (
          <button
            key={u}
            type="button"
            onClick={() => setUrgency(u)}
            className={`flex-1 h-10 rounded-lg border text-sm font-medium transition-colors ${
              urgency === u
                ? u === 'urgent'
                  ? 'bg-red-50 border-red-300 text-red-700'
                  : u === 'normal'
                    ? 'bg-amber-50 border-amber-300 text-amber-700'
                    : 'bg-gray-100 border-gray-300 text-gray-700'
                : 'border-gray-200 text-gray-500 hover:bg-gray-50'
            }`}
          >
            {u === 'urgent'
              ? t('gudang.urgent', '🔴 急件(停機)')
              : u === 'normal'
                ? t('gudang.normal', '🟡 一般')
                : t('gudang.low', '🟢 不急')}
          </button>
        ))}
      </div>

      <Textarea
        value={note}
        onChange={e => setNote(e.target.value)}
        placeholder={t('gudang.notePlaceholder', '備註（選填）：例如規格、品牌、給倉管的說明')}
        rows={2}
        maxLength={500}
      />

      <div className="flex gap-2">
        <Button variant="ghost" onClick={() => setOpen(false)} className="flex-1" disabled={sending}>
          {t('gudang.cancel', '取消')}
        </Button>
        <Button onClick={submit} disabled={sending} className="flex-[2] bg-emerald-600 hover:bg-emerald-700">
          {sending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Package className="w-4 h-4 mr-2" />}
          {t('gudang.submit', '送出叫料')}
        </Button>
      </div>
    </div>
  )
}
