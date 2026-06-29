import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

// POST /api/rca — create a Root Cause Analysis record for a failure_code.
export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const {
    failure_code_id,
    root_cause,
    corrective_action,
    preventive_action,
    responsible_person_id,
    due_date,
  } = body

  if (!failure_code_id || !root_cause || !corrective_action || !preventive_action || !responsible_person_id || !due_date) {
    return NextResponse.json(
      { error: 'Semua field RCA wajib diisi (root cause, corrective, preventive, PIC, due date)' },
      { status: 400 }
    )
  }

  const { data: rca, error } = await supabase
    .from('rca_records')
    .insert({
      failure_code_id,
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
