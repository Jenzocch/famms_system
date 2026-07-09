'use client'

import { useState } from 'react'
import Link from 'next/link'
import { AlertCircle, ChevronRight, UserCheck, CalendarClock } from 'lucide-react'
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
import NextStepHint from '@/components/incidents/NextStepHint'

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
  observation_end_date: string | null
  machine: { machine_code: string | null; machine_name: string } | null
  factory: { name: string } | null
}

interface IncidentBoardProps {
  rows: BoardRow[]
  userRole?: UserRole
  initialFilter?: string
}

export default function IncidentBoard({ rows, userRole = 'technician', initialFilter }: IncidentBoardProps) {
  const { t, locale } = useI18n()
  const dateLocale = locale === 'en' ? enUS : locale === 'id' ? idLocale : zhTW
  const typeLabel = useIncidentTypeLabel()
  const [filter, setFilter] = useState(
    initialFilter && BOARD_FILTERS.some(f => f.key === initialFilter) ? initialFilter : 'all'
  )
  const canRemind = PERMISSIONS.remindProgress(userRole)
  const { remindingId, nudge } = useProgressNudge()

  const activeFilter = BOARD_FILTERS.find(f => f.key === filter)!
  const filtered = activeFilter.statuses
    ? rows.filter(r => activeFilter.statuses!.includes(r.status))
    : rows

  // Surface the most pressing work first: overdue cases, then observation
  // periods that have ended (ready for close review), then by urgency
  // (A > B > C > D), then most recently reported. Helps technicians see what
  // to tackle next at a glance.
  const today = new Date(new Date().toDateString())
  const todayStr = format(today, 'yyyy-MM-dd')
  const URGENCY_RANK: Record<string, number> = { A: 0, B: 1, C: 2, D: 3 }
  const isOverdue = (r: BoardRow) =>
    !!r.due_date && r.status !== 'closed' && new Date(r.due_date) < today
  const isObsDue = (r: BoardRow) =>
    r.status === 'observation' && !!r.observation_end_date &&
    r.observation_end_date.slice(0, 10) <= todayStr
  const attentionRank = (r: BoardRow) => (isOverdue(r) ? 0 : isObsDue(r) ? 1 : 2)
  const sorted = [...filtered].sort((a, b) => {
    const at = attentionRank(a) - attentionRank(b)
    if (at !== 0) return at
    const ur = (URGENCY_RANK[a.downtime_impact] ?? 9) - (URGENCY_RANK[b.downtime_impact] ?? 9)
    if (ur !== 0) return ur
    return new Date(b.reported_at).getTime() - new Date(a.reported_at).getTime()
  })

  function countFor(statuses: IncidentStatus[] | null) {
    if (!statuses) return rows.length
    return rows.filter(r => statuses.includes(r.status)).length
  }

  return (
    <div className="space-y-4 md:space-y-5">
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
              aria-pressed={active}
              className={`shrink-0 px-3.5 py-2 rounded-full text-sm font-medium transition-colors ${
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
          {filter !== 'all' ? (
            // A specific tab is empty — the other tabs may still have cases.
            <p className="text-sm">{t('board.noInFilter', '此分類目前沒有工單')}</p>
          ) : (
            <>
              <p className="text-sm">
                {PERMISSIONS.boardFull(userRole)
                  ? t('board.noIncidents')
                  : t('board.emptyMine', '目前沒有指派給你或你回報的工單')}
              </p>
              <Link
                href="/incidents/new"
                className="inline-flex items-center gap-1.5 mt-4 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium active:bg-blue-700"
              >
                {t('board.reportCta', '回報問題')}
              </Link>
            </>
          )}
        </div>
      ) : (
        // One column on phones (thumb-scroll), but fan out into 2–3 columns on
        // wider screens so the desktop's horizontal space is used instead of
        // one long vertical scroll. Gaps widen with the viewport — cramped
        // columns read worse than fewer columns.
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 md:gap-5 xl:gap-6 items-start">
          {sorted.map(inc => {
            const urgency = URGENCY_FROM_IMPACT[inc.downtime_impact]
            const overdue = isOverdue(inc)
            return (
              // Card chrome lives on the wrapper div; the Link only covers the
              // readable content so the nudge button below is NOT nested inside
              // the anchor (invalid HTML + screen-reader confusion).
              <div
                key={inc.id}
                className="bg-white rounded-2xl border border-gray-300 shadow-sm hover:shadow-md hover:border-gray-400 transition-all"
              >
              <Link
                href={`/incidents/${inc.id}`}
                className="block p-4 md:p-5 xl:p-6 rounded-2xl active:bg-gray-50"
              >
                {/* Top row — the two things a technician triages on: how urgent,
                    and what state it's in. Everything else (case no., reporter)
                    is demoted so the card reads at a glance. */}
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-sm px-2.5 py-1 rounded-full font-semibold ${urgency.color}`}>
                    {t(`urgency.${inc.downtime_impact}`, urgency.label)}
                  </span>
                  <span className={`text-sm px-2.5 py-1 rounded-full font-medium ${STATUS_ZH_COLOR[inc.status]}`}>
                    {t(`boardStatus.${inc.status}`)}
                  </span>
                  {/* One attention badge, never both — overdue wins over obs-due */}
                  {overdue ? (
                    <span className="inline-flex items-center gap-1 text-sm px-2.5 py-1 rounded-full font-semibold bg-red-600 text-white">
                      <CalendarClock className="w-3.5 h-3.5" />
                      {t('board.overdue', '逾期')} {format(new Date(inc.due_date!), 'MM/dd')}
                    </span>
                  ) : isObsDue(inc) ? (
                    <span className="text-sm px-2.5 py-1 rounded-full font-semibold bg-teal-600 text-white">
                      {t('board.obsDue', '觀察期已滿')}
                    </span>
                  ) : null}
                  <ChevronRight className="w-5 h-5 text-gray-400 shrink-0 ml-auto" />
                </div>

                {/* Title — the biggest thing on the card */}
                <p className="font-bold text-lg xl:text-xl text-gray-900 mt-2.5 leading-snug line-clamp-2">
                  {inc.title || typeLabel(inc.incident_type, t('board.problem')) }
                </p>

                {/* Where — machine first (that's what a technician walks to) */}
                <p className="text-base text-gray-600 mt-1 truncate">
                  {inc.machine ? inc.machine.machine_name : typeLabel(inc.incident_type)}
                  {inc.factory ? ` · ${inc.factory.name}` : ''}
                </p>

                {/* Next-step nudge: what this case needs next, at a glance */}
                {inc.status !== 'closed' && (
                  <div className="mt-3 pt-3 border-t border-gray-100">
                    <NextStepHint status={inc.status} variant="inline" userRole={userRole} />
                  </div>
                )}

                {/* Footer meta — demoted: who/when, assignee, case no. */}
                <div className="flex items-center justify-between gap-2 mt-3 text-xs text-gray-400">
                  <span className="truncate">
                    {inc.reporter_name ? `${inc.reporter_name} · ` : ''}
                    {formatDistanceToNow(new Date(inc.reported_at), { addSuffix: true, locale: dateLocale })}
                    {!overdue && inc.due_date ? ` · ${t('board.due', '截止')} ${format(new Date(inc.due_date), 'MM/dd')}` : ''}
                  </span>
                  {inc.status !== 'closed' && (
                    inc.assigned_to ? (
                      <span className="inline-flex items-center gap-0.5 text-blue-600 shrink-0">
                        <UserCheck className="w-3.5 h-3.5" /> {inc.assigned_to}
                      </span>
                    ) : (
                      <span className="text-amber-600 shrink-0">{t('board.unassigned')}</span>
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
            <p className="col-span-full text-center text-xs text-gray-400 py-2">
              {t('board.limitNote', '僅顯示最近 200 筆工單，較舊工單請使用搜尋')}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
