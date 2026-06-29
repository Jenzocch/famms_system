import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Plus, Edit2, Trash2, QrCode } from 'lucide-react'
import { Button } from '@/components/ui/button'
import StatusBadge from '@/components/shared/StatusBadge'

export const metadata = { title: 'Mesin | FAMMS' }

export default async function MachinesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('factory_id')
    .eq('id', user.id)
    .single()

  const { data: machines } = await supabase
    .from('machines')
    .select('*, area:areas(name), owner:profiles(full_name)')
    .eq('factory_id', profile?.factory_id)
    .order('machine_code')

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">Mesin</h1>
        <form action="/machines/new" method="get">
          <Button type="submit">
            <Plus className="w-4 h-4 mr-2" />
            Tambah Mesin
          </Button>
        </form>
      </div>

      {!machines || machines.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
          <QrCode className="w-12 h-12 mx-auto mb-3 text-gray-300" />
          <p className="text-gray-500">Belum ada mesin terdaftar</p>
        </div>
      ) : (
        <div className="space-y-2">
          {machines.map((m) => (
            <div key={m.id} className="bg-white rounded-lg border border-gray-200 p-4 flex items-center justify-between hover:border-blue-300 transition">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-1">
                  <h3 className="font-semibold text-gray-900">{m.machine_code}</h3>
                  <StatusBadge status={m.status} type="machine" />
                </div>
                <p className="text-sm text-gray-600">{m.machine_name}</p>
                <div className="flex gap-4 mt-2 text-xs text-gray-500">
                  {m.brand && <span>{m.brand} {m.model}</span>}
                  {m.area?.name && <span>{m.area.name}</span>}
                  {m.owner?.full_name && <span>PIC: {m.owner.full_name}</span>}
                </div>
              </div>
              <div className="flex gap-2">
                <form action={`/machines/${m.id}/qr`} method="get" className="inline">
                  <Button type="submit" variant="outline" size="sm">
                    <QrCode className="w-4 h-4" />
                  </Button>
                </form>
                <form action={`/machines/${m.id}/edit`} method="get" className="inline">
                  <Button type="submit" variant="outline" size="sm">
                    <Edit2 className="w-4 h-4" />
                  </Button>
                </form>
                <DeleteMachineButton machineId={m.id} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function DeleteMachineButton({ machineId }: { machineId: string }) {
  return (
    <form
      action={async () => {
        'use server'
        const supabase = await createClient()
        await supabase.from('machines').delete().eq('id', machineId)
        redirect('/machines')
      }}
    >
      <Button variant="outline" size="sm" type="submit" className="text-red-600 hover:bg-red-50">
        <Trash2 className="w-4 h-4" />
      </Button>
    </form>
  )
}
