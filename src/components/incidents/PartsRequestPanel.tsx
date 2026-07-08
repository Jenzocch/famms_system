'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { Loader2, Plus, Package, Check, X, Ban } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import { WAREHOUSE_BY_FACTORY_CODE } from '@/lib/constants'
import { format } from 'date-fns'

interface PartsRequest {
  id: string
  part_name: string
  part_code: string | null
  quantity: number
  unit: string | null
  warehouse: string | null
  urgency: 'normal' | 'urgent'
  note: string | null
  status: 'requested' | 'ordered' | 'received' | 'rejected'
  qc_result: 'passed' | 'failed' | null
  requested_at: string
  requested_by: { full_name: string | null } | null
}

const STATUS_STYLE: Record<PartsRequest['status'], string> = {
  requested: 'bg-yellow-100 text-yellow-800',
  ordered: 'bg-blue-100 text-blue-800',
  received: 'bg-green-100 text-green-800',
  rejected: 'bg-gray-100 text-gray-500',
}

// Parts/material request panel on the incident detail page. Records requests
// made against a case (e.g. "waiting for oil seal") as structured data instead
// of a free-text note, so a future Gudang One sync has something to read.
// canManage (supervisor+) can advance status; everyone can create a request.
export default function PartsRequestPanel({
  incidentId, factoryCode, canManage,
}: {
  incidentId: string
  factoryCode: string | null
  canManage: boolean
}) {
  const { t } = useI18n()
  const [requests, setRequests] = useState<PartsRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [updatingId, setUpdatingId] = useState<string | null>(null)

  const [partName, setPartName] = useState('')
  const [partCode, setPartCode] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [unit, setUnit] = useState('')
  const [warehouse, setWarehouse] = useState(factoryCode ? WAREHOUSE_BY_FACTORY_CODE[factoryCode] ?? '' : '')
  const [urgency, setUrgency] = useState<'normal' | 'urgent'>('normal')
  const [note, setNote] = useState('')

  async function load() {
    setLoading(true)
    try {
      const res = await fetch(`/api/parts-requests?incidentId=${incidentId}`)
      const j = await res.json()
      setRequests(j.requests ?? [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [incidentId])

  async function submit() {
    if (!partName.trim()) {
      toast.error(t('parts.nameRequired', '請填寫零件名稱'))
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch('/api/parts-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          incident_id: incidentId,
          part_name: partName,
          part_code: partCode || undefined,
          quantity: parseInt(quantity, 10) || 1,
          unit: unit || undefined,
          warehouse: warehouse || undefined,
          urgency,
          note: note || undefined,
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => null)
        throw new Error(j?.error || t('parts.submitFailed', '送出失敗'))
      }
      toast.success(t('parts.submitted', '已送出零件需求'))
      setPartName(''); setPartCode(''); setQuantity('1'); setUnit(''); setNote(''); setUrgency('normal')
      setShowForm(false)
      load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('parts.submitFailed', '送出失敗'))
    } finally {
      setSubmitting(false)
    }
  }

  async function updateStatus(id: string, status: PartsRequest['status']) {
    setUpdatingId(id)
    try {
      const res = await fetch(`/api/parts-requests/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      if (!res.ok) throw new Error()
      load()
    } catch {
      toast.error(t('parts.updateFailed', '更新失敗'))
    } finally {
      setUpdatingId(null)
    }
  }

  return (
    <div className="space-y-3">
      {loading ? (
        <p className="text-sm text-gray-400 text-center py-2">{t('common.loading')}</p>
      ) : requests.length === 0 ? (
        <p className="text-sm text-gray-400">{t('parts.none', '尚無零件需求')}</p>
      ) : (
        <div className="space-y-2">
          {requests.map(r => (
            <div key={r.id} className="border rounded-lg p-3 bg-white">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-medium flex items-center gap-1.5">
                    <Package className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                    {r.part_name}
                    {r.part_code && <span className="text-gray-400 font-mono text-xs">[{r.part_code}]</span>}
                    {r.urgency === 'urgent' && (
                      <span className="text-xs font-semibold text-red-600">{t('parts.urgent', '緊急')}</span>
                    )}
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {t('parts.qty', '數量')}: {r.quantity}{r.unit ? ` ${r.unit}` : ''}
                    {r.warehouse && ` · ${r.warehouse}`}
                    {r.requested_by?.full_name && ` · ${r.requested_by.full_name}`}
                    {' · '}{format(new Date(r.requested_at), 'yyyy-MM-dd HH:mm')}
                  </p>
                  {r.note && <p className="text-xs text-gray-600 mt-1">{r.note}</p>}
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_STYLE[r.status]}`}>
                    {t(`parts.status.${r.status}`, r.status)}
                  </span>
                  {r.qc_result && (
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                      r.qc_result === 'passed' ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-700'
                    }`}>
                      {r.qc_result === 'passed' ? t('parts.qcPassed', 'QC 合格') : t('parts.qcFailed', 'QC 不合格')}
                    </span>
                  )}
                </div>
              </div>

              {canManage && r.status !== 'received' && r.status !== 'rejected' && (
                <div className="flex gap-2 mt-2">
                  {r.status === 'requested' && (
                    <Button size="sm" variant="outline" disabled={updatingId === r.id} onClick={() => updateStatus(r.id, 'ordered')}>
                      {updatingId === r.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                      {t('parts.markOrdered', '已下單')}
                    </Button>
                  )}
                  {r.status === 'ordered' && (
                    <Button size="sm" variant="outline" disabled={updatingId === r.id} onClick={() => updateStatus(r.id, 'received')}>
                      {updatingId === r.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                      {t('parts.markReceived', '已到貨')}
                    </Button>
                  )}
                  <Button size="sm" variant="outline" className="text-red-600" disabled={updatingId === r.id} onClick={() => updateStatus(r.id, 'rejected')}>
                    <Ban className="w-3.5 h-3.5" /> {t('parts.reject', '取消')}
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {!showForm ? (
        <Button variant="outline" size="sm" className="gap-2" onClick={() => setShowForm(true)}>
          <Plus className="w-4 h-4" /> {t('parts.request', '申請零件 / 物料')}
        </Button>
      ) : (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 space-y-2">
          <input
            value={partName}
            onChange={e => setPartName(e.target.value)}
            placeholder={t('parts.namePlaceholder', '零件名稱（例如：oil seal）')}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
          />
          <div className="grid grid-cols-2 gap-2">
            <input
              value={partCode}
              onChange={e => setPartCode(e.target.value)}
              placeholder={t('parts.codePlaceholder', '零件編號（選填）')}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
            />
            <input
              value={warehouse}
              onChange={e => setWarehouse(e.target.value)}
              placeholder={t('parts.warehousePlaceholder', '倉庫（例如：HARDWARE）')}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input
              type="number"
              min={1}
              value={quantity}
              onChange={e => setQuantity(e.target.value)}
              placeholder={t('parts.qty', '數量')}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
            />
            <input
              value={unit}
              onChange={e => setUnit(e.target.value)}
              placeholder={t('parts.unitPlaceholder', '單位（選填，例如：pcs）')}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={urgency === 'urgent'} onChange={e => setUrgency(e.target.checked ? 'urgent' : 'normal')} />
            {t('parts.markUrgent', '標記為緊急')}
          </label>
          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder={t('parts.notePlaceholder', '備註（選填）')}
            rows={2}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
          />
          <div className="flex gap-2">
            <Button size="sm" onClick={submit} disabled={submitting}>
              {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {t('parts.submit', '送出申請')}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setShowForm(false)}>
              <X className="w-3.5 h-3.5 mr-1" /> {t('pm.cancelBtn')}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
