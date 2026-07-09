'use client'

import { useState } from 'react'
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
import { Loader2 } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import { deadlineFromUrgency } from '@/lib/incident-display'
import { useIncidentTypes } from '@/lib/useIncidentTypes'
import { useIncidentTypeLabel } from '@/lib/incident-type-label'
import { useReportLocation } from '@/lib/hooks/useReportLocation'
import { useReporterAccounts } from '@/lib/hooks/useReporterAccounts'
import { usePhotoCapture } from '@/lib/hooks/usePhotoCapture'
import { submitIncidentReport } from '@/lib/incidents/submitIncidentReport'
import ReportLocationFields from './report/ReportLocationFields'
import ReportPhotoPicker from './report/ReportPhotoPicker'

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

// Three urgency levels (mapped to impact codes A / C / D). "High" (B) is
// retired from the picker but still renders for any legacy incident that has it.
const URGENCY = [
  { value: 'critical', labelKey: 'report.urgencyCritical', descKey: 'report.urgencyCriticalDesc' },
  { value: 'medium', labelKey: 'report.urgencyMedium', descKey: 'report.urgencyMediumDesc' },
  { value: 'low', labelKey: 'report.urgencyLow', descKey: 'report.urgencyLowDesc' },
]

export default function IncidentForm({ presetMachineId }: { presetMachineId?: string } = {}) {
  const router = useRouter()
  const supabase = createClient()
  const { t } = useI18n()

  const location = useReportLocation(presetMachineId)
  const reporter = useReporterAccounts()
  const photoCapture = usePhotoCapture(5)

  const { types: cachedTypes } = useIncidentTypes()
  const typeLabel = useIncidentTypeLabel()
  // Use shared cache when populated; otherwise the built-in defaults. Labels
  // follow the active app language.
  const issueTypes: IssueType[] = cachedTypes.length > 0
    ? cachedTypes.map(ct => ({ value: ct.code, label: typeLabel(ct.code) }))
    : DEFAULT_ISSUE_TYPES

  const [locationNote, setLocationNote] = useState('')
  const [issueType, setIssueType] = useState('machine')
  const [customType, setCustomType] = useState('')
  const [urgency, setUrgency] = useState('medium')
  const [dueDate, setDueDate] = useState('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [submitting, setSubmitting] = useState(false)
  // Generated ONCE per form instance (not per submit attempt) so that a retry
  // after a flaky-signal timeout — user hits submit again because it looked
  // like it failed — is recognized as the same report instead of creating a
  // duplicate incident. See submitIncidentReport's idempotency check.
  const [clientRequestId] = useState(() => crypto.randomUUID())

  async function submit() {
    if (!location.factoryId || !title.trim() || !description.trim()) {
      toast.error(t('report.fillRequired'))
      return
    }
    if (issueType === 'other' && !customType.trim()) {
      toast.error(t('report.specifyType'))
      return
    }
    // For "other", store the free-text the user typed so it shows on the board.
    const incidentType = issueType === 'other' ? customType.trim() : issueType

    // Deadline = manual pick if given, else auto-derived from urgency (SLA).
    const impactCode = urgency === 'critical' ? 'A' : urgency === 'medium' ? 'C' : 'D'
    const computedDueDate = dueDate || deadlineFromUrgency(impactCode)

    setSubmitting(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const { incident_no, id, photoUploadFailed } = await submitIncidentReport(supabase, {
        factoryId: location.factoryId,
        incidentType,
        machineId: location.assetId || null,
        title,
        description,
        reporterName: reporter.reporterName,
        impactCode,
        dueDate: computedDueDate,
        locationNote,
        photos: photoCapture.photos,
        userId: user?.id ?? null,
        clientRequestId,
      })

      if (photoUploadFailed) toast.warning('工單已建立，但照片上傳失敗')
      location.rememberLocation()
      toast.success(`工單 ${incident_no} 已建立`)
      router.push(`/incidents/${id}`)
    } catch (err) {
      // Supabase errors (PostgrestError / StorageError) are plain objects with
      // a `message`, NOT Error instances — extract it so the real cause shows.
      const msg =
        err instanceof Error ? err.message
        : (err && typeof err === 'object' && 'message' in err) ? String((err as { message: unknown }).message)
        : t('report.submitFailed')
      toast.error(msg)
    } finally {
      setSubmitting(false)
    }
  }

  const submitDisabled =
    submitting || !location.factoryId || !title.trim() || !description.trim() ||
    (issueType === 'other' && !customType.trim())

  return (
    // Extra bottom padding on phone clears the fixed submit bar (which itself
    // sits above BottomNav) — see the fixed bar below. Not needed on desktop,
    // where submit is inline.
    <div className="space-y-5 lg:space-y-6 pb-24 lg:pb-0">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{t('report.title')}</h1>
        <p className="text-base text-gray-500 mt-1">{t('report.subtitle')}</p>
      </div>

      {/* Two-column on desktop so the form uses the horizontal space instead of
          a single narrow stack. On phone the two column divs simply stack
          full-width one after another, which is exactly the intended reading
          order: reporter → ①location → ②issue text → photos → ③urgency. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 lg:gap-x-6 gap-y-5 lg:items-start">
      {/* ---- Left column (desktop) / top of page (phone) ---- */}
      <div className="space-y-5">
      {/* Reporter — compact, sits above the numbered sections */}
      <div>
        <Label className="text-sm">{t('report.reporterName')}</Label>
        {reporter.accounts.length > 0 && (
          <Select
            value={reporter.reporterAccountId}
            onValueChange={(v) => {
              const id = v ?? ''
              reporter.setReporterAccountId(id)
              const a = reporter.accounts.find(x => x.id === id)
              if (a) reporter.setReporterName(a.full_name || '')
            }}
            items={Object.fromEntries(reporter.accounts.map(a => [a.id, a.full_name || t('report.unnamedAccount', '(未命名帳號)')]))}
          >
            <SelectTrigger className="mt-1">
              <SelectValue placeholder={t('report.selectReporter', '選擇帳號（或手動填寫）')} />
            </SelectTrigger>
            <SelectContent>
              {reporter.accounts.map(a => (
                <SelectItem key={a.id} value={a.id}>{a.full_name || t('report.unnamedAccount', '(未命名帳號)')}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Input
          value={reporter.reporterName}
          onChange={e => {
            reporter.setReporterName(e.target.value)
            // Typing manually clears the linked account selection.
            if (reporter.reporterAccountId) reporter.setReporterAccountId('')
          }}
          placeholder={t('report.reporterPlaceholder')}
          className="mt-1.5"
        />
      </div>

      {/* ① Where */}
      <div>
        <SectionHeader number={1} title={t('report.sectionLocation', '在哪裡')} />
        <ReportLocationFields
          factories={location.factories}
          areas={location.areas}
          assets={location.assets}
          factoryId={location.factoryId}
          setFactoryId={location.setFactoryId}
          areaId={location.areaId}
          setAreaId={location.setAreaId}
          assetId={location.assetId}
          setAssetId={location.setAssetId}
          locationNote={locationNote}
          setLocationNote={setLocationNote}
        />
      </div>

      {/* ② What's wrong — text parts. Photos are grouped with this section on
          phone (they render immediately after, with no header in between,
          since the two-column divs stack seamlessly) but move to the right
          column on desktop. */}
      <div className="space-y-4">
        <SectionHeader number={2} title={t('report.sectionIssue', '什麼問題')} />

        <div>
          <Label className="text-base">{t('report.issueType')} <span className="text-red-500">*</span></Label>
          <div className="grid grid-cols-2 gap-2 mt-1">
            {issueTypes.map(it => (
              <button
                key={it.value}
                type="button"
                onClick={() => setIssueType(it.value)}
                className={`text-left rounded-lg border px-3 py-2.5 text-base font-medium transition-colors ${
                  issueType === it.value
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-gray-200 bg-white text-gray-700'
                }`}
              >
                {it.label}
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

        <div>
          <Label className="text-base">{t('report.problemTitle')} <span className="text-red-500">*</span></Label>
          <Input
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder={t('report.titlePlaceholder')}
            className="mt-1"
          />
        </div>

        <div>
          <Label className="text-base">{t('report.problemDesc')} <span className="text-red-500">*</span></Label>
          <Textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder={t('report.descPlaceholder')}
            className="mt-1"
            rows={4}
          />
        </div>
      </div>
      </div>
      {/* ---- Right column (desktop) / continues down the page (phone) ---- */}
      <div className="space-y-5">

      {/* Photos — big obvious tap target, see ReportPhotoPicker */}
      <ReportPhotoPicker
        photos={photoCapture.photos}
        photoPreviews={photoCapture.photoPreviews}
        compressing={photoCapture.compressing}
        maxPhotos={5}
        onAddPhotos={photoCapture.addPhotos}
        onRemovePhoto={photoCapture.removePhoto}
      />

      {/* ③ How urgent */}
      <div>
        <SectionHeader number={3} title={t('report.sectionUrgency', '有多急')} />
        <div className="grid grid-cols-3 gap-1.5 mt-1">
          {URGENCY.map(u => (
            <button
              key={u.value}
              type="button"
              onClick={() => setUrgency(u.value)}
              className={`rounded-lg border px-2 py-2 text-left transition-colors ${
                urgency === u.value
                  ? 'border-blue-500 bg-blue-50 text-blue-700'
                  : 'border-gray-200 bg-white text-gray-700'
              }`}
            >
              <span className="text-xs font-semibold block">{t(u.labelKey)}</span>
              <span className="text-xs text-gray-400 block mt-0.5 leading-tight">{t(u.descKey)}</span>
            </button>
          ))}
        </div>

        {/* Deadline — advanced/optional. Collapsed by default so new users
            aren't distracted: leaving it empty auto-derives the date from
            urgency. */}
        <details className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 mt-3">
          <summary className="text-sm text-gray-600 cursor-pointer select-none">
            {t('report.advancedOptions', '進階選項（截止日，可不填）')}
          </summary>
          <div className="mt-2">
            <Label className="text-sm">{t('report.dueDate', '截止日')}</Label>
            <Input
              type="date"
              value={dueDate}
              onChange={e => setDueDate(e.target.value)}
              className="mt-1"
            />
            <p className="text-xs text-gray-400 mt-1">
              {t('report.dueDateHint', '留空則依緊急程度自動計算（緊急=當天、高=1天、中=3天、低=7天）')}
            </p>
          </div>
        </details>
      </div>

      {/* Submit — inline on desktop only; phone uses the fixed bottom bar below */}
      <Button
        onClick={submit}
        disabled={submitDisabled}
        className="hidden lg:flex w-full h-12 text-base"
      >
        {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
        {t('report.submit')}
      </Button>
      </div>
      {/* ---- End two-column grid ---- */}
      </div>

      {/* Sticky submit bar (phone only) — pinned just above BottomNav (h-16)
          so it's always reachable without scrolling back up. z-40 keeps it
          below BottomNav's z-50 in case of any visual overlap. */}
      <div className="lg:hidden fixed inset-x-0 bottom-16 z-40 border-t border-gray-200 bg-white/95 backdrop-blur px-4 py-3 safe-area-bottom">
        <div className="max-w-lg mx-auto">
          <Button
            onClick={submit}
            disabled={submitDisabled}
            className="w-full h-12 text-base"
          >
            {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {t('report.submit')}
          </Button>
        </div>
      </div>
    </div>
  )
}

// Big numbered circle + short title — lets non-technical staff scanning the
// page on a phone always know which of the three chunks they're in.
function SectionHeader({ number, title }: { number: number; title: string }) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <span className="flex items-center justify-center w-7 h-7 rounded-full bg-blue-600 text-white text-sm font-bold shrink-0">
        {number}
      </span>
      <h2 className="text-base font-bold text-gray-900">
        {title} <span className="text-red-500">*</span>
      </h2>
    </div>
  )
}
