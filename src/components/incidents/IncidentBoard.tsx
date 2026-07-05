'use client'

import { useState } from 'react'
import Link from 'next/link'
import { AlertCircle, ChevronRight, UserCheck, Lock, CalendarClock } from 'lucide-react'
import NudgeCardButton from '@/components/incidents/NudgeCardButton'
import { formatDistanceToNow, format } from 'date-fns'
import { zhTW, enUS, id as idLocale } from 'date-fns/locale'
import type { IncidentStatus, UserRole } from '@/types'
import {
  URGENCY_FROM_IMPACT, STATUS_ZH_COLOR, BOARD_FILTERS,
} from '@/lib/incident-display'
import { PERMISSIONS } from '@/lib/permissions'
import { useI18n } from '@/lib/i18n'
import { useIncidentTypeLabel } from '@/lib/incident-type-label'
import { useProgressNudge } from '@/lib/useProgressNudge'

export interface BoardRow {
  id: string
  incident_no: string
  status: IncidentStatus
  downtime_impact: 'A' | 'B' | 'C' | 'D'
  incident_type: string
  title: string | null
  reporter_name: string | null
  reported_at: string
  assigned_to: string | null
  due_date: string | null
  machine: { machine_code: string | null; machine_name: string } | null
  factory: { name: string } | null
}

interface IncidentBoardProps {
  rows: BoardRow[]
  userRole?: UserRole
}

