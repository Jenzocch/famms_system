import { createClient } from '@/lib/supabase/server'
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import ImageViewer from '@/components/shared/ImageViewer'
import { ArrowLeft, ExternalLink } from 'lucide-react'
import { format } from 'date-fns'

export const metadata = { title: 'Knowledge Base | FAMMS' }

function parseList(raw: string | null): string[] {
  if (!raw) return []
  try {
    const v = JSON.parse(raw)
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

export default async function KBDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: entry } = await supabase
    .from('knowledge_base')
    .select('*, author:profiles(full_name), incident:incidents(incident_no, id)')
    .eq('id', id)
    .single()

  if (!entry) notFound()

  const parts = parseList(entry.parts_used)
  const photos = parseList(entry.photos)
  const keywords = (entry.keywords ?? '').split(',').map((k: string) => k.trim()).filter(Boolean)
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <Link href="/knowledge-base">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="w-4 h-4 mr-1" />
            Kembali
          </Button>
        </Link>
        {entry.incident?.id && (
          <Link href={`/incidents/${entry.incident.id}`}>
            <Button variant="outline" size="sm">
              <ExternalLink className="w-4 h-4 mr-1" />
              {entry.incident.incident_no}
            </Button>
          </Link>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
        <div>
          <h1 className="text-xl font-bold text-gray-900">{entry.problem}</h1>
          <div className="flex gap-3 mt-2 text-xs text-gray-400">
            {entry.author?.full_name && <span>oleh {entry.author.full_name}</span>}
            <span>{format(new Date(entry.created_at), 'dd MMM yyyy HH:mm')}</span>
          </div>
        </div>

        <Section title="Root Cause (Akar Masalah)" body={entry.root_cause} />
        <Section title="Metode Perbaikan" body={entry.repair_method} />
        {entry.lessons_learned && <Section title="Lessons Learned" body={entry.lessons_learned} />}

        {photos.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Foto</p>
            <ImageViewer paths={photos} supabaseUrl={supabaseUrl} bucket="incident-photos" />
          </div>
        )}

        {parts.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Parts Digunakan</p>
            <div className="flex flex-wrap gap-2">
              {parts.map((p, i) => (
                <span key={i} className="text-xs px-2 py-1 rounded-full bg-gray-100 text-gray-700 font-mono">{p}</span>
              ))}
            </div>
          </div>
        )}

        {keywords.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Keywords</p>
            <div className="flex flex-wrap gap-2">
              {keywords.map((k: string, i: number) => (
                <Link key={i} href={`/knowledge-base?q=${encodeURIComponent(k)}`}>
                  <span className="text-xs px-2 py-1 rounded-full bg-blue-50 text-blue-700 hover:bg-blue-100">#{k}</span>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function Section({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <p className="text-xs font-semibold text-gray-500 uppercase mb-1">{title}</p>
      <p className="text-sm text-gray-700 whitespace-pre-wrap">{body}</p>
    </div>
  )
}
