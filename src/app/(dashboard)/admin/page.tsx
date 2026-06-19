import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import AdminClient from './AdminClient'

export default async function AdminPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || !['purchasing', 'director'].includes(profile.role)) redirect('/dashboard')

  const [{ data: departments }, { data: profiles }] = await Promise.all([
    supabase.from('departments').select('id,name').order('name'),
    supabase.from('profiles').select('id,full_name,email,role,department_id,department:departments(id,name)').order('full_name'),
  ])

  return <AdminClient departments={departments ?? []} profiles={profiles ?? []} />
}
