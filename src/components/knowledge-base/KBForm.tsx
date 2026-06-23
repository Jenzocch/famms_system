'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'

interface Props {
  incidentId?: string
  defaultProblem?: string
  defaultRootCause?: string
}

export default function KBForm({ incidentId, defaultProblem = '', defaultRootCause = '' }: Props) {
  const router = useRouter()
  const [problem, setProblem] = useState(defaultProblem)
  const [rootCause, setRootCause] = useState(defaultRootCause)
  const [repairMethod, setRepairMethod] = useState('')
  const [lessons, setLessons] = useState('')
  const [keywords, setKeywords] = useState('')
  const [partsUsed, setPartsUsed] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function submit() {
    if (!problem || !rootCause || !repairMethod) {
      toast.error('Problem, root cause, dan metode perbaikan wajib diisi')
      return
    }
    setSubmitting(true)
    try {
      const parts = partsUsed
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)
      const res = await fetch('/api/knowledge-base', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          incident_id: incidentId || undefined,
          problem,
          root_cause: rootCause,
          repair_method: repairMethod,
          lessons_learned: lessons || undefined,
          keywords: keywords || undefined,
          parts_used: parts.length ? parts : undefined,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Gagal menyimpan')
      toast.success('Knowledge base tersimpan')
      router.push(`/knowledge-base/${json.entry.id}`)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menyimpan')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
      <div>
        <Label>Problem (Masalah) <span className="text-red-500">*</span></Label>
        <Textarea
          value={problem}
          onChange={e => setProblem(e.target.value)}
          placeholder="Apa gejala / masalah yang terjadi?"
          rows={2}
          className="mt-1"
        />
      </div>

      <div>
        <Label>Root Cause (Akar Masalah) <span className="text-red-500">*</span></Label>
        <Textarea
          value={rootCause}
          onChange={e => setRootCause(e.target.value)}
          placeholder="Apa penyebab sebenarnya?"
          rows={2}
          className="mt-1"
        />
      </div>

      <div>
        <Label>Metode Perbaikan (Repair Method) <span className="text-red-500">*</span></Label>
        <Textarea
          value={repairMethod}
          onChange={e => setRepairMethod(e.target.value)}
          placeholder="Langkah-langkah perbaikan yang dilakukan..."
          rows={3}
          className="mt-1"
        />
      </div>

      <div>
        <Label>Lessons Learned (Pelajaran)</Label>
        <Textarea
          value={lessons}
          onChange={e => setLessons(e.target.value)}
          placeholder="Apa yang dipelajari? Bagaimana mencegah ke depan?"
          rows={2}
          className="mt-1"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <Label>Parts Digunakan</Label>
          <Input
            value={partsUsed}
            onChange={e => setPartsUsed(e.target.value)}
            placeholder="bearing 6205, seal, ... (pisah koma)"
            className="mt-1"
          />
        </div>
        <div>
          <Label>Keywords (untuk pencarian)</Label>
          <Input
            value={keywords}
            onChange={e => setKeywords(e.target.value)}
            placeholder="bearing, overheat, VFD, ..."
            className="mt-1"
          />
        </div>
      </div>

      <Button onClick={submit} disabled={submitting} className="w-full">
        {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
        Simpan Knowledge Base
      </Button>
    </div>
  )
}
