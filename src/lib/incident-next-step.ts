// "Next step" guidance for the incident workflow.
//
// For every IncidentStatus the app shows a "now → next" hint so staff always
// know what to do next without memorizing the workflow (site-wide: detail page
// banner + board cards). The wording lives in the i18n dictionaries under
// `nextStep.*`; this module owns the small bits of workflow logic.
import type { IncidentStatus } from '@/types'

// Statuses that need no further action — the case is finished.
export const TERMINAL_STATUSES: IncidentStatus[] = ['closed']

export function isTerminalStatus(status: IncidentStatus): boolean {
  return TERMINAL_STATUSES.includes(status)
}

// The next *visible* status to switch to from the current one. Mirrors the
// simplified board flow (新回報 → 已接收 → 處理中 → 測試中 → 待現場確認 → 已結案).
// analyzing/repairing both display as "處理中", so their next milestone is
// "測試中"; every "waiting" side-state resumes at "處理中" (repairing).
const NEXT_STATUS: Partial<Record<IncidentStatus, IncidentStatus>> = {
  reported: 'accepted',
  accepted: 'analyzing',
  analyzing: 'testing',
  repairing: 'testing',
  testing: 'observation',
  observation: 'closed',
  waiting_parts: 'repairing',
  waiting_approval: 'repairing',
  waiting_vendor: 'repairing',
  waiting_shutdown: 'repairing',
  // closed: terminal — no next status
}

export function nextStatusOf(status: IncidentStatus): IncidentStatus | null {
  return NEXT_STATUS[status] ?? null
}
