'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ClipboardList, Plus, LayoutDashboard, Settings, Wrench } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { UserRole } from '@/types'
import { PERMISSIONS } from '@/lib/permissions'
import { useI18n } from '@/lib/i18n'

interface NavItem {
  href: string
  labelKey: string
  icon: React.ComponentType<{ className?: string }>
  primary?: boolean
  requiredRole?: (role: UserRole) => boolean
}

const NAV: NavItem[] = [
  { href: '/dashboard', labelKey: 'navigation.dashboard', icon: LayoutDashboard, requiredRole: (r) => PERMISSIONS.dashboard(r) },
  { href: '/incidents', labelKey: 'navigation.incidents', icon: ClipboardList },
  { href: '/incidents/new', labelKey: 'navigation.newIncident', icon: Plus, primary: true },
  { href: '/pm', labelKey: 'navigation.pm', icon: Wrench },
  { href: '/settings', labelKey: 'navigation.settings', icon: Settings, requiredRole: (r) => PERMISSIONS.viewSettings(r) },
]

interface BottomNavProps {
  userRole?: UserRole
  incidentBadge?: number
}

export default function BottomNav({ userRole = 'technician', incidentBadge = 0 }: BottomNavProps) {
  const pathname = usePathname()
  const { t } = useI18n()
  const visibleNav = NAV.filter(item => !item.requiredRole || item.requiredRole(userRole))

  return (
    <nav className="lg:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 z-50 safe-area-bottom">
      <div className="flex items-center justify-around h-16 max-w-lg mx-auto px-2">
        {visibleNav.map(({ href, labelKey, icon: Icon, primary }) => {
          const label = t(labelKey)
          // Active on exact or sub-path match, unless a more specific nav item
          // matches better (keeps /incidents and /incidents/new from both lighting).
          const active = pathname === href || (
            pathname.startsWith(href + '/') &&
            !visibleNav.some(o =>
              o.href !== href &&
              o.href.startsWith(href + '/') &&
              (pathname === o.href || pathname.startsWith(o.href + '/'))
            )
          )

          if (primary) {
            return (
              <Link
                key={href}
                href={href}
                className="flex flex-col items-center justify-center -mt-6"
              >
                <div className="w-14 h-14 bg-blue-600 rounded-full flex items-center justify-center shadow-lg">
                  <Icon className="w-6 h-6 text-white" />
                </div>
                <span className="text-xs text-blue-600 font-medium mt-1">{label}</span>
              </Link>
            )
          }

          const showBadge = href === '/incidents' && incidentBadge > 0
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex flex-col items-center justify-center gap-1 px-3 py-2 rounded-lg flex-1',
                active ? 'text-blue-600' : 'text-gray-500'
              )}
            >
              <span className="relative">
                <Icon className="w-5 h-5" />
                {showBadge && (
                  <span className="absolute -top-1.5 -right-2 min-w-[16px] h-4 px-1 flex items-center justify-center text-[10px] font-bold text-white bg-red-500 rounded-full">
                    {incidentBadge > 99 ? '99+' : incidentBadge}
                  </span>
                )}
              </span>
              <span className="text-xs font-medium">{label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
