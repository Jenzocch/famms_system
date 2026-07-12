'use client'

import { useRouter } from 'next/navigation'
import { Printer, FileSpreadsheet, ChevronLeft, ChevronRight, BarChart3 } from 'lucide-react'
import * as XLSX from 'xlsx'
import { Button } from '@/components/ui/button'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { useI18n } from '@/lib/i18n'
import { useIncidentTypeLabel } from '@/lib/incident-type-label'

export interface ReportIncidentRow {
  id: string
  incident_no: string
  title: string | null
  incident_type: string
  status: string
  downtime_impact: 'A' | 'B' | 'C' | 'D'
  reported_at: string
  accepted_at: string | null
  closed_at: string | null
  factory_id: string | null
  machine?: { machine_name: string; machine_code: string | null } | null
  factory?: { name: string } | null
}

export interface ReportData {
  month: string
  factoryId: string // 'all' or uuid
  factories: { id: string; name: string }[]
  totals: {
    incidents: number
    closed: number
    open: number
    urgent: number
    responseMinutes: number | null
    resolutionHours: number | null
    adhocJobs: number
    pmScheduled: number
    pmCompleted: number
    pmSkipped: number
  }
  byType: [string, number][]
  byMachine: [string, number][]
  costs: Record<string, number>
  incidents: ReportIncidentRow[]
  // True when any underlying query hit its row cap — the numbers on screen
  // would silently undercount without a warning.
  truncated?: boolean
}

function shiftMonth(month: string, delta: number): string {
  const d = new Date(`${month}-01T00:00:00.000Z`)
  d.setUTCMonth(d.getUTCMonth() + delta)
  return d.toISOString().slice(0, 7)
}

const COST_TYPE_KEYS: Record<string, string> = {
  labor: 'reports.costLabor',
  parts: 'reports.costParts',
  vendor: 'reports.costVendor',
}

