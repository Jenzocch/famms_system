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

const DICTS: Record<Locale, any> = { zh, en, id }
const STORAGE_KEY = 'famms_lang'

// Resolve a dot-path ('navigation.pm') against a nested dictionary.
function lookup(dict: any, key: string): string | undefined {
  return key.split('.').reduce((acc, part) => (acc == null ? undefined : acc[part]), dict)
}

interface I18nContextValue {
  locale: Locale
  setLocale: (l: Locale) => void
  t: (key: string, fallback?: string) => string
}

const I18nContext = createContext<I18nContextValue | null>(null)

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('zh')

  // Hydrate the saved choice on mount (client-only to avoid SSR mismatch).
  useEffect(() => {
    const saved = typeof window !== 'undefined' ? window.localStorage.getItem(STORAGE_KEY) : null
    if (saved === 'zh' || saved === 'en' || saved === 'id') setLocaleState(saved)
  }, [])

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l)
    if (typeof window !== 'undefined') window.localStorage.setItem(STORAGE_KEY, l)
  }, [])

  // t() falls back to the zh value, then the explicit fallback, then the key.
  const t = useCallback((key: string, fallback?: string): string => {
    return lookup(DICTS[locale], key) ?? lookup(DICTS.zh, key) ?? fallback ?? key
  }, [locale])

  return (
    <I18nContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </I18nContext.Provider>
  )
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext)
  // Safe fallback so components don't crash if used outside the provider.
  if (!ctx) {
    return {
      locale: 'zh',
      setLocale: () => {},
      t: (key: string, fallback?: string) => lookup(DICTS.zh, key) ?? fallback ?? key,
    }
  }
  return ctx
}
