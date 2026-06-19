'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Profile } from '@/types'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ShoppingCart, LayoutDashboard, Clock, Plus, LogOut, User, Shield, BarChart2 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface NavbarProps {
  profile: (Profile & { role: string }) | null
}

const NAV_LINKS = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/requests/new', label: 'New Request', icon: Plus },
  { href: '/history', label: 'History', icon: Clock },
  { href: '/materials', label: 'Prices', icon: BarChart2 },
]

export default function Navbar({ profile }: NavbarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()

  async function signOut() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  const initials = profile?.full_name
    ? profile.full_name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
    : 'U'

  return (
    <header className="bg-white border-b border-gray-200 sticky top-0 z-40">
      <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
        {/* Logo */}
        <Link href="/dashboard" className="flex items-center gap-2 font-bold text-blue-600">
          <ShoppingCart className="w-5 h-5" />
          <span className="hidden sm:inline">PDP</span>
        </Link>

        {/* Nav links */}
        <nav className="flex items-center gap-1">
          {NAV_LINKS.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                pathname === href
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-gray-600 hover:bg-gray-100'
              )}
            >
              <Icon className="w-4 h-4" />
              <span className="hidden sm:inline">{label}</span>
            </Link>
          ))}
          {(profile?.role === 'purchasing' || profile?.role === 'director') && (
            <Link
              href="/admin"
              className={cn(
                'flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                pathname === '/admin'
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-gray-600 hover:bg-gray-100'
              )}
            >
              <Shield className="w-4 h-4" />
              <span className="hidden sm:inline">Admin</span>
            </Link>
          )}
        </nav>

        {/* User menu */}
        <DropdownMenu>
          <DropdownMenuTrigger className="flex items-center gap-2 rounded-full focus:outline-none focus:ring-2 focus:ring-blue-500">
              <Avatar className="h-8 w-8">
                <AvatarFallback className="bg-blue-100 text-blue-700 text-xs font-semibold">
                  {initials}
                </AvatarFallback>
              </Avatar>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <div className="px-3 py-2">
              <p className="text-sm font-medium">{profile?.full_name}</p>
              <p className="text-xs text-gray-500">{profile?.email}</p>
              <p className="text-xs text-blue-600 mt-0.5 capitalize">
                {profile?.role?.replace('_', ' ')}
              </p>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => router.push('/profile')} className="flex items-center gap-2 cursor-pointer">
              <User className="w-4 h-4" /> Profile
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={signOut} className="text-red-600 flex items-center gap-2">
              <LogOut className="w-4 h-4" /> Sign Out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
