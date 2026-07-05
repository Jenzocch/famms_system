'use client'

import { zhTW, enUS, id as idLocale } from 'date-fns/locale'
import type { Locale } from 'date-fns'
import { useI18n } from '@/lib/i18n'

// date-fns locale that follows the active app language, so relative times
// ("3 天前" / "3 days ago" / "3 hari yang lalu") match the UI language.
export function useDateLocale(): Locale {
  const { locale } = useI18n()
  return locale === 'en' ? enUS : locale === 'id' ? idLocale : zhTW
}
