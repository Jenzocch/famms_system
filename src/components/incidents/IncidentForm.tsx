'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import imageCompression from 'browser-image-compression'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { toast } from 'sonner'
import { Loader2, Camera, X, ZoomIn } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import { logAuditEvent } from '@/lib/audit'

interface Factory { id: string; name: string; code: string }
interface Area { id: string; factory_id: string; name: string }
interface Asset { id: string; area_id: string; machine_name: string; machine_code: string | null }
interface IssueType { value: string; label: string }

// Fallback list used if the incident_types table is empty/unavailable.
const DEFAULT_ISSUE_TYPES: IssueType[] = [
  { value: 'machine', label: '🔧 機器故障' },
  { value: 'pipe', label: '🚿 水管/管線' },
  { value: 'electrical', label: '💡 電力/照明' },
  { value: 'facility', label: '🏭 設施/基礎建設' },
  { value: 'safety', label: '⚠️ 安全問題' },
  { value: 'cleanliness', label: '🧹 衛生/清潔' },
  { value: 'other', label: '📋 其他' },
]

const URGENCY = [
  { value: 'critical', labelKey: 'report.urgencyCritical', descKey: 'report.urgencyCriticalDesc' },
  { value: 'high', labelKey: 'report.urgencyHigh', descKey: 'report.urgencyHighDesc' },
  { value: 'medium', labelKey: 'report.urgencyMedium', descKey: 'report.urgencyMediumDesc' },
  { value: 'low', labelKey: 'report.urgencyLow', descKey: 'report.urgencyLowDesc' },
]

