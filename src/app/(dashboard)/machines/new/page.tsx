import { redirect } from 'next/navigation'
import { getCurrentUser, PERMISSIONS } from '@/lib/auth'
import MachineForm from '@/components/machines/MachineForm'

export const metadata = { title: 'New Machine | FAMMS' }

export default async function NewMachinePage() {
  // Was completely unguarded — reachable by direct URL for anyone logged in,
  // even though only manager+ can actually save (RLS). Gate the page itself.
  const user = await getCurrentUser()
  if (!user || !PERMISSIONS.manageMachines(user.role)) redirect('/machines')

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <h1 className="text-xl font-bold text-gray-900">Tambah Mesin Baru</h1>
      <MachineForm />
    </div>
  )
}
