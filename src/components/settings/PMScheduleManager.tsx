'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from 'sonner'
import { useI18n } from '@/lib/i18n'
import { Loader2, Trash2, Edit2, Calendar, Clock } from 'lucide-react'
import PMScheduleForm from './PMScheduleForm'

interface Schedule {
  id: string
  factory_id: string
  machine_id: string
  pm_type: string
  interval_days: number | null
  description: string | null
  is_active: boolean
  machine?: { machine_name: string; machine_code: string | null }
  factory?: { name: string }
}

// zh fallbacks; rendered through t(pm.cad*) so labels follow app language.
const PM_TYPE_LABELS: Record<string, string> = {
  daily: '每日', weekly: '每週', monthly: '每月', quarterly: '每季',
  half_yearly: '每半年', yearly: '每年', custom: '自訂',
}
const PM_TYPE_KEYS: Record<string, string> = {
  daily: 'pm.cadDaily', weekly: 'pm.cadWeekly', monthly: 'pm.cadMonthly',
  quarterly: 'pm.cadQuarterly', half_yearly: 'pm.cadHalfYearly',
  yearly: 'pm.cadYearly', custom: 'pm.cadCustom',
}

export default function PMScheduleManager() {
  const supabase = createClient()
  const { t } = useI18n()
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('pm_schedules')
      .select(`
        *,
        machine:machines(machine_name, machine_code),
        factory:factories(name)
      `)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
    setSchedules((data ?? []) as Schedule[])
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  async function remove(id: string) {
    setDeleting(id)
    try {
      const { error } = await supabase
        .from('pm_schedules')
        .update({ is_active: false })
        .eq('id', id)
      if (error) throw error
      toast.success(t('common.deleted', '已刪除'))
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.deleteFailed', '刪除失敗'))
    } finally {
      setDeleting(null)
    }
  }

  return (
    <div className="space-y-4">
      <PMScheduleForm onSaved={load} />

      {loading ? (
        <p className="text-sm text-gray-400">{t('common.loading', '載入中…')}</p>
      ) : schedules.length === 0 ? (
        <p className="text-sm text-gray-400">{t('pm.noSchedules', '尚無保養計畫')}</p>
      ) : (
        <div className="space-y-2">
          {schedules.map(s => (
            <div key={s.id} className="bg-white border border-gray-200 rounded-lg p-3 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1">
                  <p className="font-medium text-gray-900">
                    {s.machine?.machine_code ? `[${s.machine.machine_code}] ` : ''}{s.machine?.machine_name}
                  </p>
                  <p className="text-xs text-gray-500">{s.factory?.name}</p>
                </div>
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={deleting === s.id}
                    onClick={() => remove(s.id)}
                    className="text-red-600 hover:text-red-700 hover:bg-red-50"
                  >
                    {deleting === s.id && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    {deleting !== s.id && <Trash2 className="w-3.5 h-3.5" />}
                  </Button>
                </div>
              </div>

              <div className="flex items-center gap-2 text-sm">
                <Calendar className="w-3.5 h-3.5 text-gray-400" />
                <span className="font-medium text-gray-700">{t(PM_TYPE_KEYS[s.pm_type] ?? '', PM_TYPE_LABELS[s.pm_type] || s.pm_type)}</span>
                {s.interval_days && (
                  <>
                    <span className="text-gray-400">·</span>
                    <span className="text-gray-600">{t('pm.cadEveryNDays', '每 {days} 天').replace('{days}', String(s.interval_days))}</span>
                  </>
                )}
              </div>

              {s.description && (
                <p className="text-xs text-gray-600 whitespace-pre-wrap">{s.description}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
