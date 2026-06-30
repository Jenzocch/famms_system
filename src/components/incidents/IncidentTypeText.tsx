'use client'

import { useI18n } from '@/lib/i18n'
import { useIncidentTypeLabel } from '@/lib/incident-type-label'

// Renders an incident type's label in the active app language. Used from the
// (server-rendered) incident detail page, which can't read the client locale
// or the cached incident_types itself.
export default function IncidentTypeText({
  code,
  problemFallback = false,
}: {
  code: string
  // When true, an unknown/empty type falls back to the generic "問題/Problem"
  // wording instead of the raw code (used for the page title).
  problemFallback?: boolean
}) {
  const { t } = useI18n()
  const typeLabel = useIncidentTypeLabel()
  return <>{typeLabel(code, problemFallback ? t('board.problem') : undefined)}</>
}
