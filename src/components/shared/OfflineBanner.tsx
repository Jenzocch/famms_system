'use client'

import { useEffect, useState } from 'react'
import { WifiOff } from 'lucide-react'
import { useI18n } from '@/lib/i18n'

// Thin persistent banner so a technician knows WHY the board looks stale or
// a save is failing — without this, offline behavior (cached page, failed
// submit) looks like the app is just broken.
export default function OfflineBanner() {
  const { t } = useI18n()
  const [online, setOnline] = useState(true)

  useEffect(() => {
    // One-time browser-API read on mount: `navigator` doesn't exist during
    // SSR, so this can't be a lazy useState initializer — it must run after
    // mount, on the client only.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOnline(navigator.onLine)
    const goOnline = () => setOnline(true)
    const goOffline = () => setOnline(false)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  if (online) return null

  return (
    // In normal flow (not fixed): a fixed banner sat on top of the sticky
    // TopBar and the first rows of content with nothing compensating for its
    // height. In-flow it pushes the page down instead of covering it; failed
    // actions while scrolled still get their own toasts.
    <div className="bg-amber-500 text-white text-sm font-medium py-1.5 px-3 flex items-center justify-center gap-1.5 print:hidden">
      <WifiOff className="w-3.5 h-3.5 shrink-0" />
      {t('offline.banner', 'Tidak ada koneksi — tampilan offline, kirim data setelah sinyal kembali')}
    </div>
  )
}
