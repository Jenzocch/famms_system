'use client'

import { useEffect, useState } from 'react'
import { WifiOff } from 'lucide-react'

// Thin persistent banner so a technician knows WHY the board looks stale or
// a save is failing — without this, offline behavior (cached page, failed
// submit) looks like the app is just broken.
export default function OfflineBanner() {
  const [online, setOnline] = useState(true)

  useEffect(() => {
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
    <div className="fixed top-0 inset-x-0 z-50 bg-amber-500 text-white text-sm font-medium py-1.5 px-3 flex items-center justify-center gap-1.5 print:hidden">
      <WifiOff className="w-3.5 h-3.5 shrink-0" />
      沒有網路連線 — 顯示的是離線畫面，送出動作要等訊號恢復
    </div>
  )
}
