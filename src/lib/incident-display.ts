// Simplified Chinese display maps for the mobile-first issue tracker UI.
// These map the underlying (Bahasa) IncidentStatus + issue types to the
// labels field staff actually see.
import type { IncidentStatus, UserRole } from '@/types'

// Chinese role labels (UI is Chinese; underlying roles unchanged)
export const ROLE_ZH: Record<UserRole, string> = {
  technician: '一般員工',
  supervisor: '主管',
  manager: '經理',
  director: '廠長',
  admin: '系統管理員',
}

export const ISSUE_TYPE_LABELS: Record<string, string> = {
  machine: '🔧 機器故障',
  pipe: '🚿 水管/管線',
  electrical: '💡 電力/照明',
  facility: '🏭 設施/基礎建設',
  safety: '⚠️ 安全問題',
  cleanliness: '🧹 衛生/清潔',
  other: '📋 其他',
}

// Label says the production impact in plain words (no abstract A/B/C/D codes),
// short enough to fit a board card chip.
// Plain severity levels only — no production-impact wording (全廠停工 /
// 產能下降 etc. confused reporters into diagnosing impact instead of just
// saying how urgent it feels).
// B (橘色「高」) was retired and its DB rows normalized to 'A' — only these
// three tiers exist. Indexers should fall back for safety (any stray legacy
// value reads as 緊急 via `?? URGENCY_FROM_IMPACT.A` at the call sites).
export const URGENCY_FROM_IMPACT: Record<string, { label: string; color: string }> = {
  A: { label: '🔴 緊急', color: 'bg-red-100 text-red-700' },
  C: { label: '🟡 中', color: 'bg-yellow-100 text-yellow-700' },
  D: { label: '🟢 一般', color: 'bg-green-100 text-green-700' },
}

// SLA: how many days until a case is due, based on its urgency (downtime_impact).
// The deadline is the single benchmark technicians sort by; urgency just decides
// how tight it is. Admins/supervisors can still override the date manually.
export const URGENCY_SLA_DAYS: Record<string, number> = { A: 0, C: 7, D: 30 }

// Returns a YYYY-MM-DD due date computed from urgency, counting from `base`.
// Formatted from LOCAL date parts, never toISOString(): that converts to UTC
// first, so between local midnight and 07:00 (WIB is UTC+7) the UTC date is
// still "yesterday" — night-shift urgent reports were getting a due date one
// day early and showing as overdue the moment they were created.
export function deadlineFromUrgency(impact: string, base: Date = new Date()): string {
  const days = URGENCY_SLA_DAYS[impact] ?? 30
  const d = new Date(base)
  d.setDate(d.getDate() + days)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export const STATUS_ZH: Record<IncidentStatus, string> = {
  reported: '新回報',
  accepted: '已接收',
  analyzing: '分析中',
  waiting_parts: '等待料件',
  waiting_approval: '等待核准',
  waiting_vendor: '等待外包',
  waiting_shutdown: '等待停機',
  repairing: '維修中',
  testing: '測試中',
  observation: '待現場確認',
  closed: '已結案',
}

// Re-exported from the canonical map in @/types so the incident status never
// shows one color on the board and a different one on the machine pages.
export { INCIDENT_STATUS_COLORS as STATUS_ZH_COLOR } from '@/types'

// Every non-closed status. Shared so the board's row cap and the dashboard's
// counts can't drift apart on what "open" means (see OPEN_STATUSES usage in
// both — the board previously capped its query by recency alone, which could
// drop a genuinely-open, long-stuck case once 200 newer rows of ANY status
// had accumulated).
export const OPEN_STATUSES: IncidentStatus[] = [
  'reported', 'accepted', 'analyzing', 'waiting_parts', 'waiting_approval',
  'waiting_vendor', 'waiting_shutdown', 'repairing', 'testing', 'observation',
]

// Filter tabs for the board (groups several underlying statuses)
export const BOARD_FILTERS: { key: string; label: string; statuses: IncidentStatus[] | null }[] = [
  { key: 'all', label: '全部', statuses: null },
  { key: 'reported', label: '新回報', statuses: ['reported'] },
  { key: 'accepted', label: '已接收', statuses: ['accepted'] },
  { key: 'progress', label: '處理中', statuses: ['analyzing', 'repairing'] },
  { key: 'waiting', label: '等待中', statuses: ['waiting_parts', 'waiting_approval', 'waiting_vendor', 'waiting_shutdown'] },
  { key: 'confirm', label: '待確認', statuses: ['testing', 'observation'] },
  { key: 'closed', label: '已結案', statuses: ['closed'] },
]
