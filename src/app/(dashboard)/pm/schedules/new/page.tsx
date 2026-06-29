import PMScheduleForm from '@/components/pm/PMScheduleForm'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { ArrowLeft } from 'lucide-react'

export const metadata = { title: 'Jadwal PM Baru | FAMMS' }

export default function NewPMSchedulePage() {
  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/pm">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="w-4 h-4 mr-1" />
            Kembali
          </Button>
        </Link>
        <h1 className="text-xl font-bold text-gray-900">Jadwal PM Baru</h1>
      </div>
      <PMScheduleForm />
    </div>
  )
}
