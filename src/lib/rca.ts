// FAMMS Root Cause Analysis (RCA) helpers
//
// Trigger rule (per FAMMS spec): when the SAME failure_code occurs >= 3 times
// within 90 days (factory-wide), an RCA is mandatory. An incident with such a
// failure_code cannot be closed until an RCA record exists for that code.

import { RCA_TRIGGER_COUNT, RCA_TRIGGER_WINDOW_DAYS } from '@/lib/constants'
import type { SupabaseClient } from '@supabase/supabase-js'

export interface RCACheckResult {
  required: boolean       // failure_code crossed the threshold
  satisfied: boolean      // an RCA record already exists for the failure_code
  occurrenceCount: number // how many times the failure_code occurred in window
}

// Check whether RCA is required (and already satisfied) for a given incident's
// failure_code within its factory.
export async function checkRCARequirement(
  supabase: SupabaseClient,
  failureCodeId: string,
  factoryId: string
): Promise<RCACheckResult> {
  const windowStart = new Date(
    Date.now() - RCA_TRIGGER_WINDOW_DAYS * 86400000
  ).toISOString()

  const { count } = await supabase
    .from('incidents')
    .select('id', { count: 'exact', head: true })
    .eq('failure_code_id', failureCodeId)
    .eq('factory_id', factoryId)
    .gte('reported_at', windowStart)

  const occurrenceCount = count ?? 0
  const required = occurrenceCount >= RCA_TRIGGER_COUNT

  let satisfied = true
  if (required) {
    const { data: existing } = await supabase
      .from('rca_records')
      .select('id')
      .eq('failure_code_id', failureCodeId)
      .limit(1)
      .maybeSingle()
    satisfied = !!existing
  }

  return { required, satisfied, occurrenceCount }
}
