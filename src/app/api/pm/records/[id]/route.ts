import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { nextOccurrenceAfter } from '@/lib/pm'
import type { PMType, PMDelayReason } from '@/types'

// PATCH /api/pm/records/[id] — complete or skip a PM record.
// On completion (or skip), generate the next pending record from the schedule
// so the recurring cycle continues.
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await req.json()
  const { status, findings, parts_replaced, cost, delay_reason, checklist_results } = body as {
    status?: 'completed' | 'skipped'
    findings?: string
    parts_replaced?: { part_code: string; qty: number; cost?: number }[]
    cost?: number
    delay_reason?: PMDelayReason
    checklist_results?: { item: string; done: boolean }[]
  }

  if (status !== 'completed' && status !== 'skipped') {
    return NextResponse.json({ error: 'status harus completed atau skipped' }, { status: 400 })
  }

  if (status === 'skipped' && !delay_reason) {
    return NextResponse.json({ error: 'Alasan keterlambatan wajib diisi saat dilewati' }, { status: 400 })
  }

  // Load the record + its schedule (for recurrence + active check)
  const { data: record, error: recordErr } = await supabase
    .from('pm_records')
    .select('*, schedule:pm_schedules(id, pm_type, interval_days, is_active, checklist)')
    .eq('id', id)
    .single()
  if (recordErr || !record) {
    return NextResponse.json({ error: 'PM record tidak ditemukan' }, { status: 404 })
  }

  // The schedule's own checklist is the source of truth: completing requires
  // every item ticked. "Completed" with unticked items is exactly the
  // paper-whipping this module exists to prevent — enforce it server-side.
  if (status === 'completed') {
    const scheduleChecklist = (record.schedule as { checklist?: string | null } | null)?.checklist
    let required = 0
    try { required = (JSON.parse(scheduleChecklist || '[]') as unknown[]).length } catch { required = 0 }
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

  const { error: updateErr } = await supabase
    .from('pm_records')
    .update({
      status,
      checklist_results: checklist_results && checklist_results.length ? checklist_results : null,
      completed_at: status === 'completed' ? new Date().toISOString() : null,
      completed_by_id: status === 'completed' ? user.id : null,
      findings: findings || null,
      parts_replaced: parts_replaced && parts_replaced.length ? JSON.stringify(parts_replaced) : null,
      cost: typeof cost === 'number' ? cost : null,
      delay_reason: delay_reason || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 })
  }

  // Generate the next occurrence if the schedule is still active.
  const schedule = record.schedule as { id: string; pm_type: PMType; interval_days: number | null; is_active: boolean } | null
  let nextRecord = null
  if (schedule?.is_active) {
    // Anchor to the schedule's EARLIEST record, not this one: chaining month
    // math off the previous (possibly clamped) date drifts permanently
    // (Jan 31 → Feb 28 → stuck on 28). nextOccurrenceAfter computes
    // anchor + n×interval, so the original day-of-month is preserved.
    const { data: firstRec } = await supabase
      .from('pm_records')
      .select('scheduled_date')
      .eq('pm_schedule_id', schedule.id)
      .order('scheduled_date', { ascending: true })
      .limit(1)
      .maybeSingle()
    const anchor = firstRec?.scheduled_date ?? record.scheduled_date
    const nextDate = nextOccurrenceAfter(anchor, record.scheduled_date, schedule.pm_type, schedule.interval_days)

    // Avoid duplicate next records for the same schedule + date
    const { data: existing } = await supabase
      .from('pm_records')
      .select('id')
      .eq('pm_schedule_id', schedule.id)
      .eq('scheduled_date', nextDate)
      .maybeSingle()

    if (!existing) {
      const { data: created } = await supabase
        .from('pm_records')
        .insert({
          pm_schedule_id: schedule.id,
          scheduled_date: nextDate,
          status: 'pending',
        })
        .select('*')
        .single()
      nextRecord = created
    }
  }

  return NextResponse.json({ ok: true, next_record: nextRecord })
}
