import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { getCurrentUser, PERMISSIONS } from '@/lib/auth'
import MachinesList, { MachineRow } from '@/components/machines/MachinesList'

export const metadata = { title: 'Machines | FAMMS' }

export default async function MachinesPage() {
  // getCurrentUser is cache()-wrapped and claims-based: reuses the layout's
  // auth+profile lookup instead of re-running both queries for this page.
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  // capabilities.viewMachines defaults true for every base role; a custom
  // role (e.g. 一般員工) can turn it off in Settings → 角色管理.
  if (!user.capabilities.viewMachines) redirect('/incidents')

  const supabase = await createClient()

  // Cross-factory accounts (factory_id NULL, e.g. admins) see every machine;
  // .eq('factory_id', null) would match nothing and show an empty list.
  let query = supabase
    .from('machines')
    .select('id, machine_code, machine_name, status, brand, model, area:areas(name), owner:profiles(full_name)')
    .order('machine_code')
  if (user.factory_id) query = query.eq('factory_id', user.factory_id)

  const { data: machines } = await query

  async function deleteMachine(machineId: string) {
    'use server'
    // Server actions are callable by anyone with a session — re-check the
    // role here, not just in the UI.
    const actor = await getCurrentUser()
    if (!actor || !PERMISSIONS.manageMachines(actor.role)) return
    const supabase = await createClient()
    const { error } = await supabase.from('machines').delete().eq('id', machineId)
    // Surface failures (e.g. the RESTRICT FK guarding repair history) instead
    // of redirecting as if the delete succeeded.
    if (error) throw new Error(error.message)
    redirect('/machines')
  }

  return (
    <MachinesList
      machines={(machines ?? []) as unknown as MachineRow[]}
      deleteAction={deleteMachine}
      canManage={PERMISSIONS.manageMachines(user.role)}
    />
  )
}
