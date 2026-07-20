'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { motion } from 'motion/react'
import { ClipboardList, Plus, LayoutDashboard, Settings, Wrench } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { UserRole } from '@/types'
import { PERMISSIONS } from '@/lib/permissions'
import type { EffectiveCapabilities } from '@/lib/roles'
import { useI18n } from '@/lib/i18n'
import { springPress } from '@/lib/motion'

interface NavItem {
  href: string
  labelKey: string
  icon: React.ComponentType<{ className?: string }>
  primary?: boolean
  requiredRole?: (role: UserRole, capabilities: EffectiveCapabilities | null) => boolean
}

const NAV: NavItem[] = [
  // capabilities is the resolved custom-role overlay from the layout — falls
  // back to the plain role check when null (no custom role on this account).
  { href: '/dashboard', labelKey: 'navigation.dashboard', icon: LayoutDashboard, requiredRole: (r, c) => c?.dashboard ?? PERMISSIONS.dashboard(r) },
  { href: '/incidents', labelKey: 'navigation.incidents', icon: ClipboardList },
  { href: '/incidents/new', labelKey: 'navigation.newIncident', icon: Plus, primary: true },
  { href: '/pm', labelKey: 'navigation.pm', icon: Wrench },
  // An Account Admin custom role (manageUsers capability) needs the Settings
  // link too — see the matching comment in components/shared/Sidebar.tsx.
  { href: '/settings', labelKey: 'navigation.settings', icon: Settings, requiredRole: (r, c) => PERMISSIONS.viewSettings(r) || !!c?.manageUsers },
]

interface BottomNavProps {
  userRole?: UserRole
  incidentBadge?: number
  capabilities?: EffectiveCapabilities | null
}

export default function BottomNav({ userRole = 'technician', incidentBadge = 0, capabilities = null }: BottomNavProps) {
  const pathname = usePathname()
  const { t } = useI18n()
  const visibleNav = NAV.filter(item => !item.requiredRole || item.requiredRole(userRole, capabilities))

  return (
    // Translucent floating chrome (Apple HIG): content scrolls underneath
    // instead of stopping at an opaque bar. backdrop-blur needs a fallback —
    // browsers without it (or prefers-reduced-transparency) get the plain
    // bg-white/border via the supports-not query.
    <nav className="print:hidden lg:hidden fixed bottom-0 left-0 right-0 bg-white/80 backdrop-blur-xl border-t border-gray-200/70 z-50 safe-area-bottom [@media(prefers-reduced-transparency:reduce)]:bg-white [@media(prefers-reduced-transparency:reduce)]:backdrop-blur-none supports-[not(backdrop-filter:blur(1px))]:bg-white">
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
              <Link key={href} href={href} className="flex flex-col items-center justify-center -mt-5">
                {/* Momentum-style spring press (springPress: a touch is a
                    direct, physical action, so a little bounce on release
                    reads as responsive rather than distracting). */}
                <motion.div
                  whileTap={{ scale: 0.9 }}
                  transition={springPress}
                  className="w-14 h-14 bg-blue-600 rounded-full flex items-center justify-center shadow-md"
                >
                  <Icon className="w-6 h-6 text-white" />
                </motion.div>
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
