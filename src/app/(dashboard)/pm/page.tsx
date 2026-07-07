import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import PMPage from '@/components/pm/PMPage'

export const metadata = { title: '保養紀錄 | FAMMS' }

export default async function PMRoutePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return <PMPage />
}
