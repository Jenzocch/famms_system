import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import TopBar from '@/components/shared/TopBar'
import BottomNav from '@/components/shared/BottomNav'
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
    <div className="min-h-screen flex flex-col bg-gray-50">
      <TopBar profile={profile} />
      <main className="flex-1 max-w-lg w-full mx-auto px-4 py-4 pb-24">
        {children}
      </main>
      <BottomNav userRole={profile?.role} />
    </div>
  )
}
