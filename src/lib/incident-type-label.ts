'use client'

import { useCallback, useMemo } from 'react'
import { useI18n, type Locale } from '@/lib/i18n'
import { useIncidentTypes, type IncidentType } from '@/lib/useIncidentTypes'

// Pick a type's label for the active locale, falling back to any other filled
// language, then the legacy single `label`, then the code. This lets admins
// fill just one language and still have every UI language show something.
export function pickIncidentTypeLabel(type: IncidentType, locale: Locale): string {
  const byLocale =
    locale === 'zh' ? type.label_zh :
    locale === 'en' ? type.label_en :
    type.label_id
  return (
    byLocale ||
    type.label ||
    type.label_id || type.label_en || type.label_zh ||
    type.code
  )
}

// Returns (code, fallback?) => display label for the active locale. Resolves
// admin-added and built-in types from the DB columns; for an unknown code
// (a soft-deleted type, or free text from the "other" path) it tries the
// built-in i18n map, then the provided fallback, then the raw code.
export function useIncidentTypeLabel(): (code: string, fallback?: string) => string {
  const { types } = useIncidentTypes()
  const { locale, t } = useI18n()
  const byCode = useMemo(() => {
    const m = new Map<string, IncidentType>()
    for (const ty of types) m.set(ty.code, ty)
    return m
  }, [types])
  return useCallback((code: string, fallback?: string): string => {
    const ty = byCode.get(code)
    // 1. An admin-filled label for the active locale always wins.
    const localeLabel = ty && (
      locale === 'zh' ? ty.label_zh : locale === 'en' ? ty.label_en : ty.label_id
    )
    if (localeLabel) return localeLabel
    // 2. Built-in codes have i18n translations (issueTypes.*) — prefer those
    //    over the legacy single `label`, which is Chinese-only. This keeps the
    //    board translated even before the per-language columns are populated.
    const i18nLabel = t(`issueTypes.${code}`, '')
    if (i18nLabel) return i18nLabel
    // 3. Otherwise any filled DB label, then the provided fallback / code.
    if (ty) return ty.label || ty.label_id || ty.label_en || ty.label_zh || ty.code
    return fallback ?? code
  }, [byCode, locale, t])
}
