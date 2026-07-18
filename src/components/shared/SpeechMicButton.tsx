'use client'

import { Mic, Square } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import { useSpeechToText } from '@/lib/hooks/useSpeechToText'

// Dictation button for a text field. Renders NOTHING when the browser has no
// speech recognition — typing is always the baseline, voice is a shortcut.
// The parent appends recognized text into its own editable field state; this
// component never touches the field directly and never submits anything.
export default function SpeechMicButton({ onText }: { onText: (text: string) => void }) {
  const { t } = useI18n()
  const stt = useSpeechToText(onText)

  if (!stt.supported) return null

  return (
    <span className="inline-flex flex-col items-end">
      <button
        type="button"
        onClick={stt.toggle}
        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
          stt.listening
            ? 'bg-red-600 text-white animate-pulse'
            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
        }`}
      >
        {stt.listening
          ? <><Square className="w-3.5 h-3.5" /> {t('voice.stop', '停止')}</>
          : <><Mic className="w-3.5 h-3.5" /> {t('voice.speak', '用說的')}</>}
      </button>
      {stt.listening && (
        <span className="text-xs text-gray-400 italic mt-0.5 max-w-[200px] truncate">
          {stt.interim || t('voice.listening', '聆聽中…')}
        </span>
      )}
    </span>
  )
}
