// FAMMS Equipment Health Score
//
// Auto-calculated score 0-100 based on:
//   - failure_count_90d     : how many incidents in the last 90 days
//   - downtime_hours_90d     : total downtime hours in the last 90 days
//   - repeat_failure_count   : repeat failures (kicked-the-can-down-the-road)
//   - pm_overdue_count       : overdue preventive maintenance tasks
//
// Bands (see getHealthScoreBadge in types/famms.ts):
//   80-100 Sehat | 60-79 Perhatian | 40-59 Risiko Tinggi | <40 Kritis

export interface HealthScoreInputs {
  failureCount90d: number
  downtimeHours90d: number
  repeatFailureCount: number
  pmOverdueCount: number
}

export interface HealthScoreResult {
  score: number
  inputs: HealthScoreInputs
  deductions: {
    failures: number
    downtime: number
    repeats: number
    pmOverdue: number
  }
}

// Per-factor penalty weights and caps.
const WEIGHTS = {
  failurePerEvent: 4,   // each failure
  failureCap: 40,
  downtimePerHour: 0.5, // each downtime hour
  downtimeCap: 20,
  repeatPerEvent: 10,   // each repeat failure (heavy — root cause unresolved)
  repeatCap: 30,
  pmOverduePerEvent: 5, // each overdue PM
  pmOverdueCap: 20,
}

export function computeHealthScore(inputs: HealthScoreInputs): HealthScoreResult {
  const failures = Math.min(inputs.failureCount90d * WEIGHTS.failurePerEvent, WEIGHTS.failureCap)
  const downtime = Math.min(inputs.downtimeHours90d * WEIGHTS.downtimePerHour, WEIGHTS.downtimeCap)
  const repeats = Math.min(inputs.repeatFailureCount * WEIGHTS.repeatPerEvent, WEIGHTS.repeatCap)
  const pmOverdue = Math.min(inputs.pmOverdueCount * WEIGHTS.pmOverduePerEvent, WEIGHTS.pmOverdueCap)

  const raw = 100 - failures - downtime - repeats - pmOverdue
  const score = Math.max(0, Math.min(100, Math.round(raw)))

  return {
    score,
    inputs,
    deductions: { failures, downtime, repeats, pmOverdue },
  }
}
