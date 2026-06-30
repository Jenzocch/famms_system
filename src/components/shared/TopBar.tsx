'use client'

import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Profile } from '@/types'
import { ROLE_ZH } from '@/lib/incident-display'
import { Wrench, LogOut, User } from 'lucide-react'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import LanguageSwitcher from '@/components/shared/LanguageSwitcher'
import { useI18n } from '@/lib/i18n'

interface TopBarProps {
  profile: Profile | null
}

export default function TopBar({ profile }: TopBarProps) {
  const router = useRouter()
  const supabase = createClient()
  const { t } = useI18n()

  async function signOut() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  const initials = profile?.full_name
    ? profile.full_name.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2)
    : 'U'

  return (
    <header className="bg-white border-b border-gray-100 sticky top-0 z-40">
      <div className="flex items-center justify-between px-4 h-12 max-w-lg mx-auto">
        <div className="flex items-center gap-2 text-blue-600 font-bold min-w-0">
          <Wrench className="w-4 h-4 shrink-0" />
          <span className="text-sm truncate">{t('appName', '工廠維修系統')}</span>
        </div>

        <div className="flex items-center gap-1 shrink-0">
        <LanguageSwitcher />
        <DropdownMenu>
          <DropdownMenuTrigger className="flex items-center gap-2 focus:outline-none max-w-[40vw]">
            <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center shrink-0">
              <span className="text-xs font-semibold text-blue-700">{initials}</span>
            </div>
            <span className="text-sm font-medium text-gray-700 truncate">
              {profile?.full_name || t('settings.userFallback', '使用者')}
            </span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <div className="px-3 py-2">
              <p className="text-sm font-medium">{profile?.full_name || '使用者'}</p>
              {profile?.role && (
                <p className="text-xs text-gray-400 mt-0.5">{ROLE_ZH[profile.role]}</p>
              )}
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => router.push('/profile')} className="flex items-center gap-2 cursor-pointer">
              <User className="w-4 h-4" /> {t('navigation.profile')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={signOut} className="text-red-600 flex items-center gap-2 cursor-pointer">
              <LogOut className="w-4 h-4" /> {t('navigation.logout')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        </div>
      </div>
    </header>
  )
}
