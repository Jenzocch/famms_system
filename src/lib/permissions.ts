import type { UserRole } from '@/types'

// Centralized role -> capability checks. Every permission decision in the app
// (navigation, settings sections, server-side guards, incident actions) should
// go through this map so that "who can do what" lives in exactly one place.
//
// Role hierarchy (low -> high authority):
//   technician < supervisor < manager < director < admin
//   qc sits alongside technician operationally, but sees everything
//   supervisor+ sees (full board + dashboard) — it just can't ACT on cases.
//
// Rough intent:
//   - technician: report incidents, view board, do PM tasks, view machines
//   - qc:         full board + dashboard visibility (sign-off decisions need
//                   it) + report incidents — but no accept/close/assign due
//                   date/RCA/settings; that stays with maintenance leadership
//   - supervisor: + accept / assign / close / edit incidents, dashboard
//   - manager:    + manage equipment master (machines/areas/factories),
//                   PM schedules, edit settings (but NOT user accounts)
//   - director:   factory-level oversight (dashboard + incident actions)
//   - admin:      everything, including user & password management
export const PERMISSIONS = {
  // --- Dashboard / KPI ---
  dashboard: (role: UserRole) => ['supervisor', 'manager', 'director', 'admin', 'qc'].includes(role),

  // --- Incident board / workflow ---
  // Everyone can view the board and report incidents.
  viewBoard: (_role: UserRole) => true,
  reportIncident: (_role: UserRole) => true,
  boardFull: (role: UserRole) => ['supervisor', 'manager', 'director', 'admin', 'qc'].includes(role),
  acceptIncident: (role: UserRole) => ['supervisor', 'manager', 'director', 'admin'].includes(role),
  // Anyone can assign / reassign — technicians often self-organize who handles a
  // case (add a colleague, hand it over) without waiting for a supervisor.
  assignIncident: (_role: UserRole) => true,
  // ...but the due date is the yardstick for overdue/SLA tracking, so the
  // person being measured can't be the one moving it: supervisor+ only.
  editDueDate: (role: UserRole) => ['supervisor', 'manager', 'director', 'admin'].includes(role),
  closeIncident: (role: UserRole) => ['supervisor', 'manager', 'director', 'admin'].includes(role),
  // RCA records satisfy the mandatory-RCA close-gate — same tier as closing,
  // since a technician self-approving their own RCA would defeat the gate.
  submitRCA: (role: UserRole) => ['supervisor', 'manager', 'director', 'admin'].includes(role),
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
  manageVendors: (role: UserRole) => ['manager', 'admin'].includes(role),

  // --- Settings ---
  // The Settings page is visible to managers and admins. Individual sections
  // inside are further gated (e.g. user management is admin-only).
  viewSettings: (role: UserRole) => ['manager', 'admin'].includes(role),
  manageSettings: (role: UserRole) => ['manager', 'admin'].includes(role),
  manageTelegram: (role: UserRole) => ['manager', 'admin'].includes(role),

  // --- User & account management (admin only) ---
  manageUsers: (role: UserRole) => role === 'admin',
} as const