export default function IncidentBoard({ rows, userRole = 'technician' }: IncidentBoardProps) {
  const { t, locale } = useI18n()
  const dateLocale = locale === 'en' ? enUS : locale === 'id' ? idLocale : zhTW
  const typeLabel = useIncidentTypeLabel()
  const [filter, setFilter] = useState('all')
  const canAssign = PERMISSIONS.assignIncident(userRole)
  const canRemind = PERMISSIONS.remindProgress(userRole)
  const { remindingId, nudge } = useProgressNudge()

  const activeFilter = BOARD_FILTERS.find(f => f.key === filter)!
  const filtered = activeFilter.statuses
    ? rows.filter(r => activeFilter.statuses!.includes(r.status))
    : rows

  // Surface the most pressing work first: overdue cases, then by urgency
  // (A > B > C > D), then most recently reported. Helps technicians see what
  // to tackle next at a glance.
  const today = new Date(new Date().toDateString())
  const URGENCY_RANK: Record<string, number> = { A: 0, B: 1, C: 2, D: 3 }
  const isOverdue = (r: BoardRow) =>
    !!r.due_date && r.status !== 'closed' && new Date(r.due_date) < today
  const sorted = [...filtered].sort((a, b) => {
    const ov = (isOverdue(a) ? 0 : 1) - (isOverdue(b) ? 0 : 1)
    if (ov !== 0) return ov
    const ur = (URGENCY_RANK[a.downtime_impact] ?? 9) - (URGENCY_RANK[b.downtime_impact] ?? 9)
    if (ur !== 0) return ur
    return new Date(b.reported_at).getTime() - new Date(a.reported_at).getTime()
  })

  function countFor(statuses: IncidentStatus[] | null) {
    if (!statuses) return rows.length
    return rows.filter(r => statuses.includes(r.status)).length
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-gray-900">{t('board.heading')}</h1>

      {/* Filter tabs */}
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
        {BOARD_FILTERS.map(f => {
          const n = countFor(f.statuses)
          const active = filter === f.key
          return (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`shrink-0 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                active ? 'bg-blue-600 text-white' : 'bg-white border border-gray-200 text-gray-600'
              }`}
            >
              {t(`boardFilters.${f.key}`, f.label)}
              <span className={`ml-1 ${active ? 'text-blue-100' : 'text-gray-400'}`}>{n}</span>
            </button>
          )
        })}
      </div>

      {/* Cards */}
      {filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <AlertCircle className="w-10 h-10 mx-auto mb-2 opacity-30" />
          <p className="text-sm">{t('board.noIncidents')}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {sorted.map(inc => {
            const urgency = URGENCY_FROM_IMPACT[inc.downtime_impact]
            const overdue = isOverdue(inc)
            return (
              // Card chrome lives on the wrapper div; the Link only covers the
              // readable content so the nudge button below is NOT nested inside
              // the anchor (invalid HTML + screen-reader confusion).
              <div
                key={inc.id}
                className="bg-white rounded-xl border border-gray-300 shadow-sm hover:shadow-md hover:border-gray-400 transition-all"
              >
              <Link
                href={`/incidents/${inc.id}`}
                className="block p-3.5 rounded-xl active:bg-gray-50"
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_ZH_COLOR[inc.status]}`}>
                    {t(`boardStatus.${inc.status}`)}
                  </span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${urgency.color}`}>
                    {t(`urgency.${inc.downtime_impact}`, urgency.label)}
                  </span>
                  {inc.due_date && (
                    <span className={`inline-flex items-center gap-0.5 text-xs px-2 py-0.5 rounded-full font-medium ${
                      overdue ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'
                    }`}>
                      <CalendarClock className="w-3 h-3" />
                      {format(new Date(inc.due_date), 'MM/dd')}
                      {overdue ? ` ${t('board.overdue', '逾期')}` : ''}
                    </span>
                  )}
                  <span className="text-sm text-gray-800 font-mono font-semibold ml-auto bg-gray-100 px-2 py-0.5 rounded">{inc.incident_no}</span>
                </div>

                <p className="font-semibold text-base text-gray-900 mt-2 line-clamp-1">
                  {inc.title || typeLabel(inc.incident_type, t('board.problem')) }
                </p>

                <div className="flex items-center justify-between mt-1">
                  <p className="text-sm text-gray-700 truncate">
                    {typeLabel(inc.incident_type)}
                    {inc.factory ? ` · ${inc.factory.name}` : ''}
                    {inc.machine ? ` · ${inc.machine.machine_name}` : ''}
                  </p>
                  <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />
                </div>

                <div className="flex items-center justify-between mt-1">
                  <p className="text-xs text-gray-600">
                    {inc.reporter_name ? `${inc.reporter_name} · ` : ''}
                    {formatDistanceToNow(new Date(inc.reported_at), { addSuffix: true, locale: dateLocale })}
                  </p>
                  {inc.status !== 'closed' && (
                    inc.assigned_to ? (
                      <span className="inline-flex items-center gap-0.5 text-xs text-blue-600">
                        <UserCheck className="w-3 h-3" /> {inc.assigned_to}
                      </span>
                    ) : canAssign ? (
                      <span className="text-xs text-amber-600">{t('board.unassigned')}</span>
                    ) : (
                      <span className="inline-flex items-center gap-0.5 text-xs text-gray-400" title={t('board.onlySupervisorAssign')}>
                        <Lock className="w-3 h-3" /> {t('board.unassigned')}
                      </span>
                    )
                  )}
                </div>

              </Link>

              {/* Nudge for progress — supervisors+ only, open cases only.
                  Outside the Link (sibling, not nested) with a 2-tap confirm. */}
              {canRemind && inc.status !== 'closed' && (
                <div className="px-3.5 pb-3 -mt-1 flex justify-end">
                  <NudgeCardButton
                    incidentId={inc.id}
                    sending={remindingId === inc.id}
                    onNudge={nudge}
                  />
                </div>
              )}
              </div>
            )
          })}

          {/* The server query caps at 200 rows — tell the user older cases
              exist but are only reachable via search, instead of silently
              truncating. */}
          {rows.length >= 200 && (
            <p className="text-center text-xs text-gray-400 py-2">
              {t('board.limitNote', '僅顯示最近 200 筆案件，較舊案件請使用搜尋')}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
