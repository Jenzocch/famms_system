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
