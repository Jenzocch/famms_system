import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { notifyFactory } from '@/lib/telegram'
import { PERMISSIONS } from '@/lib/permissions'
import type { UserRole } from '@/types'

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

  const { data: incident, error: loadErr } = await supabase
    .from('incidents')
    .select(`
      id, incident_no, title, status, factory_id, assigned_to, due_date,
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

  const html = [
    `<b>⏰ 進度提醒</b>`,
    `<b>編號:</b> ${incident.incident_no}`,
    incident.title ? `<b>標題:</b> ${incident.title}` : '',
    `<b>位置:</b> ${factory?.name || '?'}${machine ? ` · ${machine.machine_name}` : ''}`,
    incident.assigned_to ? `<b>負責人:</b> ${incident.assigned_to}` : '<b>負責人:</b> （尚未指派）',
    incident.due_date ? `<b>預計完成:</b> ${incident.due_date}` : '',
    `${profile?.full_name || '主管'} 請您更新此案件的處理進度。`,
    `<a href="${appUrl}/incidents/${incident.id}">更新進度 →</a>`,
  ].filter(Boolean).join('\n')

  try {
    const result = await notifyFactory(supabase, {
      factoryId: incident.factory_id,
      type: 'status_update',
      html,
    })
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'notify failed' }, { status: 500 })
  }
}
