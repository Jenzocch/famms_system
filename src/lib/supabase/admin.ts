import { createClient } from '@supabase/supabase-js'

// Service-role client — bypasses RLS and can manage auth.users.
// NEVER import this into client components. Server-side (API routes) only.
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    throw new Error('Supabase service role 未設定 (缺少 SUPABASE_SERVICE_ROLE_KEY)')
  }
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}
