'use client'

import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { Button } from '@/components/ui/button'
import { Download, Copy } from 'lucide-react'
import { toast } from 'sonner'

interface Props {
  machineCode: string
  machineId: string
  appUrl?: string
}

export default function QRDisplay({ machineCode, machineId, appUrl = 'http://localhost:3000' }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [qrDataUrl, setQrDataUrl] = useState<string>('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function generateQR() {
      try {
        const url = `${appUrl}/machines/${machineId}`
        const dataUrl = await QRCode.toDataURL(url, {
          errorCorrectionLevel: 'H',
          type: 'image/webp',
          width: 300,
          margin: 1,
          color: { dark: '#000000', light: '#ffffff' },
        })
        setQrDataUrl(dataUrl)
      } catch (err) {
        toast.error('Gagal membuat QR code')
        console.error(err)
      } finally {
        setLoading(false)
      }
    }
    generateQR()
  }, [machineId, appUrl])

  function downloadQR() {
    if (!qrDataUrl) return
    const link = document.createElement('a')
    link.href = qrDataUrl
    link.download = `QR-${machineCode}.png`
    link.click()
  }

  function copyToClipboard() {
    if (!qrDataUrl) return
    navigator.clipboard.writeText(qrDataUrl)
    toast.success('QR code disalin ke clipboard')
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-8 space-y-6">
      <div className="text-center">
        <h2 className="text-lg font-semibold text-gray-900 mb-2">QR Code — {machineCode}</h2>
        <p className="text-sm text-gray-500">Scan untuk akses detail mesin</p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-80 bg-gray-50 rounded-lg">
          <p className="text-gray-400">Membuat QR code...</p>
        </div>
      ) : qrDataUrl ? (
        <div className="flex flex-col items-center gap-4">
          <div className="bg-gray-50 p-6 rounded-lg border border-gray-200">
            <img src={qrDataUrl} alt={`QR-${machineCode}`} className="w-80 h-80" />
          </div>
          <div className="flex gap-2">
            <Button onClick={downloadQR} className="gap-2">
              <Download className="w-4 h-4" />
              Download
            </Button>
            <Button variant="outline" onClick={copyToClipboard} className="gap-2">
              <Copy className="w-4 h-4" />
              Copy
            </Button>
          </div>
        </div>
      ) : (
        <div className="text-center py-10 text-red-600">
          Gagal membuat QR code
        </div>
      )}

      <div className="border-t pt-4">
        <p className="text-xs text-gray-500 text-center">
          URL: {appUrl}/machines/{machineId}
        </p>
      </div>
    </div>
  )
}
