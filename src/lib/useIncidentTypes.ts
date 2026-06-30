'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export interface IncidentType {
  id: string
  code: string
  label: string
  // Per-language labels (added by migration_incident_type_i18n.sql). May be
  // null/undefined on older databases; consumers fall back to `label`.
  label_zh?: string | null
  label_en?: string | null
  label_id?: string | null
  sort_order: number
  is_active: boolean
}

// Module-level cache shared across every client component within the SPA
// session. Without this, IncidentForm / IncidentActions / IncidentSearch /
// IncidentTypeManager each re-queried incident_types on mount. Now the first
// consumer fetches; the rest reuse the cached list, and mutations (add/delete
// in the manager) call invalidateIncidentTypes() to refresh all subscribers.
let cache: IncidentType[] | null = null
let inflight: Promise<IncidentType[]> | null = null
const listeners = new Set<(types: IncidentType[]) => void>()

async function fetchTypes(): Promise<IncidentType[]> {
  const supabase = createClient()
  // select('*') so the query still works on databases where the per-language
  // label columns haven't been added yet (the migration is optional/rolling).
  const { data } = await supabase
    .from('incident_types')
    .select('*')
    .eq('is_active', true)
    .order('sort_order')
  // De-dupe by code in case legacy duplicate rows still exist.
  const seen = new Set<string>()
  return (data ?? []).filter(r => {
    if (seen.has(r.code)) return false
    seen.add(r.code)
    return true
  }) as IncidentType[]
}

// Returns the cached list, fetching once and de-duping concurrent callers.
export function loadIncidentTypes(force = false): Promise<IncidentType[]> {
  if (cache && !force) return Promise.resolve(cache)
  if (inflight && !force) return inflight
  inflight = fetchTypes().then(rows => {
    cache = rows
    inflight = null
    listeners.forEach(l => l(rows))
    return rows
  })
  return inflight
}

// Drop the cache and re-fetch, notifying all mounted consumers. Call after a
// mutation (add / soft-delete) so report/edit/search forms see the change.
export function invalidateIncidentTypes(): Promise<IncidentType[]> {
  cache = null
  inflight = null
  return loadIncidentTypes(true)
}

// Subscribe a component to the shared list. `types` is [] until the first
// fetch resolves; `loading` is true only while that first fetch is pending.
export function useIncidentTypes(): { types: IncidentType[]; loading: boolean } {
  const [types, setTypes] = useState<IncidentType[]>(cache ?? [])
  const [loading, setLoading] = useState(cache === null)

  useEffect(() => {
    let mounted = true
    const listener = (next: IncidentType[]) => {
      if (mounted) { setTypes(next); setLoading(false) }
    }
    listeners.add(listener)
    loadIncidentTypes().then(rows => {
      if (mounted) { setTypes(rows); setLoading(false) }
    })
    return () => { mounted = false; listeners.delete(listener) }
  }, [])

  return { types, loading }
}
