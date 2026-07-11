import { NextResponse } from 'next/server'
import { sendTelegramMessage, isTelegramConfigured } from '@/lib/telegram'

// POST /api/notifications/telegram — Telegram bot webhook.
// Handles /start and /chatid commands so users/admins can discover the chat_id
// (or group_id) needed to register in the telegram_users / telegram_groups tables.
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
