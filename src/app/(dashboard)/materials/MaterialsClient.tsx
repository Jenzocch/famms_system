'use client'

import { useState, useEffect, useCallback } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { TrendingUp, TrendingDown, Minus, Search, Upload, RefreshCw, X, ChevronLeft } from 'lucide-react'
import { formatRupiah } from '@/types'
import { format } from 'date-fns'
import { toast } from 'sonner'
import Link from 'next/link'

interface PricePoint { date: string; price: number; qty: number; company: string }
interface Material {
  code_bb: string
  item_name: string
  supplier: string
  latest_price: number | null
  latest_date: string | null
  trend_pct: number
  history: PricePoint[]
}

interface Props {
  hasData: boolean
  canSeed: boolean
  recordCount: number
}

export default function MaterialsClient({ hasData, canSeed, recordCount }: Props) {
  const [materials, setMaterials] = useState<Material[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [seeding, setSeeding] = useState(false)
  const [selected, setSelected] = useState<Material | null>(null)
  const [count, setCount] = useState(recordCount)

  const fetchMaterials = useCallback(async (q = '') => {
    setLoading(true)
    const res = await fetch(`/api/materials?q=${encodeURIComponent(q)}`)
    const data = await res.json()
    setLoading(false)
    if (Array.isArray(data)) setMaterials(data)
  }, [])

  useEffect(() => {
    if (hasData) fetchMaterials()
  }, [hasData, fetchMaterials])

  useEffect(() => {
    const t = setTimeout(() => { if (count > 0) fetchMaterials(search) }, 400)
    return () => clearTimeout(t)
  }, [search, count, fetchMaterials])

  async function seedData() {
    setSeeding(true)
    const res = await fetch('/api/materials/seed', { method: 'POST' })
    const data = await res.json()
    setSeeding(false)
    if (data.error) { toast.error(data.error); return }
    toast.success(data.message)
    setCount(204)
    fetchMaterials()
  }

  const TrendIcon = ({ pct }: { pct: number }) => {
    if (pct > 0.5) return <TrendingUp className="w-4 h-4 text-red-500" />
    if (pct < -0.5) return <TrendingDown className="w-4 h-4 text-green-500" />
    return <Minus className="w-4 h-4 text-gray-400" />
  }

  const TrendBadge = ({ pct }: { pct: number }) => {
    if (Math.abs(pct) < 0.5) return <span className="text-xs text-gray-400">stable</span>
    const color = pct > 0 ? 'text-red-600' : 'text-green-600'
    return <span className={`text-xs font-medium ${color}`}>{pct > 0 ? '+' : ''}{pct.toFixed(1)}%</span>
  }

  if (!hasData && count === 0) {
    return (
      <div className="max-w-2xl mx-auto text-center py-16">
        <div className="text-5xl mb-4">📊</div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Price Intelligence</h1>
        <p className="text-gray-500 mb-6">原物料採購歷史價格追蹤系統。尚未有資料。</p>
        {canSeed ? (
          <button
            onClick={seedData}
            disabled={seeding}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 disabled:opacity-60 transition-colors"
          >
            {seeding ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            {seeding ? '匯入中...' : '匯入 Google Sheet 資料 (204 筆)'}
          </button>
        ) : (
          <p className="text-sm text-gray-400">請聯絡 Purchasing 部門匯入資料</p>
        )}
        <div className="mt-8 p-4 bg-yellow-50 rounded-xl text-left text-sm text-yellow-800">
          <p className="font-semibold mb-1">⚠️ 請先在 Supabase 執行 SQL Migration：</p>
          <p className="font-mono text-xs bg-yellow-100 p-2 rounded mt-1">
            supabase/schema.sql 中 material_price_history 相關語法
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center gap-2 mb-5">
        <Link href="/dashboard" className="text-gray-400 hover:text-gray-600">
          <ChevronLeft className="w-5 h-5" />
        </Link>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-gray-900">Price Intelligence</h1>
          <p className="text-sm text-gray-500">{count} 筆採購記錄 · 原物料價格趨勢追蹤</p>
        </div>
        {canSeed && count === 0 && (
          <button onClick={seedData} disabled={seeding}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-60">
            {seeding ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
            匯入資料
          </button>
        )}
      </div>

      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          type="text"
          placeholder="搜尋 Code BB、品名、供應商..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {selected && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-4" onClick={() => setSelected(null)}>
          <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="p-5 border-b border-gray-100 flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm bg-blue-50 text-blue-700 px-2 py-0.5 rounded font-semibold">{selected.code_bb}</span>
                  <TrendIcon pct={selected.trend_pct} />
                  <TrendBadge pct={selected.trend_pct} />
                </div>
                <h2 className="text-lg font-bold text-gray-900 mt-1">{selected.item_name || selected.code_bb}</h2>
                <p className="text-sm text-gray-500">{selected.supplier}</p>
              </div>
              <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-3 gap-3 p-5 border-b border-gray-100">
              <div className="bg-blue-50 rounded-xl p-3 text-center">
                <p className="text-xs text-gray-500">最新價格</p>
                <p className="text-base font-bold text-blue-700 mt-0.5">
                  {selected.latest_price ? formatRupiah(selected.latest_price) : '—'}
                </p>
              </div>
              <div className="bg-gray-50 rounded-xl p-3 text-center">
                <p className="text-xs text-gray-500">最低價</p>
                <p className="text-base font-bold text-green-700 mt-0.5">
                  {formatRupiah(Math.min(...selected.history.map(h => h.price)))}
                </p>
              </div>
              <div className="bg-gray-50 rounded-xl p-3 text-center">
                <p className="text-xs text-gray-500">最高價</p>
                <p className="text-base font-bold text-red-700 mt-0.5">
                  {formatRupiah(Math.max(...selected.history.map(h => h.price)))}
                </p>
              </div>
            </div>

            {selected.history.length >= 2 && (
              <div className="p-5 border-b border-gray-100">
                <p className="text-sm font-semibold text-gray-700 mb-3">價格走勢</p>
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={selected.history}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis
                      dataKey="date"
                      tickFormatter={d => {
                        try { return format(new Date(d), 'MMM yy') } catch { return d }
                      }}
                      tick={{ fontSize: 11 }}
                    />
                    <YAxis
                      tickFormatter={v => {
                        if (v >= 1000000) return `${(v/1000000).toFixed(1)}M`
                        if (v >= 1000) return `${(v/1000).toFixed(0)}K`
                        return v.toString()
                      }}
                      tick={{ fontSize: 11 }}
                    />
                    <Tooltip
                      formatter={(v: any) => [formatRupiah(v), 'Harga']}
                      labelFormatter={d => { try { return format(new Date(d), 'dd MMM yyyy') } catch { return d } }}
                    />
                    <Line type="monotone" dataKey="price" stroke="#2563eb" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}

            <div className="p-5">
              <p className="text-sm font-semibold text-gray-700 mb-3">採購記錄 ({selected.history.length})</p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100">
                      <th className="text-left text-xs text-gray-500 pb-2">日期</th>
                      <th className="text-right text-xs text-gray-500 pb-2">單價 (incl PPN)</th>
                      <th className="text-right text-xs text-gray-500 pb-2">數量</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...selected.history].reverse().map((h, i) => {
                      const prev = selected.history[selected.history.length - 2 - i]
                      const change = prev ? ((h.price - prev.price) / prev.price) * 100 : 0
                      return (
                        <tr key={i} className="border-b border-gray-50">
                          <td className="py-2 text-gray-700">
                            {h.date ? format(new Date(h.date), 'dd MMM yyyy') : '—'}
                          </td>
                          <td className="py-2 text-right font-medium text-gray-900">
                            {formatRupiah(h.price)}
                            {Math.abs(change) > 0.5 && (
                              <span className={`ml-1.5 text-xs ${change > 0 ? 'text-red-500' : 'text-green-500'}`}>
                                {change > 0 ? '+' : ''}{change.toFixed(1)}%
                              </span>
                            )}
                          </td>
                          <td className="py-2 text-right text-gray-500">{h.qty ?? '—'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-center py-16 text-gray-400">
          <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2" />
          <p className="text-sm">載入中...</p>
        </div>
      ) : materials.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p>找不到符合的原物料</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {materials.map(m => (
            <button
              key={m.code_bb}
              onClick={() => setSelected(m)}
              className="bg-white rounded-xl border border-gray-200 p-4 text-left hover:border-blue-300 hover:shadow-sm transition-all"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-mono text-xs bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded font-semibold shrink-0">{m.code_bb}</span>
                    <TrendIcon pct={m.trend_pct} />
                    <TrendBadge pct={m.trend_pct} />
                  </div>
                  <p className="text-sm font-semibold text-gray-900 truncate">{m.item_name || m.code_bb}</p>
                  <p className="text-xs text-gray-500 truncate">{m.supplier}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-bold text-blue-700">
                    {m.latest_price ? formatRupiah(m.latest_price) : '—'}
                  </p>
                  <p className="text-xs text-gray-400">{m.history.length} 筆記錄</p>
                </div>
              </div>

              {m.history.length >= 3 && (
                <div className="mt-3 h-12">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={m.history.slice(-8)}>
                      <Line type="monotone" dataKey="price" stroke="#2563eb" strokeWidth={1.5} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
