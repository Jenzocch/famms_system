import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { nextOccurrenceAfter } from '@/lib/pm'
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
  const { pm_schedule_id, scheduled_date, status, findings, cost, delay_reason, checklist_results } = body as {
    pm_schedule_id?: string
    scheduled_date?: string
    status?: 'completed' | 'skipped'
    findings?: string
    cost?: number
    delay_reason?: PMDelayReason
    checklist_results?: { item: string; done: boolean }[]
  }

  if (!pm_schedule_id || !scheduled_date) {
    return NextResponse.json({ error: 'Jadwal perawatan dan tanggal wajib diisi' }, { status: 400 })
  }
  if (status !== 'completed' && status !== 'skipped') {
    return NextResponse.json({ error: 'status harus completed atau skipped' }, { status: 400 })
  }
  if (status === 'skipped' && !delay_reason) {
    return NextResponse.json({ error: 'Alasan keterlambatan wajib diisi saat dilewati' }, { status: 400 })
  }

  const { data: schedule, error: scheduleErr } = await supabase
    .from('pm_schedules')
    .select('id, pm_type, interval_days, is_active, checklist')
    .eq('id', pm_schedule_id)
    .single()
  if (scheduleErr || !schedule) {
    return NextResponse.json({ error: 'Jadwal PM tidak ditemukan' }, { status: 404 })
  }

  // The schedule's own checklist is the source of truth: completing requires
  // every item ticked. Checking only the client-sent array would let a client
  // that omits checklist_results (or sends fewer items) bypass the rule.
  if (status === 'completed') {
    let required = 0
    try { required = (JSON.parse(schedule.checklist || '[]') as unknown[]).length } catch { required = 0 }
    if (required > 0) {
      const done = Array.isArray(checklist_results) ? checklist_results.filter(c => c?.done).length : 0
      if (done < required) {
        return NextResponse.json(
          { error: 'Semua item checklist harus dicentang sebelum menandai selesai' },
          { status: 400 }
        )
      }
    }
  }

  const values = {
    status,
    checklist_results: checklist_results && checklist_results.length ? checklist_results : null,
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
    if (error?.code === '23505') {
      // Race lost: someone materialised this (schedule, date) between our
      // check and insert — the unique index (migration_pm_records_unique)
      // stopped a duplicate. Apply our result to the winner's row instead.
      const { data: winner } = await supabase
        .from('pm_records')
        .select('id')
        .eq('pm_schedule_id', pm_schedule_id)
        .eq('scheduled_date', scheduled_date)
        .single()
      if (winner) {
        const { error: updErr } = await supabase.from('pm_records').update(values).eq('id', winner.id)
        recordErrMsg = updErr?.message ?? null
      } else {
        recordErrMsg = error.message
      }
    } else {
      recordErrMsg = error?.message ?? null
    }
  }
  if (recordErrMsg) return NextResponse.json({ error: recordErrMsg }, { status: 500 })

  // Keep the cycle going: generate the next pending occurrence (same as the
  // PATCH /api/pm/records/[id] flow).
  let nextRecord = null
  if (schedule.is_active) {
    // Anchor to the schedule's earliest record so month-length clamping never
    // drifts the cadence (see lib/pm.ts rule 1).
    const { data: firstRec } = await supabase
      .from('pm_records')
      .select('scheduled_date')
      .eq('pm_schedule_id', schedule.id)
      .order('scheduled_date', { ascending: true })
      .limit(1)
      .maybeSingle()
    const nextDate = nextOccurrenceAfter(
      firstRec?.scheduled_date ?? scheduled_date,
      scheduled_date,
      schedule.pm_type as PMType,
      schedule.interval_days
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
