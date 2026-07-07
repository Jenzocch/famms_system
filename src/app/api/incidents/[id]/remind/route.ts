import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { notifyFactory, notifyAssignees } from '@/lib/telegram'
import { PERMISSIONS } from '@/lib/permissions'
import type { UserRole } from '@/types'

// Escape user-supplied text for Telegram HTML parse mode.
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// POST /api/incidents/[id]/remind — supervisor/admin nudges the assignees via
// Telegram to update an incident's progress. Broadcasts to the factory's
// subscribed groups + opted-in users (the assignees see themselves named).
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Role gate — only supervisors+ may send a reminder.
  const { data: profile } = await supabase
    .from('profiles')
    .select('role, full_name')
    .eq('id', user.id)
    .single()
  const role = (profile?.role ?? 'technician') as UserRole
  if (!PERMISSIONS.remindProgress(role)) {
    return NextResponse.json({ error: 'Hanya supervisor yang bisa mengirim pengingat' }, { status: 403 })
  }

  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const note = typeof body?.note === 'string' ? body.note.trim().slice(0, 500) : ''

  const { data: incident, error: loadErr } = await supabase
    .from('incidents')
    .select(`
      id, incident_no, title, status, factory_id, assigned_to, assigned_user_ids, due_date,
      machine:machines(machine_code, machine_name),
      factory:factories(name)
    `)
    .eq('id', id)
    .single()
  if (loadErr || !incident) {
    return NextResponse.json({ error: 'Incident tidak ditemukan' }, { status: 404 })
  }
  if (incident.status === 'closed') {
    return NextResponse.json({ error: 'Incident sudah ditutup' }, { status: 400 })
  }

  const machine = incident.machine as unknown as { machine_code: string | null; machine_name: string } | null
  const factory = incident.factory as unknown as { name: string } | null
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

  // Telegram messages are in Bahasa Indonesia — the factory floor audience.
  const html = [
    `<b>⏰ Pengingat Progres</b>`,
    `<b>No:</b> ${esc(incident.incident_no)}`,
    incident.title ? `<b>Judul:</b> ${esc(incident.title)}` : '',
    `<b>Lokasi:</b> ${esc(factory?.name || '?')}${machine ? ` · ${esc(machine.machine_name)}` : ''}`,
    incident.assigned_to ? `<b>PIC:</b> ${esc(incident.assigned_to)}` : '<b>PIC:</b> (belum ditugaskan)',
    incident.due_date ? `<b>Target selesai:</b> ${esc(incident.due_date)}` : '',
    `${esc(profile?.full_name || 'Supervisor')} meminta Anda memperbarui progres kasus ini.`,
    note ? `<b>📝 Catatan:</b> ${esc(note)}` : '',
    `<a href="${appUrl}/incidents/${incident.id}">Perbarui progres →</a>`,
  ].filter(Boolean).join('\n')

  const assignedIds = Array.isArray(incident.assigned_user_ids) ? (incident.assigned_user_ids as string[]) : []

  try {
    // 1) Direct-message the assigned people (QC, technician, whoever) so the
    //    nudge lands in their personal chat — the real "催". 2) Also broadcast
    //    to the factory's groups so the team keeps visibility.
    const [personal, group] = await Promise.all([
      notifyAssignees(supabase, { profileIds: assignedIds, type: 'status_update', html }),
      notifyFactory(supabase, { factoryId: incident.factory_id, type: 'status_update', html }),
    ])

    return NextResponse.json({
      ok: true,
      // Combined totals keep older callers working…
      sent: personal.sent + group.sent,
      failed: personal.failed + group.failed,
      // …and the breakdown powers a clearer toast ("2 pinged, 1 not set up").
      personalSent: personal.sent,
      personalFailed: personal.failed,
      unregistered: personal.unregistered,
      groupSent: group.sent,
      groupFailed: group.failed,
    })
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'notify failed' }, { status: 500 })
  }
}
