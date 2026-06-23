'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { Loader2, RefreshCw } from 'lucide-react'

export default function RecalcHealthButton() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  async function recalc() {
    setLoading(true)
    try {
      const res = await fetch('/api/health-score', { method: 'POST' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Gagal menghitung ulang')
      toast.success(`Health score diperbarui untuk ${json.scores?.length ?? 0} mesin`)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menghitung ulang')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={recalc} disabled={loading}>
      {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
      Hitung Ulang
    </Button>
  )
}
