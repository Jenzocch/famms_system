import KBForm from '@/components/knowledge-base/KBForm'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { ArrowLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'

export const metadata = { title: 'Tambah Knowledge Base | FAMMS' }

export default async function NewKBPage({
  searchParams,
}: {
  searchParams: Promise<{ incident?: string }>
}) {
  const { incident: incidentId } = await searchParams

  // If linked to an incident, prefill problem/root cause from it.
  let defaultProblem = ''
  let defaultRootCause = ''
  if (incidentId) {
    const supabase = await createClient()
    const { data: inc } = await supabase
      .from('incidents')
      .select('remarks, root_cause, failure_code:failure_codes(name)')
      .eq('id', incidentId)
      .single()
    if (inc) {
      const fc = inc.failure_code as unknown as { name: string } | { name: string }[] | null
      const fcName = Array.isArray(fc) ? fc[0]?.name : fc?.name
      defaultProblem = inc.remarks || fcName || ''
      defaultRootCause = inc.root_cause || ''
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/knowledge-base">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="w-4 h-4 mr-1" />
            Kembali
          </Button>
        </Link>
        <h1 className="text-xl font-bold text-gray-900">Tambah Knowledge Base</h1>
      </div>
      <KBForm
        incidentId={incidentId}
        defaultProblem={defaultProblem}
        defaultRootCause={defaultRootCause}
      />
    </div>
  )
}
