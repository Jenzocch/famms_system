// Custom roles — shared, framework-agnostic pieces (safe to import from
// client AND server code). Server-only DB fetching lives in lib/auth.ts
// (resolveRoleOverlay) so this file never pulls in next/headers.
import type { UserRole } from '@/types'
import { PERMISSIONS } from '@/lib/permissions'

// Fixed, small allow-list of "soft" capabilities a custom role may override.
// Every key here must have ZERO backing in RLS/DB policies — the data access
// these toggle is already open to any authenticated role at the factory
// scope, so flipping one can only change what the UI SURFACES by default,
// never what a role could already technically read. Extend this list only
// with capabilities that hold the same property; DB-enforced actions
// (accept/close/RCA/manage-*) stay hardcoded in lib/permissions.ts.
export const CAPABILITY_KEYS = ['dashboard', 'boardFull', 'viewMachines'] as const
export type CapabilityKey = typeof CAPABILITY_KEYS[number]

export const CAPABILITY_LABELS: Record<CapabilityKey, { zh: string; en: string; id: string }> = {
  dashboard: { zh: 'KPI 儀表板', en: 'KPI dashboard', id: 'Dasbor KPI' },
  boardFull: { zh: '完整工單看板（非僅自己相關案件）', en: 'Full incident board (not just own cases)', id: 'Papan insiden penuh (bukan hanya kasus sendiri)' },
  viewMachines: { zh: '設備主檔（機器列表與詳情頁）', en: 'Equipment master (machine list & detail pages)', id: 'Data induk mesin (daftar & detail mesin)' },
}

// The 3 tiers a custom role may inherit from — deliberately excludes
// director/admin. A custom role is meant to widen VISIBILITY for a new job
// function, not to mint a shortcut into the top two authority tiers.
export const CUSTOM_ROLE_BASE_OPTIONS: UserRole[] = ['technician', 'supervisor', 'manager']

export interface CustomRole {
  key: string
  label_zh: string
  label_en: string
  label_id: string
  base_role: UserRole
  is_system: boolean
}

export type EffectiveCapabilities = Record<CapabilityKey, boolean>

export function baseCapabilityDefaults(baseRole: UserRole): EffectiveCapabilities {
  return {
    dashboard: PERMISSIONS.dashboard(baseRole),
    boardFull: PERMISSIONS.boardFull(baseRole),
    viewMachines: PERMISSIONS.viewMachines(baseRole),
  }
}

// Merge a custom role's capability_overrides (role_capabilities rows, as a
// plain {capability: allowed} map) onto its base role's defaults.
export function resolveCapabilities(
  baseRole: UserRole,
  overrides: Partial<Record<string, boolean>> | null | undefined
): EffectiveCapabilities {
  const result = baseCapabilityDefaults(baseRole)
  if (!overrides) return result
  for (const key of CAPABILITY_KEYS) {
    if (overrides[key] !== undefined) result[key] = !!overrides[key]
  }
  return result
}

export function customRoleLabel(role: CustomRole, locale: 'zh' | 'en' | 'id'): string {
  return locale === 'en' ? role.label_en : locale === 'id' ? role.label_id : role.label_zh
}
