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
    if (ty) return pickIncidentTypeLabel(ty, locale)
    return t(`issueTypes.${code}`, fallback ?? code)
  }, [byCode, locale, t])
}