export default function IncidentForm() {
  const router = useRouter()
  const supabase = createClient()
  const { t } = useI18n()

  const [factories, setFactories] = useState<Factory[]>([])
  const [areas, setAreas] = useState<Area[]>([])
  const [assets, setAssets] = useState<Asset[]>([])

  const [issueTypes, setIssueTypes] = useState<IssueType[]>(DEFAULT_ISSUE_TYPES)
  const [factoryId, setFactoryId] = useState('')
  const [areaId, setAreaId] = useState('')
  const [assetId, setAssetId] = useState('')
  const [issueType, setIssueType] = useState('machine')
  const [customType, setCustomType] = useState('')
  const [urgency, setUrgency] = useState('medium')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [reporterName, setReporterName] = useState('')
  const [photos, setPhotos] = useState<File[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [compressing, setCompressing] = useState(false)

  useEffect(() => {
    supabase.from('factories').select('*').order('name').then(({ data }) => setFactories(data ?? []))
    // Load manageable issue types; keep defaults if table is empty/unavailable.
    supabase.from('incident_types').select('code, label').eq('is_active', true)
      .order('sort_order').then(({ data }) => {
        if (data && data.length > 0) {
          // De-dupe by code in case the table still has duplicate rows.
          const seen = new Set<string>()
          const unique = data.filter((t: any) => {
            if (seen.has(t.code)) return false
            seen.add(t.code)
            return true
          })
          setIssueTypes(unique.map((t: any) => ({ value: t.code, label: t.label })))
        }
      })
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

  async function addPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    if (files.length === 0) return

    setCompressing(true)
    try {
      const compressed: File[] = []
      for (const file of files) {
        if (!file.type.startsWith('image/')) continue
        const options = {
          maxSizeMB: 1,
          maxWidthOrHeight: 2000,
          useWebWorker: true,
        }
        const compressedFile = await imageCompression(file, options)
        compressed.push(compressedFile)
      }
      setPhotos(prev => [...prev, ...compressed].slice(0, 5))
      toast.success(`壓縮完成（節省 ${Math.round(files.reduce((s, f) => s + f.size, 0) / 1024 / 1024)}MB）`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('report.compressFailed'))
    } finally {
      setCompressing(false)
    }
  }

  async function submit() {
    if (!factoryId || !title.trim() || !description.trim()) {
      toast.error(t('report.fillRequired'))
      return
    }
    if (issueType === 'other' && !customType.trim()) {
      toast.error(t('report.specifyType'))
      return
    }
    // For "other", store the free-text the user typed so it shows on the board.
    const incidentType = issueType === 'other' ? customType.trim() : issueType

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
          incident_type: incidentType,
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

      // Upload photos if any. Best-effort: the incident is already saved, so a
      // storage problem (missing bucket / permissions) must not fail the report.
      if (photos.length > 0) {
        try {
          for (const photo of photos) {
            const ext = photo.name.split('.').pop()
            const path = `${incident.id}/${Date.now()}.${ext}`
            const { error: upErr } = await supabase.storage.from('incident-photos').upload(path, photo)
            if (upErr) throw upErr
          }
        } catch (photoErr) {
          console.error('Photo upload failed:', photoErr)
          toast.warning('案件已建立，但照片上傳失敗')
        }
      }

      // Audit trail: case created
      await logAuditEvent(supabase, {
        userId: user?.id ?? null,
        userName: reporterName || null,
        actionType: 'create',
        resourceType: 'incident',
        resourceId: incident.id,
        newValue: { incident_no, title, incident_type: incidentType },
        changeSummary: `案件已建立：${incident_no}`,
        factoryId: factoryId || undefined,
      })

      // Telegram notify
      await fetch('/api/incidents/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ incidentId: incident.id }),
      }).catch(() => {})

      toast.success(`案件 ${incident_no} 已建立`)
      router.push(`/incidents/${incident.id}`)
    } catch (err) {
      // Supabase errors (PostgrestError / StorageError) are plain objects with
      // a `message`, NOT Error instances — extract it so the real cause shows.
      const msg =
        err instanceof Error ? err.message
        : (err && typeof err === 'object' && 'message' in err) ? String((err as any).message)
        : t('report.submitFailed')
      toast.error(msg)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-gray-900">{t('report.title')}</h1>
        <p className="text-sm text-gray-500 mt-1">{t('report.subtitle')}</p>
      </div>

      {/* Reporter */}
      <div>
        <Label>{t('report.reporterName')}</Label>
        <Input
          value={reporterName}
          onChange={e => setReporterName(e.target.value)}
          placeholder={t('report.reporterPlaceholder')}
          className="mt-1"
        />
      </div>

      {/* Issue Type */}
      <div>
        <Label>{t('report.issueType')} <span className="text-red-500">*</span></Label>
        <div className="grid grid-cols-2 gap-2 mt-1">
          {issueTypes.map(t => (
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
        {issueType === 'other' && (
          <Input
            value={customType}
            onChange={e => setCustomType(e.target.value)}
            placeholder={t('report.otherPlaceholder')}
            className="mt-2"
          />
        )}
      </div>

      {/* Urgency */}
      <div>
        <Label>{t('report.urgency')} <span className="text-red-500">*</span></Label>
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
              <span className="font-medium">{t(u.labelKey)}</span>
              <span className="block text-xs text-gray-500">{t(u.descKey)}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Location */}
      <div className="space-y-3">
        <Label>{t('report.location')}</Label>
        <Select value={factoryId} onValueChange={(v) => setFactoryId(v ?? '')} items={Object.fromEntries(factories.map(f => [f.id, f.name]))}>
          <SelectTrigger><SelectValue placeholder={t('report.selectFactory')} /></SelectTrigger>
          <SelectContent>
            {factories.map(f => (
              <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {areas.length > 0 && (
          <Select value={areaId} onValueChange={(v) => setAreaId(v ?? '')} items={Object.fromEntries(areas.map(a => [a.id, a.name]))}>
            <SelectTrigger><SelectValue placeholder={t('report.selectArea')} /></SelectTrigger>
            <SelectContent>
              {areas.map(a => (
                <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {assets.length > 0 && (
          <Select value={assetId} onValueChange={(v) => setAssetId(v ?? '')} items={Object.fromEntries(assets.map(a => [a.id, `${a.machine_code ? `[${a.machine_code}] ` : ''}${a.machine_name}`]))}>
            <SelectTrigger><SelectValue placeholder={t('report.selectMachine')} /></SelectTrigger>
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
        <Label>{t('report.problemTitle')} <span className="text-red-500">*</span></Label>
        <Input
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder={t('report.titlePlaceholder')}
          className="mt-1"
        />
      </div>

      {/* Description */}
      <div>
        <Label>{t('report.problemDesc')} <span className="text-red-500">*</span></Label>
        <Textarea
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder={t('report.descPlaceholder')}
          className="mt-1"
          rows={4}
        />
      </div>

      {/* Photos */}
      <div>
        <Label>{t('report.photos')}</Label>
        <div className="mt-1 space-y-2">
          {photos.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {photos.map((p, i) => (
                <div key={i} className="relative group">
                  <img
                    src={URL.createObjectURL(p)}
                    alt=""
                    className="w-24 h-24 object-cover rounded-lg border border-gray-200 group-hover:opacity-80 transition-opacity"
                  />
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/0 group-hover:bg-black/40 rounded-lg transition-all">
                    <ZoomIn className="w-5 h-5 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                    <span className="text-xs text-white opacity-0 group-hover:opacity-100 mt-1 transition-opacity">
                      {(p.size / 1024).toFixed(0)} KB
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setPhotos(prev => prev.filter((_, j) => j !== i))}
                    className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center shadow-lg hover:bg-red-600 transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
          {photos.length < 5 && (
            <label className={`flex items-center gap-2 border-2 border-dashed rounded-lg p-4 cursor-pointer transition-colors ${
              compressing ? 'border-blue-300 bg-blue-50' : 'border-gray-300 hover:border-blue-400'
            }`}>
              <Camera className="w-5 h-5 text-gray-400" />
              <div className="flex-1 text-sm">
                <span className="text-gray-500">
                  {compressing ? t('report.compressing') : t('report.takePhoto')}
                </span>
              </div>
              <input
                type="file"
                accept="image/*"
                multiple
                capture="environment"
                onChange={addPhoto}
                disabled={compressing}
                className="hidden"
              />
            </label>
          )}
          {photos.length > 0 && (
            <p className="text-xs text-gray-400 mt-2">
              共 {photos.length} 張（{(photos.reduce((s, f) => s + f.size, 0) / 1024 / 1024).toFixed(1)} MB）
            </p>
          )}
        </div>
      </div>

      <Button onClick={submit} disabled={submitting} className="w-full h-12 text-base">
        {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
        {t('report.submit')}
      </Button>
    </div>
  )
}
