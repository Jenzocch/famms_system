'use client'

import Link from 'next/link'
import { AlertTriangle, Clock, Factory, ChevronRight, CheckCircle2, Wrench } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { zhTW, enUS, id as idLocale } from 'date-fns/locale'
import { IncidentStatus } from '@/types'
import { ISSUE_TYPE_LABELS, URGENCY_FROM_IMPACT, STATUS_ZH, STATUS_ZH_COLOR } from '@/lib/incident-display'
import { useI18n } from '@/lib/i18n'

export interface DashboardRow {
  id: string
  incident_no: string
  status: IncidentStatus
  downtime_impact: 'A' | 'B' | 'C' | 'D'
  incident_type: string
  title: string | null
  reported_at: string
  updated_at: string
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
  byFactory: [string, number][]
  urgent: DashboardRow[]
  stale: DashboardRow[]
  overdue: OverdueRow[]
}

const PM_TYPE_KEYS: Record<string, string> = {
  daily: 'pm.cadDaily', weekly: 'pm.cadWeekly', monthly: 'pm.cadMonthly',
  quarterly: 'pm.cadQuarterly', half_yearly: 'pm.cadHalfYearly', yearly: 'pm.cadYearly', custom: 'pm.cadCustom',
}

export default function DashboardView({
  openCount, urgentCount, staleCount, byFactory, urgent, stale, overdue,
}: DashboardViewProps) {
  const { t, locale } = useI18n()
  const dateLocale = locale === 'en' ? enUS : locale === 'id' ? idLocale : zhTW
  const pmTypeLabel = (pmType: string) => t(PM_TYPE_KEYS[pmType] ?? '', pmType)

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-gray-900">{t('dash.title')}</h1>
        <p className="text-sm text-gray-500 mt-1">{t('dash.overview')}</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-2">
        <SummaryCard label={t('dash.open')} value={openCount} color="text-blue-600" />
        <SummaryCard label={t('dash.urgent')} value={urgentCount} color="text-red-600" />
        <SummaryCard label={t('dash.stale')} value={staleCount} color="text-amber-600" />
      </div>

      {/* Per-factory open counts */}
      <Section icon={<Factory className="w-4 h-4" />} title={t('dash.openByFactory')}>
        {byFactory.length === 0 ? (
          <Empty text={t('dash.noOpen')} />
        ) : (
          <div className="space-y-1.5">
            {byFactory.map(([name, count]) => (
              <div key={name} className="flex items-center justify-between bg-white rounded-lg border border-gray-200 px-3 py-2.5">
                <span className="text-sm font-medium text-gray-700">{name}</span>
                <span className="text-sm font-bold text-blue-600">{t('dash.cases').replace('{count}', String(count))}</span>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Urgent cases */}
      <Section icon={<AlertTriangle className="w-4 h-4 text-red-500" />} title={t('dash.urgentCases')}>
        {urgent.length === 0 ? <Empty text={t('dash.noUrgent')} /> : <CaseList rows={urgent} t={t} dateLocale={dateLocale} />}
      </Section>

      {/* Stale cases */}
      <Section icon={<Clock className="w-4 h-4 text-amber-500" />} title={t('dash.staleCases')}>
        {stale.length === 0 ? <Empty text={t('dash.noStale')} /> : <CaseList rows={stale} t={t} dateLocale={dateLocale} />}
      </Section>

      {/* Overdue maintenance */}
      <Section icon={<Wrench className="w-4 h-4 text-red-500" />} title={t('dash.overdueMachines')}>
        {overdue.length === 0 ? (
          <Empty text={t('dash.noOverdue')} />
        ) : (
          <div className="space-y-1.5">
            {overdue.map(m => (
              <div key={m.machine_id} className="bg-red-50 rounded-lg border border-red-200 px-3 py-2.5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-700">
                      {m.machine_code ? `[${m.machine_code}] ` : ''}{m.machine_name}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {t('pm.maintenanceFreq')}: {pmTypeLabel(m.pm_type)}
                    </p>
                  </div>
                  <p className="text-sm font-bold text-red-600">{t('pm.overdueDays').replace('{count}', String(m.days_overdue))}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  )
}

function SummaryCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-3 text-center">
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      <p className="text-xs text-gray-500 mt-0.5">{label}</p>
    </div>
  )
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="font-semibold text-gray-700 text-sm mb-2 flex items-center gap-1.5">{icon} {title}</h2>
      {children}
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 text-center text-sm text-gray-400 flex items-center justify-center gap-2">
      <CheckCircle2 className="w-4 h-4 text-green-400" /> {text}
    </div>
  )
}

function CaseList({
  rows, t, dateLocale,
}: {
  rows: DashboardRow[]
  t: (key: string, fallback?: string) => string
  dateLocale: Locale
}) {
  return (
    <div className="space-y-1.5">
      {rows.map(r => {
        const urgency = URGENCY_FROM_IMPACT[r.downtime_impact]
        return (
          <Link key={r.id} href={`/incidents/${r.id}`} className="block bg-white rounded-lg border border-gray-200 p-3 active:bg-gray-50">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_ZH_COLOR[r.status]}`}>{t(`boardStatus.${r.status}`, STATUS_ZH[r.status])}</span>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${urgency.color}`}>{t(`urgency.${r.downtime_impact}`, urgency.label)}</span>
              <ChevronRight className="w-4 h-4 text-gray-300 ml-auto" />
            </div>
            <p className="text-sm font-medium text-gray-900 mt-1.5 line-clamp-1">
              {r.title || t(`issueTypes.${r.incident_type}`, ISSUE_TYPE_LABELS[r.incident_type] || t('board.problem'))}
            </p>
            <p className="text-xs text-gray-400 mt-0.5">
              {r.factory?.name || ''} · {formatDistanceToNow(new Date(r.updated_at), { addSuffix: true, locale: dateLocale })}
            </p>
          </Link>
        )
      })}
    </div>
  )
}

type Locale = typeof zhTW
