// FAMMS Telegram notification helpers.
//
// Requires env TELEGRAM_BOT_TOKEN (from @BotFather). All sends are best-effort:
// failures are logged to notification_logs but never throw to the caller, so a
// notification problem can't break an incident/PM flow.

import type { SupabaseClient } from '@supabase/supabase-js'
import { DOWNTIME_IMPACT_LABELS, NotificationType, DowntimeImpact } from '@/types'
import { SLA_LABELS } from '@/lib/constants'

const TOKEN = process.env.TELEGRAM_BOT_TOKEN
const API_BASE = TOKEN ? `https://api.telegram.org/bot${TOKEN}` : ''

export function isTelegramConfigured(): boolean {
  return !!TOKEN
}

// Escape HTML special chars for Telegram HTML parse mode. Exported so route
// handlers building their own messages can't forget to sanitize user input
// (titles, reporter names) — unescaped '<' breaks the whole send.
export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export interface SendResult {
  ok: boolean
  messageId?: number
  error?: string
}

// Inline keyboard support: buttons under a message that fire callback_query
// updates back to the webhook — how assignees report status straight from
// Telegram without opening the app.
export interface InlineKeyboard {
  inline_keyboard: { text: string; callback_data: string }[][]
}

// force_reply: pins the client's text input to THIS message and opens the
// keyboard automatically — the user just types and hits send, no need to
// long-press and pick "Reply" themselves. Used for the "📝 Tambah catatan"
// prompt so replying doesn't require knowing Telegram's reply gesture.
export interface ForceReply {
  force_reply: true
  input_field_placeholder?: string
}

export async function sendTelegramMessage(
  chatId: number | string,
  html: string,
  replyMarkup?: InlineKeyboard | ForceReply
): Promise<SendResult> {
  if (!TOKEN) return { ok: false, error: 'TELEGRAM_BOT_TOKEN belum dikonfigurasi' }
  try {
    const res = await fetch(`${API_BASE}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: html,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
      }),
    })
    const json = await res.json()
    if (!json.ok) return { ok: false, error: json.description || 'send failed' }
    return { ok: true, messageId: json.result?.message_id }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'network error' }
  }
}

// Status-report buttons attached to assignment/reminder DMs. callback_data
// stays under Telegram's 64-byte cap: "st|<uuid36>|repairing" ≈ 50 bytes.
// Only technician-safe forward statuses — closing stays in-app (RCA gate,
// supervisor-only). Third row: prompts a force_reply so adding a note/photo
// doesn't require knowing "long-press → Reply" — see handleNoteButton.
export function incidentActionButtons(incidentId: string): InlineKeyboard {
  return {
    inline_keyboard: [
      [
        { text: '🔧 Mulai dikerjakan', callback_data: `st|${incidentId}|repairing` },
        { text: '✅ Selesai, siap dicek', callback_data: `st|${incidentId}|testing` },
      ],
      [{ text: '📝 Tambah catatan / foto', callback_data: `note|${incidentId}` }],
    ],
  }
}

// Urgency picker shown after a /lapor description is received. Plain
// severity levels only, matching the app's report form (no production-impact
// wording) — see URGENCY_FROM_IMPACT.
export function newReportUrgencyButtons(): InlineKeyboard {
  return {
    inline_keyboard: [[
      { text: '🔴 Mendesak', callback_data: 'newrpt|A' },
      { text: '🟡 Sedang', callback_data: 'newrpt|C' },
      { text: '🟢 Biasa', callback_data: 'newrpt|D' },
    ]],
  }
}

const URGENCY_LABEL_ID: Record<string, string> = { A: '🔴 Mendesak', C: '🟡 Sedang', D: '🟢 Biasa' }

// Checked, inert state after the urgency tap — same "visibly registered"
// treatment as incidentActionButtonsAfter.
export function newReportUrgencyButtonsAfter(picked: 'A' | 'C' | 'D'): InlineKeyboard {
  return { inline_keyboard: [[{ text: `✅ ${URGENCY_LABEL_ID[picked]}`, callback_data: 'noop' }]] }
}

// Factory picker — only shown to accounts NOT bound to a single factory
// (cross-factory technicians). One button per factory; FAMMS only has a
// handful (SJA/DIN/Olentia), so this stays a single tap, not a real picker.
export function newReportFactoryButtons(factories: { id: string; name: string }[]): InlineKeyboard {
  return { inline_keyboard: factories.map(f => [{ text: f.name, callback_data: `newrptfac|${f.id}` }]) }
}

export function newReportFactoryButtonAfter(name: string): InlineKeyboard {
  return { inline_keyboard: [[{ text: `✅ ${name}`, callback_data: 'noop' }]] }
}

// Repeat-failure confirm prompt sent to a factory's supervisors when /lapor
// detects a candidate (same machine + incident_type, prior incident closed
// as a temporary fix or with no root cause, within 30 days — see
// src/lib/repeat-failure.ts). Both IDs travel in callback_data since a
// serverless webhook has no other state to recover them from.
export function repeatFailureButtons(newIncidentId: string, priorIncidentId: string): InlineKeyboard {
  return {
    inline_keyboard: [[
      { text: '✅ Ya, sama', callback_data: `reprpt|${newIncidentId}|${priorIncidentId}|yes` },
      { text: '❌ Bukan', callback_data: `reprpt|${newIncidentId}|${priorIncidentId}|no` },
    ]],
  }
}

export function repeatFailureButtonsAfter(confirmed: boolean): InlineKeyboard {
  return {
    inline_keyboard: [[
      { text: confirmed ? '✅ Dikonfirmasi sama' : '❌ Ditandai berbeda', callback_data: 'noop' },
    ]],
  }
}

// Acknowledge a button tap (stops the client-side loading spinner). The text
// shows as a small toast in Telegram.
export async function answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
  if (!TOKEN) return
  await fetch(`${API_BASE}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: callbackQueryId, ...(text ? { text } : {}) }),
  }).catch(() => {})
}

