import { createClient } from '@/lib/supabase/server'
import { getCurrentUser, PERMISSIONS } from '@/lib/auth'
import { NextResponse } from 'next/server'

// POST /api/rca — create a Root Cause Analysis record for a failure_code.
export async function POST(req: Request) {
  const currentUser = await getCurrentUser()
  if (!currentUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!PERMISSIONS.submitRCA(currentUser.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const {
    failure_code_id,
    factory_id,
    root_cause,
    corrective_action,
    preventive_action,
    responsible_person_id,
    due_date,
  } = body

  if (!failure_code_id || !factory_id || !root_cause || !corrective_action || !preventive_action || !responsible_person_id || !due_date) {
    return NextResponse.json(
      { error: 'Semua field RCA wajib diisi (kode kegagalan, pabrik, root cause, corrective, preventive, PIC, due date)' },
      { status: 400 }
    )
  }
  // A factory-scoped submitter (has their own factory_id) can only file an
  // RCA under their own factory — otherwise they could satisfy another
  // factory's mandatory-RCA gate without that factory ever investigating.
  // Cross-factory accounts (manager/director/admin with no single factory_id)
  // may file for any factory.
  if (currentUser.factory_id && factory_id !== currentUser.factory_id) {
    return NextResponse.json({ error: '只能為自己的工廠建立 RCA' }, { status: 403 })
  }

  const { data: rca, error } = await supabase
    .from('rca_records')
    .insert({
      failure_code_id,
      factory_id,
      root_cause,
      corrective_action,
      preventive_action,
      responsible_person_id,
      due_date,
      status: 'open',
    })
    .select('*')
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ rca })
}
