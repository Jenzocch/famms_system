'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Loader2, BellRing } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import { useProgressNudge } from '@/lib/useProgressNudge'

// Supervisor/admin "nudge" button — sends a Telegram progress reminder for this
// incident, with an optional free-text note. Rendered only when the viewer has
// the remindProgress permission (the parent page decides that).
export default function RemindButton({ incidentId }: { incidentId: string }) {
  const { t } = useI18n()
  const { remindingId, nudge } = useProgressNudge()
  const [note, setNote] = useState('')
  const sending = remindingId === incidentId

  async function remind() {
    const ok = await nudge(incidentId, note)
    if (ok) setNote('')
  }

  return (
    <div className="bg-white rounded-xl border border-amber-200 p-4 space-y-2">
      <Textarea
        value={note}
        onChange={e => setNote(e.target.value)}
        placeholder={t('remind.notePlaceholder', '可選：補充想對負責人說的話（例如：老闆在問了，今天能好嗎？）')}
        rows={2}
        maxLength={500}
      />
      <Button
        onClick={remind}
        disabled={sending}
        variant="outline"
        title={t('remind.sectionHint', '發 Telegram 提醒給負責人')}
        className="w-full h-11 text-base border-amber-300 text-amber-700 hover:bg-amber-50"
      >
        {sending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <BellRing className="w-4 h-4 mr-2" />}
        {t('remind.button', '催進度（Telegram 通知負責人）')}
      </Button>
    </div>
  )
}