export default function MonthlyReport({ data }: { data: ReportData }) {
  const { t } = useI18n()
  const router = useRouter()
  const typeLabel = useIncidentTypeLabel()
  const { totals } = data

  const nav = (month: string, factory: string) =>
    router.push(`/reports?month=${month}&factory=${factory}`)

  const pmCompliance = totals.pmScheduled > 0
    ? Math.round((totals.pmCompleted / totals.pmScheduled) * 100)
    : null

  const costTotal = Object.values(data.costs).reduce((a, b) => a + b, 0)
  const factoryName = data.factoryId === 'all'
    ? t('reports.allFactories', '全部工廠')
    : data.factories.find(f => f.id === data.factoryId)?.name ?? ''

  function exportExcel() {
    const wb = XLSX.utils.book_new()

    const summary = [
      [t('reports.title', '月報'), `${data.month}`, factoryName],
      [],
      [t('reports.total', '總件數'), totals.incidents],
      [t('reports.closed', '已結案'), totals.closed],
      [t('reports.stillOpen', '未結案'), totals.open],
      [t('reports.urgent', '緊急件'), totals.urgent],
      [t('reports.avgResponseMin', '平均回應（分鐘）'), totals.responseMinutes?.toFixed(0) ?? '-'],
      [t('reports.avgResolutionHr', '平均結案（小時）'), totals.resolutionHours?.toFixed(1) ?? '-'],
      [t('reports.pmScheduled', 'PM 排定'), totals.pmScheduled],
      [t('reports.pmCompleted', 'PM 完成'), totals.pmCompleted],
      [t('reports.pmCompliance', 'PM 完成率'), pmCompliance !== null ? `${pmCompliance}%` : '-'],
      [t('reports.adhoc', '臨時維修'), totals.adhocJobs],
      [t('reports.costTotal', '費用合計'), costTotal || '-'],
    ]
    wb.SheetNames.push('Summary')
    wb.Sheets['Summary'] = XLSX.utils.aoa_to_sheet(summary)

    const rows = data.incidents.map(i => ({
      No: i.incident_no,
      [t('reports.colTitle', '標題')]: i.title ?? '',
      [t('reports.colType', '類型')]: typeLabel(i.incident_type),
      [t('reports.colStatus', '狀態')]: t(`boardStatus.${i.status}`, i.status),
      [t('reports.colUrgency', '緊急度')]: i.downtime_impact,
      [t('reports.colMachine', '設備')]: i.machine
        ? `${i.machine.machine_code ? `[${i.machine.machine_code}] ` : ''}${i.machine.machine_name}`
        : '',
      [t('reports.colFactory', '工廠')]: i.factory?.name ?? '',
      [t('reports.colReported', '回報時間')]: i.reported_at.slice(0, 16).replace('T', ' '),
      [t('reports.colClosed', '結案時間')]: i.closed_at ? i.closed_at.slice(0, 16).replace('T', ' ') : '',
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    XLSX.utils.book_append_sheet(wb, ws, 'Incidents')

    XLSX.writeFile(wb, `FAMMS-report-${data.month}.xlsx`)
  }

  return (
    <div className="space-y-5 print:space-y-3">
      {data.truncated && (
        <div className="bg-amber-50 border border-amber-200 text-amber-900 text-sm rounded-lg px-3 py-2">
          {t('reports.truncated', '⚠️ 本月資料量超過統計上限，以下數字可能少算，請縮小範圍（選單一工廠）後重看。')}
        </div>
      )}
      {/* Header + controls (controls hidden when printing) */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <BarChart3 className="w-5 h-5 print:hidden" />
            {t('reports.title', '月報')} — {data.month}
          </h1>
          <p className="text-sm text-gray-500 mt-1">{factoryName}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" aria-label="prev"
              onClick={() => nav(shiftMonth(data.month, -1), data.factoryId)}>
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <span className="text-sm font-medium px-1">{data.month}</span>
            <Button variant="outline" size="sm" aria-label="next"
              onClick={() => nav(shiftMonth(data.month, 1), data.factoryId)}>
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
          <Select
            value={data.factoryId}
            onValueChange={(v) => nav(data.month, v ?? 'all')}
            items={{ all: t('reports.allFactories', '全部工廠'), ...Object.fromEntries(data.factories.map(f => [f.id, f.name])) }}
          >
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('reports.allFactories', '全部工廠')}</SelectItem>
              {data.factories.map(f => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={() => window.print()} className="gap-1.5">
            <Printer className="w-4 h-4" /> {t('reports.print', '列印')}
          </Button>
          <Button size="sm" onClick={exportExcel} className="gap-1.5">
            <FileSpreadsheet className="w-4 h-4" /> Excel
          </Button>
        </div>
      </div>

      {/* Incident summary tiles */}
      <section>
        <h2 className="font-semibold text-gray-700 text-sm mb-2">{t('reports.incidentsSummary', '報修統計')}</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Tile label={t('reports.total', '總件數')} value={String(totals.incidents)} color="text-blue-600" />
          <Tile label={t('reports.closed', '已結案')} value={String(totals.closed)} color="text-green-600" />
          <Tile label={t('reports.stillOpen', '未結案')} value={String(totals.open)} color="text-amber-600" />
          <Tile label={t('reports.urgent', '緊急件')} value={String(totals.urgent)} color="text-red-600" />
          <Tile
            label={t('reports.avgResponse', '平均回應')}
            value={totals.responseMinutes !== null ? `${totals.responseMinutes.toFixed(0)} ${t('reports.minutes', '分')}` : '—'}
            color="text-gray-800"
          />
          <Tile
            label={t('reports.avgResolution', '平均結案')}
            value={totals.resolutionHours !== null ? `${totals.resolutionHours.toFixed(1)} ${t('reports.hours', '小時')}` : '—'}
            color="text-gray-800"
          />
          <Tile
            label={t('reports.pmCompliance', 'PM 完成率')}
            value={pmCompliance !== null ? `${pmCompliance}%` : '—'}
            color={pmCompliance !== null && pmCompliance < 80 ? 'text-red-600' : 'text-green-600'}
          />
          <Tile label={t('reports.adhoc', '臨時維修')} value={String(totals.adhocJobs)} color="text-gray-800" />
        </div>
      </section>

      {/* PM detail */}
      <section>
        <h2 className="font-semibold text-gray-700 text-sm mb-2">{t('reports.pmSection', '保養執行')}</h2>
        <div className="bg-white rounded-xl border border-gray-200 p-3 text-sm text-gray-700 flex flex-wrap gap-x-6 gap-y-1">
          <span>{t('reports.pmScheduled', '排定')}: <b>{totals.pmScheduled}</b></span>
          <span>{t('reports.pmCompleted', '完成')}: <b className="text-green-700">{totals.pmCompleted}</b></span>
          <span>{t('reports.pmSkipped', '跳過')}: <b className="text-gray-500">{totals.pmSkipped}</b></span>
          <span>{t('reports.pmCompliance', '完成率')}: <b>{pmCompliance !== null ? `${pmCompliance}%` : '—'}</b></span>
        </div>
      </section>

      {/* Costs */}
      <section>
        <h2 className="font-semibold text-gray-700 text-sm mb-2">{t('reports.costs', '維修費用')}</h2>
        {costTotal === 0 ? (
          <p className="text-sm text-gray-400 bg-white rounded-xl border border-gray-200 p-3">
            {t('reports.noCosts', '本月尚無費用記錄（結案時可填工時/零件費）')}
          </p>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 p-3 text-sm text-gray-700 flex flex-wrap gap-x-6 gap-y-1">
            {Object.entries(data.costs).map(([type, amount]) => (
              <span key={type}>
                {t(COST_TYPE_KEYS[type] ?? '', type)}: <b>{amount.toLocaleString()}</b>
              </span>
            ))}
            <span>{t('reports.costTotal', '合計')}: <b className="text-blue-700">{costTotal.toLocaleString()}</b></span>
          </div>
        )}
      </section>

      {/* Distributions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 print:grid-cols-2">
        <section>
          <h2 className="font-semibold text-gray-700 text-sm mb-2">{t('reports.byType', '問題類型分布')}</h2>
          <RankTable rows={data.byType.map(([k, v]) => [typeLabel(k), v])} total={totals.incidents}
            empty={t('reports.noData', '本月無資料')} />
        </section>
        <section>
          <h2 className="font-semibold text-gray-700 text-sm mb-2">{t('reports.topMachines', '故障最多設備')}</h2>
          <RankTable rows={data.byMachine} total={totals.incidents}
            empty={t('reports.noData', '本月無資料')} />
        </section>
      </div>
    </div>
  )
}

function Tile({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-3 text-center">
      <p className={`text-xl font-bold ${color}`}>{value}</p>
      <p className="text-xs text-gray-500 mt-0.5">{label}</p>
    </div>
  )
}

function RankTable({ rows, total, empty }: { rows: [string, number][]; total: number; empty: string }) {
  if (rows.length === 0) {
    return <p className="text-sm text-gray-400 bg-white rounded-xl border border-gray-200 p-3">{empty}</p>
  }
  const max = rows[0]?.[1] ?? 1
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-3 space-y-2">
      {rows.map(([label, count]) => (
        <div key={label} className="flex items-center gap-2 text-sm">
          <span className="flex-1 truncate text-gray-700">{label}</span>
          <div className="w-24 h-2 rounded bg-gray-100 overflow-hidden shrink-0">
            <div className="h-full bg-blue-500" style={{ width: `${Math.max(6, (count / max) * 100)}%` }} />
          </div>
          <span className="w-10 text-right font-semibold text-gray-800 shrink-0">{count}</span>
          <span className="w-12 text-right text-xs text-gray-400 shrink-0">
            {total > 0 ? `${Math.round((count / total) * 100)}%` : ''}
          </span>
        </div>
      ))}
    </div>
  )
}
