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

// Escape HTML special chars for Telegram HTML parse mode.
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export interface SendResult {
  ok: boolean
  messageId?: number
  error?: string
}

export async function sendTelegramMessage(chatId: number | string, html: string): Promise<SendResult> {
  if (!TOKEN) return { ok: false, error: 'TELEGRAM_BOT_TOKEN 尚未設定' }
  try {
    const res = await fetch(`${API_BASE}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: html,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    })
    const json = await res.json()
    if (!json.ok) return { ok: false, error: json.description || 'send failed' }
    return { ok: true, messageId: json.result?.message_id }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'network error' }
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
    `🚨 <b>新案件</b> — ${esc(args.incidentNo)}`,
    `🏭 機器: ${esc(args.machineLabel)}`,
    `🔧 故障: ${esc(args.failureName)}`,
    `📉 影響: ${esc(DOWNTIME_IMPACT_LABELS[args.impact])}（SLA ${esc(SLA_LABELS[args.impact])}）`,
  ]
  if (args.appUrl && args.incidentId) {
    lines.push(`🔗 ${args.appUrl}/incidents/${args.incidentId}`)
  }
  return lines.join('\n')
}

export function formatSLAAlert(args: { incidentNo: string; machineLabel: string; minutesLate: number }): string {
  return [
    `⏰ <b>SLA 已逾時</b> — ${esc(args.incidentNo)}`,
    `🏭 機器: ${esc(args.machineLabel)}`,
    `⚠️ 尚未回應，已逾時 ${args.minutesLate} 分鐘`,
  ].join('\n')
}

export function formatBlocking(args: { incidentNo: string; reason: string }): string {
  return [
    `🛑 <b>工單已阻擋</b> — ${esc(args.incidentNo)}`,
    `原因: ${esc(args.reason)}`,
  ].join('\n')
}

export function formatDailySummary(args: {
  factoryName: string
  open: number
  newToday: number
  closedToday: number
  overduePM: number
}): string {
  return [
    `📊 <b>每日摘要</b> — ${esc(args.factoryName)}`,
    `• 進行中案件: ${args.open}`,
    `• 今日新增: ${args.newToday}`,
    `• 今日完成: ${args.closedToday}`,
    `• 保養逾期: ${args.overduePM}`,
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
  args: { factoryId: string; type: NotificationType; html: string }
): Promise<{ sent: number; failed: number }> {
  if (!TOKEN) return { sent: 0, failed: 0 }

  const flag = TYPE_TO_FLAG[args.type]
  let sent = 0
  let failed = 0

  // Groups subscribed to this notification type
  let groupQuery = supabase
    .from('telegram_groups')
    .select('id, telegram_group_id')
    .eq('factory_id', args.factoryId)
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
    r.ok ? sent++ : failed++
  }

  // Individually opted-in users
  const { data: users } = await supabase
    .from('telegram_users')
    .select('id, telegram_chat_id')
    .eq('factory_id', args.factoryId)
    .eq('notification_enabled', true)

  for (const u of users ?? []) {
    const r = await sendTelegramMessage(u.telegram_chat_id, args.html)
    await supabase.from('notification_logs').insert({
      notification_type: args.type,
      recipient_type: 'user',
      recipient_id: u.id,
      telegram_message_id: r.messageId ?? null,
      status: r.ok ? 'sent' : 'failed',
    })
    r.ok ? sent++ : failed++
  }

  return { sent, failed }
}
