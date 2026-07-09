import { WifiOff } from 'lucide-react'

// Last-resort fallback: shown only when the service worker's navigation
// fetch fails AND there's no cached copy of the requested page either (e.g.
// first-ever visit to that URL while offline). Static, no data fetching —
// it must never itself depend on the network.
export const metadata = { title: 'Offline | FAMMS' }

export default function OfflinePage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
      <div className="text-center max-w-sm">
        <div className="inline-flex items-center justify-center w-14 h-14 bg-gray-200 rounded-2xl mb-4">
          <WifiOff className="w-7 h-7 text-gray-500" />
        </div>
        <h1 className="text-lg font-bold text-gray-900">目前沒有網路連線</h1>
        <p className="text-sm text-gray-500 mt-2">
          這個頁面還沒有離線備份可以顯示。訊號恢復後重新整理即可。
        </p>
      </div>
    </div>
  )
}
