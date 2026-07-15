import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  sendTelegramMessage, answerCallbackQuery, editMessageKeyboard, downloadTelegramFile,
  incidentActionButtons, incidentActionButtonsAfter, newReportUrgencyButtons,
  newReportUrgencyButtonsAfter, notifyFactory, isTelegramConfigured, esc,
} from '@/lib/telegram'
import { logAuditEvent } from '@/lib/audit'
import { deadlineFromUrgency } from '@/lib/incident-display'
import type { IncidentStatus } from '@/types'

// POST /api/notifications/telegram — Telegram bot webhook.
//
// Four things happen here:
//  1. /start & /chatid — discover the chat_id needed to register.
//  2. callback_query — an assignee tapped a status button (🔧 Mulai /
//     ✅ Selesai) on their assignment/reminder DM: update the incident
//     without them opening the app.
//  3. A text reply to one of the bot's incident messages — recorded as a
//     progress note on that incident (the FIT- number in the quoted message
//     identifies the case).
//  4. /lapor — report a brand-new incident without opening the app. Two-step
//     (describe → pick urgency) because a chat can only carry state across
//     separate updates via telegram_report_drafts (no in-memory state on a
//     serverless webhook). Deliberately minimal: no area/machine picker —
//     factory comes from the reporter's own account, and if the description
//     happens to contain a machine code (e.g. "[DIN-HMG-001]") it's matched
//     automatically so repeat-failure detection still works.

// Prompt prefix Telegram echoes back verbatim in reply_to_message.text — used
// to tell "replying to a /lapor prompt" apart from "replying to an incident
// message" (FIT- number match) without any extra state lookup.
const NEW_REPORT_PROMPT_PREFIX = '📋 Laporan baru'

// Forward-only status line, same as ProgressUpdate's. Buttons may only move a
// case forward; waiting side-states resume at 'analyzing'.
const MAIN_ORDER: IncidentStatus[] = [
  'reported', 'accepted', 'analyzing', 'repairing', 'testing', 'observation', 'closed',
]
const WAITING_STATES: IncidentStatus[] = [
  'waiting_parts', 'waiting_approval', 'waiting_vendor', 'waiting_shutdown',
]
// The only statuses a Telegram button may set. Closing stays in-app: it's
// supervisor-gated and runs the RCA check.
const BUTTON_TARGETS: IncidentStatus[] = ['repairing', 'testing']

const STATUS_LABEL_ID: Record<string, string> = {
  repairing: 'Sedang diperbaiki',
  testing: 'Selesai — menunggu pengecekan',
}

// Resolve who this chat belongs to. Registration is the auth here: only
// chat_ids an admin registered in telegram_users can act, and only on cases
// they're assigned to.
async function resolveProfile(admin: ReturnType<typeof createAdminClient>, chatId: number) {
  const { data: reg } = await admin
    .from('telegram_users')
    .select('profile_id')
    .eq('telegram_chat_id', chatId)
    .limit(1)
    .maybeSingle()
  if (!reg) return null
  const { data: profile } = await admin
    .from('profiles')
    .select('id, full_name, factory_id')
    .eq('id', reg.profile_id)
    .maybeSingle()
  return profile
}

