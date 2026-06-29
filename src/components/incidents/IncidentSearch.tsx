'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import Link from 'next/link'
import { toast } from 'sonner'
import { Download, Search, X, ChevronRight, AlertCircle } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { zhTW } from 'date-fns/locale'
import * as XLSX from 'xlsx'
import type { IncidentStatus } from '@/types'
import { ISSUE_TYPE_LABELS, URGENCY_FROM_IMPACT, STATUS_ZH_COLOR } from '@/lib/incident-display'
import { useI18n } from '@/lib/i18n'

interface Factory { id: string; name: string }
interface Area { id: string; name: string }
interface Machine { id: string; machine_name: string; machine_code: string | null }
interface IncidentRow {
  id: string
  incident_no: string
  status: string
  downtime_impact: 'A' | 'B' | 'C' | 'D'
  incident_type: string
  title: string | null
  reporter_name: string | null
  reported_at: string
  assigned_to: string | null
  machine_id: string | null
  machine?: { machine_code: string | null; machine_name: string }
  factory?: { name: string }
}

interface IncidentSearchProps {
  onResults?: (results: IncidentRow[]) => void
}

export default function IncidentSearch({ onResults }: IncidentSearchProps) {
  const { t } = useI18n()
  const supabase = createClient()
  const typeLabelOf = (key: string, fallback?: string) =>
    t(`issueTypes.${key}`, fallback ?? key ?? t('board.unknown'))
  const statusLabelOf = (key: string) => t(`boardStatus.${key}`, key)

  const [factories, setFactories] = useState<Factory[]>([])
  const [areas, setAreas] = useState<Area[]>([])
  const [machines, setMachines] = useState<Machine[]>([])
  const [results, setResults] = useState<IncidentRow[]>([])
  const [loading, setLoading] = useState(false)
  const [hasSearched, setHasSearched] = useState(false)

  // Filter state
  const [factoryId, setFactoryId] = useState('')
  const [areaId, setAreaId] = useState('')
  const [machineId, setMachineId] = useState('')
  const [incidentType, setIncidentType] = useState('')
  const [status, setStatus] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')

  const STATUSES = [
    'reported', 'accepted', 'analyzing', 'waiting_parts', 'waiting_approval',
    'waiting_vendor', 'waiting_shutdown', 'repairing', 'testing', 'observation', 'closed',
  ]

  useEffect(() => {
    loadFactories()
  }, [])

  useEffect(() => {
    if (!factoryId) { setAreas([]); setAreaId(''); return }
    loadAreas(factoryId)
  }, [factoryId])

  useEffect(() => {
    if (!areaId) { setMachines([]); setMachineId(''); return }
    loadMachines(areaId)
  }, [areaId])

  async function loadFactories() {
    const { data } = await supabase.from('factories').select('*').order('name')
    setFactories(data ?? [])
  }

  async function loadAreas(fId: string) {
    const { data } = await supabase
      .from('areas')
      .select('*')
      .eq('factory_id', fId)
      .order('name')
    setAreas(data ?? [])
  }

  async function loadMachines(aId: string) {
    const { data } = await supabase
      .from('machines')
      .select('id, machine_name, machine_code')
      .eq('area_id', aId)
      .neq('status', 'scrapped')
      .order('machine_name')
    setMachines(data ?? [])
  }

  async function search() {
    setLoading(true)
    try {
      let query = supabase
        .from('incidents')
        .select(`
          id, incident_no, status, downtime_impact, incident_type,
          title, reporter_name, reported_at, assigned_to, machine_id,
          machine:machines(machine_code, machine_name),
          factory:factories(name)
        `)

      if (machineId) query = query.eq('machine_id', machineId)
      if (incidentType) query = query.eq('incident_type', incidentType)
      if (status) query = query.eq('status', status)
      if (startDate) query = query.gte('reported_at', `${startDate}T00:00:00Z`)
      if (endDate) query = query.lte('reported_at', `${endDate}T23:59:59Z`)

      const { data, error } = await query
        .order('reported_at', { ascending: false })
        .limit(500)

      if (error) throw error
      const mapped = (data ?? []).map((d: any) => ({
        id: d.id,
        incident_no: d.incident_no,
        status: d.status,
        downtime_impact: d.downtime_impact,
        incident_type: d.incident_type,
        title: d.title,
        reporter_name: d.reporter_name,
        reported_at: d.reported_at,
        assigned_to: d.assigned_to,
        machine_id: d.machine_id,
        machine: Array.isArray(d.machine) ? d.machine[0] : d.machine,
        factory: Array.isArray(d.factory) ? d.factory[0] : d.factory,
      }))
      setResults(mapped)
      setHasSearched(true)
      if (onResults) onResults(mapped)
      toast.success(t('board.foundCount', `找到 ${mapped.length} 件案件`).replace('{count}', String(mapped.length)))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('board.searchFailed'))
    } finally {
      setLoading(false)
    }
  }

  async function exportToExcel() {
    if (results.length === 0) {
      toast.error(t('board.noDataToExport'))
      return
    }

    try {
      const exportData = results.map(r => {
        const machineDisplay = r.machine
          ? r.machine.machine_code
            ? `[${r.machine.machine_code}] ${r.machine.machine_name}`
            : r.machine.machine_name
          : ''

        return {
          [t('board.colIncidentNo')]: r.incident_no,
          [t('board.colTitle')]: r.title || typeLabelOf(r.incident_type, t('board.problem')),
          [t('board.colType')]: typeLabelOf(r.incident_type, r.incident_type),
          [t('board.colStatus')]: statusLabelOf(r.status),
          [t('board.colUrgency')]: t(`urgency.${r.downtime_impact}`, URGENCY_FROM_IMPACT[r.downtime_impact as any]?.label || r.downtime_impact),
          [t('board.colMachine')]: machineDisplay,
          [t('board.colFactory')]: r.factory?.name || '',
          [t('board.colReporter')]: r.reporter_name || '',
          [t('board.colAssignedTo')]: r.assigned_to || '',
          [t('board.colReportedAt')]: new Date(r.reported_at).toLocaleString('zh-TW'),
        }
      })

      const ws = XLSX.utils.json_to_sheet(exportData)
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, t('board.sheetName'))

      // Auto-size columns
      const columnWidths = [
        { wch: 12 }, // 案件號
        { wch: 20 }, // 標題
        { wch: 15 }, // 類型
        { wch: 12 }, // 狀態
        { wch: 12 }, // 緊急度
        { wch: 25 }, // 機器
        { wch: 15 }, // 工廠
        { wch: 15 }, // 回報者
        { wch: 15 }, // 指派給
        { wch: 20 }, // 回報時間
      ]
      ws['!cols'] = columnWidths

      XLSX.writeFile(wb, `incident-report-${new Date().toISOString().split('T')[0]}.xlsx`)
      toast.success(t('board.excelExported'))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('board.exportFailed'))
    }
  }

  function resetFilters() {
    setFactoryId('')
    setAreaId('')
    setMachineId('')
    setIncidentType('')
    setStatus('')
    setStartDate('')
    setEndDate('')
    setResults([])
    setHasSearched(false)
    if (onResults) onResults([])
  }

  const hasFilters = factoryId || areaId || machineId || incidentType || status || startDate || endDate

  return (
    <div className="space-y-4">
      {/* Search Panel */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-4">
        <div className="flex items-center gap-2 mb-3">
          <Search className="w-4 h-4 text-gray-600" />
          <h3 className="font-semibold text-gray-900">{t('board.searchTitle')}</h3>
        </div>

        <div className="grid grid-cols-1 gap-3">
          {/* Date Range */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">{t('board.startDate')}</Label>
              <Input
                type="date"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                className="mt-1 text-sm"
              />
            </div>
            <div>
              <Label className="text-xs">{t('board.endDate')}</Label>
              <Input
                type="date"
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
                className="mt-1 text-sm"
              />
            </div>
          </div>

          {/* Factory */}
          <div>
            <Label className="text-xs">{t('board.factory')}</Label>
            <Select value={factoryId} onValueChange={(v) => setFactoryId(v ?? '')}>
              <SelectTrigger className="mt-1 text-sm">
                <SelectValue placeholder={t('board.selectFactory')} />
              </SelectTrigger>
              <SelectContent>
                {factories.map(f => (
                  <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Area */}
          {areas.length > 0 && (
            <div>
              <Label className="text-xs">{t('board.area')}</Label>
              <Select value={areaId} onValueChange={(v) => setAreaId(v ?? '')}>
                <SelectTrigger className="mt-1 text-sm">
                  <SelectValue placeholder={t('board.selectArea')} />
                </SelectTrigger>
                <SelectContent>
                  {areas.map(a => (
                    <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Machine */}
          {machines.length > 0 && (
            <div>
              <Label className="text-xs">{t('board.machine')}</Label>
              <Select value={machineId} onValueChange={(v) => setMachineId(v ?? '')}>
                <SelectTrigger className="mt-1 text-sm">
                  <SelectValue placeholder={t('board.selectMachine')} />
                </SelectTrigger>
                <SelectContent>
                  {machines.map(m => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.machine_code ? `[${m.machine_code}] ` : ''}{m.machine_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Incident Type */}
          <div>
            <Label className="text-xs">{t('board.issueType')}</Label>
            <Select value={incidentType} onValueChange={(v) => setIncidentType(v ?? '')}>
              <SelectTrigger className="mt-1 text-sm">
                <SelectValue placeholder={t('board.selectType')} />
              </SelectTrigger>
              <SelectContent>
                {Object.keys(ISSUE_TYPE_LABELS).map((key) => (
                  <SelectItem key={key} value={key}>{typeLabelOf(key)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Status */}
          <div>
            <Label className="text-xs">{t('board.statusLabel')}</Label>
            <Select value={status} onValueChange={(v) => setStatus(v ?? '')}>
              <SelectTrigger className="mt-1 text-sm">
                <SelectValue placeholder={t('board.selectStatus')} />
              </SelectTrigger>
              <SelectContent>
                {STATUSES.map(s => (
                  <SelectItem key={s} value={s}>
                    {statusLabelOf(s)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2 pt-2">
          <Button
            onClick={search}
            disabled={loading}
            className="flex-1 gap-2"
          >
            <Search className="w-4 h-4" />
            {loading ? t('board.searching') : t('board.searchBtn')}
          </Button>
          {hasFilters && (
            <Button
              variant="outline"
              onClick={resetFilters}
              className="gap-2"
            >
              <X className="w-4 h-4" />
              {t('board.reset')}
            </Button>
          )}
        </div>
      </div>

      {/* Results header: count + export */}
      {results.length > 0 && (
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm text-gray-600">
            {t('board.foundCount', `找到 ${results.length} 件案件`)
              .split('{count}')
              .flatMap((part, i) =>
                i === 0
                  ? [part]
                  : [<span key={i} className="font-semibold text-blue-600">{results.length}</span>, part]
              )}
          </p>
          <Button
            onClick={exportToExcel}
            variant="outline"
            size="sm"
            className="gap-2 text-green-600 border-green-300"
          >
            <Download className="w-4 h-4" />
            {t('board.exportExcel')}
          </Button>
        </div>
      )}

      {/* Results list */}
      {results.length > 0 && (
        <div className="space-y-2">
          {results.map(inc => {
            const urgency = URGENCY_FROM_IMPACT[inc.downtime_impact as any]
            const statusLabel = statusLabelOf(inc.status)
            const statusColor = STATUS_ZH_COLOR[inc.status as IncidentStatus] || 'bg-gray-100 text-gray-700'
            const typeLabel = typeLabelOf(inc.incident_type, inc.incident_type)

            return (
              <Link
                key={inc.id}
                href={`/incidents/${inc.id}`}
                className="block bg-white rounded-xl border border-gray-200 p-3 active:bg-gray-50"
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColor}`}>
                    {statusLabel}
                  </span>
                  {urgency && (
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${urgency.color}`}>
                      {t(`urgency.${inc.downtime_impact}`, urgency.label)}
                    </span>
                  )}
                  <span className="text-xs text-gray-400 font-mono ml-auto">{inc.incident_no}</span>
                </div>

                <p className="font-medium text-gray-900 mt-2 line-clamp-1">
                  {inc.title || typeLabel || t('board.problem')}
                </p>

                <div className="flex items-center justify-between mt-1">
                  <p className="text-xs text-gray-500 truncate">
                    {typeLabel}
                    {inc.factory ? ` · ${inc.factory.name}` : ''}
                    {inc.machine ? ` · ${inc.machine.machine_name}` : ''}
                  </p>
                  <ChevronRight className="w-4 h-4 text-gray-300 shrink-0" />
                </div>

                <p className="text-xs text-gray-400 mt-1">
                  {inc.reporter_name ? `${inc.reporter_name} · ` : ''}
                  {formatDistanceToNow(new Date(inc.reported_at), { addSuffix: true, locale: zhTW })}
                </p>
              </Link>
            )
          })}
        </div>
      )}

      {/* Empty state after a search with no matches */}
      {hasSearched && results.length === 0 && !loading && (
        <div className="text-center py-12 text-gray-400">
          <AlertCircle className="w-10 h-10 mx-auto mb-2 opacity-30" />
          <p className="text-sm">{t('board.noMatch')}</p>
        </div>
      )}
    </div>
  )
}
