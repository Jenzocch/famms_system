'use client'

import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import zh from './locales/zh.json'
import en from './locales/en.json'
import id from './locales/id.json'

export type Locale = 'zh' | 'en' | 'id'

export const LOCALES: { value: Locale; label: string }[] = [
  { value: 'zh', label: '中文' },
  { value: 'en', label: 'English' },
  { value: 'id', label: 'Bahasa' },
]

// Recursive shape of the locale JSON dictionaries (nested string leaves).
type Dict = { [key: string]: string | Dict }

const DICTS: Record<Locale, Dict> = { zh, en, id }
const STORAGE_KEY = 'famms_lang'
// Cookie mirror of the same choice. The cookie is what lets the SERVER render
// the first paint in the right language — localStorage alone is invisible to
// SSR, which is why pages used to flash Bahasa before snapping to the saved
// language on every full page load.
export const LOCALE_COOKIE = 'famms_lang'

function isLocale(v: unknown): v is Locale {
  return v === 'zh' || v === 'en' || v === 'id'
}

// Resolve a dot-path ('navigation.pm') against a nested dictionary.
function lookup(dict: Dict, key: string): string | undefined {
  const result = key.split('.').reduce<string | Dict | undefined>(
    (acc, part) => (acc == null || typeof acc === 'string' ? undefined : acc[part]),
    dict,
  )
  return typeof result === 'string' ? result : undefined
}

interface I18nContextValue {
  locale: Locale
  setLocale: (l: Locale) => void
  t: (key: string, fallback?: string) => string
}

const I18nContext = createContext<I18nContextValue | null>(null)

export function I18nProvider({
  children,
  initialLocale,
}: {
  children: React.ReactNode
  initialLocale?: Locale
}) {
  // initialLocale comes from the cookie via the server layout, so SSR and the
  // first client render agree — no hydration flash.
  const [locale, setLocaleState] = useState<Locale>(initialLocale ?? 'id')

  // One-time migration for visitors from before the cookie existed (choice
  // only in localStorage) and first-visit browser-language detection:
  // Indonesian staff see Bahasa, Chinese managers see 中文, without hunting
  // for the switcher. A manual choice always wins afterwards.
  useEffect(() => {
    if (initialLocale) return // cookie present — nothing to migrate
    const saved = window.localStorage.getItem(STORAGE_KEY)
    if (isLocale(saved)) {
      // One-time mount migration (localStorage -> cookie); not an
      // external-data sync, so the synchronous setState here is intentional.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLocaleState(saved)
      writeCookie(saved)
      return
    }
    const nav = (navigator.language || '').toLowerCase()
    if (nav.startsWith('zh')) { setLocaleState('zh'); writeCookie('zh') }
    else if (nav.startsWith('en')) { setLocaleState('en'); writeCookie('en') }
    else writeCookie('id') // remember the default too, so SSR stops guessing
  }, [initialLocale])

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l)
    window.localStorage.setItem(STORAGE_KEY, l)
    writeCookie(l)
  }, [])

  // t() falls back to the id value, then the explicit fallback, then the key.
  const t = useCallback((key: string, fallback?: string): string => {
    return lookup(DICTS[locale], key) ?? lookup(DICTS.id, key) ?? fallback ?? key
  }, [locale])

  return (
    <I18nContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </I18nContext.Provider>
  )
}

function writeCookie(l: Locale) {
  // 1 year; SameSite=Lax so it rides along on normal navigations.
  document.cookie = `${LOCALE_COOKIE}=${l}; path=/; max-age=31536000; SameSite=Lax`
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext)
  // Safe fallback so components don't crash if used outside the provider.
  if (!ctx) {
    return {
      locale: 'id',
      setLocale: () => {},
      t: (key: string, fallback?: string) => lookup(DICTS.id, key) ?? fallback ?? key,
    }
  }
  return ctx
}
