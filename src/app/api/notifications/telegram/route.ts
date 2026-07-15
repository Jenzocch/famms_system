import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendTelegramMessage, answerCallbackQuery, isTelegramConfigured, esc } from '@/lib/telegram'
import { logAuditEvent } from '@/lib/audit'
import type { IncidentStatus } from '@/types'

// POST /api/notifications/telegram — Telegram bot webhook.
//
// Three things happen here:
//  1. /start & /chatid — discover the chat_id needed to register.
//  2. callback_query — an assignee tapped a status button (🔧 Mulai /
//     ✅ Selesai) on their assignment/reminder DM: update the incident
//     without them opening the app.
//  3. A text reply to one of the bot's incident messages — recorded as a
//     progress note on that incident (the FIT- number in the quoted message
//     identifies the case).

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
    .select('id, full_name')
    .eq('id', reg.profile_id)
    .maybeSingle()
  return profile
}

async function handleStatusButton(admin: ReturnType<typeof createAdminClient>, cq: {
  id: string
  from?: { id?: number }
  message?: { chat?: { id?: number } }
  data?: string
}) {
  const chatId = cq.from?.id ?? cq.message?.chat?.id
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
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  await sendTelegramMessage(chatId, [
    `✅ <b>${esc(incident.incident_no)}</b> → ${esc(STATUS_LABEL_ID[target] ?? target)}`,
    'Balas pesan ini untuk menambah catatan pekerjaan (opsional).',
    `<a href="${appUrl}/incidents/${incidentId}">Lihat kasus →</a>`,
  ].join('\n'))
}

// A text reply to one of the bot's incident messages → progress note. The
// quoted message text carries the FIT- number, which identifies the case.
async function handleReplyNote(admin: ReturnType<typeof createAdminClient>, message: {
  chat?: { id?: number }
  text?: string
  reply_to_message?: { text?: string; from?: { is_bot?: boolean } }
}) {
  const chatId = message.chat?.id
  const note = (message.text ?? '').trim()
  const quoted = message.reply_to_message
  if (!chatId || !note || !quoted?.from?.is_bot) return

  const m = (quoted.text ?? '').match(/FIT-\d{8}-\d{3}(?:-dup\d+)?/)
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

  const { error } = await admin.from('incident_updates').insert({
    incident_id: incident.id,
    new_status: null,
    note,
    updated_by: profile.full_name || null,
    updated_by_id: profile.id,
  })
  if (!error) {
    await admin.from('incidents').update({ updated_at: new Date().toISOString() }).eq('id', incident.id)
    await sendTelegramMessage(chatId, `📝 Catatan tersimpan di <b>${esc(incident.incident_no)}</b>.`)
  }
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

  // Status button tapped on an assignment/reminder DM
  if (update?.callback_query) {
    const admin = createAdminClient()
    await handleStatusButton(admin, update.callback_query)
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

  // Reply-to-bot note (private chats only — group replies would be ambiguous)
  if (!isGroup && message?.reply_to_message) {
    const admin = createAdminClient()
    await handleReplyNote(admin, message)
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
