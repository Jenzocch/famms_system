'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useI18n } from '@/lib/i18n'
import { useDateLocale } from '@/lib/date-locale'
import { Clock, User, Edit3, CheckCircle, AlertCircle, Trash2 } from 'lucide-react'
import { formatDistanceToNow, format } from 'date-fns'

interface AuditEntry {
  id: string
  user_name: string | null
  action_type: string
  change_summary: string | null
  timestamp: string
}

interface AuditTrailProps {
  resourceId: string
  resourceType: string
  // Hide the internal heading when the parent already renders a title
  // (e.g. inside a CollapsibleSection).
  showHeading?: boolean
}

const ACTION_ICONS = {
  create: <CheckCircle className="w-4 h-4 text-green-600" />,
  update: <Edit3 className="w-4 h-4 text-blue-600" />,
  delete: <Trash2 className="w-4 h-4 text-red-600" />,
  status_change: <AlertCircle className="w-4 h-4 text-amber-600" />,
  assign: <User className="w-4 h-4 text-purple-600" />,
  comment: <Edit3 className="w-4 h-4 text-blue-500" />,
}

// Fallback zh labels; display goes through t(`audit.*`) so en/id users
// see their language. change_summary stays as stored (zh audit log).
const ACTION_LABELS = {
  create: '建立',
  update: '編輯',
  delete: '刪除',
  status_change: '狀態變更',
  assign: '指派',
  comment: '評論',
}

export default function AuditTrail({ resourceId, resourceType, showHeading = true }: AuditTrailProps) {
  const supabase = createClient()
  const { t } = useI18n()
  const dateLocale = useDateLocale()
  const [logs, setLogs] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // `supabase` is intentionally omitted from deps: createClient() returns
    // a fresh instance every render (not memoized), so depending on it would
    // re-run this on every render instead of only when the audited resource
    // changes. The fetch is chained via .then()/.catch()/.finally() (rather
    // than an awaited helper) so all state updates happen inside those
    // callbacks, not synchronously in the effect body.
    supabase
      .from('audit_logs')
      .select('id, user_name, action_type, change_summary, timestamp')
      .eq('resource_id', resourceId)
      .eq('resource_type', resourceType)
      .order('timestamp', { ascending: false })
      .limit(100)
      .then(({ data, error }) => {
        if (error) console.error('Failed to load audit trail:', error)
        setLogs(data ?? [])
        setLoading(false)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resourceId, resourceType])

  if (loading) {
    return <div className="text-sm text-gray-500 py-4">{t('audit.loading', '載入歷史記錄中...')}</div>
  }

  if (logs.length === 0) {
    return (
      <div className="text-center py-6 text-gray-400 text-sm">
        <Clock className="w-6 h-6 mx-auto mb-2 opacity-30" />
        {t('audit.empty', '沒有操作記錄')}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {showHeading && (
        <h3 className="font-semibold text-gray-900 text-sm flex items-center gap-2">
          <Clock className="w-4 h-4" />
          {t('audit.heading', '操作歷史')}
        </h3>
      )}

      <div className="space-y-2">
        {logs.map((log, idx) => {
          const icon = ACTION_ICONS[log.action_type as keyof typeof ACTION_ICONS]
          const label = t(`audit.${log.action_type}`, ACTION_LABELS[log.action_type as keyof typeof ACTION_LABELS] ?? log.action_type)

          return (
            <div
              key={log.id}
              className="relative flex gap-3 pb-3"
            >
              {/* Timeline connector */}
              {idx < logs.length - 1 && (
                <div className="absolute left-1.5 top-8 bottom-0 w-px bg-gray-200" />
              )}

              {/* Timeline dot */}
              <div className="flex-shrink-0 flex items-center justify-center w-3 h-3 rounded-full bg-gray-200 mt-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-white" />
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0 bg-white rounded-lg border border-gray-200 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      {icon}
                      <p className="text-sm font-medium text-gray-900">
                        {label}
                      </p>
                    </div>

                    {log.change_summary && (
                      <p className="text-xs text-gray-700 mb-2">
                        {log.change_summary}
                      </p>
                    )}

                    <p className="text-xs text-gray-500 flex items-center gap-1">
                      <User className="w-3 h-3" />
                      {log.user_name || t('audit.system', '系統')}
                    </p>
                  </div>

                  <p className="text-xs text-gray-400 whitespace-nowrap text-right">
                    {formatDistanceToNow(new Date(log.timestamp), {
                      addSuffix: true,
                      locale: dateLocale,
                    })}
                    <br />
                    <span className="text-gray-500">
                      {format(new Date(log.timestamp), 'HH:mm', { locale: dateLocale })}
                    </span>
                  </p>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
