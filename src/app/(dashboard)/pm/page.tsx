import { getCurrentUser } from '@/lib/auth'
import { redirect } from 'next/navigation'
import PMPage from '@/components/pm/PMPage'

export const metadata = { title: '保養紀錄 | 維修系統' }

export default async function PMRoutePage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  // Pre-select the user's own factory so the PM calendar loads without an
  // extra pick (cross-factory admins fall back to the first factory).
  return <PMPage defaultFactoryId={user.factory_id} />
}