// Rewrite the keyboard on the ORIGINAL message after a button tap — Telegram
// gives no other visual sign a button was pressed (no built-in pressed/
// disabled state), so without this the buttons look untouched forever and a
// technician can't tell whether their tap registered. The done action
// becomes a checked, inert label (callback_data 'noop'); a still-available
// forward action stays live.
export async function editMessageKeyboard(
  chatId: number | string,
  messageId: number,
  keyboard: InlineKeyboard
): Promise<void> {
  if (!TOKEN) return
  await fetch(`${API_BASE}/editMessageReplyMarkup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, message_id: messageId, reply_markup: keyboard }),
  }).catch(() => {})
}

// Keyboard reflecting a status that was just set via button: the completed
// action shows checked + inert; 'repairing' still offers the forward step to
// 'testing' (closing is never a button — stays in-app). The note button stays
// live either way — adding a note/photo isn't a one-time action.
export function incidentActionButtonsAfter(incidentId: string, target: 'repairing' | 'testing'): InlineKeyboard {
  const noteRow = [{ text: '📝 Tambah catatan / foto', callback_data: `note|${incidentId}` }]
  if (target === 'testing') {
    return { inline_keyboard: [[{ text: '✅ Selesai, siap dicek', callback_data: 'noop' }], noteRow] }
  }
  return {
    inline_keyboard: [
      [
        { text: '✅ Sedang dikerjakan', callback_data: 'noop' },
        { text: '✅ Selesai, siap dicek', callback_data: `st|${incidentId}|testing` },
      ],
      noteRow,
    ],
  }
}

// Download a file a user sent to the bot (photos attached to progress
// replies). Two-step per Telegram's API: getFile resolves the file_id to a
// path, then the file endpoint serves the bytes. Photos come pre-compressed
// by Telegram (largest size ≈ 1280px), conveniently close to the app's own
// upload compression target.
export async function downloadTelegramFile(fileId: string): Promise<{ bytes: ArrayBuffer; ext: string } | null> {
  if (!TOKEN) return null
  try {
    const meta = await fetch(`${API_BASE}/getFile?file_id=${encodeURIComponent(fileId)}`).then(r => r.json())
    const filePath: string | undefined = meta?.result?.file_path
    if (!meta?.ok || !filePath) return null
    const res = await fetch(`https://api.telegram.org/file/bot${TOKEN}/${filePath}`)
    if (!res.ok) return null
    const ext = filePath.includes('.') ? filePath.split('.').pop()! : 'jpg'
    return { bytes: await res.arrayBuffer(), ext }
  } catch {
    return null
  }
}

