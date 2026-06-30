'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { ClipboardList, Plus, LayoutDashboard, Settings, Wrench, LogOut, User } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Profile, UserRole } from '@/types'
import { PERMISSIONS } from '@/lib/permissions'
import { ROLE_ZH } from '@/lib/incident-display'
import { useI18n } from '@/lib/i18n'
import LanguageSwitcher from '@/components/shared/LanguageSwitcher'

interface NavItem {
  href: string
  labelKey: string
  icon: React.ComponentType<{ className?: string }>
  requiredRole?: (role: UserRole) => boolean
}

const NAV: NavItem[] = [
  { href: '/dashboard', labelKey: 'navigation.dashboard', icon: LayoutDashboard, requiredRole: (r) => PERMISSIONS.dashboard(r) },
  { href: '/incidents', labelKey: 'navigation.incidents', icon: ClipboardList },
  { href: '/incidents/new', labelKey: 'navigation.newIncident', icon: Plus },
  { href: '/pm', labelKey: 'navigation.pm', icon: Wrench },
  { href: '/settings', labelKey: 'navigation.settings', icon: Settings, requiredRole: (r) => PERMISSIONS.viewSettings(r) },
]

interface SidebarProps {
  profile: Profile | null
  incidentBadge?: number
}

// Desktop-only left sidebar. Hidden on mobile, where BottomNav + TopBar are used.
export default function Sidebar({ profile, incidentBadge = 0 }: SidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()
  const { t } = useI18n()
  const userRole = (profile?.role ?? 'technician') as UserRole

  const visibleNav = NAV.filter(item => !item.requiredRole || item.requiredRole(userRole))

  const initials = profile?.full_name
    ? profile.full_name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
    : 'U'

  async function signOut() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <aside className="hidden lg:flex lg:flex-col w-60 shrink-0 bg-white border-r border-gray-200 h-screen sticky top-0">
      {/* Brand */}
      <div className="flex items-center justify-between px-4 h-14 border-b border-gray-100">
        <Link href="/dashboard" className="flex items-center gap-2 text-blue-600 font-bold">
          <Wrench className="w-5 h-5" />
          <span className="text-sm">工廠維修系統</span>
        </Link>
        <LanguageSwitcher />
      </div>

      {/* Nav */}
      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        {visibleNav.map(({ href, labelKey, icon: Icon }) => {
          // Active when the path matches exactly, or is a sub-path — but NOT
          // when a more specific nav item (e.g. /incidents/new) matches better.
          // This prevents both "Papan" (/incidents) and "Lapor" (/incidents/new)
          // lighting up at the same time.
          const active = pathname === href || (
            pathname.startsWith(href + '/') &&
            !visibleNav.some(o =>
              o.href !== href &&
              o.href.startsWith(href + '/') &&
              (pathname === o.href || pathname.startsWith(o.href + '/'))
            )
          )
          const showBadge = href === '/incidents' && incidentBadge > 0
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                active ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-100'
              )}
            >
              <Icon className="w-5 h-5 shrink-0" />
              <span className="flex-1">{t(labelKey)}</span>
              {showBadge && (
                <span className="min-w-[18px] h-[18px] px-1 flex items-center justify-center text-[10px] font-bold text-white bg-red-500 rounded-full">
                  {incidentBadge > 99 ? '99+' : incidentBadge}
                </span>
              )}
            </Link>
          )
        })}
      </nav>

      {/* User */}
      <div className="border-t border-gray-100 p-3">
        <div className="flex items-center gap-2 px-2 py-1.5">
          <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center shrink-0">
            <span className="text-xs font-semibold text-blue-700">{initials}</span>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium truncate">{profile?.full_name || t('navigation.profile')}</p>
            {profile?.role && <p className="text-xs text-gray-400">{ROLE_ZH[profile.role]}</p>}
          </div>
        </div>
        <div className="mt-1 space-y-0.5">
          <button
            onClick={() => router.push('/profile')}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-100"
          >
            <User className="w-4 h-4" /> {t('navigation.profile')}
          </button>
          <button
            onClick={signOut}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-red-600 hover:bg-red-50"
          >
            <LogOut className="w-4 h-4" /> {t('navigation.logout')}
          </button>
        </div>
      </div>
    </aside>
  )
}
