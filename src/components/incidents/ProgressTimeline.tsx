'use client'

import { format } from 'date-fns'
import ImageViewer from '@/components/shared/ImageViewer'
import { STATUS_ZH, STATUS_ZH_COLOR } from '@/lib/incident-display'
import type { IncidentStatus } from '@/types'
import { useI18n } from '@/lib/i18n'

export interface TimelineRow {
  id: string
  new_status: string | null
  note: string | null
  updated_by: string | null
  photos: string[]
  created_at: string
}

// Client-side timeline so the status labels and headings follow the active app
// language (the parent page is a server component and can't read the locale,
// which is stored client-side in localStorage).
export default function ProgressTimeline({
  rows, supabaseUrl,
}: {
  rows: TimelineRow[]
  supabaseUrl: string
}) {
  const { t } = useI18n()
  const statusLabel = (s: string) =>
    t(`boardStatus.${s}`, STATUS_ZH[s as IncidentStatus] || s)

  if (rows.length === 0) {
    return (
      <div>
        <p className="text-sm text-gray-400 flex items-baseline gap-1.5">
          <span className="font-semibold text-gray-900">{t('incidentDetail.progressLog')} (0)</span>
          {t('incidentDetail.noRecords')}
        </p>
        <p className="text-xs text-gray-500 mt-0.5">{t('progressTimeline.sectionHint', '所有處理更新的完整紀錄')}</p>
      </div>
    )
  }

  return (
    <div>
      <h2 className="font-semibold text-gray-900 mb-0.5 text-sm">
        {t('incidentDetail.progressLog')} ({rows.length})
      </h2>
      <p className="text-xs text-gray-500 mb-2">{t('progressTimeline.sectionHint', '所有處理更新的完整紀錄')}</p>
      <ol className="relative border-l-2 border-gray-100 ml-2 space-y-3">
        {rows.map(u => (
          <li key={u.id} className="ml-4">
            <span className="absolute -left-[7px] w-3 h-3 bg-blue-500 rounded-full ring-4 ring-white" />
            <div className="bg-white rounded-lg border border-gray-200 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-gray-800">
                  {u.updated_by || t('incidentDetail.maintenanceStaff')}
                </span>
                {u.new_status && (
                  <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_ZH_COLOR[u.new_status as IncidentStatus] || 'bg-gray-100 text-gray-600'}`}>
                    → {statusLabel(u.new_status)}
                  </span>
                )}
              </div>
              {u.note && <p className="text-sm text-gray-600 mt-1 whitespace-pre-wrap">{u.note}</p>}
              {u.photos.length > 0 && (
                <div className="mt-2">
                  <ImageViewer paths={u.photos} supabaseUrl={supabaseUrl} />
                </div>
              )}
              <p className="text-xs text-gray-400 mt-1.5">
                {format(new Date(u.created_at), 'MM-dd HH:mm')}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}
