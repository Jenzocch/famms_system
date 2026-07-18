'use client'

import { useI18n } from '@/lib/i18n'

// Three at-a-glance reliability/cost tiles for the machine detail page:
// 12-month failure count, MTBF (mean time between failures), and cumulative
// maintenance spend. A client component (unlike the surrounding server page)
// purely so it can call useI18n() — the page itself computes the numbers
// server-side and passes them down as plain props.
export default function MachineStatsStrip({
  failureCount12mo,
  mtbfDays,
  totalCost,
}: {
  failureCount12mo: number
  mtbfDays: number | null
  totalCost: number
}) {
  const { t } = useI18n()

  return (
    <div className="grid grid-cols-3 gap-3">
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <p className="text-xs font-semibold text-gray-500 uppercase">{t('machines.failures12moLabel', '近12個月故障次數')}</p>
        <p className="text-lg font-semibold text-gray-900 mt-1">
          {t('machines.failuresValue', '{n} 次').replace('{n}', String(failureCount12mo))}
        </p>
      </div>
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <p className="text-xs font-semibold text-gray-500 uppercase">{t('machines.mtbfLabel', 'MTBF（平均故障間隔天數）')}</p>
        <p className="text-lg font-semibold text-gray-900 mt-1">
          {mtbfDays == null ? '—' : t('machines.mtbfValue', '{n} 天').replace('{n}', String(mtbfDays))}
        </p>
      </div>
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <p className="text-xs font-semibold text-gray-500 uppercase">{t('machines.totalCostLabel', '累計維修成本')}</p>
        <p className="text-lg font-semibold text-gray-900 mt-1">
          Rp {totalCost.toLocaleString('id-ID')}
        </p>
      </div>
    </div>
  )
}
