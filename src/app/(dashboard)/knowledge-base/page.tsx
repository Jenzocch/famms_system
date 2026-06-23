import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Plus, BookOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import KBSearch from '@/components/knowledge-base/KBSearch'
import { format } from 'date-fns'

export const metadata = { title: 'Knowledge Base | FAMMS' }

export default async function KnowledgeBasePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { q } = await searchParams

  let query = supabase
    .from('knowledge_base')
    .select('*, author:profiles(full_name), incident:incidents(incident_no)')
    .order('created_at', { ascending: false })
    .limit(100)

  if (q) {
    // Full-text style search across the key fields
    const term = `%${q}%`
    query = query.or(
      `problem.ilike.${term},root_cause.ilike.${term},repair_method.ilike.${term},keywords.ilike.${term},lessons_learned.ilike.${term}`
    )
  }

  const { data: entries } = await query

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">Knowledge Base</h1>
        <Link href="/knowledge-base/new">
          <Button>
            <Plus className="w-4 h-4 mr-2" />
            Tambah Entry
          </Button>
        </Link>
      </div>

      <KBSearch initialQuery={q ?? ''} />

      {q && (
        <p className="text-sm text-gray-500">
          {entries?.length ?? 0} hasil untuk &ldquo;{q}&rdquo;
        </p>
      )}

      {!entries || entries.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
          <BookOpen className="w-12 h-12 mx-auto mb-3 text-gray-300" />
          <p className="text-gray-500">
            {q ? 'Tidak ada hasil. Coba kata kunci lain.' : 'Belum ada knowledge base. Tambah entry pertama.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {entries.map((e) => (
            <Link key={e.id} href={`/knowledge-base/${e.id}`}>
              <div className="bg-white rounded-lg border border-gray-200 p-4 hover:border-blue-300 transition">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="font-semibold text-gray-900 line-clamp-1">{e.problem}</h3>
                  {e.incident?.incident_no && (
                    <span className="text-xs font-mono text-blue-600 shrink-0">{e.incident.incident_no}</span>
                  )}
                </div>
                <p className="text-sm text-gray-600 mt-1 line-clamp-2">
                  <span className="font-medium text-gray-700">Root cause: </span>
                  {e.root_cause}
                </p>
                <div className="flex gap-3 mt-2 text-xs text-gray-400">
                  {e.author?.full_name && <span>{e.author.full_name}</span>}
                  <span>{format(new Date(e.created_at), 'dd MMM yyyy')}</span>
                  {e.keywords && <span className="text-gray-500">#{e.keywords.split(',')[0]?.trim()}</span>}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
