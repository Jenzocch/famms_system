// FAMMS service worker — offline VIEWING only, never offline writing.
//
// Scope, deliberately narrow:
//   - GET requests only. POST/PUT/PATCH/DELETE are never intercepted — they
//     hit the network directly and fail normally (existing try/catch + toast)
//     when offline. We are NOT queueing writes; that needs an idempotency
//     design (see submitIncidentReport's client_request_id) and is a bigger,
//     separate piece of work.
//   - Navigation requests (HTML pages): network-first, falling back to the
//     last cached copy of that exact page when the network is unreachable.
//     Lets a technician re-open a page they already visited while signal is
//     out, instead of seeing the browser's offline error page.
//   - Static build assets (/_next/static/*) and icons: cache-first — these
//     are content-hashed and immutable, safe to serve from cache forever.
//   - Everything else (Supabase REST/storage calls, API routes): pass
//     through untouched. Caching Supabase GETs here would risk serving
//     another factory's stale data after a role/session change; not worth
//     the risk for this first pass.

const CACHE_VERSION = 'famms-v1'

self.addEventListener('install', (event) => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names.filter((n) => n !== CACHE_VERSION).map((n) => caches.delete(n))
      )
    ).then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return // never touch writes

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return // leave Supabase etc. alone

  // Navigations (actual page loads / client-side route changes that hit the
  // server) — network-first so users always get fresh data when online.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone()
          caches.open(CACHE_VERSION).then((c) => c.put(request, copy))
          return res
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match('/offline')))
    )
    return
  }

  // Hashed static assets — cache-first, they never change under the same URL.
  if (url.pathname.startsWith('/_next/static/') || /\.(?:png|jpg|jpeg|svg|ico|webp)$/.test(url.pathname)) {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request).then((res) => {
        const copy = res.clone()
        caches.open(CACHE_VERSION).then((c) => c.put(request, copy))
        return res
      }))
    )
  }
})
