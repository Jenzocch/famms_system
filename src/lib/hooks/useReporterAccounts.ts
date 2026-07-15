'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export interface ReporterAccount { id: string; full_name: string | null }

// Active accounts for the reporter picker, defaulted to the logged-in user
// (most reports are self-reports) while still allowing manual entry or
// picking someone else for on-behalf reporting.
export function useReporterAccounts() {
  const supabase = createClient()
  const [accounts, setAccounts] = useState<ReporterAccount[]>([])
  const [reporterName, setReporterName] = useState('')
  const [reporterAccountId, setReporterAccountId] = useState('')
  // Exposed so the form can make picking a reporter mandatory ONLY on a
  // shared-device login — a personal login already gets it right for free
  // via the auto-fill below, so it shouldn't be forced there too.
  const [isSharedDevice, setIsSharedDevice] = useState(false)

  useEffect(() => {
    supabase.from('profiles').select('id, full_name').eq('is_active', true).order('full_name')
      .then(({ data }) => setAccounts((data ?? []) as ReporterAccount[]))

    // getSession = local read, keeps the form opening instantly.
    supabase.auth.getSession().then(({ data: { session } }) => {
      const uid = session?.user.id
      if (!uid) return
      supabase.from('profiles').select('id, full_name, is_shared_device').eq('id', uid).single()
        .then(({ data }) => {
          if (!data) return
          // A shared-device login (e.g. one tablet passed between several
          // technicians) must NOT auto-fill from its own account — that would
          // silently attribute every report to the tablet instead of
          // whoever actually typed it. Leave both fields blank; the form
          // makes picking the real reporter a required step instead.
          if (data.is_shared_device) { setIsSharedDevice(true); return }
          setReporterAccountId(prev => prev || data.id)
          setReporterName(prev => prev || data.full_name || '')
        })
    })
  }, [])

  return {
    accounts, reporterName, setReporterName, reporterAccountId, setReporterAccountId,
    isSharedDevice,
  }
}
