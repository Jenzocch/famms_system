'use client'

import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { useI18n } from '@/lib/i18n'
import type { ReportFactory, ReportArea, ReportAsset } from '@/lib/hooks/useReportLocation'

// Factory → area → machine cascade + free-text "other location" for the
// incident report form. Controlled entirely by the parent's useReportLocation
// state — this component only renders the pickers.
export default function ReportLocationFields({
  factories, areas, assets, factoryId, setFactoryId, areaId, setAreaId, assetId, setAssetId,
  locationNote, setLocationNote,
}: {
  factories: ReportFactory[]
  areas: ReportArea[]
  assets: ReportAsset[]
  factoryId: string
  setFactoryId: (id: string) => void
  areaId: string
  setAreaId: (id: string) => void
  assetId: string
  setAssetId: (id: string) => void
  locationNote: string
  setLocationNote: (note: string) => void
}) {
  const { t } = useI18n()

  return (
    <div className="space-y-3">
      <Label className="text-base">{t('report.location')} <span className="text-red-500">*</span></Label>
      <Select value={factoryId} onValueChange={(v) => setFactoryId(v ?? '')} items={Object.fromEntries(factories.map(f => [f.id, f.name]))}>
        <SelectTrigger><SelectValue placeholder={t('report.selectFactory')} /></SelectTrigger>
        <SelectContent>
          {factories.map(f => (
            <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={areaId}
        onValueChange={(v) => setAreaId(v ?? '')}
        items={Object.fromEntries([
          ...areas.map(a => [a.id, a.name]),
          ...(areas.length === 0 ? [['__other__', t('report.selectAreaOther', '其他')]] : []),
        ])}
      >
        <SelectTrigger><SelectValue placeholder={t('report.selectArea')} /></SelectTrigger>
        <SelectContent>
          {areas.map(a => (
            <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
          ))}
          {areas.length === 0 && (
            <SelectItem value="__other__">{t('report.selectAreaOther', '其他')}</SelectItem>
          )}
        </SelectContent>
      </Select>

      {areaId === '__other__' && (
        <Input
          value={locationNote}
          onChange={e => setLocationNote(e.target.value)}
          placeholder={t('report.areaCustom', '請填寫區域名稱')}
          className="mt-1"
        />
      )}

      {/* Reference photo for the picked area — helps tell apart areas with
          similar names (e.g. two "Line 2"s in different buildings). */}
      {(() => {
        const picked = areas.find(a => a.id === areaId)
        if (!picked?.photo_url) return null
        return (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={picked.photo_url} alt={picked.name} className="w-full max-w-[200px] h-28 rounded-lg object-cover" />
        )
      })()}

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

      {/* Free-text "other" location — for spots not in the lists above.
          Hidden while the "__other__" area option is active: that input above
          binds the SAME locationNote value, and showing both looked like two
          mysteriously self-filling fields. */}
      {areaId !== '__other__' && (
        <Input
          value={locationNote}
          onChange={e => setLocationNote(e.target.value)}
          placeholder={t('report.locationOther', '其他位置（自行填寫，選填）')}
          className="mt-1"
        />
      )}
    </div>
  )
}
