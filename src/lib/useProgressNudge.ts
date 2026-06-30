'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { useI18n } from '@/lib/i18n'

// Shared "nudge for progress" action used by the board cards, the search-result
// cards, and the detail-page button. Fires the Telegram reminder for an
// incident and toasts the result. `remindingId` tracks which card is in-flight
// so a list can disable just that one button.
export function useProgressNudge() {
  const { t } = useI18n()
  const [remindingId, setRemindingId] = useState<string | null>(null)

  async function nudge(id: string, note?: string) {
    setRemindingId(id)
    try {
      const res = await fetch(`/api/incidents/${id}/remind`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(note?.trim() ? { note: note.trim() } : {}),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error || t('remind.failed', '催進度發送失敗'))
      if ((json.sent ?? 0) === 0) {
        toast.warning(t('remind.noRecipients', '已送出，但目前沒有訂閱的 Telegram 接收者'))
      } else {
        toast.success(t('remind.sent', '已透過 Telegram 催進度（{count} 位接收者）').replace('{count}', String(json.sent)))
      }
      return true
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('remind.failed', '催進度發送失敗'))
      return false
    } finally {
      setRemindingId(null)
    }
  }

  return { remindingId, nudge }
}
