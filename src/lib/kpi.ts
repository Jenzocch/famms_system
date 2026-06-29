// KPI calculation helpers for FAMMS dashboard

import { differenceInMinutes, differenceInHours, parseISO } from 'date-fns'

export interface KPIData {
  responseTime: number | null // minutes, avg
  diagnosisTime: number | null // hours, avg
  repairTime: number | null // hours, avg
  downtimeHours: number // total in period
  firstFixRate: number // %, permanent / total
  repeatFailureRate: number // %
  pmCompliance: number // %
}

export interface IncidentSummary {
  total: number
  reported: number
  accepted: number
  analyzing: number
  repairing: number
  testing: number
  observation: number
  closed: number
}

/**
 * Calculate average response time (reported → accepted).
 * Uses accepted_at (stamped when the incident first moves past 'reported');
 * falls back to created_at for legacy rows that predate that column.
 * Only counts incidents that have progressed past 'reported'.
 */
export function calcResponseTime(incidents: any[]): number | null {
  const responded = incidents.filter(i => i.status !== 'reported' && i.reported_at)
  if (responded.length === 0) return null

  const times = responded
    .map(i => {
      const reported = parseISO(i.reported_at)
      const acceptedStr = i.accepted_at ?? i.created_at // fallback for legacy rows
      if (!acceptedStr) return null
      const mins = differenceInMinutes(parseISO(acceptedStr), reported)
      return mins >= 0 ? mins : null // guard against clock skew / bad data
    })
    .filter((m): m is number => m !== null)

  if (times.length === 0) return null
  return Math.round(times.reduce((a, b) => a + b, 0) / times.length)
}

/**
 * Calculate average repair time from first action to close.
 */
export function calcRepairTime(incidents: any[], actions: any[]): number | null {
  const closedIncidents = incidents.filter(i => i.status === 'closed' && i.closed_at)
  if (closedIncidents.length === 0) return null

  const times = closedIncidents.map(inc => {
    const firstAction = actions
      .filter(a => a.incident_id === inc.id)
      .sort((a, b) => new Date(a.performed_at).getTime() - new Date(b.performed_at).getTime())[0]

    if (!firstAction) return 0
    const start = parseISO(firstAction.performed_at)
    const end = parseISO(inc.closed_at)
    return differenceInHours(end, start)
  })

  const nonZero = times.filter(t => t > 0)
  return nonZero.length ? Math.round(nonZero.reduce((a, b) => a + b, 0) / nonZero.length) : null
}

/**
 * Calculate total downtime (sum of action durations marked as downtime).
 */
export function calcDowntimeHours(actions: any[]): number {
  const totalMinutes = actions
    .filter(a => a.duration_minutes)
    .reduce((sum, a) => sum + (a.duration_minutes || 0), 0)
  return Math.round(totalMinutes / 60 * 10) / 10
}

/**
 * First fix rate = permanent fixes / total repairs (excluding open/pending).
 */
export function calcFirstFixRate(incidents: any[]): number {
  const finished = incidents.filter(i => ['closed'].includes(i.status))
  if (finished.length === 0) return 0

  const permanent = finished.filter(i => i.completion_type === 'permanent_fix').length
  return Math.round((permanent / finished.length) * 100)
}

/**
 * Repeat failure rate = repeat incidents / all closed incidents.
 */
export function calcRepeatFailureRate(incidents: any[], relations: any[]): number {
  const closed = incidents.filter(i => i.status === 'closed')
  if (closed.length === 0) return 0

  const repeatIds = new Set(
    relations
      .filter(r => r.relation_type === 'repeat_failure')
      .map(r => r.incident_id)
  )
  const repeats = closed.filter(i => repeatIds.has(i.id)).length
  return Math.round((repeats / closed.length) * 100)
}

/**
 * PM compliance = completed / (completed + overdue_pending + skipped).
 */
export function calcPMCompliance(records: any[]): number {
  const today = new Date().toISOString().split('T')[0]
  const completed = records.filter(r => r.status === 'completed').length
  const skipped = records.filter(r => r.status === 'skipped').length
  const overdue = records.filter(r => r.status === 'pending' && r.scheduled_date < today).length

  const accountable = completed + skipped + overdue
  return accountable > 0 ? Math.round((completed / accountable) * 100) : 100
}

/**
 * Summarize incident counts by status.
 */
export function summarizeIncidents(incidents: any[]): IncidentSummary {
  return {
    total: incidents.length,
    reported: incidents.filter(i => i.status === 'reported').length,
    accepted: incidents.filter(i => i.status === 'accepted').length,
    analyzing: incidents.filter(i => i.status === 'analyzing').length,
    repairing: incidents.filter(i => i.status === 'repairing').length,
    testing: incidents.filter(i => i.status === 'testing').length,
    observation: incidents.filter(i => i.status === 'observation').length,
    closed: incidents.filter(i => i.status === 'closed').length,
  }
}
