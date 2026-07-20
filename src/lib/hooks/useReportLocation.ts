'use client'

import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { loadMyFactoryId } from '@/lib/useMyFactory'
import { loadFactories } from '@/lib/useFactories'

export interface ReportFactory { id: string; name: string; code: string }
export interface ReportArea { id: string; factory_id: string; name: string; photo_url: string | null }
export interface ReportAsset { id: string; area_id: string; machine_name: string; machine_code: string | null }

const LAST_LOCATION_KEY = 'famms.lastReportLocation'

// Factory → area → machine cascade for the incident report form, plus the two
// ways a location gets preselected: a QR scan-to-report machine id (overrides
// everything), or the last factory/area this browser reported from (repeat
// reports are usually from the same spot).
export function useReportLocation(presetMachineId?: string) {
  const supabase = createClient()
  const [factories, setFactories] = useState<ReportFactory[]>([])
  const [areas, setAreas] = useState<ReportArea[]>([])
  const [assets, setAssets] = useState<ReportAsset[]>([])
  const [factoryId, setFactoryId] = useState('')
  const [areaId, setAreaId] = useState('')
  const [assetId, setAssetId] = useState('')

  // Area/machine waiting to be re-applied once their options finish loading.
  const restoredAreaRef = useRef<string | null>(null)
  const restoredAssetRef = useRef<string | null>(null)

  useEffect(() => {
    // Preselect the reporter's own factory so the form is one step shorter for
    // technicians. Skipped when a QR preset is present — otherwise the two
    // async setters can race and swallow the preset's area/machine restore.
    Promise.all([loadFactories(), loadMyFactoryId()]).then(([data, myFactoryId]) => {
      setFactories((data ?? []) as ReportFactory[])
      if (!presetMachineId && myFactoryId && (data ?? []).some(f => f.id === myFactoryId)) {
        setFactoryId(prev => prev || myFactoryId)
      }
    })

    // QR scan-to-report: ?machine=<id> preselects the whole location cascade
    // (factory → area → machine), overriding the last-used restore below.
    // Every failure mode used to be SILENT (blank form, no explanation) —
    // each one now tells the technician what's wrong with this QR.
    if (presetMachineId) {
      supabase
        .from('machines')
        .select('id, area_id, status, area:areas(factory_id)')
        .eq('id', presetMachineId)
        .maybeSingle()
        .then(({ data, error }) => {
          if (error || !data) {
            // Machine deleted (or RLS denies this factory) — stale QR.
            toast.error('QR ini tidak dikenal — mesinnya sudah tidak ada di sistem. Pilih lokasi secara manual.')
            return
          }
          if (data.status === 'scrapped') {
            // The machine list below filters scrapped out, so preselecting
            // could never work — say so instead of showing an empty field.
            toast.warning('Mesin di QR ini sudah berstatus SCRAPPED. Pilih mesin lain secara manual.')
            return
          }
          const fid = (data.area as { factory_id?: string } | null)?.factory_id
          if (!fid) {
            toast.error('Data mesin di QR ini tidak lengkap (tanpa area). Pilih lokasi secara manual.')
            return
          }
          restoredAreaRef.current = data.area_id
          restoredAssetRef.current = data.id
          setFactoryId(fid)
        })
      return
    }

    // Restore the last-used factory/area for repeat reports.
    try {
      const saved = JSON.parse(localStorage.getItem(LAST_LOCATION_KEY) ?? 'null')
      if (saved?.factoryId) {
        restoredAreaRef.current = typeof saved.areaId === 'string' ? saved.areaId : null
        // One-time mount restore from localStorage, not an external-data sync.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setFactoryId(saved.factoryId)
      }
    } catch { /* corrupt storage — start blank */ }
    // Mount-only: `presetMachineId` is treated as fixed for this hook's
    // lifetime (the caller reads it once, e.g. from a URL param), and
    // `supabase` is intentionally omitted since createClient() returns a new
    // client instance every call (not memoized) — adding either would re-run
    // this on every render instead of once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    // Intentional reset-before-refetch: clears the stale option list
    // synchronously so the dropdown doesn't show the previous factory's
    // areas while the new factory's areas are loading.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!factoryId) { setAreas([]); setAreaId(''); return }
    supabase.from('areas').select('*').eq('factory_id', factoryId).order('name')
      .then(({ data }) => {
        setAreas(data ?? [])
        // Apply the remembered area once, only while its options actually exist.
        const pending = restoredAreaRef.current
        restoredAreaRef.current = null
        if (pending && (data ?? []).some(a => a.id === pending)) setAreaId(pending)
      })
    setAreaId('')
    setAssetId('')
    // `supabase` is intentionally omitted: createClient() returns a new
    // client instance every call (not memoized), so adding it here would
    // re-run this effect on every render instead of only when factoryId
    // changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [factoryId])

  useEffect(() => {
    // Intentional reset-before-refetch (see areas effect above).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!areaId || areaId === '__other__') { setAssets([]); setAssetId(''); return }
    supabase.from('machines').select('id, area_id, machine_name, machine_code')
      .eq('area_id', areaId).neq('status', 'scrapped').order('machine_name')
      .then(({ data }) => {
        setAssets(data ?? [])
        // Apply the QR-preset machine once, only while it actually exists here.
        const pending = restoredAssetRef.current
        restoredAssetRef.current = null
        if (pending && (data ?? []).some(m => m.id === pending)) setAssetId(pending)
      })
    setAssetId('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [areaId])

  // Remember this location for the next report from this browser.
  function rememberLocation() {
    try {
      localStorage.setItem(LAST_LOCATION_KEY, JSON.stringify({ factoryId, areaId }))
    } catch { /* storage full/blocked — skip */ }
  }

  return { factories, areas, assets, factoryId, setFactoryId, areaId, setAreaId, assetId, setAssetId, rememberLocation }
}
