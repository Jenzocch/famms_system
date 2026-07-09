'use client'

import Link from 'next/link'
import { format } from 'date-fns'
import { ChevronLeft, CalendarClock, Printer } from 'lucide-react'
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

// Entry point to the printable work-order review report (/incidents/[id]/print).
export function PrintReportLink({ incidentId }: { incidentId: string }) {
  const { t } = useI18n()
  return (
    <Link
      href={`/incidents/${incidentId}/print`}
      className="text-xs text-gray-500 inline-flex items-center gap-1 hover:text-gray-800"
    >
      <Printer className="w-3.5 h-3.5" /> {t('printReport.openBtn', '列印報告')}
    </Link>
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

// Small corner badge marking whichever section is THIS user's actual next
// action right now (Part 6 "your turn" emphasis). Parent wrapper must have
// `relative` for the absolute positioning to anchor correctly.
export function YourTurnBadge() {
  const { t } = useI18n()
  return (
    <span className="absolute -top-2 -right-2 z-10 inline-flex items-center gap-1 rounded-full bg-blue-600 text-white text-[10px] font-semibold px-2 py-0.5 shadow">
      {t('common.yourTurn', '👉 該你了')}
    </span>
  )
}

export function ClosedBanner({ closedAt }: { closedAt: string | null }) {
  const { t } = useI18n()
  return (
    <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-center text-sm text-green-700 space-y-1">
      <p>
        ✅ {t('incidentDetail.closed')}
        {closedAt && ` · ${format(new Date(closedAt), 'yyyy-MM-dd HH:mm')}`}
      </p>
      <p className="text-xs text-green-600">{t('nextStep.doneNote')}</p>
    </div>
  )
}

// Collapsible wrapper for low-frequency sections (edit/delete, audit trail) so
// the detail page stays short on mobile. Native <details> keeps it zero-JS.
// `hintKey`/`hintFallback` render a small muted one-liner under the title,
// visible even while collapsed (it lives inside <summary>, not the hidden body)
// — explains what the section is for at a glance.
export function CollapsibleSection({ titleKey, fallback, hintKey, hintFallback, children }: {
  titleKey: string
  fallback: string
  hintKey?: string
  hintFallback?: string
  children: React.ReactNode
}) {
  const { t } = useI18n()
  return (
    <details className="bg-white rounded-xl border border-gray-200 group">
      <summary className="cursor-pointer select-none px-4 py-3 flex items-center justify-between">
        <div>
          <span className="text-sm font-semibold text-gray-700">{t(titleKey, fallback)}</span>
          {hintKey && (
            <p className="text-xs font-normal text-gray-500 mt-0.5">{t(hintKey, hintFallback ?? '')}</p>
          )}
        </div>
        <span className="text-gray-400 transition-transform group-open:rotate-90">›</span>
      </summary>
      <div className="px-4 pb-4">{children}</div>
    </details>
  )
}
