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

import { addDays, addWeeks, addMonths } from 'date-fns'
import type { PMType } from '@/types'

// zh fallbacks; rendered through t(PM_TYPE_KEYS[type]) so labels follow the
// active app language — this pair used to be redefined independently in
// PMDueList.tsx, PMPage.tsx, MachinePmStatus.tsx and pm/calendar/types.ts,
// which meant a translation fix to one could silently miss the others.
export const PM_TYPE_LABELS: Record<string, string> = {
  daily: '每日', weekly: '每週', monthly: '每月',
  quarterly: '每季', half_yearly: '每半年', yearly: '每年', custom: '自訂天數',
}
export const PM_TYPE_KEYS: Record<string, string> = {
  daily: 'pm.cadDaily', weekly: 'pm.cadWeekly', monthly: 'pm.cadMonthly',
  quarterly: 'pm.cadQuarterly', half_yearly: 'pm.cadHalfYearly',
  yearly: 'pm.cadYearly', custom: 'pm.cadCustom',
}

// The schedule's own checklist is the source of truth for what "completed"
// requires: every item ticked. Checking only the client-sent array would let
// a client that omits checklist_results (or sends fewer items) bypass the
// rule — "completed" with unticked items is exactly the paper-whipping this
// module exists to prevent, so this is enforced server-side, identically for
// both the pm_records list route (materializing a projected occurrence) and
// the [id] route (updating an existing row). Returns the same Bahasa error
// message both routes already surfaced, or null if it's fine to proceed.
export function checklistIncompleteError(
  scheduleChecklistJson: string | null | undefined,
  checklistResults: { item: string; done: boolean }[] | null | undefined,
): string | null {
  let required = 0
  try { required = (JSON.parse(scheduleChecklistJson || '[]') as unknown[]).length } catch { required = 0 }
  if (required === 0) return null
  const done = Array.isArray(checklistResults) ? checklistResults.filter(c => c?.done).length : 0
  return done < required ? 'Semua item checklist harus dicentang sebelum menandai selesai' : null
}

// Next PM due date from the LAST COMPLETED maintenance: last + one interval
// (no anchoring needed — it's a single step from a real completion date, not
// a projected series, so the chained-add drift rule below doesn't apply, and
// date-fns' clamped addMonths is the intended semantics here). Used by the
// dashboard's overdue-PM widget and the board's PM banner — both MUST use
// this one function so their overdue counts can never disagree (they used to
// be two "mirrored exactly" copies in two route files).
export function nextDueFromLast(lastMaintained: string | null, pmType: string, intervalDays?: number | null): Date {
  const base = lastMaintained ? new Date(lastMaintained) : new Date()
  switch (pmType) {
    case 'daily': return addDays(base, 1)
    case 'weekly': return addWeeks(base, 1)
    case 'monthly': return addMonths(base, 1)
    case 'quarterly': return addMonths(base, 3)
    case 'half_yearly': return addMonths(base, 6)
    case 'yearly': return addMonths(base, 12)
    case 'custom': return addDays(base, customDays(intervalDays))
    default: return addMonths(base, 1)
  }
}

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

// Whole days between two 'YYYY-MM-DD' strings (UTC midnight to UTC midnight).
export function daysBetween(from: string, to: string): number {
  return Math.round((parseDateStr(to).getTime() - parseDateStr(from).getTime()) / DAY_MS)
}

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
