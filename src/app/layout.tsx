import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { Toaster } from '@/components/ui/sonner'
import { I18nProvider } from '@/lib/i18n'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'FAMMS — Factory Asset & Maintenance Management',
  description: 'Sistem manajemen aset & maintenance equipment untuk SJA, DIN, Olentia',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className={`${inter.className} h-full bg-gray-50`}>
        <I18nProvider>
          {children}
          <Toaster richColors position="top-right" />
        </I18nProvider>
      </body>
    </html>
  )
}
