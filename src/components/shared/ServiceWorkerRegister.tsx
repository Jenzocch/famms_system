'use client'

import { useEffect } from 'react'

// Registers the offline-viewing service worker (public/sw.js). Silently
// no-ops on browsers without support or if registration fails — this is a
// progressive enhancement, never something the app depends on to function.
export default function ServiceWorkerRegister() {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {})
    }
  }, [])
  return null
}
