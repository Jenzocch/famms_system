import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import TopBar from '@/components/shared/TopBar'
import BottomNav from '@/components/shared/BottomNav'
import Sidebar from '@/components/shared/Sidebar'
import AccountDisabled from '@/components/shared/AccountDisabled'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  // Admin-disabled accounts are blocked from the app entirely
  if (profile && profile.is_active === false) {
    return <AccountDisabled />
  }

  return (
    <div className="min-h-screen bg-gray-50 lg:flex">
      {/* Desktop-only left sidebar */}
      <Sidebar profile={profile} />

      <div className="flex-1 flex flex-col min-w-0">
        {/* TopBar only on mobile; the sidebar handles brand/lang/user on desktop */}
        <div className="lg:hidden">
          <TopBar profile={profile} />
        </div>
        <main className="flex-1 w-full mx-auto px-4 py-4 pb-24 max-w-lg lg:max-w-5xl lg:pb-8">
          {children}
        </main>
      </div>

      <BottomNav userRole={profile?.role} />
    </div>
  )
}
