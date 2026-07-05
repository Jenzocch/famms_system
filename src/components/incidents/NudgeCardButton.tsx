'use client'

import { useEffect, useRef, useState } from 'react'
import { BellRing, Loader2 } from 'lucide-react'
import { useI18n } from '@/lib/i18n'

// Card-level "nudge for progress" button with a two-tap confirm, so a stray
// tap on a phone doesn't blast Telegram at the assignees + factory group.
// First tap arms the confirm state (auto-resets after 3s); second tap sends.
export default function NudgeCardButton({
  incidentId, sending, onNudge,
}: {
  incidentId: string
  sending: boolean
  onNudge: (id: string) => void
}) {
  const { t } = useI18n()
  const [armed, setArmed] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  function click(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (sending) return
    if (!armed) {
      setArmed(true)
      timer.current = setTimeout(() => setArmed(false), 3000)
      return
    }
    if (timer.current) clearTimeout(timer.current)
    setArmed(false)
    onNudge(incidentId)
  }

  return (
    <button
      onClick={click}
      disabled={sending}
      className={`inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full border transition-colors disabled:opacity-50 ${
        armed
          ? 'border-amber-500 text-white bg-amber-500 hover:bg-amber-600'
          : 'border-amber-300 text-amber-700 bg-amber-50 hover:bg-amber-100'
      }`}
    >
      {sending ? <Loader2 className="w-3 h-3 animate-spin" /> : <BellRing className="w-3 h-3" />}
      {armed ? t('remind.confirmTap', '再按一次確認') : t('remind.cardButton', '催進度')}
    </button>
  )
}
