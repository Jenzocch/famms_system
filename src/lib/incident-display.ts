// Simplified Chinese display maps for the mobile-first issue tracker UI.
// These map the underlying (Bahasa) IncidentStatus + issue types to the
// labels field staff actually see.
import type { IncidentStatus, UserRole } from '@/types'

// Chinese role labels (UI is Chinese; underlying roles unchanged)
export const ROLE_ZH: Record<UserRole, string> = {
  technician: '技師',
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

export const URGENCY_FROM_IMPACT: Record<string, { label: string; color: string }> = {
  A: { label: '🔴 緊急', color: 'bg-red-100 text-red-700' },
  B: { label: '🟠 高', color: 'bg-orange-100 text-orange-700' },
  C: { label: '🟡 中', color: 'bg-yellow-100 text-yellow-700' },
  D: { label: '🟢 低', color: 'bg-green-100 text-green-700' },
}

export const STATUS_ZH: Record<IncidentStatus, string> = {
  reported: '新回報',
  accepted: '已接收',
  analyzing: '處理中',
  waiting_parts: '等待料件',
  waiting_approval: '等待核准',
  waiting_vendor: '等待外包',
  waiting_shutdown: '等待停機',
  repairing: '處理中',
  testing: '測試中',
  observation: '待現場確認',
  closed: '已結案',
}

export const STATUS_ZH_COLOR: Record<IncidentStatus, string> = {
  reported: 'bg-blue-100 text-blue-700',
  accepted: 'bg-sky-100 text-sky-700',
  analyzing: 'bg-purple-100 text-purple-700',
  waiting_parts: 'bg-amber-100 text-amber-700',
  waiting_approval: 'bg-amber-100 text-amber-700',
  waiting_vendor: 'bg-amber-100 text-amber-700',
  waiting_shutdown: 'bg-amber-100 text-amber-700',
  repairing: 'bg-purple-100 text-purple-700',
  testing: 'bg-indigo-100 text-indigo-700',
  observation: 'bg-teal-100 text-teal-700',
  closed: 'bg-green-100 text-green-700',
}

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
