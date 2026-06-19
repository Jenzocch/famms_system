import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import MaterialsClient from './MaterialsClient'

export default async function MaterialsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()

  // Check if table exists and has data
  const { count } = await supabase
    .from('material_price_history')
    .select('*', { count: 'exact', head: true })

  const canSeed = profile && ['purchasing', 'director'].includes(profile.role)

  return <MaterialsClient hasData={(count ?? 0) > 0} canSeed={!!canSeed} recordCount={count ?? 0} />
}