async function handleStatusButton(admin: ReturnType<typeof createAdminClient>, cq: {
  id: string
  from?: { id?: number }
  message?: { chat?: { id?: number }; message_id?: number }
  data?: string
}) {
  const chatId = cq.from?.id ?? cq.message?.chat?.id
  const messageId = cq.message?.message_id

  // The already-done button on a rewritten keyboard is inert by design
  // (callback_data 'noop') — just clear the spinner, no state change.
  if (cq.data === 'noop') {
    await answerCallbackQuery(cq.id)
    return
  }

  const [, incidentId, target] = (cq.data ?? '').split('|')
  if (!chatId || !incidentId || !BUTTON_TARGETS.includes(target as IncidentStatus)) {
    await answerCallbackQuery(cq.id)
    return
  }

  const profile = await resolveProfile(admin, chatId)
  if (!profile) {
    await answerCallbackQuery(cq.id, 'Chat ID Anda belum terdaftar di FAMMS.')
    return
  }

  const { data: incident } = await admin
    .from('incidents')
    .select('id, incident_no, status, assigned_user_ids, factory_id')
    .eq('id', incidentId)
    .maybeSingle()
  if (!incident) {
    await answerCallbackQuery(cq.id, 'Kasus tidak ditemukan.')
    return
  }

  const assigned: string[] = Array.isArray(incident.assigned_user_ids) ? incident.assigned_user_ids : []
  if (!assigned.includes(profile.id)) {
    await answerCallbackQuery(cq.id, 'Anda bukan penanggung jawab kasus ini.')
    return
  }

  const current = incident.status as IncidentStatus
  if (current === 'closed') {
    await answerCallbackQuery(cq.id, 'Kasus sudah ditutup.')
    return
  }
  if (current === (target as IncidentStatus)) {
    await answerCallbackQuery(cq.id, 'Status sudah sama.')
    return
  }
  const effective = WAITING_STATES.includes(current) ? 'analyzing' : current
  if (MAIN_ORDER.indexOf(target as IncidentStatus) < MAIN_ORDER.indexOf(effective)) {
    await answerCallbackQuery(cq.id, 'Status tidak bisa mundur — perbarui lewat aplikasi.')
    return
  }

  const patch: Record<string, unknown> = { status: target, updated_at: new Date().toISOString() }
  if (current === 'reported') {
    patch.accepted_at = new Date().toISOString()
    patch.accepted_by_id = profile.id
  }
  const { error: updErr } = await admin.from('incidents').update(patch).eq('id', incidentId)
  if (updErr) {
    await answerCallbackQuery(cq.id, 'Gagal memperbarui — coba lewat aplikasi.')
    return
  }

  // Timeline + audit, so a Telegram report looks identical to an in-app one.
  await admin.from('incident_updates').insert({
    incident_id: incidentId,
    new_status: target,
    note: null,
    updated_by: profile.full_name || null,
    updated_by_id: profile.id,
  })
  await logAuditEvent(admin, {
    userId: profile.id,
    userName: profile.full_name || null,
    actionType: 'status_change',
    resourceType: 'incident',
    resourceId: incidentId,
    oldValue: current,
    newValue: target,
    changeSummary: `狀態變更為 "${target}"（via Telegram）`,
    factoryId: incident.factory_id ?? undefined,
  })

  await answerCallbackQuery(cq.id, '✅ Status diperbarui')

  // Rewrite the ORIGINAL message's buttons so the tap is visibly registered
  // there — without this, the buttons look untouched and a technician can't
  // tell from the message itself whether their tap went through.
  if (messageId) {
    await editMessageKeyboard(chatId, messageId, incidentActionButtonsAfter(incidentId, target as 'repairing' | 'testing'))
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  await sendTelegramMessage(chatId, [
    `✅ <b>${esc(incident.incident_no)}</b> → ${esc(STATUS_LABEL_ID[target] ?? target)}`,
    'Balas pesan ini untuk menambah catatan pekerjaan (opsional).',
    `<a href="${appUrl}/incidents/${incidentId}">Lihat kasus →</a>`,
  ].join('\n'))
}

// "📝 Tambah catatan / foto" tapped: send a force_reply prompt so the client
// auto-opens the keyboard pinned to THIS message — the user just types/sends
// a photo, no need to know Telegram's long-press-to-reply gesture. The
// prompt's own text carries the FIT- number so handleReplyNote's regex match
// keeps working on it exactly like a reply to the original assignment DM.
async function handleNoteButton(admin: ReturnType<typeof createAdminClient>, cq: {
  id: string
  from?: { id?: number }
  message?: { chat?: { id?: number } }
  data?: string
}) {
  const chatId = cq.from?.id ?? cq.message?.chat?.id
  const [, incidentId] = (cq.data ?? '').split('|')
  if (!chatId || !incidentId) { await answerCallbackQuery(cq.id); return }

  const { data: incident } = await admin
    .from('incidents')
    .select('incident_no')
    .eq('id', incidentId)
    .maybeSingle()
  await answerCallbackQuery(cq.id)
  if (!incident) return

  await sendTelegramMessage(
    chatId,
    `📝 Ketik catatan untuk <b>${esc(incident.incident_no)}</b> di bawah ini (boleh sertakan foto):`,
    { force_reply: true, input_field_placeholder: 'Catatan pekerjaan…' }
  )
}

// A reply to one of the bot's incident messages → progress note, with photos
// supported: a photo reply (with optional caption) is downloaded from
// Telegram and stored alongside app-uploaded work photos. The quoted message
// text carries the FIT- number, which identifies the case.
async function handleReplyNote(admin: ReturnType<typeof createAdminClient>, message: {
  chat?: { id?: number }
  text?: string
  caption?: string
  photo?: { file_id: string }[]
  reply_to_message?: { text?: string; caption?: string; from?: { is_bot?: boolean } }
}) {
  const chatId = message.chat?.id
  const note = (message.text ?? message.caption ?? '').trim()
  const hasPhoto = Array.isArray(message.photo) && message.photo.length > 0
  const quoted = message.reply_to_message
  if (!chatId || (!note && !hasPhoto) || !quoted?.from?.is_bot) return

  const m = (quoted.text ?? quoted.caption ?? '').match(/FIT-\d{8}-\d{3}(?:-dup\d+)?/)
  if (!m) return

  const profile = await resolveProfile(admin, chatId)
  if (!profile) {
    await sendTelegramMessage(chatId, 'Chat ID Anda belum terdaftar di FAMMS — hubungi admin.')
    return
  }

  const { data: incident } = await admin
    .from('incidents')
    .select('id, incident_no, status, assigned_user_ids')
    .eq('incident_no', m[0])
    .maybeSingle()
  if (!incident) return

  const assigned: string[] = Array.isArray(incident.assigned_user_ids) ? incident.assigned_user_ids : []
  if (!assigned.includes(profile.id)) {
    await sendTelegramMessage(chatId, `Anda bukan penanggung jawab ${esc(incident.incident_no)}.`)
    return
  }
  if (incident.status === 'closed') {
    await sendTelegramMessage(chatId, `${esc(incident.incident_no)} sudah ditutup — catatan tidak disimpan.`)
    return
  }

  // Photo reply: Telegram offers several sizes per photo — take the largest
  // (Telegram pre-compresses "photo" sends to ≈1280px, matching the app's own
  // upload compression), store it with the app's work photos.
  const photoPaths: string[] = []
  if (hasPhoto) {
    const largest = message.photo![message.photo!.length - 1]
    const file = await downloadTelegramFile(largest.file_id)
    if (file) {
      const path = `${incident.id}/updates/tg-${Date.now()}.${file.ext}`
      const { error: upErr } = await admin.storage
        .from('incident-photos')
        .upload(path, file.bytes, { contentType: `image/${file.ext === 'jpg' ? 'jpeg' : file.ext}` })
      if (!upErr) photoPaths.push(path)
    }
  }

  const { error } = await admin.from('incident_updates').insert({
    incident_id: incident.id,
    new_status: null,
    note: note || (photoPaths.length > 0 ? '📷 (foto via Telegram)' : null),
    updated_by: profile.full_name || null,
    updated_by_id: profile.id,
    photos: photoPaths.length > 0 ? JSON.stringify(photoPaths) : null,
  })
  if (!error) {
    await admin.from('incidents').update({ updated_at: new Date().toISOString() }).eq('id', incident.id)
    const what = photoPaths.length > 0 && note ? 'Catatan + foto' : photoPaths.length > 0 ? 'Foto' : 'Catatan'
    await sendTelegramMessage(chatId, `📝 ${what} tersimpan di <b>${esc(incident.incident_no)}</b>.`)
  }
}

// /lapor — start a new-incident report. Requires a single-factory account
// (the quick-report has no factory picker); cross-factory/unregistered
// accounts are told to use the app instead. Overwrites any stale draft for
// this chat so a second /lapor is always a fresh start, never a stuck one.
async function handleNewReportStart(admin: ReturnType<typeof createAdminClient>, chatId: number) {
  const profile = await resolveProfile(admin, chatId)
  if (!profile) {
    await sendTelegramMessage(chatId, 'Chat ID Anda belum terdaftar di FAMMS — hubungi admin.')
    return
  }
  if (!profile.factory_id) {
    await sendTelegramMessage(chatId, 'Akun Anda tidak terikat ke satu pabrik — laporan cepat lewat Telegram butuh itu. Silakan lapor lewat aplikasi.')
    return
  }

  await admin.from('telegram_report_drafts').delete().eq('chat_id', chatId)
  await admin.from('telegram_report_drafts').insert({ chat_id: chatId, profile_id: profile.id })

  await sendTelegramMessage(
    chatId,
    [
      `${NEW_REPORT_PROMPT_PREFIX}`,
      '',
      'Jelaskan masalahnya (boleh sertakan foto). Kalau tahu kode mesinnya, sertakan juga — mis. "[DIN-HMG-001] bocor di pipa bawah".',
    ].join('\n'),
    { force_reply: true, input_field_placeholder: 'Jelaskan masalahnya…' }
  )
}

// Reply to the /lapor prompt → save description/photo into the draft, then
// ask for urgency. The photo itself is NOT downloaded yet — only its
// file_id is kept — so an abandoned draft never uploads a stray file to
// storage; the actual download happens once the incident is really created.
async function handleNewReportDescription(admin: ReturnType<typeof createAdminClient>, message: {
  chat?: { id?: number }
  text?: string
  caption?: string
  photo?: { file_id: string }[]
}) {
  const chatId = message.chat?.id
  const description = (message.text ?? message.caption ?? '').trim()
  const photoFileId = Array.isArray(message.photo) && message.photo.length > 0
    ? message.photo[message.photo.length - 1].file_id
    : null
  if (!chatId || (!description && !photoFileId)) return

  const { data: draft } = await admin
    .from('telegram_report_drafts')
    .select('chat_id')
    .eq('chat_id', chatId)
    .maybeSingle()
  if (!draft) {
    await sendTelegramMessage(chatId, 'Sesi laporan sudah kedaluwarsa — ketik /lapor untuk mulai lagi.')
    return
  }

  await admin.from('telegram_report_drafts')
    .update({ description: description || null, photo_file_id: photoFileId })
    .eq('chat_id', chatId)

  await sendTelegramMessage(chatId, 'Seberapa mendesak?', newReportUrgencyButtons())
}

// Urgency tapped → actually create the incident: same incident_no scheme as
// the app's report form (today's sequence, retried on collision), same
// due-date calculation, same audit trail and factory notification. Runs as
// service_role so it doesn't go through the incidents RLS field-guard
// trigger — fine here since this whole path only ever writes fields a
// technician is already allowed to set (never due_date after creation,
// never status other than 'reported').
async function handleNewReportUrgency(admin: ReturnType<typeof createAdminClient>, cq: {
  id: string
  from?: { id?: number }
  message?: { chat?: { id?: number }; message_id?: number }
  data?: string
}) {
  const chatId = cq.from?.id ?? cq.message?.chat?.id
  const messageId = cq.message?.message_id
  const impact = (cq.data ?? '').split('|')[1] as 'A' | 'C' | 'D' | undefined
  if (!chatId || !impact) { await answerCallbackQuery(cq.id); return }

  const profile = await resolveProfile(admin, chatId)
  const { data: draft } = await admin
    .from('telegram_report_drafts')
    .select('*')
    .eq('chat_id', chatId)
    .maybeSingle()
  if (!profile || !profile.factory_id || !draft || !draft.description) {
    await answerCallbackQuery(cq.id, 'Sesi laporan sudah kedaluwarsa — ketik /lapor untuk mulai lagi.')
    return
  }

  await answerCallbackQuery(cq.id, '⏳ Membuat laporan…')

  // Best-effort machine-code match: a bracketed or bare token in the
  // description compared against this factory's machine codes. No match is
  // completely normal — the report just goes in without a machine link,
  // same as leaving that field blank in the app form.
  let machineId: string | null = null
  const codeMatch = draft.description.match(/\[?([A-Z]{2,}-[A-Z0-9-]+)\]?/i)
  if (codeMatch) {
    const { data: machine } = await admin
      .from('machines')
      .select('id')
      .eq('factory_id', profile.factory_id)
      .ilike('machine_code', codeMatch[1])
      .maybeSingle()
    machineId = machine?.id ?? null
  }

  const now = new Date()
  const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
  const { count } = await admin
    .from('incidents')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString())

  const title = draft.description.length > 60 ? `${draft.description.slice(0, 57)}...` : draft.description
  const basePayload = {
    factory_id: profile.factory_id,
    machine_id: machineId,
    incident_type: 'other',
    title,
    description: draft.description,
    reporter_name: profile.full_name || null,
    downtime_impact: impact,
    due_date: deadlineFromUrgency(impact),
    status: 'reported' as const,
    reported_by_id: profile.id,
  }

  let incident: { id: string; incident_no: string } | null = null
  let seq = (count ?? 0) + 1
  for (let attempt = 0; attempt < 6; attempt++) {
    const incident_no = `FIT-${ym}-${String(seq).padStart(3, '0')}`
    const { data, error } = await admin
      .from('incidents')
      .insert({ ...basePayload, incident_no })
      .select('id, incident_no')
      .single()
    if (!error) { incident = data; break }
    if (error.code === '23505') { seq++; continue }
    break
  }
  if (!incident) {
    await sendTelegramMessage(chatId, 'Gagal membuat laporan — coba lagi lewat /lapor, atau lewat aplikasi.')
    return
  }

  // Photo, if the description reply included one — downloaded now for the
  // first time (see handleNewReportDescription).
  if (draft.photo_file_id) {
    const file = await downloadTelegramFile(draft.photo_file_id)
    if (file) {
      const path = `${incident.id}/${Date.now()}-0.${file.ext}`
      await admin.storage.from('incident-photos')
        .upload(path, file.bytes, { contentType: `image/${file.ext === 'jpg' ? 'jpeg' : file.ext}` })
        .catch(() => {})
    }
  }

  await logAuditEvent(admin, {
    userId: profile.id,
    userName: profile.full_name || null,
    actionType: 'create',
    resourceType: 'incident',
    resourceId: incident.id,
    newValue: { incident_no: incident.incident_no, title, incident_type: 'other' },
    changeSummary: `工單已建立：${incident.incident_no}（via Telegram）`,
    factoryId: profile.factory_id,
  })

  await admin.from('telegram_report_drafts').delete().eq('chat_id', chatId)

  if (messageId) {
    await editMessageKeyboard(chatId, messageId, newReportUrgencyButtonsAfter(impact))
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  await sendTelegramMessage(chatId, [
    `✅ <b>${esc(incident.incident_no)}</b> berhasil dibuat.`,
    machineId ? '🔧 Mesin terdeteksi otomatis dari kode di deskripsi.' : '',
    `<a href="${appUrl}/incidents/${incident.id}">Lihat kasus →</a>`,
  ].filter(Boolean).join('\n'))

  // Best-effort: notify the factory's Telegram groups/opted-in users, same
  // as a report filed through the app.
  await notifyFactory(admin, {
    factoryId: profile.factory_id,
    type: 'new_incident',
    html: [
      `🚨 <b>Laporan Baru</b> — ${esc(incident.incident_no)}`,
      `📋 ${esc(title)}`,
      `📉 Dampak: ${esc(URGENCY_LABEL_FULL[impact])}`,
      profile.full_name ? `👤 ${esc(profile.full_name)}` : '',
      `<a href="${appUrl}/incidents/${incident.id}">Lihat detail →</a>`,
    ].filter(Boolean).join('\n'),
  }).catch(() => {})
}

const URGENCY_LABEL_FULL: Record<string, string> = {
  A: '🔴 Mendesak', C: '🟡 Sedang', D: '🟢 Biasa',
}

export async function POST(req: Request) {
  if (!isTelegramConfigured()) {
    return NextResponse.json({ ok: true }) // silently accept; bot not configured
  }

  // Verify the request really came from Telegram: it echoes
  // TELEGRAM_WEBHOOK_SECRET in this header on every webhook call (configured
  // via setWebhook's secret_token). Fail closed — an unset secret must reject,
  // not accept, or anyone can POST forged updates and make the bot message
  // arbitrary chat_ids on the company's behalf.
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET
  if (!secret || req.headers.get('x-telegram-bot-api-secret-token') !== secret) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }

  const update = await req.json().catch(() => null)

  // Button tapped on an assignment/reminder DM — dispatch by callback_data prefix
  if (update?.callback_query) {
    const admin = createAdminClient()
    const data: string = update.callback_query.data ?? ''
    if (data.startsWith('note|')) {
      await handleNoteButton(admin, update.callback_query)
    } else if (data.startsWith('newrpt|')) {
      await handleNewReportUrgency(admin, update.callback_query)
    } else {
      await handleStatusButton(admin, update.callback_query)
    }
    return NextResponse.json({ ok: true })
  }

  const message = update?.message
  const chat = message?.chat
  const text: string = message?.text ?? ''
  if (!chat) return NextResponse.json({ ok: true })

  const chatId = chat.id
  const isGroup = chat.type === 'group' || chat.type === 'supergroup'

  if (text.startsWith('/start') || text.startsWith('/chatid')) {
    const reply = isGroup
      ? [
          '👋 <b>FAMMS Bot</b>',
          `Group ID: <code>${chatId}</code>`,
          '',
          'Berikan ID ini ke admin untuk mendaftarkan group ke notifikasi pabrik.',
        ].join('\n')
      : [
          '👋 <b>FAMMS Bot</b>',
          `Chat ID Anda: <code>${chatId}</code>`,
          '',
          'Berikan ID ini ke admin untuk mengaktifkan notifikasi insiden.',
        ].join('\n')
    await sendTelegramMessage(chatId, reply)
    return NextResponse.json({ ok: true })
  }

  // /lapor — start a brand-new incident report (see the file-header comment
  // for the two-step design).
  if (!isGroup && (text.startsWith('/lapor') || text.startsWith('/report'))) {
    const admin = createAdminClient()
    await handleNewReportStart(admin, chatId)
    return NextResponse.json({ ok: true })
  }

  // /tugas — re-send the technician's open assigned cases, one message per
  // case with its own status buttons. The answer to "the assignment message
  // scrolled away, which one do I tap?": pull them all up fresh.
  if (!isGroup && (text.startsWith('/tugas') || text.startsWith('/tasks'))) {
    const admin = createAdminClient()
    const profile = await resolveProfile(admin, chatId)
    if (!profile) {
      await sendTelegramMessage(chatId, 'Chat ID Anda belum terdaftar di FAMMS — hubungi admin.')
      return NextResponse.json({ ok: true })
    }
    const { data: cases } = await admin
      .from('incidents')
      .select('id, incident_no, title, incident_type, status, due_date')
      .contains('assigned_user_ids', [profile.id])
      .neq('status', 'closed')
      .order('updated_at', { ascending: false })
      .limit(5)
    if (!cases || cases.length === 0) {
      await sendTelegramMessage(chatId, '✅ Tidak ada tugas aktif saat ini.')
      return NextResponse.json({ ok: true })
    }
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
    for (const c of cases) {
      await sendTelegramMessage(chatId, [
        `🔧 <b>${esc(c.incident_no)}</b> — ${esc(c.title || c.incident_type)}`,
        `Status: ${esc(c.status)}${c.due_date ? ` · Target: ${esc(c.due_date)}` : ''}`,
        `<a href="${appUrl}/incidents/${c.id}">Lihat kasus →</a>`,
      ].join('\n'), incidentActionButtons(c.id))
    }
    return NextResponse.json({ ok: true })
  }

  // Reply to a bot message (private chats only — group replies would be
  // ambiguous): either continuing a /lapor draft, or a note/photo on an
  // existing incident. Distinguished by the quoted prompt's own text, no
  // extra lookup needed.
  if (!isGroup && message?.reply_to_message?.from?.is_bot) {
    const admin = createAdminClient()
    const quotedText = message.reply_to_message.text ?? message.reply_to_message.caption ?? ''
    if (quotedText.startsWith(NEW_REPORT_PROMPT_PREFIX)) {
      await handleNewReportDescription(admin, message)
    } else {
      await handleReplyNote(admin, message)
    }
  }

  return NextResponse.json({ ok: true })
}

// GET — health check / setup hint
export async function GET() {
  return NextResponse.json({
    configured: isTelegramConfigured(),
    hint: 'Set TELEGRAM_BOT_TOKEN and register this URL as the bot webhook via setWebhook.',
  })
}
