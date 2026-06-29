import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import QRDisplay from '@/components/machines/QRDisplay'
import { Button } from '@/components/ui/button'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

export const metadata = { title: 'QR Code | FAMMS' }

export default async function MachineQRPage({ params }: { params: { id: string } }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: machine } = await supabase
    .from('machines')
    .select('*')
    .eq('id', params.id)
    .single()

  if (!machine) redirect('/machines')

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/machines">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="w-4 h-4 mr-1" />
            Kembali
          </Button>
        </Link>
        <h1 className="text-xl font-bold text-gray-900">QR Code</h1>
      </div>
      <QRDisplay
        machineCode={machine.machine_code}
        machineId={machine.id}
        appUrl={appUrl}
      />
    </div>
  )
}
