import type { UserRole } from '@/types'

export const PERMISSIONS = {
  dashboard: (role: UserRole) => ['supervisor', 'manager', 'director', 'admin'].includes(role),
  boardFull: (role: UserRole) => ['supervisor', 'manager', 'director', 'admin'].includes(role),
  assignIncident: (role: UserRole) => ['supervisor', 'director', 'admin'].includes(role),
  closeIncident: (role: UserRole) => ['supervisor', 'director', 'admin'].includes(role),
  editIncident: (role: UserRole) => ['supervisor', 'director', 'admin'].includes(role),
  deleteIncident: (role: UserRole) => ['supervisor', 'director', 'admin'].includes(role),
  manageUsers: (role: UserRole) => role === 'admin',
  manageSettings: (role: UserRole) => role === 'admin',
} as const
