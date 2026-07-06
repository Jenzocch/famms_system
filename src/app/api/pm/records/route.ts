import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { nextScheduledDate, parseDateStr, toDateStr } from '@/lib/pm'
import type { PMType, PMDelayReason } from '@/types'

// POST /api/pm/records — complete or skip a *projected* PM occurrence.
//
// The calendar projects future occurrences from active schedules without
// storing a pm_record row for each one. When a technician acts on a projected
// task, this endpoint materialises the record for (schedule, date) with the
// final status in one step — so every task shown on the calendar can actually
// be saved, whether or not a pending row existed yet.
export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { pm_schedule_id, scheduled_date, status, findings, cost, delay_reason } = body as {
    pm_schedule_id?: string
    scheduled_date?: string
    status?: 'completed' | 'skipped'
    findings?: string
    cost?: number
    delay_reason?: PMDelayReason
  }

  if (!pm_schedule_id || !scheduled_date) {
    return NextResponse.json({ error: 'pm_schedule_id dan scheduled_date wajib diisi' }, { status: 400 })
  }
  if (status !== 'completed' && status !== 'skipped') {
    return NextResponse.json({ error: 'status harus completed atau skipped' }, { status: 400 })
  }
  if (status === 'skipped' && !delay_reason) {
    return NextResponse.json({ error: 'delay_reason wajib diisi saat skip' }, { status: 400 })
  }

  const { data: schedule, error: scheduleErr } = await supabase
    .from('pm_schedules')
    .select('id, pm_type, interval_days, is_active')
    .eq('id', pm_schedule_id)
    .single()
  if (scheduleErr || !schedule) {
    return NextResponse.json({ error: 'Jadwal PM tidak ditemukan' }, { status: 404 })
  }

  const values = {
    status,
    completed_at: status === 'completed' ? new Date().toISOString() : null,
    completed_by_id: status === 'completed' ? user.id : null,
    findings: findings || null,
    cost: typeof cost === 'number' ? cost : null,
    delay_reason: delay_reason || null,
    updated_at: new Date().toISOString(),
  }

  // A stored row for this (schedule, date) may exist (e.g. two people acting
  // at once, or the projection raced a stored record) — update it instead of
  // inserting a duplicate.
  const { data: existing } = await supabase
    .from('pm_records')
    .select('id')
    .eq('pm_schedule_id', pm_schedule_id)
    .eq('scheduled_date', scheduled_date)
    .maybeSingle()

  let recordErrMsg: string | null = null
  if (existing) {
    const { error } = await supabase.from('pm_records').update(values).eq('id', existing.id)
    recordErrMsg = error?.message ?? null
  } else {
    const { error } = await supabase.from('pm_records').insert({
      pm_schedule_id,
      scheduled_date,
      ...values,
    })
    recordErrMsg = error?.message ?? null
  }
  if (recordErrMsg) return NextResponse.json({ error: recordErrMsg }, { status: 500 })

  // Keep the cycle going: generate the next pending occurrence (same as the
  // PATCH /api/pm/records/[id] flow).
  let nextRecord = null
  if (schedule.is_active) {
    const nextDate = toDateStr(
      nextScheduledDate(parseDateStr(scheduled_date), schedule.pm_type as PMType, schedule.interval_days)
    )
    const { data: nextExisting } = await supabase
      .from('pm_records')
      .select('id')
      .eq('pm_schedule_id', schedule.id)
      .eq('scheduled_date', nextDate)
      .maybeSingle()
    if (!nextExisting) {
      const { data: created } = await supabase
        .from('pm_records')
        .insert({ pm_schedule_id: schedule.id, scheduled_date: nextDate, status: 'pending' })
        .select('*')
        .single()
      nextRecord = created
    }
  }

  return NextResponse.json({ ok: true, next_record: nextRecord })
}