// ----------------------------------------------------------------------------
// Message formatters (Bahasa Indonesia + English technical terms)
// ----------------------------------------------------------------------------

export function formatNewIncident(args: {
  incidentNo: string
  machineLabel: string
  failureName: string
  impact: DowntimeImpact
  appUrl?: string
  incidentId?: string
}): string {
  const lines = [
    `🚨 <b>Insiden Baru</b> — ${esc(args.incidentNo)}`,
    `🏭 Mesin: ${esc(args.machineLabel)}`,
    `🔧 Kode Kerusakan: ${esc(args.failureName)}`,
    `📉 Dampak: ${esc(DOWNTIME_IMPACT_LABELS[args.impact])} (SLA ${esc(SLA_LABELS[args.impact])})`,
  ]
  if (args.appUrl && args.incidentId) {
    lines.push(`🔗 ${args.appUrl}/incidents/${args.incidentId}`)
  }
  return lines.join('\n')
}

// Personal "you've been assigned" message. Recipients are Indonesian field
// technicians → Bahasa Indonesia per the project language convention.
export function formatAssignment(args: {
  incidentNo: string
  title: string
  locationLabel: string
  impact: DowntimeImpact
  dueDate?: string | null
  appUrl?: string
  incidentId?: string
}): string {
  const lines = [
    `🔧 <b>Anda ditugaskan</b> — ${esc(args.incidentNo)}`,
    `📋 ${esc(args.title)}`,
    `📍 ${esc(args.locationLabel)}`,
    `📉 Dampak: ${esc(DOWNTIME_IMPACT_LABELS[args.impact])}`,
  ]
  if (args.dueDate) lines.push(`📅 Target selesai: ${esc(args.dueDate)}`)
  if (args.appUrl && args.incidentId) {
    lines.push(`🔗 ${args.appUrl}/incidents/${args.incidentId}`)
  }
  return lines.join('\n')
}

export function formatBlocking(args: { incidentNo: string; reason: string }): string {
  return [
    `🛑 <b>Kasus Terblokir</b> — ${esc(args.incidentNo)}`,
    `Alasan: ${esc(args.reason)}`,
  ].join('\n')
}

const PARTS_STATUS_LABEL: Record<'ordered' | 'received' | 'rejected', string> = {
  ordered: '🛒 Sedang diproses',
  received: '✅ Sudah tiba',
  rejected: '❌ Ditolak',
}

// Told to whoever placed the Gudang One parts request when the warehouse
// pushes a status write-back (POST /api/external/parts-requests) — closes
// the loop that previously required the requester to re-open the incident
// and check manually.
export function formatPartsStatus(args: {
  incidentNo: string
  itemsSummary: string
  status: 'ordered' | 'received' | 'rejected'
  appUrl?: string
  incidentId?: string
}): string {
  const lines = [
    `📦 <b>Update Permintaan Barang</b> — ${esc(args.incidentNo)}`,
    `${esc(args.itemsSummary)}`,
    `Status: ${PARTS_STATUS_LABEL[args.status]}`,
  ]
  if (args.appUrl && args.incidentId) {
    lines.push(`🔗 ${args.appUrl}/incidents/${args.incidentId}`)
  }
  return lines.join('\n')
}

export function formatDailySummary(args: {
  factoryName: string
  open: number
  newToday: number
  closedToday: number
  overduePM: number
}): string {
  return [
    `📊 <b>Ringkasan Harian</b> — ${esc(args.factoryName)}`,
    `• Kasus aktif: ${args.open}`,
    `• Baru hari ini: ${args.newToday}`,
    `• Selesai hari ini: ${args.closedToday}`,
    `• PM terlambat: ${args.overduePM}`,
  ].join('\n')
}

// ----------------------------------------------------------------------------
// Dispatch: send to a factory's groups + opted-in users, log each send.
// ----------------------------------------------------------------------------

type GroupFlag = 'notify_new_incident' | 'notify_sla_alert' | 'notify_blocking' | 'notify_daily_summary'

const TYPE_TO_FLAG: Partial<Record<NotificationType, GroupFlag>> = {
  new_incident: 'notify_new_incident',
  sla_alert: 'notify_sla_alert',
  blocking_alert: 'notify_blocking',
  daily_summary: 'notify_daily_summary',
}

