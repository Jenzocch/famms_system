// FAMMS Preventive Maintenance helpers

import { addDays, addWeeks, addMonths, addYears, subDays, subWeeks, subMonths, subYears } from 'date-fns'
import type { PMType } from '@/types'

// Custom "every N days" schedules fall back to this when no interval is set.
const DEFAULT_CUSTOM_DAYS = 30
function customDays(intervalDays?: number | null): number {
  return intervalDays && intervalDays > 0 ? intervalDays : DEFAULT_CUSTOM_DAYS
}

// Compute the next scheduled date for a PM occurrence based on its type.
// For pm_type 'custom', intervalDays sets the "every N days" cadence.
export function nextScheduledDate(from: Date, pmType: PMType, intervalDays?: number | null): Date {
  switch (pmType) {
    case 'daily': return addDays(from, 1)
    case 'weekly': return addWeeks(from, 1)
    case 'monthly': return addMonths(from, 1)
    case 'quarterly': return addMonths(from, 3)
    case 'half_yearly': return addMonths(from, 6)
    case 'yearly': return addYears(from, 1)
    case 'custom': return addDays(from, customDays(intervalDays))
    default: return addMonths(from, 1)
  }
}

// Compute the previous scheduled date (one interval back).
export function prevScheduledDate(from: Date, pmType: PMType, intervalDays?: number | null): Date {
  switch (pmType) {
    case 'daily': return subDays(from, 1)
    case 'weekly': return subWeeks(from, 1)
    case 'monthly': return subMonths(from, 1)
    case 'quarterly': return subMonths(from, 3)
    case 'half_yearly': return subMonths(from, 6)
    case 'yearly': return subYears(from, 1)
    case 'custom': return subDays(from, customDays(intervalDays))
    default: return subMonths(from, 1)
  }
}

// Parse a 'YYYY-MM-DD' string into a UTC-midnight Date (avoids TZ drift
// when round-tripping through toDateStr).
export function parseDateStr(s: string): Date {
  return new Date(s + 'T00:00:00.000Z')
}

// Enumerate all occurrence dates (YYYY-MM-DD) of a recurring schedule that
// fall within [winStart, winEnd), anchored to a known occurrence date so the
// cadence stays aligned to real records. winStart/winEnd are 'YYYY-MM-DD'.
export function occurrencesInWindow(
  anchorStr: string,
  pmType: PMType,
  winStartStr: string,
  winEndStr: string,
  intervalDays?: number | null,
): string[] {
  const winStart = parseDateStr(winStartStr)
  const winEnd = parseDateStr(winEndStr)
  const out: string[] = []

  // Daily fills every day in the window regardless of anchor.
  if (pmType === 'daily') {
    let d = winStart
    let guard = 0
    while (d < winEnd && guard++ < 400) { out.push(toDateStr(d)); d = addDays(d, 1) }
    return out
  }

  // Other cadences: walk the anchor into the window, then forward.
  let occ = parseDateStr(anchorStr)
  let guard = 0
  while (occ >= winStart && guard++ < 5000) occ = prevScheduledDate(occ, pmType, intervalDays)
  guard = 0
  while (occ < winEnd && guard++ < 5000) {
    if (occ >= winStart) out.push(toDateStr(occ))
    occ = nextScheduledDate(occ, pmType, intervalDays)
  }
  return out
}

// Format a Date as YYYY-MM-DD (DATE column friendly).
export function toDateStr(d: Date): string {
  return d.toISOString().split('T')[0]
}

// A PM record is overdue when its scheduled date is in the past and it is not yet done.
export function isOverdue(scheduledDate: string, status: string): boolean {
  if (status === 'completed' || status === 'skipped') return false
  return new Date(scheduledDate) < new Date(new Date().toISOString().split('T')[0])
}
