import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import type { UserRole } from '@/types'
export { PERMISSIONS } from '@/lib/permissions'

export type CurrentUser = {
  id: string
  factory_id: string | null
  full_name: string | null
  role: UserRole
  is_active: boolean
}

// Returns the logged-in user's profile, or null when unauthenticated.
// Wrapped in React cache() so repeated calls within a single server render
// (page + nested guards/components) reuse one auth + profile lookup.
export const getCurrentUser = cache(async function getCurrentUser(): Promise<CurrentUser | null> {
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
})

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