export async function notifyFactory(
  supabase: SupabaseClient,
  // factoryId may be null: an incident that isn't tied to one factory. In that
  // case only the shared (factory_id NULL) groups/users apply — passing null
  // into `.eq`/`.or` string filters would build `factory_id.eq.null`, which
  // PostgREST tries to cast to UUID and errors on, killing the whole send.
  args: { factoryId: string | null; type: NotificationType; html: string }
): Promise<{ sent: number; failed: number }> {
  if (!TOKEN) return { sent: 0, failed: 0 }

  const flag = TYPE_TO_FLAG[args.type]
  let sent = 0
  let failed = 0

  // Groups subscribed to this notification type — factory_id NULL means "all
  // factories" (e.g. one shared office group), always included; a specific
  // factory also gets its own groups.
  let groupQuery = supabase
    .from('telegram_groups')
    .select('id, telegram_group_id')
  groupQuery = args.factoryId
    ? groupQuery.or(`factory_id.eq.${args.factoryId},factory_id.is.null`)
    : groupQuery.is('factory_id', null)
  if (flag) groupQuery = groupQuery.eq(flag, true)
  const { data: groups } = await groupQuery

  for (const g of groups ?? []) {
    const r = await sendTelegramMessage(g.telegram_group_id, args.html)
    await supabase.from('notification_logs').insert({
      notification_type: args.type,
      recipient_type: 'group',
      recipient_id: g.id,
      telegram_message_id: r.messageId ?? null,
      status: r.ok ? 'sent' : 'failed',
    })
    if (r.ok) sent++; else failed++
  }

  // Individually opted-in users (shared NULL-factory registrations always
  // apply; a specific factory also gets its own).
  let userQuery = supabase
    .from('telegram_users')
    .select('id, telegram_chat_id')
    .eq('notification_enabled', true)
  userQuery = args.factoryId
    ? userQuery.or(`factory_id.eq.${args.factoryId},factory_id.is.null`)
    : userQuery.is('factory_id', null)
  const { data: users } = await userQuery

  for (const u of users ?? []) {
    const r = await sendTelegramMessage(u.telegram_chat_id, args.html)
    await supabase.from('notification_logs').insert({
      notification_type: args.type,
      recipient_type: 'user',
      recipient_id: u.id,
      telegram_message_id: r.messageId ?? null,
      status: r.ok ? 'sent' : 'failed',
    })
    if (r.ok) sent++; else failed++
  }

  return { sent, failed }
}

// Direct-message specific accounts (by profile id) via their registered
// personal chat_id. Used to nudge the exact assignees of an incident — a QC,
// technician, or anyone — instead of broadcasting to the whole factory.
// `unregistered` = assigned accounts with NO personal chat_id on file yet, so
// the caller can tell the supervisor "3 pinged, 1 not set up".
export async function notifyAssignees(
  supabase: SupabaseClient,
  args: { profileIds: string[]; type: NotificationType; html: string; replyMarkup?: InlineKeyboard }
): Promise<{ sent: number; failed: number; unregistered: number }> {
  if (!TOKEN || args.profileIds.length === 0) return { sent: 0, failed: 0, unregistered: 0 }

  const { data: users } = await supabase
    .from('telegram_users')
    .select('id, profile_id, telegram_chat_id')
    .in('profile_id', args.profileIds)
    .eq('notification_enabled', true)

  // A person may be registered in more than one factory (chat_id is globally
  // unique) — dedupe so they don't get the same nudge twice.
  const seen = new Set<number>()
  const targets = (users ?? []).filter(u => {
    if (seen.has(u.telegram_chat_id)) return false
    seen.add(u.telegram_chat_id)
    return true
  })

  let sent = 0
  let failed = 0
  for (const u of targets) {
    const r = await sendTelegramMessage(u.telegram_chat_id, args.html, args.replyMarkup)
    await supabase.from('notification_logs').insert({
      notification_type: args.type,
      recipient_type: 'user',
      recipient_id: u.id,
      telegram_message_id: r.messageId ?? null,
      status: r.ok ? 'sent' : 'failed',
    })
    if (r.ok) sent++; else failed++
  }

  const registered = new Set((users ?? []).map(u => u.profile_id))
  const unregistered = args.profileIds.filter(id => !registered.has(id)).length

  return { sent, failed, unregistered }
}
