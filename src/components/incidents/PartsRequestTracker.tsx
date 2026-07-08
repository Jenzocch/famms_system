'use client'

import { Package } from 'lucide-react'
import { format } from 'date-fns'
import { useI18n } from '@/lib/i18n'

interface TrackedRequest {
  id: string
  items: { name: string; part_no: string; qty: number; unit: string }[]
  urgency: string
  status: 'requested' | 'ordered' | 'received' | 'rejected'
  requested_at: string
}

const STATUS_STYLE: Record<TrackedRequest['status'], string> = {
  requested: 'bg-yellow-100 text-yellow-800',
  ordered: 'bg-blue-100 text-blue-800',
  received: 'bg-green-100 text-green-800',
  rejected: 'bg-gray-100 text-gray-500',
}

// Read-only status list for parts/materials already sent to Gudang One via
// GudangRequest. Gudang One writes status forward (requested -> ordered ->
// received/rejected); FAMMS never polls, so this just reflects the latest
// row state — no submit form here (that lives in GudangRequest).
export default function PartsRequestTracker({ requests }: { requests: TrackedRequest[] }) {
  const { t } = useI18n()
  if (requests.length === 0) return null

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-2">
      <div className="flex items-center gap-2 font-semibold text-gray-900 text-sm">
        <Package className="w-4 h-4 text-emerald-600" />
        {t('gudang.trackingHeading', '叫料狀態')}
      </div>
      {requests.map(r => (
        <div key={r.id} className="border rounded-lg p-2.5 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm text-gray-800 truncate">
              {r.items.map(it => `${it.name} ×${it.qty}${it.unit ? it.unit : ''}`).join('、')}
            </p>
            <p className="text-xs text-gray-400 mt-0.5">
              {format(new Date(r.requested_at), 'yyyy-MM-dd HH:mm')}
              {r.urgency === 'urgent' && (
                <span className="ml-1.5 text-red-600 font-medium">{t('gudang.urgent', '🔴 急件(停機)')}</span>
              )}
            </p>
          </div>
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full shrink-0 ${STATUS_STYLE[r.status]}`}>
            {t(`gudang.status.${r.status}`, r.status)}
          </span>
        </div>
      ))}
    </div>
  )
}
