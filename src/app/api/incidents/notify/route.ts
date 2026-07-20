import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getAuthClaims } from '@/lib/auth'
import { notifyFactory, esc } from '@/lib/telegram'

// Telegram messages are in Bahasa Indonesia — the factory floor audience.
const ISSUE_TYPE_LABELS: Record<string, string> = {
  machine: '🔧 Kerusakan Mesin',
  pipe: '🚿 Pipa/Saluran',
  electrical: '💡 Listrik/Penerangan',
  facility: '🏭 Fasilitas/Infrastruktur',
  safety: '⚠️ Masalah Keselamatan',
  cleanliness: '🧹 Kebersihan/Sanitasi',
  other: '📋 Lainnya',
}

const URGENCY_LABELS: Record<string, string> = {
  A: '🔴 Kritis', C: '🟡 Sedang', D: '🟢 Rendah',
}

// POST /api/incidents/notify — send Telegram alert for a new report
export async function POST(req: Request) {
  // Login required — without this, anyone on the internet could POST incident
  // ids and spam every registered Telegram group/user.
  const claims = await getAuthClaims()
  if (!claims) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const supabase = await createClient()

  // Require a logged-in user — otherwise anyone could POST an incidentId and
  // spam the factory's Telegram groups. Any authenticated user may trigger it
  // (the reporter, right after creating the incident).
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { incidentId } = await req.json()
  if (!incidentId) {
    return NextResponse.json({ error: 'incidentId required' }, { status: 400 })
  }

  const { data: incident } = await supabase
    .from('incidents')
    .select(`
      id, incident_no, incident_type, title, reporter_name, downtime_impact, factory_id,
      machine:machines(machine_code, machine_name),
      factory:factories(name)
    `)
    .eq('id', incidentId)
    .single()

  if (!incident) {
    return NextResponse.json({ error: 'incident not found' }, { status: 404 })
  }

  const machine = incident.machine as unknown as { machine_code: string | null; machine_name: string } | null
  const factory = incident.factory as unknown as { name: string } | null
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

  // Resolve the type label (covers admin-added types). Telegram audience is
  // the Indonesian factory floor, so prefer the Bahasa label.
  // select('*') keeps this working before the i18n columns migration is run.
  let typeLabel = ISSUE_TYPE_LABELS[incident.incident_type] || incident.incident_type
  const { data: typeRow } = await supabase
    .from('incident_types')
    .select('*')
    .eq('code', incident.incident_type)
    .maybeSingle()
  if (typeRow) {
    const row = typeRow as { label_id?: string | null; label?: string | null }
    typeLabel = row.label_id || row.label || typeLabel
  }

  // User-entered fields (title, names) must be escaped — a stray '<' would
  // otherwise make Telegram reject the whole message as bad HTML.
  const html = [
    `<b>🆕 Laporan Baru</b>`,
    `<b>No:</b> ${esc(incident.incident_no)}`,
    `<b>Jenis:</b> ${esc(typeLabel)}`,
    `<b>Urgensi:</b> ${URGENCY_LABELS[incident.downtime_impact] || esc(incident.downtime_impact)}`,
    incident.title ? `<b>Judul:</b> ${esc(incident.title)}` : '',
    `<b>Lokasi:</b> ${esc(factory?.name || '?')}${machine ? ` · ${esc(machine.machine_name)}` : ''}`,
    incident.reporter_name ? `<b>Pelapor:</b> ${esc(incident.reporter_name)}` : '',
    `<a href="${appUrl}/incidents/${incident.id}">Lihat detail →</a>`,
  ].filter(Boolean).join('\n')

  try {
    const result = await notifyFactory(supabase, {
      factoryId: incident.factory_id,
      type: 'new_incident',
      html,
    })
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'notify failed' })
  }
}
