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

// Bump this whenever the caching rules change — the activate handler purges
// every cache that isn't the current version, so returning users don't get
// stuck on stale assets served by an older service worker.
const CACHE_VERSION = 'famms-v2'

// fetch() has no built-in timeout. On a truly offline device the browser
// rejects almost instantly, but on a WEAK/lossy connection (spotty factory
// wifi, one bar of signal) it can hang for 30s+ before failing — during
// which the tab-switch just sits frozen instead of falling back to the
// cached copy. Race the network against a short timer so a bad connection
// degrades to "stale page" instead of "stuck page".
const NAV_TIMEOUT_MS = 4000

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('sw-fetch-timeout')), ms)
    promise.then(
      (v) => { clearTimeout(timer); resolve(v) },
      (e) => { clearTimeout(timer); reject(e) }
    )
  })
}

self.addEventListener('install', () => {
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
      withTimeout(fetch(request), NAV_TIMEOUT_MS)
        .then((res) => {
          // Only cache good responses: a transient 5xx/404 resolves (doesn't
          // throw), and caching it would overwrite the last GOOD copy of the
          // page — offline users would then see the cached error page.
          if (res.ok) {
            const copy = res.clone()
            caches.open(CACHE_VERSION).then((c) => c.put(request, copy))
          }
          return res
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match('/offline')))
    )
    return
  }

  // Hashed build assets under /_next/static/ are content-addressed (the hash is
  // in the URL), so cache-first is always safe and never serves stale content.
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request).then((res) => {
        if (res.ok) {
          const copy = res.clone()
          caches.open(CACHE_VERSION).then((c) => c.put(request, copy))
        }
        return res
      }))
    )
    return
  }

  // Icons and other images live at STABLE urls (/icon-192.png, /favicon.ico,
  // /apple-icon.png…), so cache-first would pin the old artwork forever — a
  // redesigned icon would never reach a returning device. Network-first: use
  // the fresh copy online, fall back to cache only when offline.
  if (/\.(?:png|jpg|jpeg|svg|ico|webp)$/.test(url.pathname)) {
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone()
            caches.open(CACHE_VERSION).then((c) => c.put(request, copy))
          }
          return res
        })
        .catch(() => caches.match(request))
    )
  }
})
