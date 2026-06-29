'use client'

import { Globe, Check } from 'lucide-react'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useI18n, LOCALES } from '@/lib/i18n'

export default function LanguageSwitcher() {
  const { locale, setLocale } = useI18n()
  const current = LOCALES.find(l => l.value === locale)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-gray-500 hover:bg-gray-100 focus:outline-none">
        <Globe className="w-4 h-4" />
        <span className="text-xs font-medium">{current?.label}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-36">
        {LOCALES.map(l => (
          <DropdownMenuItem
            key={l.value}
            onClick={() => setLocale(l.value)}
            className="flex items-center justify-between cursor-pointer"
          >
            <span>{l.label}</span>
            {l.value === locale && <Check className="w-4 h-4 text-blue-600" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
