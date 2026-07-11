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

  // Sessionless callers with their own secret-based auth (the route itself
  // verifies the shared secret; the session guard below would 401 them before
  // that check ever runs):
  //  - Telegram webhook (secret-token header, checked inside the route)
  //  - Vercel cron (Bearer CRON_SECRET, checked inside the route)
  //  - External integrations (Gudang One → parts-requests write-back with
  //    Bearer GUDANG_SYNC_SECRET; QC/FQMS → machine-status with Bearer
  //    QC_API_SECRET) — server-to-server, no Supabase session cookie
  if (
    pathname.startsWith('/api/notifications/telegram') ||
    pathname.startsWith('/api/cron/') ||
    pathname.startsWith('/api/external/')
  ) {
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
  // manifest.webmanifest MUST be excluded too: Android/Chrome (and Google's
  // WebAPK minting server) fetch it WITHOUT the user's session cookie when
  // installing the PWA, so guarding it redirects the fetch to /login, the
  // installer can't read the icons, and the home-screen icon falls back to a
  // generated monogram. /offline is the service worker's offline fallback page
  // and must render without auth for the same reason.
  //
  // The extension exclusion is deliberately [^/]* (a single path segment),
  // NOT .* — all of our static assets (icon-192.png, favicon.ico, …) live at
  // the root. .* would match across slashes too, so e.g. /incidents/x.png
  // would satisfy "path ends in .png" and skip this guard entirely, even
  // though [id] there is a dynamic route segment, not a real file. That's
  // currently caught by the (dashboard) layout's own auth check and each API
  // route's own guard, but a route added without one would silently inherit
  // the bypass — keep this scoped to actual top-level static filenames.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|offline|[^/]*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map)$).*)'],
}
