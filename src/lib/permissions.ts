import type { UserRole } from '@/types'

// Centralized role -> capability checks. Every permission decision in the app
// (navigation, settings sections, server-side guards, incident actions) should
// go through this map so that "who can do what" lives in exactly one place.
//
// Role hierarchy (low -> high authority):
//   technician < supervisor < manager < director < admin
//
// Rough intent:
//   - technician: report incidents, view board, do PM tasks, view machines
//   - supervisor: + accept / assign / close / edit incidents, dashboard
//   - manager:    + manage equipment master (machines/areas/factories),
//                   PM schedules, edit settings (but NOT user accounts)
//   - director:   factory-level oversight (dashboard + incident actions)
//   - admin:      everything, including user & password management
export const PERMISSIONS = {
  // --- Dashboard / KPI ---
  dashboard: (role: UserRole) => ['supervisor', 'manager', 'director', 'admin'].includes(role),

  // --- Incident board / workflow ---
  // Everyone can view the board and report incidents.
  viewBoard: (_role: UserRole) => true,
  reportIncident: (_role: UserRole) => true,
  boardFull: (role: UserRole) => ['supervisor', 'manager', 'director', 'admin'].includes(role),
  acceptIncident: (role: UserRole) => ['supervisor', 'manager', 'director', 'admin'].includes(role),
  // Anyone can assign / reassign — technicians often self-organize who handles a
  // case (add a colleague, hand it over) without waiting for a supervisor.
  assignIncident: (_role: UserRole) => true,
  closeIncident: (role: UserRole) => ['supervisor', 'manager', 'director', 'admin'].includes(role),
  // Supervisors+ can poke the assignees via Telegram to update progress.
  remindProgress: (role: UserRole) => ['supervisor', 'manager', 'director', 'admin'].includes(role),
  editIncident: (role: UserRole) => ['supervisor', 'manager', 'director', 'admin'].includes(role),
  deleteIncident: (role: UserRole) => ['supervisor', 'manager', 'director', 'admin'].includes(role),

  // --- Preventive maintenance ---
  // Technicians execute PM tasks; managers + admins also manage PM schedules.
  viewPM: (_role: UserRole) => true,
  managePMSchedules: (role: UserRole) => ['manager', 'admin'].includes(role),

  // --- Equipment master ---
  viewMachines: (_role: UserRole) => true,
  manageMachines: (role: UserRole) => ['manager', 'admin'].includes(role),
  manageAreas: (role: UserRole) => ['manager', 'admin'].includes(role),
  manageFactories: (role: UserRole) => ['manager', 'admin'].includes(role),
  manageIncidentTypes: (role: UserRole) => role === 'admin',

  // --- Settings ---
  // The Settings page is visible to managers and admins. Individual sections
  // inside are further gated (e.g. user management is admin-only).
  viewSettings: (role: UserRole) => ['manager', 'admin'].includes(role),
  manageSettings: (role: UserRole) => ['manager', 'admin'].includes(role),
  manageTelegram: (role: UserRole) => ['manager', 'admin'].includes(role),

  // --- User & account management (admin only) ---
  manageUsers: (role: UserRole) => role === 'admin',
} as const
