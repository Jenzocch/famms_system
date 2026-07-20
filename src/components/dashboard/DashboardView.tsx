'use client'

import Link from 'next/link'
import { AlertTriangle, Clock, Factory, ChevronRight, CheckCircle2, Wrench, Inbox, BarChart3 } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { zhTW, enUS, id as idLocale } from 'date-fns/locale'
import { IncidentStatus, UserRole } from '@/types'
import { URGENCY_FROM_IMPACT, STATUS_ZH, STATUS_ZH_COLOR } from '@/lib/incident-display'
import { useI18n } from '@/lib/i18n'
import { useIncidentTypeLabel } from '@/lib/incident-type-label'
import NextStepHint from '@/components/incidents/NextStepHint'

// Same left-edge urgency bar treatment as the board (IncidentBoard.tsx) — kept
// in sync there so a card reads the same "how urgent" signal everywhere in
// the app instead of a redundant pill.
const URGENCY_BAR_COLOR: Record<string, string> = {
  A: 'border-l-red-500',
  C: 'border-l-amber-400',
  D: 'border-l-green-500',
}

export interface DashboardRow {
  id: string
  incident_no: string
  status: IncidentStatus
  downtime_impact: 'A' | 'C' | 'D'
  incident_type: string
  title: string | null
  reported_at: string
  updated_at: string
  factory_id: string | null
  factory: { name: string } | null
}

export interface OverdueRow {
  machine_id: string
  machine_name: string
  machine_code: string | null
  pm_type: string
  days_overdue: number
}

interface DashboardViewProps {
  openCount: number
  urgentCount: number
  staleCount: number
  // Action queues: new reports to accept / blocked cases / cases to confirm-close
  inbox: { reported: number; waiting: number; confirm: number }
  // [factory name, open count, factory id (null = unspecified)]
  byFactory: [string, number, (string | null)?][]
  urgent: DashboardRow[]
  stale: DashboardRow[]
  overdue: OverdueRow[]
  userRole: UserRole
}

const PM_TYPE_KEYS: Record<string, string> = {
  daily: 'pm.cadDaily', weekly: 'pm.cadWeekly', monthly: 'pm.cadMonthly',
  quarterly: 'pm.cadQuarterly', half_yearly: 'pm.cadHalfYearly', yearly: 'pm.cadYearly', custom: 'pm.cadCustom',
}

