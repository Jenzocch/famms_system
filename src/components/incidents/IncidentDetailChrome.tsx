'use client'

import Link from 'next/link'
import { format } from 'date-fns'
import { ChevronLeft, CalendarClock } from 'lucide-react'
import { useI18n } from '@/lib/i18n'

// Small localized bits of the (server-rendered) incident detail page. Kept as
// client components so they follow the active app language.

export function BackLink() {
  const { t } = useI18n()
  return (
    <Link href="/incidents" className="text-sm text-gray-500 inline-flex items-center gap-1">
      <ChevronLeft className="w-4 h-4" /> {t('incidentDetail.backToBoard')}
    </Link>
  )
}

// Urgency pill derived from the impact code (A/B/C/D). Label follows the app
// language; falls back to the static Chinese label for safety.
export function UrgencyChip({ impact, color, fallbackLabel }: {
  impact: string
  color: string
  fallbackLabel: string
}) {
  const { t } = useI18n()
  return (
    <span className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${color}`}>
      {t(`urgency.${impact}`, fallbackLabel)}
    </span>
  )
}

export function DueDateChip({ dueDate, isClosed }: { dueDate: string; isClosed: boolean }) {
  const { t } = useI18n()
  const overdue = !isClosed && new Date(dueDate) < new Date(new Date().toDateString())
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full ${
      overdue ? 'bg-red-50 text-red-700' : 'bg-gray-100 text-gray-600'
    }`}>
      <CalendarClock className="w-3.5 h-3.5" />
      {t('incidentDetail.expected')} {format(new Date(dueDate), 'yyyy-MM-dd')}
      {overdue ? ` (${t('incidentDetail.overdue')})` : ''}
    </span>
  )
}

export function ClosedBanner({ closedAt }: { closedAt: string | null }) {
  const { t } = useI18n()
  return (
    <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-center text-sm text-green-700">
      ✅ {t('incidentDetail.closed')}
      {closedAt && ` · ${format(new Date(closedAt), 'yyyy-MM-dd HH:mm')}`}
    </div>
  )
}

// Collapsible wrapper for low-frequency sections (edit/delete, audit trail) so
// the detail page stays short on mobile. Native <details> keeps it zero-JS.
export function CollapsibleSection({ titleKey, fallback, children }: {
  titleKey: string
  fallback: string
  children: React.ReactNode
}) {
  const { t } = useI18n()
  return (
    <details className="bg-white rounded-xl border border-gray-200 group">
      <summary className="cursor-pointer select-none px-4 py-3 text-sm font-semibold text-gray-700 flex items-center justify-between">
        {t(titleKey, fallback)}
        <span className="text-gray-400 transition-transform group-open:rotate-90">›</span>
      </summary>
      <div className="px-4 pb-4">{children}</div>
    </details>
  )
}
