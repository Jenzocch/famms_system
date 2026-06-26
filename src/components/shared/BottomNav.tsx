'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ClipboardList, Plus, LayoutDashboard, Settings, Wrench } from 'lucide-react'
import { cn } from '@/lib/utils'

const NAV = [
  { href: '/dashboard', label: '主管', icon: LayoutDashboard },
  { href: '/incidents', label: '看板', icon: ClipboardList },
  { href: '/incidents/new', label: '回報', icon: Plus, primary: true },
  { href: '/pm', label: '保養', icon: Wrench },
  { href: '/settings', label: '設定', icon: Settings },
]

export default function BottomNav() {
  const pathname = usePathname()

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 z-50 safe-area-bottom">
      <div className="flex items-center justify-around h-16 max-w-lg mx-auto px-2">
        {NAV.map(({ href, label, icon: Icon, primary }) => {
          const active = href === '/incidents/new'
            ? pathname === href
            : pathname === href || (pathname.startsWith(href + '/') && href !== '/incidents/new')

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

          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex flex-col items-center justify-center gap-1 px-3 py-2 rounded-lg flex-1',
                active ? 'text-blue-600' : 'text-gray-500'
              )}
            >
              <Icon className="w-5 h-5" />
              <span className="text-xs font-medium">{label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