export default function DashboardView({
  openCount, urgentCount, staleCount, inbox, byFactory, urgent, stale, overdue, userRole,
}: DashboardViewProps) {
  const { t, locale } = useI18n()
  const dateLocale = locale === 'en' ? enUS : locale === 'id' ? idLocale : zhTW
  const pmTypeLabel = (pmType: string) => t(PM_TYPE_KEYS[pmType] ?? '', pmType)

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">{t('dash.title')}</h1>
          <p className="text-sm text-gray-500 mt-1">{t('dash.overview')}</p>
        </div>
        <Link
          href="/reports"
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:border-blue-400 active:bg-gray-50 shrink-0"
        >
          <BarChart3 className="w-4 h-4" /> {t('dash.monthlyReport', '月報 Report')}
        </Link>
      </div>

      {/* Inbox and the 4 KPI tiles swap relative order by breakpoint: on
          phone, a supervisor checking "does anything need me" wants the
          inbox first, then the tiles. On desktop, the tiles read as a
          top-level stat row above the two-column detail grid, so they come
          first. Same two elements, just reordered via flex `order`. */}
      <div className="flex flex-col gap-5 lg:gap-6">
        <div className="order-2 lg:order-1 grid grid-cols-2 lg:grid-cols-4 gap-2 lg:gap-3">
          <SummaryCard label={t('dash.open')} value={openCount} color="text-blue-600" href="/incidents" />
          <SummaryCard label={t('dash.urgent')} value={urgentCount} color="text-red-600" href="#dash-urgent" />
          <SummaryCard label={t('dash.stale')} value={staleCount} color="text-amber-600" href="#dash-stale" />
          <SummaryCard label={t('dash.overdueMachines')} value={overdue.length} color="text-red-600" href="/pm" />
        </div>

        <div className="order-1 lg:order-2">
          {/* Action inbox — the three queues to drain daily; each deep-links to
              the board pre-set to the matching filter tab */}
          <Section icon={<Inbox className="w-4 h-4 text-blue-500" />} title={t('dash.inbox', '需要你處理')}>
            <div className="grid grid-cols-3 gap-2">
              <InboxCard
                href="/incidents?filter=reported"
                label={t('dash.inboxAccept', '未接單')}
                count={inbox.reported}
                activeClass="border-blue-300 bg-blue-50 text-blue-700"
              />
              <InboxCard
                href="/incidents?filter=waiting"
                label={t('dash.inboxWaiting', '等待中')}
                count={inbox.waiting}
                activeClass="border-amber-300 bg-amber-50 text-amber-700"
              />
              <InboxCard
                href="/incidents?filter=confirm"
                label={t('dash.inboxConfirm', '待確認結案')}
                count={inbox.confirm}
                activeClass="border-teal-300 bg-teal-50 text-teal-700"
              />
            </div>
          </Section>
        </div>
      </div>

      {/* Detail grid: LEFT = case lists needing attention (urgent, stale),
          RIGHT = aggregate views (per-factory, PM overdue). On phone these
          two column divs simply stack full-width, one after another. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 lg:gap-6 gap-y-5 lg:items-start">
        <div className="space-y-5">
          {/* Urgent cases */}
          <Section id="dash-urgent" icon={<AlertTriangle className="w-4 h-4 text-red-500" />} title={t('dash.urgentCases')}>
            {urgent.length === 0 ? <Empty text={t('dash.noUrgent')} /> : <CaseList rows={urgent} t={t} dateLocale={dateLocale} userRole={userRole} />}
          </Section>

          {/* Stale cases */}
          <Section id="dash-stale" icon={<Clock className="w-4 h-4 text-amber-500" />} title={t('dash.staleCases')}>
            {stale.length === 0 ? <Empty text={t('dash.noStale')} /> : <CaseList rows={stale} t={t} dateLocale={dateLocale} userRole={userRole} />}
          </Section>
        </div>

        <div className="space-y-5">
          {/* Per-factory open counts */}
          <Section icon={<Factory className="w-4 h-4" />} title={t('dash.openByFactory')}>
            {byFactory.length === 0 ? (
              <Empty text={t('dash.noOpen')} />
            ) : (
              // One grouped card with hairline dividers between rows, instead
              // of N separate bordered boxes — same content, fewer competing
              // outlines.
              <div className="bg-white rounded-2xl shadow-sm divide-y divide-gray-100">
                {byFactory.map(([name, count, factoryId]) => {
                  const content = (
                    <>
                      <span className="text-sm font-medium text-gray-700">{name}</span>
                      <span className="flex items-center gap-1">
                        <span className="text-sm font-bold text-blue-600">{t('dash.cases').replace('{count}', String(count))}</span>
                        {factoryId && <ChevronRight className="w-4 h-4 text-gray-300" />}
                      </span>
                    </>
                  )
                  // Clickable when we know the factory id → jump to a filtered board.
                  return factoryId ? (
                    <Link
                      key={name}
                      href={`/incidents?factory=${factoryId}`}
                      className="flex items-center justify-between px-3 py-2.5 active:bg-gray-50 active:scale-[0.98] transition-transform duration-150"
                    >
                      {content}
                    </Link>
                  ) : (
                    <div key={name} className="flex items-center justify-between px-3 py-2.5">
                      {content}
                    </div>
                  )
                })}
              </div>
            )}
          </Section>

          {/* Overdue maintenance */}
          <Section icon={<Wrench className="w-4 h-4 text-red-500" />} title={t('dash.overdueMachines')}>
            {overdue.length === 0 ? (
              <Empty text={t('dash.noOverdue')} />
            ) : (
              // Grouped card, hairline rows. The red bold day-count is enough
              // urgency signal here — the per-row red tint it used to sit in
              // was redundant once the rows share one card.
              <div className="bg-white rounded-2xl shadow-sm divide-y divide-gray-100">
                {overdue.map(m => (
                  <div key={m.machine_id} className="flex items-center justify-between px-3 py-2.5">
                    <div>
                      <p className="text-sm font-medium text-gray-700">
                        {m.machine_code ? `[${m.machine_code}] ` : ''}{m.machine_name}
                      </p>
                      <p className="text-[13px] text-gray-500 mt-0.5">
                        {t('pm.maintenanceFreq')}: {pmTypeLabel(m.pm_type)}
                      </p>
                    </div>
                    <p className="text-sm font-bold text-red-600">{t('pm.overdueDays').replace('{count}', String(m.days_overdue))}</p>
                  </div>
                ))}
              </div>
            )}
          </Section>
        </div>
      </div>
    </div>
  )
}

