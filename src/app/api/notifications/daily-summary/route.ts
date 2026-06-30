import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { notifyFactory, formatDailySummary, isTelegramConfigured } from '@/lib/telegram'

// POST /api/notifications/daily-summary — compute and send a daily summary to
// each factory's subscribed Telegram groups/users. Intended to be triggered by
// a scheduled job (cron) or manually by an admin.
export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!isTelegramConfigured()) {
    return NextResponse.json({ error: 'TELEGRAM_BOT_TOKEN 尚未設定' }, { status: 400 })
  }

  const today = new Date().toISOString().split('T')[0]
  const { data: factories } = await supabase.from('factories').select('id, name')

  const results: { factory: string; sent: number; failed: number }[] = []

  for (const f of factories ?? []) {
    const { data: incidents } = await supabase
      .from('incidents')
      .select('status, created_at, closed_at')
      .eq('factory_id', f.id)

    const open = (incidents ?? []).filter(i => i.status !== 'closed').length
    const newToday = (incidents ?? []).filter(i => i.created_at?.startsWith(today)).length
    const closedToday = (incidents ?? []).filter(i => i.closed_at?.startsWith(today)).length

    // Overdue PM for this factory
    const { data: schedules } = await supabase
      .from('pm_schedules')
      .select('id')
      .eq('factory_id', f.id)
    const scheduleIds = (schedules ?? []).map(s => s.id)
    let overduePM = 0
    if (scheduleIds.length) {
      const { count } = await supabase
        .from('pm_records')
        .select('id', { count: 'exact', head: true })
        .in('pm_schedule_id', scheduleIds)
        .eq('status', 'pending')
        .lt('scheduled_date', today)
      overduePM = count ?? 0
    }

    const html = formatDailySummary({
      factoryName: f.name,
      open,
      newToday,
      closedToday,
      overduePM,
    })
    const r = await notifyFactory(supabase, { factoryId: f.id, type: 'daily_summary', html })
    results.push({ factory: f.name, sent: r.sent, failed: r.failed })
  }

  return NextResponse.json({ results })
}
