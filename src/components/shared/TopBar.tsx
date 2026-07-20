'use client'

import { useRouter } from 'next/navigation'
import { signOutAndClearCaches } from '@/lib/sign-out'
import { Profile } from '@/types'
import { ROLE_ZH } from '@/lib/incident-display'
import type { CustomRole } from '@/lib/roles'
import { customRoleLabel } from '@/lib/roles'
import { Wrench, LogOut, User } from 'lucide-react'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import LanguageSwitcher from '@/components/shared/LanguageSwitcher'
import { useI18n } from '@/lib/i18n'

interface TopBarProps {
  profile: Profile | null
  customRole?: CustomRole | null
}

export default function TopBar({ profile, customRole = null }: TopBarProps) {
  const router = useRouter()
  const { t, locale } = useI18n()
  const roleDisplay = customRole ? customRoleLabel(customRole, locale) : (profile?.role ? ROLE_ZH[profile.role] : null)

  async function signOut() {
    await signOutAndClearCaches()
    router.push('/login')
    // Purge Next's client Router Cache too — back/forward restores from it
    // regardless of staleTimes, so without this the next user on a shared
    // device could Back into the previous user's rendered pages.
    router.refresh()
  }

  const initials = profile?.full_name
    ? profile.full_name.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2)
    : 'U'

  return (
    // Translucent floating chrome, matching BottomNav — content scrolls
    // underneath instead of stopping at an opaque bar.
    <header className="print:hidden bg-white/80 backdrop-blur-xl border-b border-gray-100/70 sticky top-0 z-40 [@media(prefers-reduced-transparency:reduce)]:bg-white [@media(prefers-reduced-transparency:reduce)]:backdrop-blur-none supports-[not(backdrop-filter:blur(1px))]:bg-white">
      <div className="flex items-center justify-between px-4 h-12 max-w-lg mx-auto">
        <div className="flex items-center gap-2 text-blue-600 min-w-0">
          <Wrench className="w-5 h-5 shrink-0" />
          <span className="text-base font-extrabold tracking-tight">FAMMS</span>
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
              {roleDisplay && (
                <p className="text-[13px] text-gray-500 mt-0.5">{roleDisplay}</p>
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
