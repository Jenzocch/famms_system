import { createClient } from '@/lib/supabase/server'
import { getCurrentUser, PERMISSIONS } from '@/lib/auth'
import { NextResponse } from 'next/server'
import { nextOccurrenceAfter, wibTodayStr } from '@/lib/pm'
import type { PMType } from '@/types'

// POST /api/pm/schedules — create a PM schedule for a machine,
// and generate its first pending pm_record.
export async function POST(req: Request) {
  const currentUser = await getCurrentUser()
  if (!currentUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!PERMISSIONS.managePMSchedules(currentUser.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { machine_id, pm_type, interval_days, description, checklist, first_due_date, assigned_user_ids, assigned_to } = body as {
    machine_id?: string
    pm_type?: PMType
    interval_days?: number | null
    description?: string
    checklist?: string[]
    first_due_date?: string
    assigned_user_ids?: string[]
    assigned_to?: string | null
  }

  if (!machine_id || !pm_type) {
    return NextResponse.json({ error: 'Mesin dan jenis perawatan wajib diisi' }, { status: 400 })
  }

  // Resolve factory from the machine
  const { data: machine, error: machineErr } = await supabase
    .from('machines')
    .select('id, factory_id')
    .eq('id', machine_id)
    .single()
  if (machineErr || !machine) {
    return NextResponse.json({ error: 'Mesin tidak ditemukan' }, { status: 404 })
  }

  const base = {
    factory_id: machine.factory_id,
    machine_id,
    pm_type,
    interval_days: pm_type === 'custom' ? (interval_days || null) : null,
    description: description || null,
    checklist: checklist && checklist.length ? JSON.stringify(checklist) : null,
    is_active: true,
  }

  // Assignee columns are added by SYNC_SCHEMA_LATEST.sql — try with them,
  // retry without if the migration hasn't run so creation never hard-fails.
  let { data: schedule, error: scheduleErr } = await supabase
    .from('pm_schedules')
    .insert({ ...base, assigned_user_ids: assigned_user_ids ?? [], assigned_to: assigned_to ?? null })
    .select('*')
    .single()
  if (scheduleErr) {
    ({ data: schedule, error: scheduleErr } = await supabase
      .from('pm_schedules')
      .insert(base)
      .select('*')
      .single())
  }

  if (scheduleErr || !schedule) {
    return NextResponse.json({ error: scheduleErr?.message ?? 'Insert failed' }, { status: 500 })
  }

  // Generate the first pending record. Use first_due_date if provided,
  // otherwise schedule one interval from today.
  // One interval from factory-local today (WIB) — new Date() alone is the
  // server's UTC clock, which is still "yesterday" for 7 hours each night.
  const wibToday = wibTodayStr()
  const dueDate = first_due_date
    ? first_due_date
    : nextOccurrenceAfter(wibToday, wibToday, pm_type, interval_days)

  const { data: record, error: recordErr } = await supabase
    .from('pm_records')
    .insert({
      pm_schedule_id: schedule.id,
      scheduled_date: dueDate,
      status: 'pending',
    })
    .select('*')
    .single()

  if (recordErr) {
    return NextResponse.json({ error: recordErr.message }, { status: 500 })
  }

  return NextResponse.json({ schedule, record })
}
