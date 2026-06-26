import { createClient } from '@/lib/supabase/server'
import type { UserRole } from '@/types'

export type CurrentUser = {
  id: string
  factory_id: string | null
  full_name: string | null
  role: UserRole
  is_active: boolean
}

// Returns the logged-in user's profile, or null when unauthenticated.
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: profile } = await supabase
    .from('profiles')
    .select('factory_id, full_name, role, is_active')
    .eq('id', user.id)
    .single()

  if (!profile) return null

  return {
    id: user.id,
    factory_id: profile.factory_id ?? null,
    full_name: profile.full_name ?? null,
    role: (profile.role ?? 'technician') as UserRole,
    is_active: profile.is_active ?? true,
  }
}

// Guard for admin-only API routes. Returns the admin user or an error reason.
export async function requireAdmin(): Promise<
  | { ok: true; user: CurrentUser }
  | { ok: false; status: 401 | 403 }
> {
  const user = await getCurrentUser()
  if (!user) return { ok: false, status: 401 }
  if (user.role !== 'admin') return { ok: false, status: 403 }
  return { ok: true, user }
}

// Permission checks for different features
export const PERMISSIONS = {
  // Can access dashboard (supervisor+)
  dashboard: (role: UserRole) => ['supervisor', 'manager', 'director', 'admin'].includes(role),
  // Can view full incident board (supervisor+)
  boardFull: (role: UserRole) => ['supervisor', 'manager', 'director', 'admin'].includes(role),
  // Can assign incidents (supervisor+)
  assignIncident: (role: UserRole) => ['supervisor', 'director', 'admin'].includes(role),
  // Can close incidents (supervisor+)
  closeIncident: (role: UserRole) => ['supervisor', 'director', 'admin'].includes(role),
  // Can edit incidents (supervisor+)
  editIncident: (role: UserRole) => ['supervisor', 'director', 'admin'].includes(role),
  // Can delete incidents (supervisor+)
  deleteIncident: (role: UserRole) => ['supervisor', 'director', 'admin'].includes(role),
  // Can manage users (admin only)
  manageUsers: (role: UserRole) => role === 'admin',
  // Can manage settings (admin only)
  manageSettings: (role: UserRole) => role === 'admin',
} as const
