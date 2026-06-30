import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { notifyFactory, isTelegramConfigured } from '@/lib/telegram'

// POST /api/notifications/test — send a test message to the current user's
// factory groups/users to verify Telegram wiring.
export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!isTelegramConfigured()) {
    return NextResponse.json({ error: 'TELEGRAM_BOT_TOKEN 尚未在伺服器設定' }, { status: 400 })
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('factory_id')
    .eq('id', user.id)
    .single()
  if (!profile?.factory_id) {
    return NextResponse.json({ error: '找不到工廠' }, { status: 400 })
  }

  const html = '✅ <b>FAMMS 測試通知</b>\nTelegram 連線正常。'
  const r = await notifyFactory(supabase, {
    factoryId: profile.factory_id,
    type: 'status_update',
    html,
  })

  if (r.sent === 0 && r.failed === 0) {
    return NextResponse.json({
      error: '尚無已登記的接收者，請先新增群組或使用者。',
    }, { status: 400 })
  }

  return NextResponse.json(r)
}
