// FAMMS Core Types
// Factory Asset & Maintenance Management System

// ============================================================================
// Auth & Organization
// ============================================================================

// The 5 tiers every DB security rule (RLS policies, field-guard triggers)
// hardcodes. A named "custom role" (see custom_roles table / lib/roles.ts)
// is an admin-defined overlay that inherits one of these as its base_role —
// it never introduces a 6th value here, so the DB-enforced security floor
// (who can close/edit-due-date/RCA/manage-machines/etc.) is never at risk of
// drifting out of sync with a role someone typed into a settings form.
export type UserRole = 'technician' | 'supervisor' | 'manager' | 'director' | 'admin';

export type Factory = {
  id: string;
  name: string;
  code: string;
  country: string;
  timezone: string;
  created_at: string;
  updated_at: string;
};

export type Area = {
  id: string;
  factory_id: string;
  name: string;
  code: string;
  description?: string;
  created_at: string;
  updated_at: string;
};

export type Profile = {
  id: string;
  factory_id: string;
  full_name?: string;
  role: UserRole;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

// ============================================================================
// Equipment Master
// ============================================================================

export type Machine = {
  id: string;
  factory_id: string;
  area_id: string;
  machine_code: string;
  machine_name: string;
  brand?: string;
  model?: string;
  serial_number?: string;
  purchase_date?: string;
  install_date?: string;
  owner_id?: string;
  maintenance_cycle: number; // days
  status: 'running' | 'repairing' | 'standby' | 'scrapped';
  remarks?: string;
  created_at: string;
  updated_at: string;
};

export type MachineQRCode = {
  id: string;
  machine_id: string;
  qr_code_url: string;
  generated_at: string;
};

// ============================================================================
// Failure Classification (Fault Tree)
// ============================================================================

export type FailureCategory = {
  id: string;
  code: string; // 'MECH', 'ELEC', 'BEARING', 'VFD', etc.
  name: string;
  level: 1 | 2 | 3; // main | sub | leaf
  parent_id?: string;
  display_order: number;
  is_active: boolean;
  created_at: string;
};

export type FailureCode = {
  id: string;
  code: string; // 'BEARING_001', 'VFD_005', etc.
  name: string;
  description?: string;
  category_id: string;
  display_order: number;
  is_active: boolean;
  created_at: string;
};

// ============================================================================
// Incident Management
// ============================================================================

export type IncidentStatus =
  | 'reported'
  | 'accepted'
  | 'analyzing'
  | 'waiting_parts'
  | 'waiting_approval'
  | 'waiting_vendor'
  | 'waiting_shutdown'
  | 'repairing'
  | 'testing'
  | 'observation'
  | 'closed';

// B (orange "High / Line Berhenti") was retired — legacy DB rows were
// normalized to 'A'. Only three tiers exist now.
export type DowntimeImpact = 'A' | 'C' | 'D';
// A = Factory Stop
// B = Production Line Stop
// C = Reduced Capacity
// D = No Production Impact

export type Incident = {
  id: string;
  factory_id: string;
  machine_id: string;
  incident_no: string; // INC-202606-0001
  failure_code_id: string;
  status: IncidentStatus;
  downtime_impact: DowntimeImpact;
  reported_at: string;
  reported_by_id?: string;
  root_cause?: string;
  completion_type?: CompletionType;
  observation_period?: number; // 3 | 7 | 30 days
  observation_end_date?: string;
  closed_at?: string;
  closed_by_id?: string;
  remarks?: string;
  created_at: string;
  updated_at: string;
};

export type IncidentRelationType =
  | 'repeat_failure'
  | 'same_root_cause'
  | 'temporary_fix_followup'
  | 'new_failure';

export type IncidentRelation = {
  id: string;
  incident_id: string;
  related_incident_id: string;
  relation_type: IncidentRelationType;
  confirmed_by_id?: string;
  confirmed_at?: string;
  remarks?: string;
  created_at: string;
};

// ============================================================================
// Incident Actions (Multi-step Repair)
// ============================================================================

export type ActionType =
  | 'inspection'
  | 'temporary_fix'
  | 'root_cause_analysis'
  | 'part_replacement'
  | 'corrective_action'
  | 'preventive_action'
  | 'testing'
  | 'observation';

export type CompletionType = 'temporary_fix' | 'permanent_fix';

export type ActionStatus = 'pending' | 'in_progress' | 'completed' | 'blocked';

export type PartUsage = {
  part_code: string;
  qty: number;
  cost?: number;
};

export type IncidentAction = {
  id: string;
  incident_id: string;
  action_sequence: number;
  action_type: ActionType;
  description?: string;
  performed_by_id: string;
  performed_at: string;
  duration_minutes?: number;
  parts_used?: PartUsage[];
  labor_cost?: number;
  material_cost?: number;
  vendor_cost?: number;
  photos_before?: string[]; // JSON array of file paths
  photos_during?: string[];
  photos_after?: string[];
  status: ActionStatus;
  created_at: string;
  updated_at: string;
};

// ============================================================================
// Work Order Blocking
// ============================================================================

export type BlockReason =
  | 'waiting_parts'
  | 'waiting_purchase'
  | 'waiting_vendor'
  | 'waiting_shutdown'
  | 'waiting_approval'
  | 'waiting_drawing'
  | 'other';

export type RequiredAction =
  | 'need_purchase'
  | 'need_approval'
  | 'need_vendor_support'
  | 'need_production_arrangement';

export type WorkOrderBlock = {
  id: string;
  incident_action_id: string;
  block_reason: BlockReason;
  required_action: RequiredAction;
  blocked_at: string;
  blocked_by_id?: string;
  resolved_at?: string;
  resolved_by_id?: string;
  remarks?: string;
  created_at: string;
};

// ============================================================================
// Preventive Maintenance (PM)
// ============================================================================

export type PMType = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'half_yearly' | 'yearly' | 'custom';

export type PMSchedule = {
  id: string;
  factory_id: string;
  machine_id: string;
  pm_type: PMType;
  interval_days?: number | null; // "every N days" cadence when pm_type === 'custom'
  description?: string;
  checklist?: string[]; // JSON array of checklist items
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type PMRecordStatus = 'pending' | 'completed' | 'overdue' | 'skipped';

export type PMDelayReason =
  | 'no_shutdown'
  | 'no_manpower'
  | 'no_parts'
  | 'production_priority'
  | 'forgot';

export type PMRecord = {
  id: string;
  pm_schedule_id: string;
  scheduled_date: string;
  status: PMRecordStatus;
  completed_at?: string;
  completed_by_id?: string;
  delay_reason?: PMDelayReason;
  findings?: string;
  parts_replaced?: PartUsage[];
  cost?: number;
  created_at: string;
  updated_at: string;
};

// ============================================================================
// Spare Parts
// ============================================================================

export type SparePart = {
  id: string;
  factory_id: string;
  part_code: string;
  part_name: string;
  category?: string;
  unit_price?: number;
  stock_qty: number;
  reorder_level: number;
  supplier?: string;
  lead_time_days?: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type SparePartTransactionType =
  | 'used_in_repair'
  | 'received'
  | 'adjustment'
  | 'scrapped';

export type SparePartTransaction = {
  id: string;
  part_id: string;
  transaction_type: SparePartTransactionType;
  quantity: number;
  incident_action_id?: string;
  cost?: number;
  created_at: string;
  created_by_id?: string;
  remarks?: string;
};

// ============================================================================
// Comments & Audit Trail
// ============================================================================

export type IncidentComment = {
  id: string;
  incident_id: string;
  comment: string;
  created_by_id: string;
  created_at: string;
  updated_at: string;
};

export type ApprovalAction = 'approved' | 'rejected' | 'returned';

export type ApprovalLog = {
  id: string;
  incident_action_id: string;
  action: ApprovalAction;
  approved_by_id: string;
  approved_at: string;
  remarks?: string;
};

// ============================================================================
// Root Cause Analysis (RCA)
// ============================================================================

export type RCAStatus = 'open' | 'in_progress' | 'completed' | 'closed';

export type RCARecord = {
  id: string;
  failure_code_id: string;
  root_cause: string;
  corrective_action: string;
  preventive_action: string;
  responsible_person_id: string;
  due_date: string;
  status: RCAStatus;
  completed_at?: string;
  created_at: string;
  updated_at: string;
};

// ============================================================================
// Equipment Health Score
// ============================================================================

export type EquipmentHealthScore = {
  id: string;
  machine_id: string;
  score: number; // 0-100
  failure_count_90d: number;
  downtime_hours_90d: number;
  repeat_failure_count: number;
  pm_overdue_count: number;
  last_updated: string;
  created_at: string;
};

// ============================================================================
// Knowledge Base
// ============================================================================

export type KnowledgeBaseEntry = {
  id: string;
  incident_id?: string;
  problem: string;
  root_cause: string;
  repair_method: string;
  photos?: string[]; // JSON array of file paths
  parts_used?: string[]; // JSON array of part codes
  lessons_learned?: string;
  keywords?: string;
  created_by_id: string;
  created_at: string;
  updated_at: string;
};

// ============================================================================
// Notifications & Telegram
// ============================================================================

export type TelegramUser = {
  id: string;
  factory_id: string;
  profile_id: string;
  telegram_chat_id: number;
  telegram_username?: string;
  notification_enabled: boolean;
  created_at: string;
};

export type TelegramGroup = {
  id: string;
  factory_id: string;
  name: string;
  telegram_group_id: number;
  notify_new_incident: boolean;
  notify_sla_alert: boolean;
  notify_blocking: boolean;
  notify_daily_summary: boolean;
  created_at: string;
};

export type NotificationType =
  | 'new_incident'
  | 'assignment'
  | 'status_update'
  | 'blocking_alert'
  | 'sla_alert'
  | 'pm_reminder'
  | 'daily_summary'
  | 'weekly_summary'
  | 'parts_status';

export type NotificationLog = {
  id: string;
  notification_type: NotificationType;
  recipient_type: 'user' | 'group';
  recipient_id: string;
  telegram_message_id?: number;
  status: 'sent' | 'failed';
  created_at: string;
};

// ============================================================================
// Maintenance Costs
// ============================================================================

export type CostType = 'labor' | 'parts' | 'vendor' | 'other';

export type MaintenanceCost = {
  id: string;
  factory_id: string;
  machine_id: string;
  incident_action_id?: string;
  cost_type: CostType;
  amount: number;
  currency: string; // 'IDR', 'USD', etc.
  cost_date: string;
  created_at: string;
};

// ============================================================================
// Projects
// ============================================================================

export type ProjectType =
  | 'new_production_line'
  | 'equipment_installation'
  | 'factory_expansion'
  | 'utility_upgrade'
  | 'other';

export type ProjectStatus = 'planning' | 'executing' | 'testing' | 'completed';

export type Project = {
  id: string;
  factory_id: string;
  project_name: string;
  project_type?: ProjectType;
  status: ProjectStatus;
  start_date?: string;
  end_date?: string;
  budget?: number;
  manager_id?: string;
  description?: string;
  created_at: string;
  updated_at: string;
};

// ============================================================================
// UI Helper Types
// ============================================================================

// Single source of truth for incident-status pill colors. The technician-facing
// display layer (lib/incident-display.ts) re-exports this as STATUS_ZH_COLOR so
// the same status is never two different colors on two different screens.
// Grouped so the color tells a technician what it means to THEM:
//   blue  = fresh / just in    ·  purple = being worked on
//   amber = blocked, waiting    ·  indigo/teal = nearly done, verifying
//   green = closed
export const INCIDENT_STATUS_COLORS: Record<IncidentStatus, string> = {
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
};

// UI Language: Bahasa Indonesia + technical English terms
// (parts/components like bearing, VFD, PLC stay in English for clarity)

export const INCIDENT_STATUS_LABELS: Record<IncidentStatus, string> = {
  reported: 'Dilaporkan',
  accepted: 'Diterima',
  analyzing: 'Analisa',
  waiting_parts: 'Menunggu Parts',
  waiting_approval: 'Menunggu Persetujuan',
  waiting_vendor: 'Menunggu Vendor',
  waiting_shutdown: 'Menunggu Shutdown',
  repairing: 'Perbaikan',
  testing: 'Pengujian',
  observation: 'Observasi',
  closed: 'Selesai',
};

export const DOWNTIME_IMPACT_LABELS: Record<DowntimeImpact, string> = {
  A: 'Pabrik Berhenti',      // Factory Stop
  C: 'Kapasitas Turun',      // Reduced Capacity
  D: 'Tidak Berpengaruh',    // No Impact
};

export const ROLE_LABELS: Record<UserRole, string> = {
  technician: 'Karyawan',
  supervisor: 'Pengawas',
  manager: 'Manajer',
  director: 'Kepala Pabrik',
  admin: 'Admin Sistem',
};

// Extended descriptions for admin/settings pages where context helps.
export const ROLE_DESCRIPTIONS: Record<UserRole, string> = {
  technician: 'Lapor & catat perbaikan',
  supervisor: 'Terima & assign insiden',
  manager: 'Pantau KPI & persetujuan',
  director: 'Lihat laporan strategis',
  admin: 'Kelola semua master data & akun',
};

export const ACTION_TYPE_LABELS: Record<ActionType, string> = {
  inspection: 'Inspeksi',
  temporary_fix: 'Perbaikan Sementara',
  root_cause_analysis: 'Analisa Root Cause',
  part_replacement: 'Ganti Parts',
  corrective_action: 'Tindakan Korektif',
  preventive_action: 'Tindakan Preventif',
  testing: 'Testing',
  observation: 'Observasi',
};

export const COMPLETION_TYPE_LABELS: Record<CompletionType, string> = {
  temporary_fix: '⚠️ Perbaikan Sementara — pantau 30 hari, akar masalah belum selesai',
  permanent_fix: '✅ Perbaikan Permanen — akar masalah terselesaikan',
};

export const PM_TYPE_LABELS: Record<PMType, string> = {
  daily: 'Harian',
  weekly: 'Mingguan',
  monthly: 'Bulanan',
  quarterly: 'Per 3 Bulan',
  half_yearly: 'Per 6 Bulan',
  yearly: 'Tahunan',
  custom: 'Custom (per N hari)',
};

export const PM_DELAY_REASON_LABELS: Record<PMDelayReason, string> = {
  no_shutdown: 'Tidak Ada Shutdown',
  no_manpower: 'Kurang Tenaga Kerja',
  no_parts: 'Parts Tidak Ada',
  production_priority: 'Prioritas Produksi',
  forgot: 'Terlupa',
};

export const BLOCK_REASON_LABELS: Record<BlockReason, string> = {
  waiting_parts: 'Menunggu Parts',
  waiting_purchase: 'Menunggu Pembelian',
  waiting_vendor: 'Menunggu Vendor',
  waiting_shutdown: 'Menunggu Shutdown',
  waiting_approval: 'Menunggu Approval',
  waiting_drawing: 'Menunggu Drawing',
  other: 'Lainnya',
};

export const MACHINE_STATUS_LABELS: Record<Machine['status'], string> = {
  running: 'Beroperasi',
  repairing: 'Perbaikan',
  standby: 'Standby',
  scrapped: 'Afkir',
};

export const MACHINE_STATUS_COLORS: Record<Machine['status'], string> = {
  running: 'bg-green-100 text-green-800',
  repairing: 'bg-orange-100 text-orange-800',
  standby: 'bg-gray-100 text-gray-800',
  scrapped: 'bg-red-100 text-red-800',
};

export const RCA_STATUS_LABELS: Record<RCAStatus, string> = {
  open: 'Terbuka',
  in_progress: 'Sedang Dikerjakan',
  completed: 'Selesai',
  closed: 'Ditutup',
};

export const RCA_STATUS_COLORS: Record<RCAStatus, string> = {
  open: 'bg-red-100 text-red-800',
  in_progress: 'bg-yellow-100 text-yellow-800',
  completed: 'bg-green-100 text-green-800',
  closed: 'bg-gray-100 text-gray-800',
};

// ============================================================================
// Health Score Helper
// ============================================================================

export function getHealthScoreBadge(score: number): {
  label: string;
  color: string;
} {
  if (score >= 80) return { label: 'Sehat', color: 'bg-green-500' };          // Healthy
  if (score >= 60) return { label: 'Perhatian', color: 'bg-yellow-500' };     // Warning
  if (score >= 40) return { label: 'Risiko Tinggi', color: 'bg-orange-500' }; // High Risk
  return { label: 'Kritis', color: 'bg-red-500' };                            // Critical
}
