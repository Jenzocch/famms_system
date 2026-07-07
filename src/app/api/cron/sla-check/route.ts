import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  isTelegramConfigured, notifyFactory, formatSLAAlert, formatDailySummary, esc,
} from '@/lib/telegram'
import { SLA_MINUTES } from '@/lib/constants'
import type { DowntimeImpact } from '@/types'

// GET /api/cron/sla-check — scheduled escalation sweep (vercel.json cron).
//
// One daily run does three things, so it fits the Hobby-plan single-daily-cron
// limit (on Pro the schedule can simply be raised to */30):
//  1. SLA breach: 'reported' incidents nobody accepted within their SLA window
//  2. Deadline breach: open incidents whose due_date has passed
//  3. Daily summary per factory (open / new / closed / overdue-PM counts)
//
// Auth: Vercel sends `Authorization: Bearer ${CRON_SECRET}` when the env var
// is set. Runs with the service-role client — there is no user session here.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization')
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!isTelegramConfigured()) {
    return NextResponse.json({ ok: true, skipped: 'telegram not configured' })
  }

  const supabase = createAdminClient()
  const now = Date.now()
  // Factory-local "today" (WIB, UTC+7) for the summary counts.
  const localToday = new Date(now + 7 * 3600000).toISOString().slice(0, 10)
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || ''

  // Re-alert at most once per ~22h per incident, so the daily run doesn't
  // spam the same breach forever but keeps nudging until someone acts.
  const alertFloor = new Date(now - 22 * 3600000).toISOString()

  const results = { slaAlerts: 0, overdueAlerts: 0, summaries: 0, failed: 0 }

  // ---- 1) Unaccepted incidents past their SLA response window -------------
  const { data: unaccepted } = await supabase
    .from('incidents')
    .select('id, incident_no, title, downtime_impact, reported_at, factory_id, last_sla_alert_at, machine:machines(machine_name, machine_code)')
    .eq('status', 'reported')
    .limit(200)

  for (const inc of unaccepted ?? []) {
    if (!inc.factory_id) continue
    const slaMin = SLA_MINUTES[(inc.downtime_impact ?? 'D') as DowntimeImpact] ?? 480
    const minutesLate = Math.floor((now - new Date(inc.reported_at).getTime()) / 60000) - slaMin
    if (minutesLate <= 0) continue
    if (inc.last_sla_alert_at && inc.last_sla_alert_at > alertFloor) continue

    const machine = inc.machine as unknown as { machine_name: string; machine_code: string | null } | null
    const machineLabel = machine
      ? `${machine.machine_code ? `[${machine.machine_code}] ` : ''}${machine.machine_name}`
      : (inc.title ?? '-')
    const html = formatSLAAlert({ incidentNo: inc.incident_no, machineLabel, minutesLate })
      + (appUrl ? `\n<a href="${appUrl}/incidents/${inc.id}">Lihat detail →</a>` : '')

    const res = await notifyFactory(supabase, { factoryId: inc.factory_id, type: 'sla_alert', html })
    if (res.sent > 0) {
      results.slaAlerts++
      await supabase.from('incidents')
        .update({ last_sla_alert_at: new Date().toISOString() })
        .eq('id', inc.id)
    } else if (res.failed > 0) {
      results.failed++
    }
  }

  // ---- 2) Open incidents whose due_date has passed -------------------------
  const { data: overdue } = await supabase
    .from('incidents')
    .select('id, incident_no, title, due_date, factory_id, last_sla_alert_at, assigned_to')
    .neq('status', 'closed')
    .not('due_date', 'is', null)
    .lt('due_date', localToday)
    .limit(200)

  for (const inc of overdue ?? []) {
    if (!inc.factory_id) continue
    if (inc.last_sla_alert_at && inc.last_sla_alert_at > alertFloor) continue

    const daysLate = Math.max(1, Math.floor(
      (new Date(localToday).getTime() - new Date(inc.due_date!).getTime()) / 86400000
    ))
    const html = [
      `📅 <b>Melewati Target</b> — ${esc(inc.incident_no)}`,
      inc.title ? esc(inc.title) : '',
      `Terlambat ${daysLate} hari dari target ${esc(inc.due_date!)}`,
      inc.assigned_to ? `PIC: ${esc(inc.assigned_to)}` : 'Belum ditugaskan',
      appUrl ? `<a href="${appUrl}/incidents/${inc.id}">Lihat detail →</a>` : '',
    ].filter(Boolean).join('\n')

    const res = await notifyFactory(supabase, { factoryId: inc.factory_id, type: 'sla_alert', html })
    if (res.sent > 0) {
      results.overdueAlerts++
      await supabase.from('incidents')
        .update({ last_sla_alert_at: new Date().toISOString() })
        .eq('id', inc.id)
    } else if (res.failed > 0) {
      results.failed++
    }
  }

  // ---- 3) Daily summary per factory ----------------------------------------
  const dayStartUtc = new Date(new Date(localToday).getTime() - 7 * 3600000).toISOString()
  const [factoriesRes, openRes, newRes, closedRes, pmRes] = await Promise.all([
    supabase.from('factories').select('id, name'),
    supabase.from('incidents').select('id, factory_id').neq('status', 'closed').limit(2000),
    supabase.from('incidents').select('id, factory_id').gte('reported_at', dayStartUtc).limit(2000),
    supabase.from('incidents').select('id, factory_id').gte('closed_at', dayStartUtc).limit(2000),
    supabase.from('pm_records')
      .select('id, schedule:pm_schedules!inner(factory_id)')
      .eq('status', 'pending')
      .lt('scheduled_date', localToday)
      .limit(2000),
  ])

  const countBy = (rows: { factory_id?: string | null }[] | null) => {
    const m: Record<string, number> = {}
    for (const r of rows ?? []) if (r.factory_id) m[r.factory_id] = (m[r.factory_id] ?? 0) + 1
    return m
  }
  const openBy = countBy(openRes.data)
  const newBy = countBy(newRes.data)
  const closedBy = countBy(closedRes.data)
  const pmBy: Record<string, number> = {}
  for (const r of pmRes.data ?? []) {
    const fid = (r.schedule as { factory_id?: string } | null)?.factory_id
    if (fid) pmBy[fid] = (pmBy[fid] ?? 0) + 1
  }

  for (const f of factoriesRes.data ?? []) {
    // Skip factories with nothing to report — no noise in quiet factories.
    if (!openBy[f.id] && !newBy[f.id] && !closedBy[f.id] && !pmBy[f.id]) continue
    const html = formatDailySummary({
      factoryName: f.name,
      open: openBy[f.id] ?? 0,
      newToday: newBy[f.id] ?? 0,
      closedToday: closedBy[f.id] ?? 0,
      overduePM: pmBy[f.id] ?? 0,
    })
    const res = await notifyFactory(supabase, { factoryId: f.id, type: 'daily_summary', html })
    if (res.sent > 0) results.summaries++
  }

  return NextResponse.json({ ok: true, ...results })
}
