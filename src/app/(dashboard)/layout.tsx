import { createClient } from '@/lib/supabase/server'
import { getAuthClaims } from '@/lib/auth'
import { redirect } from 'next/navigation'
import TopBar from '@/components/shared/TopBar'
import BottomNav from '@/components/shared/BottomNav'
import Sidebar from '@/components/shared/Sidebar'
import AccountDisabled from '@/components/shared/AccountDisabled'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  // Local JWT check — no auth server round-trip on every navigation. The
  // profile query below runs under the same JWT and is verified server-side
  // by PostgREST, so a forged token still yields nothing.
  const claims = await getAuthClaims()
  if (!claims?.sub) redirect('/login')
  const userId = claims.sub

  const supabase = await createClient()
  // Fetch profile and my-open-case count in parallel — they're independent,
  // so this saves one round-trip of latency on every page navigation.
  const [{ data: profile }, { count: myOpenCount }] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', userId).single(),
    supabase
      .from('incidents')
      .select('id', { count: 'exact', head: true })
      .neq('status', 'closed')
      .contains('assigned_user_ids', [userId]),
  ])

  // Admin-disabled accounts are blocked from the app entirely
  if (profile && profile.is_active === false) {
    return <AccountDisabled />
  }

  return (
    <div className="min-h-screen bg-gray-50 lg:flex">
      {/* Desktop-only left sidebar */}
      <Sidebar profile={profile} incidentBadge={myOpenCount ?? 0} />

      <div className="flex-1 flex flex-col min-w-0">
        {/* TopBar only on mobile; the sidebar handles brand/lang/user on desktop */}
        <div className="lg:hidden">
          <TopBar profile={profile} />
        </div>
        <main className="flex-1 w-full mx-auto px-4 py-4 pb-24 max-w-lg lg:max-w-5xl xl:max-w-7xl xl:px-6 lg:pb-8">
          {children}
        </main>
      </div>

      <BottomNav userRole={profile?.role} incidentBadge={myOpenCount ?? 0} />
    </div>
  )
}
