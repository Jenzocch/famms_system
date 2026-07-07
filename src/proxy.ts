import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// Auth guard + session refresh. (Next 16 renamed the "middleware" convention
// to "proxy" — same behavior.)
//
// Performance note: this runs on EVERY page navigation, so it must not add a
// network round-trip. getClaims() verifies the session JWT locally (cached
// JWKS) on projects with asymmetric signing keys and only touches the network
// when the token has actually expired (to refresh it, roughly once an hour).
// The old getUser() called the Supabase Auth server on every single request —
// the main cause of visible pauses when switching tabs.
export default async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Sessionless callers with their own secret-based auth:
  //  - Telegram webhook (secret-token header, checked inside the route)
  //  - Vercel cron (Bearer CRON_SECRET, checked inside the route)
  if (pathname.startsWith('/api/notifications/telegram') || pathname.startsWith('/api/cron/')) {
    return NextResponse.next()
  }

  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Local JWT verification + auto-refresh of expired sessions (writes the
  // refreshed cookies onto the response via setAll above).
  const { data } = await supabase.auth.getClaims()
  const authenticated = !!data?.claims

  if (pathname.startsWith('/api')) {
    // Safety net: every API route also self-guards, but this keeps a future
    // route that forgets its auth check from being exposed. JSON, not a
    // redirect — API callers can't follow a login page. The claims check is
    // a local JWT verify, so this adds no network round-trip.
    if (!authenticated) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return supabaseResponse
  }

  const isAuthPage = pathname.startsWith('/login')

  if (!authenticated && !isAuthPage) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  if (authenticated && isAuthPage) {
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  return supabaseResponse
}

export const config = {
  // Skip static assets entirely — running the guard there is pure overhead.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map)$).*)'],
}
