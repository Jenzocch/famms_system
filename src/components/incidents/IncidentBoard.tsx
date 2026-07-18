'use client'

import { useState } from 'react'
import Link from 'next/link'
import { AlertCircle, ChevronRight, UserCheck, CalendarClock, Camera, Factory } from 'lucide-react'
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

// Urgency is now shown as a colored left edge bar on the card (not a pill —
// see the top row below), reusing the same red/amber/green intent as
// URGENCY_FROM_IMPACT. A and B both read as "red" (urgent), C is amber, D is
// the calm default.
const URGENCY_BAR_COLOR: Record<string, string> = {
  A: 'border-l-red-500',
  C: 'border-l-amber-400',
  D: 'border-l-green-500',
}

export interface BoardRow {
  id: string
  incident_no: string
  status: IncidentStatus
  downtime_impact: 'A' | 'C' | 'D'
  incident_type: string
  title: string | null
  reporter_name: string | null
  reported_at: string
  assigned_to: string | null
  due_date: string | null
  observation_end_date: string | null
  // Photos attached to the original report — written at creation time (the
  // photos themselves live only in storage, so this is the board's only
  // affordable way to know). undefined on pre-photo_count rows.
  photo_count?: number | null
  machine: { machine_code: string | null; machine_name: string } | null
  factory: { id: string; name: string } | null
}

interface IncidentBoardProps {
  rows: BoardRow[]
  userRole?: UserRole
  initialFilter?: string
  initialFactory?: string
}