// Tappable queue card: colored while there's work in it, muted when drained.
function InboxCard({ href, label, count, activeClass }: {
  href: string; label: string; count: number; activeClass: string
}) {
  return (
    <Link
      href={href}
      className={`rounded-2xl p-3 text-center transition-all active:opacity-80 active:scale-[0.98] ${
        count > 0 ? `border ${activeClass}` : 'shadow-sm bg-white text-gray-400'
      }`}
    >
      <p className="text-2xl font-bold">{count}</p>
      <p className="text-xs mt-0.5 font-medium">{label}</p>
    </Link>
  )
}

function SummaryCard({ label, value, color, href }: { label: string; value: number; color: string; href?: string }) {
  const body = (
    <>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      <p className="text-[13px] text-gray-500 mt-0.5">{label}</p>
    </>
  )
  const cls = 'block bg-white rounded-2xl shadow-sm p-3 text-center'
  if (!href) return <div className={cls}>{body}</div>
  // In-page anchors jump to the section below; the board link navigates.
  return href.startsWith('#')
    ? <a href={href} className={`${cls} active:bg-gray-50 active:scale-[0.98] transition-transform duration-150`}>{body}</a>
    : <Link href={href} className={`${cls} active:bg-gray-50 active:scale-[0.98] transition-transform duration-150`}>{body}</Link>
}

function Section({ id, icon, title, children }: { id?: string; icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div id={id} className="scroll-mt-16">
      <h2 className="font-semibold text-gray-700 text-sm mb-2 flex items-center gap-1.5">{icon} {title}</h2>
      {children}
    </div>
  )
}

function Empty({ text }: { text: string }) {
  // Slim, single muted line — this fires often (most queues are empty most of
  // the time), so it shouldn't compete visually with sections that have work.
  return (
    <p className="flex items-center gap-1.5 text-sm text-gray-400 py-1">
      <CheckCircle2 className="w-4 h-4 text-green-400 shrink-0" /> {text}
    </p>
  )
}

function CaseList({
  rows, t, dateLocale, userRole,
}: {
  rows: DashboardRow[]
  t: (key: string, fallback?: string) => string
  dateLocale: Locale
  userRole: UserRole
}) {
  const typeLabel = useIncidentTypeLabel()
  return (
    // One grouped card, hairline rows — matches the byFactory/overdue lists.
    // Urgency reads from a left edge bar (same treatment as the board) instead
    // of a redundant pill, used consistently for both urgent and stale lists.
    <div className="bg-white rounded-2xl shadow-sm divide-y divide-gray-100">
      {rows.map(r => {
        const urgency = URGENCY_FROM_IMPACT[r.downtime_impact] ?? URGENCY_FROM_IMPACT.A
        return (
          <Link
            key={r.id}
            href={`/incidents/${r.id}`}
            aria-label={t(`urgency.${r.downtime_impact}`, urgency.label)}
            className={`block p-3 active:bg-gray-50 active:scale-[0.98] transition-transform duration-150 border-l-4 ${URGENCY_BAR_COLOR[r.downtime_impact] ?? URGENCY_BAR_COLOR.D}`}
          >
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_ZH_COLOR[r.status]}`}>{t(`boardStatus.${r.status}`, STATUS_ZH[r.status])}</span>
              <ChevronRight className="w-4 h-4 text-gray-300 ml-auto" />
            </div>
            <p className="text-sm font-medium text-gray-900 mt-1.5 line-clamp-1">
              {r.title || typeLabel(r.incident_type, t('board.problem'))}
            </p>
            <p className="text-[13px] text-gray-500 mt-0.5">
              {r.factory?.name || ''} · {formatDistanceToNow(new Date(r.updated_at), { addSuffix: true, locale: dateLocale })}
            </p>
            {r.status !== 'closed' && (
              <div className="mt-1.5 pt-1.5 border-t border-gray-100">
                <NextStepHint status={r.status} userRole={userRole} />
              </div>
            )}
          </Link>
        )
      })}
    </div>
  )
}

type Locale = typeof zhTW
