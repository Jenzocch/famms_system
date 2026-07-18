'use client'

import { useEffect, useRef, useState } from 'react'
import { useI18n } from '@/lib/i18n'

// Browser-native dictation (Web Speech API) for the report/progress text
// fields — a "too lazy to type" shortcut for floor workers, NOT a replacement
// for typing. Design rules this hook enforces:
//   1. Recognized text goes through onText into an EDITABLE field — never
//      auto-submitted. Factory noise guarantees mis-recognitions; the user
//      reviews before sending.
//   2. `supported` is false when the API isn't available (some webviews) —
//      callers hide the mic button entirely and typing just works.
//   3. Recognition language follows the app locale, so an Indonesian-locale
//      user dictates in Bahasa without any extra picker.
// Chrome sends the audio to Google's recognizer, so this needs network —
// same failure mode as submitting the form itself, no worse.

const LOCALE_TO_BCP47: Record<string, string> = { zh: 'zh-TW', en: 'en-US', id: 'id-ID' }

type SpeechRecognitionLike = {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((e: SpeechResultEventLike) => void) | null
  onend: (() => void) | null
  onerror: (() => void) | null
  start: () => void
  stop: () => void
}
type SpeechResultEventLike = {
  resultIndex: number
  results: { length: number; [i: number]: { isFinal: boolean; 0: { transcript: string } } }
}

function getRecognizer(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as Record<string, unknown>
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null) as (new () => SpeechRecognitionLike) | null
}

export function useSpeechToText(onText: (text: string) => void) {
  const { locale } = useI18n()
  const [supported, setSupported] = useState(false)
  const [listening, setListening] = useState(false)
  // Words recognized so far in the current utterance — shown live so the
  // speaker sees it's working, then finalized into the field via onText.
  const [interim, setInterim] = useState('')
  const recRef = useRef<SpeechRecognitionLike | null>(null)
  // Keep the latest callback without re-creating the recognizer mid-session.
  const onTextRef = useRef(onText)
  onTextRef.current = onText

  // Detected in an effect (not render) — SSR has no window.
  useEffect(() => { setSupported(!!getRecognizer()) }, [])

  function stop() {
    recRef.current?.stop()
    recRef.current = null
    setListening(false)
    setInterim('')
  }

  function start() {
    const SR = getRecognizer()
    if (!SR || recRef.current) return
    const rec = new SR()
    rec.lang = LOCALE_TO_BCP47[locale] ?? 'id-ID'
    rec.continuous = true
    rec.interimResults = true
    rec.onresult = (e) => {
      let interimText = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]
        if (r.isFinal) onTextRef.current(r[0].transcript.trim())
        else interimText += r[0].transcript
      }
      setInterim(interimText)
    }
    // Ends on its own after silence, mic permission denial, or network error —
    // all collapse to the same quiet reset; the field is still typable.
    rec.onend = () => { recRef.current = null; setListening(false); setInterim('') }
    rec.onerror = () => { recRef.current = null; setListening(false); setInterim('') }
    recRef.current = rec
    rec.start()
    setListening(true)
  }

  // Never leave the mic running after unmount (e.g. user navigates away).
  useEffect(() => () => { recRef.current?.stop() }, [])

  return { supported, listening, interim, start, stop, toggle: () => (listening ? stop() : start()) }
}
