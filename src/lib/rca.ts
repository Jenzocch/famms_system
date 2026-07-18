// FAMMS Root Cause Analysis (RCA) helpers
//
// Trigger rule: the fault-tree code (failure_code_id) is never populated by
// any report path in the app (see git history / CLAUDE.md's "Repeat Failure
// Detection" section) — the report form only ever captures the coarse
// incident_type category. Keying the mandatory-RCA gate off failure_code_id
// therefore never fired in practice. This keys the trigger off the SAME
// machine_id + incident_type pair instead: when it occurs >= 3 times within
// 90 days (factory-wide), an RCA is mandatory before an incident with that
// machine/type can be closed.
//
// machine_id is required (non-null) for this to apply at all — a
// facility/electrical/etc. incident with no machine attached has nothing to
// compare across incidents against, same as the repeat-failure check.

import { RCA_TRIGGER_COUNT, RCA_TRIGGER_WINDOW_DAYS } from '@/lib/constants'
import type { SupabaseClient } from '@supabase/supabase-js'

export interface RCACheckResult {
  required: boolean       // machine_id + incident_type crossed the threshold
  satisfied: boolean      // an RCA record already exists for that pair
  occurrenceCount: number // how many times the pair occurred in window
}

// Check whether RCA is required (and already satisfied) for a given
// incident's machine_id + incident_type within its factory.
export async function checkRCARequirement(
  supabase: SupabaseClient,
  machineId: string | null,
  incidentType: string,
  factoryId: string
): Promise<RCACheckResult> {
  if (!machineId) {
    // No machine to compare across incidents against — never triggers.
    return { required: false, satisfied: true, occurrenceCount: 0 }
  }

  const windowStart = new Date(
    Date.now() - RCA_TRIGGER_WINDOW_DAYS * 86400000
  ).toISOString()

  const { count } = await supabase
    .from('incidents')
    .select('id', { count: 'exact', head: true })
    .eq('machine_id', machineId)
    .eq('incident_type', incidentType)
    .eq('factory_id', factoryId)
    .gte('reported_at', windowStart)

  const occurrenceCount = count ?? 0
  const required = occurrenceCount >= RCA_TRIGGER_COUNT

  let satisfied = true
  if (required) {
    // Scoped by factory: an RCA filed by one factory must never satisfy the
    // mandatory-RCA gate for a DIFFERENT factory's incidents on the same
    // machine/type pair (machine_id itself is already factory-specific, but
    // factory_id is kept as the scoping key for consistency with the rest
    // of the app's RCA plumbing and with legacy rows that predate these
    // columns).
    const { data: existing } = await supabase
      .from('rca_records')
      .select('id')
      .eq('machine_id', machineId)
      .eq('incident_type', incidentType)
      .eq('factory_id', factoryId)
      .limit(1)
      .maybeSingle()
    satisfied = !!existing
  }

  return { required, satisfied, occurrenceCount }
}
