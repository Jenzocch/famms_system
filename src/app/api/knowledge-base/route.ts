import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

// POST /api/knowledge-base — create a knowledge base entry (post-incident learning).
export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const {
    incident_id,
    problem,
    root_cause,
    repair_method,
    lessons_learned,
    keywords,
    parts_used,
    photos,
  } = body

  if (!problem || !root_cause || !repair_method) {
    return NextResponse.json(
      { error: 'Deskripsi masalah, penyebab, dan metode perbaikan wajib diisi' },
      { status: 400 }
    )
  }

  const { data: entry, error } = await supabase
    .from('knowledge_base')
    .insert({
      incident_id: incident_id || null,
      problem,
      root_cause,
      repair_method,
      lessons_learned: lessons_learned || null,
      keywords: keywords || null,
      parts_used: parts_used && parts_used.length ? JSON.stringify(parts_used) : null,
      photos: photos && photos.length ? JSON.stringify(photos) : null,
      created_by_id: user.id,
    })
    .select('*')
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ entry })
}
