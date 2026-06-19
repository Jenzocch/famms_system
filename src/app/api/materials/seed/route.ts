import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import seedData from '../seed-data.json'

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || !['purchasing', 'director'].includes(profile.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Check if already seeded
  const { count } = await supabase.from('material_price_history').select('*', { count: 'exact', head: true })
  if (count && count > 0) {
    return NextResponse.json({ message: `Already has ${count} records`, skipped: true })
  }

  const { error } = await supabase.from('material_price_history').insert(seedData as any[])
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ message: `Imported ${seedData.length} records successfully` })
}
