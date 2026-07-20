import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import './globals.css'
import { Toaster } from '@/components/ui/sonner'
import { I18nProvider, LOCALE_COOKIE, type Locale } from '@/lib/i18n'
import ServiceWorkerRegister from '@/components/shared/ServiceWorkerRegister'
import OfflineBanner from '@/components/shared/OfflineBanner'

export const metadata: Metadata = {
  title: 'FAMMS — Factory Asset & Maintenance Management',
  description: 'Sistem manajemen aset & maintenance equipment untuk SJA, DIN, Olentia',
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Read the saved language from the cookie so the server renders the first
  // paint in the user's language — without this, every full page load flashed
  // the Bahasa default before the client swapped in the saved choice.
  const saved = (await cookies()).get(LOCALE_COOKIE)?.value
  const initialLocale =
    saved === 'zh' || saved === 'en' || saved === 'id' ? (saved as Locale) : undefined

  return (
    <html lang={initialLocale ?? 'id'} className="h-full">
      <body className="h-full bg-gray-50 font-sans">
        <I18nProvider initialLocale={initialLocale}>
          <ServiceWorkerRegister />
          <OfflineBanner />
          {children}
          <Toaster richColors position="top-right" />
        </I18nProvider>
      </body>
    </html>
  )
}
