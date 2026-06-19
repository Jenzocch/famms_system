'use client'

import { useState, useEffect } from 'react'
import { TrendingUp, TrendingDown, Minus, AlertTriangle } from 'lucide-react'
import { formatRupiah } from '@/types'
import { format } from 'date-fns'

interface PricePoint { date: string; price: number }
interface Material {
  code_bb: string
  item_name: string
  latest_price: number | null
  latest_date: string | null
  trend_pct: number
  history: PricePoint[]
}

interface Props {
  searchTerm: string
  currentPrice?: number
}

export default function PriceIntelligence({ searchTerm, currentPrice }: Props) {
  const [materials, setMaterials] = useState<Material[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!searchTerm || searchTerm.length < 2) { setMaterials([]); return }
    const t = setTimeout(async () => {
      setLoading(true)
      const res = await fetch(`/api/materials?q=${encodeURIComponent(searchTerm)}`)
      const data = await res.json()
      setLoading(false)
      if (Array.isArray(data)) setMaterials(data.slice(0, 3))
    }, 500)
    return () => clearTimeout(t)
  }, [searchTerm])

  if (loading) return (
    <div className="text-xs text-gray-400 py-1">🔍 Checking price history...</div>
  )

  if (!materials.length) return null

  return (
    <div className="mt-2 space-y-2">
      {materials.map(m => {
        const prev = m.history[m.history.length - 2]
        const latest = m.history[m.history.length - 1]
        const vsCurrentPct = currentPrice && latest?.price
          ? ((currentPrice - latest.price) / latest.price) * 100
          : null

        return (
          <div key={m.code_bb} className="bg-blue-50 border border-blue-100 rounded-lg p-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span className="font-mono text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-semibold">{m.code_bb}</span>
                  {m.trend_pct > 0.5 ? <TrendingUp className="w-3.5 h-3.5 text-red-500" /> :
                   m.trend_pct < -0.5 ? <TrendingDown className="w-3.5 h-3.5 text-green-500" /> :
                   <Minus className="w-3.5 h-3.5 text-gray-400" />}
                </div>
                <p className="text-xs text-gray-600 truncate">{m.item_name}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-sm font-bold text-blue-700">{m.latest_price ? formatRupiah(m.latest_price) : '—'}</p>
                {m.latest_date && (
                  <p className="text-xs text-gray-400">{format(new Date(m.latest_date), 'MMM yyyy')}</p>
                )}
              </div>
            </div>

            {vsCurrentPct !== null && vsCurrentPct > 10 && (
              <div className="flex items-center gap-1 mt-2 text-xs text-orange-700 bg-orange-50 rounded p-1.5">
                <AlertTriangle className="w-3 h-3 shrink-0" />
                <span>現在報價比歷史高 +{vsCurrentPct.toFixed(1)}%，請注意！</span>
              </div>
            )}
            {vsCurrentPct !== null && vsCurrentPct < -10 && (
              <div className="flex items-center gap-1 mt-2 text-xs text-green-700 bg-green-50 rounded p-1.5">
                <TrendingDown className="w-3 h-3 shrink-0" />
                <span>現在報價比歷史低 {vsCurrentPct.toFixed(1)}%，優惠！</span>
              </div>
            )}

            {prev && (
              <div className="mt-2 pt-2 border-t border-blue-100 text-xs text-gray-500">
                上次: {formatRupiah(prev.price)} ({prev.date ? format(new Date(prev.date), 'MMM yyyy') : '?'})
                {prev.price && latest?.price && (
                  <span className={`ml-1 font-medium ${latest.price > prev.price ? 'text-red-600' : 'text-green-600'}`}>
                    {latest.price > prev.price ? '↑' : '↓'}{Math.abs(m.trend_pct).toFixed(1)}%
                  </span>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