export default function IncidentBoard({ rows, userRole = 'technician', initialFilter, initialFactory }: IncidentBoardProps) {
  const { t, locale } = useI18n()
  const dateLocale = locale === 'en' ? enUS : locale === 'id' ? idLocale : zhTW
  const typeLabel = useIncidentTypeLabel()
  const [filter, setFilter] = useState(
    initialFilter && BOARD_FILTERS.some(f => f.key === initialFilter) ? initialFilter : 'all'
  )
  const canRemind = PERMISSIONS.remindProgress(userRole)
  const { remindingId, nudge } = useProgressNudge()

  // Distinct factories actually present in the fetched rows. Only rendered as
  // tabs when there's more than one — a factory-scoped supervisor's rows are
  // always a single factory, so the tab row would be pure clutter for them;
  // it only matters for admin/cross-factory viewers whose board spans plants.
  const factoriesPresent = (() => {
    const byId = new Map<string, string>()
    for (const r of rows) if (r.factory) byId.set(r.factory.id, r.factory.name)
    return [...byId.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
  })()
  const [factoryFilter, setFactoryFilter] = useState(
    initialFactory && factoriesPresent.some(f => f.id === initialFactory) ? initialFactory : 'all'
  )

  // Urgency is now a THIRD filter dimension alongside status and factory (see
  // the chip row below). 'A'/'C'/'D' only — the retired 'B' tier no longer
  // exists in URGENCY_FROM_IMPACT and must not be reintroduced here.
  const [urgencyFilter, setUrgencyFilter] = useState<'all' | 'A' | 'C' | 'D'>('all')

  const activeFilter = BOARD_FILTERS.find(f => f.key === filter)!
  // Per-dimension predicates (each one deliberately ignoring its OWN
  // dimension) so `filtered` and every countFor* below can be built from the
  // same three building blocks instead of drifting apart.
  const byStatus = (r: BoardRow) => !activeFilter.statuses || activeFilter.statuses.includes(r.status)
  const byFactory = (r: BoardRow) => factoryFilter === 'all' || r.factory?.id === factoryFilter
  const byUrgency = (r: BoardRow) => urgencyFilter === 'all' || r.downtime_impact === urgencyFilter
  const factoryScoped = rows.filter(r => byFactory(r) && byUrgency(r))
  const filtered = rows.filter(r => byStatus(r) && byFactory(r) && byUrgency(r))

  // Surface the most pressing work first: overdue cases, then observation
  // periods that have ended (ready for close review), then by urgency
  // (A > B > C > D), then most recently reported. Helps technicians see what
  // to tackle next at a glance.
  const today = new Date(new Date().toDateString())
  const todayStr = format(today, 'yyyy-MM-dd')
  const URGENCY_RANK: Record<string, number> = { A: 0, C: 2, D: 3 }
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

  // Each filter's count reflects the OTHER TWO dimensions' current
  // selections — status tab counts narrow to the selected factory + urgency,
  // factory tab counts narrow to the selected status + urgency, and urgency
  // tab counts narrow to the selected status + factory — so no number ever
  // lies about what tapping it will actually show.
  function countFor(statuses: IncidentStatus[] | null) {
    if (!statuses) return factoryScoped.length
    return factoryScoped.filter(r => statuses.includes(r.status)).length
  }
  const statusScoped = rows.filter(r => byStatus(r) && byUrgency(r))
  function countForFactory(factoryId: string | null) {
    if (!factoryId) return statusScoped.length
    return statusScoped.filter(r => r.factory?.id === factoryId).length
  }
  const statusAndFactoryScoped = rows.filter(r => byStatus(r) && byFactory(r))
  function countForUrgency(code: 'A' | 'C' | 'D' | null) {
    if (!code) return statusAndFactoryScoped.length
    return statusAndFactoryScoped.filter(r => r.downtime_impact === code).length
  }

  return (
    <div className="space-y-4 md:space-y-5">
      <h1 className="text-2xl font-semibold text-gray-900">{t('board.heading')}</h1>

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

      {/* Factory tabs — only when the board actually spans more than one
          factory (admin/cross-factory viewers); a single-factory supervisor
          never sees this row since it'd always show just their one plant. */}
      {factoriesPresent.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
          <button
            onClick={() => setFactoryFilter('all')}
            aria-pressed={factoryFilter === 'all'}
            className={`shrink-0 inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              factoryFilter === 'all' ? 'bg-gray-800 text-white' : 'bg-white border border-gray-200 text-gray-600'
            }`}
          >
            <Factory className="w-3.5 h-3.5" />
            {t('board.allFactories', '全部工廠')}
            <span className={factoryFilter === 'all' ? 'text-gray-300' : 'text-gray-400'}>{countForFactory(null)}</span>
          </button>
          {factoriesPresent.map(f => {
            const active = factoryFilter === f.id
            return (
              <button
                key={f.id}
                onClick={() => setFactoryFilter(f.id)}
                aria-pressed={active}
                className={`shrink-0 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                  active ? 'bg-gray-800 text-white' : 'bg-white border border-gray-200 text-gray-600'
                }`}
              >
                {f.name}
                <span className={`ml-1 ${active ? 'text-gray-300' : 'text-gray-400'}`}>{countForFactory(f.id)}</span>
              </button>
            )
          })}
        </div>
      )}

      {/* Urgency chips — unlike the factory row this is always shown (useful
          even for a single-factory board), except when there are simply no
          rows at all to filter. */}
      {rows.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
          <button
            onClick={() => setUrgencyFilter('all')}
            aria-pressed={urgencyFilter === 'all'}
            className={`shrink-0 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              urgencyFilter === 'all' ? 'bg-gray-800 text-white' : 'bg-white border border-gray-200 text-gray-600'
            }`}
          >
            {t('boardFilters.all', '全部')}
            <span className={urgencyFilter === 'all' ? 'text-gray-300' : 'text-gray-400'}> {countForUrgency(null)}</span>
          </button>
          {(['A', 'C', 'D'] as const).map(code => {
            const active = urgencyFilter === code
            return (
              <button
                key={code}
                onClick={() => setUrgencyFilter(code)}
                aria-pressed={active}
                className={`shrink-0 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                  active ? 'bg-gray-800 text-white' : 'bg-white border border-gray-200 text-gray-600'
                }`}
              >
                {t(`urgency.${code}`, URGENCY_FROM_IMPACT[code].label)}
                <span className={`ml-1 ${active ? 'text-gray-300' : 'text-gray-400'}`}>{countForUrgency(code)}</span>
              </button>
            )
          })}
        </div>
      )}

      {/* Cards */}
      {filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <AlertCircle className="w-10 h-10 mx-auto mb-2 opacity-30" />
          {filter !== 'all' || factoryFilter !== 'all' || urgencyFilter !== 'all' ? (
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
            const urgency = URGENCY_FROM_IMPACT[inc.downtime_impact] ?? URGENCY_FROM_IMPACT.A
            const overdue = isOverdue(inc)
            return (
              // Card chrome lives on the wrapper div; the Link only covers the
              // readable content so the nudge button below is NOT nested inside
              // the anchor (invalid HTML + screen-reader confusion).
              <div
                key={inc.id}
                aria-label={t(`urgency.${inc.downtime_impact}`, urgency.label)}
                className={`bg-white rounded-2xl shadow-sm hover:shadow-md transition-all border-l-4 ${URGENCY_BAR_COLOR[inc.downtime_impact] ?? URGENCY_BAR_COLOR.D}`}
              >
              <Link
                href={`/incidents/${inc.id}`}
                className="block p-4 md:p-5 xl:p-6 rounded-2xl active:bg-gray-50 active:scale-[0.98] transition-transform duration-150"
              >
                {/* Row 1 — factory leads, status pill right beside it (+ one
                    attention badge, + chevron). First thing to register:
                    which plant, and does it need attention. */}
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="flex items-center gap-1 text-[13px] font-medium text-gray-500 truncate">
                    <Factory className="w-3.5 h-3.5 shrink-0" />
                    {inc.factory ? inc.factory.name : t('board.noFactory', '未設定工廠')}
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

                {/* Row 2 — machine, own line */}
                {inc.machine && (
                  <p className="text-[13px] font-medium text-gray-500 truncate mt-1">
                    {inc.machine.machine_name}
                  </p>
                )}

                {/* Row 3 — title, the biggest thing on the card */}
                <p className="font-bold text-lg xl:text-xl text-gray-900 mt-2.5 leading-snug line-clamp-2">
                  {inc.title || typeLabel(inc.incident_type, t('board.problem')) }
                </p>

                {/* Photo indicator — right under the title */}
                {(inc.photo_count ?? 0) > 0 && (
                  <p
                    className="flex items-center gap-1 mt-1.5 text-[13px] text-gray-500"
                    aria-label={`${inc.photo_count} ${t('board.photos', '張照片')}`}
                  >
                    <Camera className="w-3.5 h-3.5" /> {inc.photo_count}
                  </p>
                )}

                {/* Next-step nudge: what this case needs next, at a glance */}
                {inc.status !== 'closed' && (
                  <div className="mt-3 pt-3 border-t border-gray-100">
                    <NextStepHint status={inc.status} userRole={userRole} />
                  </div>
                )}

                {/* Footer meta — demoted: who/when, assignee, case no. */}
                <div className="flex items-center justify-between gap-2 mt-3 text-[13px] text-gray-500">
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

          {/* Open cases are fetched uncapped (well, up to 1000 — see
              incidents/page.tsx) so a stuck-open case can never silently
              vanish; only CLOSED history is capped at 200 recent rows, since
              older closed cases are just history, reachable via search. */}
          {rows.filter(r => r.status === 'closed').length >= 200 && (
            <p className="col-span-full text-center text-xs text-gray-400 py-2">
              {t('board.limitNote', '已結案工單僅顯示最近 200 筆，較舊工單請使用搜尋')}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
