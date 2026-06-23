'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Input } from '@/components/ui/input'
import { Search } from 'lucide-react'

export default function KBSearch({ initialQuery = '' }: { initialQuery?: string }) {
  const router = useRouter()
  const [q, setQ] = useState(initialQuery)

  function search(e: React.FormEvent) {
    e.preventDefault()
    const params = new URLSearchParams()
    if (q.trim()) params.set('q', q.trim())
    router.push(`/knowledge-base${params.toString() ? `?${params.toString()}` : ''}`)
  }

  return (
    <form onSubmit={search} className="relative">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
      <Input
        value={q}
        onChange={e => setQ(e.target.value)}
        placeholder="Cari problem, root cause, keyword..."
        className="pl-9"
      />
    </form>
  )
}
