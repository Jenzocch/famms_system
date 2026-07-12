'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { ExternalLink, Package, Warehouse } from 'lucide-react'
import { format } from 'date-fns'
import { useI18n } from '@/lib/i18n'

const GUDANG_APP_URL = process.env.NEXT_PUBLIC_GUDANG_APP_URL

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
// received/rejected) via a server-to-server webhook the viewing technician
// has no session for, so there's nothing here to subscribe to directly —
// instead, poll for a fresh server render while any request is still open,
// so a status change (e.g. an urgent part arriving) shows up without the
// technician having to remember to reload the page. Stops once every
// request is resolved. No submit form here (that lives in GudangRequest).
export default function PartsRequestTracker({ requests }: { requests: TrackedRequest[] }) {
  const { t } = useI18n()
  const router = useRouter()
  const hasOpenRequest = requests.some(r => r.status === 'requested' || r.status === 'ordered')

  useEffect(() => {
    if (!hasOpenRequest) return
    const id = setInterval(() => router.refresh(), 20_000)
    return () => clearInterval(id)
  }, [hasOpenRequest, router])

  if (requests.length === 0) return null

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-semibold text-gray-900 text-sm">
          <Package className="w-4 h-4 text-emerald-600" />
          {t('gudang.trackingHeading', '叫料狀態')}
        </div>
        {GUDANG_APP_URL && (
          <a
            href={GUDANG_APP_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:text-emerald-800 shrink-0"
          >
            <Warehouse className="w-3.5 h-3.5" />
            {t('gudang.openApp', '開啟 Gudang App')}
            <ExternalLink className="w-3 h-3" />
          </a>
        )}
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
