'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { Loader2, BellRing } from 'lucide-react'
import { useI18n } from '@/lib/i18n'

// Supervisor/admin "nudge" button — sends a Telegram progress reminder for this
// incident. Rendered only when the viewer has the remindProgress permission
// (the parent page decides that), so no role check is needed here.
export default function RemindButton({ incidentId }: { incidentId: string }) {
  const { t } = useI18n()
  const [sending, setSending] = useState(false)

  async function remind() {
    setSending(true)
    try {
      const res = await fetch(`/api/incidents/${incidentId}/remind`, { method: 'POST' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error || t('remind.failed', '催進度發送失敗'))
      if ((json.sent ?? 0) === 0) {
        toast.warning(t('remind.noRecipients', '已送出，但目前沒有訂閱的 Telegram 接收者'))
      } else {
        toast.success(t('remind.sent', '已透過 Telegram 催進度（{count} 位接收者）').replace('{count}', String(json.sent)))
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('remind.failed', '催進度發送失敗'))
    } finally {
      setSending(false)
    }
  }

  return (
    <Button
      onClick={remind}
      disabled={sending}
      variant="outline"
      className="w-full h-11 text-base border-amber-300 text-amber-700 hover:bg-amber-50"
    >
      {sending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <BellRing className="w-4 h-4 mr-2" />}
      {t('remind.button', '催進度（Telegram 通知負責人）')}
    </Button>
  )
}
