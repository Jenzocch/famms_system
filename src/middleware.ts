import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
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

  const { data: { user } } = await supabase.auth.getUser()

  const pathname = request.nextUrl.pathname
  const isAuthPage = pathname.startsWith('/login')
  const isApi = pathname.startsWith('/api')
  // Only the Telegram webhook may be called without a session — Telegram's
  // servers can't log in. It authenticates itself via the secret-token header
  // checked inside the route.
  const isPublicApi = pathname.startsWith('/api/notifications/telegram')

  if (!user && isApi && !isPublicApi) {
    // Safety net: every API route also self-guards, but this keeps a future
    // route that forgets its auth check from being exposed. JSON, not a
    // redirect — API callers can't follow a login page.
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!user && !isAuthPage && !isApi) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  if (user && isAuthPage) {
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  return supabaseResponse
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
