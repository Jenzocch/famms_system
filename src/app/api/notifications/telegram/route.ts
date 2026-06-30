import { NextResponse } from 'next/server'
import { sendTelegramMessage, isTelegramConfigured } from '@/lib/telegram'

// POST /api/notifications/telegram — Telegram bot webhook.
// Handles /start and /chatid commands so users/admins can discover the chat_id
// (or group_id) needed to register in the telegram_users / telegram_groups tables.
export async function POST(req: Request) {
  if (!isTelegramConfigured()) {
    return NextResponse.json({ ok: true }) // silently accept; bot not configured
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
          '請把這個 ID 提供給管理員，登記群組以接收工廠通知。',
        ].join('\n')
      : [
          '👋 <b>FAMMS Bot</b>',
          `您的 Chat ID: <code>${chatId}</code>`,
          '',
          '請把這個 ID 提供給管理員，以啟用案件通知。',
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
