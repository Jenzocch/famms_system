// FAMMS Preventive Maintenance date math.
//
// Two hard-won rules, learned from real bugs:
//
// 1. NEVER chain interval math off the previous occurrence. addMonths clamps
//    Jan 31 → Feb 28, and chaining from the clamped date loses the original
//    day forever (…Feb 28 → Mar 28 → Apr 28, never back to the 31st; a
//    leap-day yearly schedule decays to Feb 28 permanently). Every occurrence
//    is therefore computed as anchor + n×interval, clamping from the ANCHOR's
//    original day each time: Jan 31 → Feb 28 → Mar 31 → Apr 30 → May 31.
//
// 2. Do ALL of it in UTC. 'YYYY-MM-DD' strings parse to UTC midnight; mixing
//    that with local-time date libraries makes results depend on the server's
//    TZ setting (verified: a UTC-negative TZ shifts every date by one day).
//    Only UTC getters/setters below — output is identical in any server TZ.

import type { PMType } from '@/types'

// Custom "every N days" schedules fall back to this when no interval is set.
const DEFAULT_CUSTOM_DAYS = 30
function customDays(intervalDays?: number | null): number {
  return intervalDays && intervalDays > 0 ? intervalDays : DEFAULT_CUSTOM_DAYS
}

// Parse a 'YYYY-MM-DD' string into a UTC-midnight Date.
export function parseDateStr(s: string): Date {
  return new Date(s + 'T00:00:00.000Z')
}

// Format a UTC-midnight Date as YYYY-MM-DD (DATE column friendly).
export function toDateStr(d: Date): string {
  return d.toISOString().split('T')[0]
}

// Today's date string in factory-local time (WIB, UTC+7) regardless of the
// server's TZ. Mirrors the cron/sla-check convention.
export function wibTodayStr(now: Date = new Date()): string {
  return new Date(now.getTime() + 7 * 3_600_000).toISOString().split('T')[0]
}

const DAY_MS = 86_400_000

function addDaysUtc(d: Date, n: number): Date {
  return new Date(d.getTime() + n * DAY_MS)
}

// anchor + n months, clamped to the target month's length but always FROM the
// anchor's original day-of-month (rule 1 above).
function addMonthsUtcAnchored(anchor: Date, months: number): Date {
  const first = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + months, 1))
  const daysInTarget = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate()
  return new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(anchor.getUTCDate(), daysInTarget)))
}

// The n-th occurrence (n may be negative) of a schedule anchored at `anchor`.
export function occurrenceFromAnchor(anchor: Date, pmType: PMType, n: number, intervalDays?: number | null): Date {
  switch (pmType) {
    case 'daily': return addDaysUtc(anchor, n)
    case 'weekly': return addDaysUtc(anchor, 7 * n)
    case 'monthly': return addMonthsUtcAnchored(anchor, n)
    case 'quarterly': return addMonthsUtcAnchored(anchor, 3 * n)
    case 'half_yearly': return addMonthsUtcAnchored(anchor, 6 * n)
    case 'yearly': return addMonthsUtcAnchored(anchor, 12 * n)
    case 'custom': return addDaysUtc(anchor, customDays(intervalDays) * n)
    default: return addMonthsUtcAnchored(anchor, n)
  }
}

// First occurrence STRICTLY AFTER `afterStr`, aligned to `anchorStr`'s cadence.
// Used when a task is completed/skipped to materialise the next pending row —
// anchored so the cadence never drifts (rule 1).
export function nextOccurrenceAfter(
  anchorStr: string,
  afterStr: string,
  pmType: PMType,
  intervalDays?: number | null,
): string {
  const anchor = parseDateStr(anchorStr)
  const after = parseDateStr(afterStr)
  // Jump close with an estimate, then walk to the exact spot (guarded).
  const approxInterval =
    pmType === 'daily' ? 1
    : pmType === 'weekly' ? 7
    : pmType === 'monthly' ? 28
    : pmType === 'quarterly' ? 89
    : pmType === 'half_yearly' ? 181
    : pmType === 'yearly' ? 365
    : customDays(intervalDays)
  let n = Math.max(1, Math.floor((after.getTime() - anchor.getTime()) / DAY_MS / approxInterval))
  let guard = 0
  while (occurrenceFromAnchor(anchor, pmType, n, intervalDays) <= after && guard++ < 5000) n++
  while (n > 1 && occurrenceFromAnchor(anchor, pmType, n - 1, intervalDays) > after && guard++ < 5000) n--
  return toDateStr(occurrenceFromAnchor(anchor, pmType, n, intervalDays))
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
    while (d < winEnd && guard++ < 400) { out.push(toDateStr(d)); d = addDaysUtc(d, 1) }
    return out
  }

  const anchor = parseDateStr(anchorStr)
  // Find the first n whose occurrence lands inside the window, then walk
  // forward — always as anchor-multiples, never chained (rule 1).
  let n = 0
  let guard = 0
  while (occurrenceFromAnchor(anchor, pmType, n, intervalDays) >= winStart && guard++ < 5000) n--
  guard = 0
  while (guard++ < 5000) {
    const occ = occurrenceFromAnchor(anchor, pmType, n, intervalDays)
    if (occ >= winEnd) break
    if (occ >= winStart) out.push(toDateStr(occ))
    n++
  }
  return out
}
