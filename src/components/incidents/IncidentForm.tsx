'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { toast } from 'sonner'
import { Loader2, Camera, X } from 'lucide-react'

interface Factory { id: string; name: string; code: string }
interface Area { id: string; factory_id: string; name: string }
interface Asset { id: string; area_id: string; machine_name: string; machine_code: string | null }

const ISSUE_TYPES = [
  { value: 'machine', label: '🔧 機器故障' },
  { value: 'pipe', label: '🚿 水管/管線' },
  { value: 'electrical', label: '💡 電力/照明' },
  { value: 'facility', label: '🏭 設施/基礎建設' },
  { value: 'safety', label: '⚠️ 安全問題' },
  { value: 'cleanliness', label: '🧹 衛生/清潔' },
  { value: 'other', label: '📋 其他' },
]

const URGENCY = [
  { value: 'critical', label: '🔴 緊急', desc: '生產停線' },
  { value: 'high', label: '🟠 高', desc: '影響生產' },
  { value: 'medium', label: '🟡 中', desc: '部分影響' },
  { value: 'low', label: '🟢 低', desc: '不影響生產' },
]

export default function IncidentForm() {
  const router = useRouter()
  const supabase = createClient()

  const [factories, setFactories] = useState<Factory[]>([])
  const [areas, setAreas] = useState<Area[]>([])
  const [assets, setAssets] = useState<Asset[]>([])

  const [factoryId, setFactoryId] = useState('')
  const [areaId, setAreaId] = useState('')
  const [assetId, setAssetId] = useState('')
  const [issueType, setIssueType] = useState('machine')
  const [urgency, setUrgency] = useState('medium')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [reporterName, setReporterName] = useState('')
  const [photos, setPhotos] = useState<File[]>([])
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    supabase.from('factories').select('*').order('name').then(({ data }) => setFactories(data ?? []))
  }, [])

  useEffect(() => {
    if (!factoryId) { setAreas([]); setAreaId(''); return }
    supabase.from('areas').select('*').eq('factory_id', factoryId).order('name')
      .then(({ data }) => setAreas(data ?? []))
    setAreaId('')
    setAssetId('')
  }, [factoryId])

  useEffect(() => {
    if (!areaId) { setAssets([]); setAssetId(''); return }
    supabase.from('machines').select('id, area_id, machine_name, machine_code')
      .eq('area_id', areaId).neq('status', 'scrapped').order('machine_name')
      .then(({ data }) => setAssets(data ?? []))
    setAssetId('')
  }, [areaId])

  function addPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    setPhotos(prev => [...prev, ...files].slice(0, 5))
  }

  async function submit() {
    if (!factoryId || !title.trim() || !description.trim()) {
      toast.error('請填寫工廠、標題和問題描述')
      return
    }

    setSubmitting(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()

      const now = new Date()
      const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
      const { count } = await supabase
        .from('incidents')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString())
      const seq = String((count ?? 0) + 1).padStart(3, '0')
      const incident_no = `FIT-${ym}-${seq}`

      const { data: incident, error } = await supabase
        .from('incidents')
        .insert({
          factory_id: factoryId,
          incident_type: issueType,
          machine_id: assetId || null,
          incident_no,
          title,
          description,
          reporter_name: reporterName || null,
          downtime_impact: urgency === 'critical' ? 'A' : urgency === 'high' ? 'B' : urgency === 'medium' ? 'C' : 'D',
          status: 'reported',
          reported_by_id: user?.id ?? null,
        })
        .select('*')
        .single()

      if (error) throw error

      // Upload photos if any
      if (photos.length > 0) {
        for (const photo of photos) {
          const ext = photo.name.split('.').pop()
          const path = `${incident.id}/${Date.now()}.${ext}`
          await supabase.storage.from('incident-photos').upload(path, photo)
        }
      }

      // Telegram notify
      await fetch('/api/incidents/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ incidentId: incident.id }),
      }).catch(() => {})

      toast.success(`案件 ${incident_no} 已建立`)
      router.push(`/incidents/${incident.id}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '送出失敗')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-gray-900">回報問題</h1>
        <p className="text-sm text-gray-500 mt-1">現場問題快速回報</p>
      </div>

      {/* Reporter */}
      <div>
        <Label>回報人姓名</Label>
        <Input
          value={reporterName}
          onChange={e => setReporterName(e.target.value)}
          placeholder="您的姓名"
          className="mt-1"
        />
      </div>

      {/* Issue Type */}
      <div>
        <Label>問題類型 <span className="text-red-500">*</span></Label>
        <div className="grid grid-cols-2 gap-2 mt-1">
          {ISSUE_TYPES.map(t => (
            <button
              key={t.value}
              type="button"
              onClick={() => setIssueType(t.value)}
              className={`text-left rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                issueType === t.value
                  ? 'border-blue-500 bg-blue-50 text-blue-700'
                  : 'border-gray-200 bg-white text-gray-700'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Urgency */}
      <div>
        <Label>緊急程度 <span className="text-red-500">*</span></Label>
        <div className="grid grid-cols-2 gap-2 mt-1">
          {URGENCY.map(u => (
            <button
              key={u.value}
              type="button"
              onClick={() => setUrgency(u.value)}
              className={`text-left rounded-lg border px-3 py-2 text-sm transition-colors ${
                urgency === u.value
                  ? 'border-blue-500 bg-blue-50 text-blue-700'
                  : 'border-gray-200 bg-white text-gray-700'
              }`}
            >
              <span className="font-medium">{u.label}</span>
              <span className="block text-xs text-gray-500">{u.desc}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Location */}
      <div className="space-y-3">
        <Label>位置</Label>
        <Select value={factoryId} onValueChange={(v) => setFactoryId(v ?? '')}>
          <SelectTrigger><SelectValue placeholder="選擇工廠 *" /></SelectTrigger>
          <SelectContent>
            {factories.map(f => (
              <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {areas.length > 0 && (
          <Select value={areaId} onValueChange={(v) => setAreaId(v ?? '')}>
            <SelectTrigger><SelectValue placeholder="選擇區域（可選）" /></SelectTrigger>
            <SelectContent>
              {areas.map(a => (
                <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {assets.length > 0 && (
          <Select value={assetId} onValueChange={(v) => setAssetId(v ?? '')}>
            <SelectTrigger><SelectValue placeholder="選擇機器/項目（可選）" /></SelectTrigger>
            <SelectContent>
              {assets.map(a => (
                <SelectItem key={a.id} value={a.id}>
                  {a.machine_code ? `[${a.machine_code}] ` : ''}{a.machine_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Title */}
      <div>
        <Label>問題標題 <span className="text-red-500">*</span></Label>
        <Input
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="簡短描述，如：充填機漏水"
          className="mt-1"
        />
      </div>

      {/* Description */}
      <div>
        <Label>問題描述 <span className="text-red-500">*</span></Label>
        <Textarea
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="詳細描述：問題發生位置、狀況、何時開始..."
          className="mt-1"
          rows={4}
        />
      </div>

      {/* Photos */}
      <div>
        <Label>現場照片（最多 5 張）</Label>
        <div className="mt-1 space-y-2">
          {photos.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {photos.map((p, i) => (
                <div key={i} className="relative">
                  <img
                    src={URL.createObjectURL(p)}
                    alt=""
                    className="w-20 h-20 object-cover rounded-lg border"
                  />
                  <button
                    type="button"
                    onClick={() => setPhotos(prev => prev.filter((_, j) => j !== i))}
                    className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
          {photos.length < 5 && (
            <label className="flex items-center gap-2 border-2 border-dashed border-gray-300 rounded-lg p-3 cursor-pointer hover:border-blue-400">
              <Camera className="w-5 h-5 text-gray-400" />
              <span className="text-sm text-gray-500">拍照或選擇照片</span>
              <input
                type="file"
                accept="image/*"
                multiple
                capture="environment"
                onChange={addPhoto}
                className="hidden"
              />
            </label>
          )}
        </div>
      </div>

      <Button onClick={submit} disabled={submitting} className="w-full h-12 text-base">
        {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
        送出回報
      </Button>
    </div>
  )
}
