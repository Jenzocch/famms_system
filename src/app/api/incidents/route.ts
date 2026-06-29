import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { REPEAT_FAILURE_WINDOW_DAYS } from '@/lib/constants'
import { notifyFactory, formatNewIncident } from '@/lib/telegram'
import type { DowntimeImpact } from '@/types'

type IncidentType = 'machine' | 'facility'

interface IncidentRequest {
  incident_type: IncidentType
  machine_id?: string
  facility_id?: string
  failure_code_id?: string
  facility_issue_description?: string
  downtime_impact: DowntimeImpact
  remarks?: string
}

// POST /api/incidents — create a new incident (machine or facility)
export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body: IncidentRequest = await req.json()
  const { incident_type, downtime_impact, remarks } = body

  if (!incident_type || !downtime_impact) {
    return NextResponse.json({ error: 'incident_type dan downtime_impact wajib diisi' }, { status: 400 })
  }

  const now = new Date()
  let factory_id: string
  let label: string

  if (incident_type === 'machine') {
    // ============== MACHINE INCIDENT ==============
    const { machine_id, failure_code_id } = body
    if (!machine_id || !failure_code_id) {
      return NextResponse.json({ error: 'machine_id dan failure_code_id wajib diisi untuk incident mesin' }, { status: 400 })
    }

    // Resolve factory from the machine
    const { data: machine, error: machineErr } = await supabase
      .from('machines')
      .select('id, factory_id, machine_code')
      .eq('id', machine_id)
      .single()
    if (machineErr || !machine) {
      return NextResponse.json({ error: 'Mesin tidak ditemukan' }, { status: 404 })
    }

    factory_id = machine.factory_id
    label = machine.machine_code

    // Generate incident number
    const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
    const { count } = await supabase
      .from('incidents')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', monthStart)
    const seq = String((count ?? 0) + 1).padStart(4, '0')
    const incident_no = `INC-${ym}-${seq}`

    // Create incident
    const { data: incident, error: insertErr } = await supabase
      .from('incidents')
      .insert({
        factory_id,
        incident_type: 'machine',
        machine_id,
        incident_no,
        failure_code_id,
        downtime_impact,
        status: 'reported',
        reported_by_id: user.id,
        remarks: remarks || null,
      })
      .select('*')
      .single()

    if (insertErr) {
      return NextResponse.json({ error: insertErr.message }, { status: 500 })
    }

    // Repeat-failure detection
    const windowStart = new Date(now.getTime() - REPEAT_FAILURE_WINDOW_DAYS * 86400000).toISOString()
    const { data: priors } = await supabase
      .from('incidents')
      .select('id, incident_no, status, completion_type, root_cause, reported_at')
      .eq('machine_id', machine_id)
      .eq('failure_code_id', failure_code_id)
      .neq('id', incident.id)
      .gte('reported_at', windowStart)
      .order('reported_at', { ascending: false })

    const potentialRepeats = (priors ?? []).filter(
      p => p.completion_type === 'temporary_fix' || !p.root_cause
    )

    // Telegram notification
    try {
      const { data: fc } = await supabase
        .from('failure_codes')
        .select('name')
        .eq('id', failure_code_id)
        .single()
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
      const html = formatNewIncident({
        incidentNo: incident_no,
        machineLabel: machine.machine_code,
        failureName: fc?.name ?? failure_code_id,
        impact: downtime_impact,
        appUrl,
        incidentId: incident.id,
      })
      await notifyFactory(supabase, {
        factoryId: factory_id,
        type: 'new_incident',
        html,
      })
    } catch {
      // swallow
    }

    return NextResponse.json({
      incident,
      potential_repeats: potentialRepeats,
    })
  } else if (incident_type === 'facility') {
    // ============== FACILITY INCIDENT ==============
    const { facility_id, facility_issue_description } = body
    if (!facility_id || !facility_issue_description?.trim()) {
      return NextResponse.json({ error: 'facility_id dan facility_issue_description wajib diisi untuk incident fasilitas' }, { status: 400 })
    }

    // Resolve factory from the facility
    const { data: facility, error: facilityErr } = await supabase
      .from('facilities')
      .select('id, factory_id, facility_code, facility_name')
      .eq('id', facility_id)
      .single()
    if (facilityErr || !facility) {
      return NextResponse.json({ error: 'Fasilitas tidak ditemukan' }, { status: 404 })
    }

    factory_id = facility.factory_id
    label = facility.facility_code

    // Generate incident number
    const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
    const { count } = await supabase
      .from('incidents')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', monthStart)
    const seq = String((count ?? 0) + 1).padStart(4, '0')
    const incident_no = `INC-${ym}-${seq}`

    // Create incident
    const { data: incident, error: insertErr } = await supabase
      .from('incidents')
      .insert({
        factory_id,
        incident_type: 'facility',
        facility_id,
        incident_no,
        facility_issue_description,
        downtime_impact,
        status: 'reported',
        reported_by_id: user.id,
        remarks: remarks || null,
      })
      .select('*')
      .single()

    if (insertErr) {
      return NextResponse.json({ error: insertErr.message }, { status: 500 })
    }

    // Telegram notification
    try {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
      const html = `
        <b>🏭 Laporan Fasilitas Baru</b><br>
        <b>ID:</b> ${incident_no}<br>
        <b>Fasilitas:</b> ${facility.facility_name}<br>
        <b>Dampak:</b> ${downtime_impact}<br>
        <a href="${appUrl}/incidents/${incident.id}">Lihat Detail →</a>
      `
      await notifyFactory(supabase, {
        factoryId: factory_id,
        type: 'new_incident',
        html,
      })
    } catch {
      // swallow
    }

    return NextResponse.json({
      incident,
      potential_repeats: [],
    })
  } else {
    return NextResponse.json({ error: 'incident_type harus "machine" atau "facility"' }, { status: 400 })
  }
}
