import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import PMPage from '@/components/pm/PMPage'

export const metadata = { title: 'PM | FAMMS' }

export default async function PMRoutePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return <PMPage />
}
