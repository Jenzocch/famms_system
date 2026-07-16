import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentUser, PERMISSIONS } from '@/lib/auth'
import { logAuditEvent } from '@/lib/audit'

// DELETE /api/incidents/[id]/photos — remove one report photo from storage.
//
// Supervisor+ only: photos are field evidence ("the report DID show the
// leak"), so the people being supervised can't quietly remove them — a
// reporter who took a blurry shot adds a better one instead (photo upload in
// the edit form allows exactly that). Every deletion is audit-logged.
//
// Goes through the admin client because storage delete is gated by storage
// RLS; the role check here is the actual guard.
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!PERMISSIONS.editIncident(user.role)) {
    return NextResponse.json({ error: '只有主管以上可以刪除照片' }, { status: 403 })
  }

  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const path = typeof body.path === 'string' ? body.path : ''
  // The path must live inside THIS incident's folder — anything else (another
  // case's folder, traversal tricks) is rejected outright.
  if (!path.startsWith(`${id}/`) || path.includes('..')) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { error: rmErr } = await admin.storage.from('incident-photos').remove([path])
  if (rmErr) return NextResponse.json({ error: rmErr.message }, { status: 500 })

  // Recount instead of decrement: photo_count only tracks TOP-LEVEL report
  // photos (updates/ photos are tracked on their own rows), and a recount
  // self-heals any drift from pre-photo_count rows that started at 0.
  try {
    const { data: files } = await admin.storage.from('incident-photos').list(id, { limit: 100 })
    const count = (files ?? []).filter(f => f.id && !f.name.startsWith('.')).length
    await admin.from('incidents').update({ photo_count: count }).eq('id', id)
  } catch { /* count is cosmetic (board badge) — never fail the delete over it */ }

  await logAuditEvent(admin, {
    userId: user.id,
    userName: user.full_name || null,
    actionType: 'delete',
    resourceType: 'incident',
    resourceId: id,
    oldValue: { photo_path: path },
    changeSummary: `工單照片已刪除：${path.split('/').pop()}`,
    factoryId: user.factory_id || undefined,
  })

  return NextResponse.json({ ok: true })
}
