const CACHE_NAME = 'twomiah-price-v1'
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/offline.html',
]

// Install: cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  )
  self.skipWaiting()
})

// Activate: clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  )
  self.clients.claim()
})

// Fetch strategy:
// 1. Static assets (/, /assets/*, /index.html): cache-first
// 2. API GET requests: network-first, fallback to cache
// 3. API POST/PATCH/DELETE: try network, if offline queue in IDB via message
// 4. Navigation requests: network-first, fallback to cached index.html (SPA)
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)

  // API requests
  if (url.pathname.startsWith('/api/')) {
    if (event.request.method === 'GET') {
      // Network-first for API GETs
      event.respondWith(
        fetch(event.request)
          .then((response) => {
            // Cache successful GET responses
            const clone = response.clone()
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone))
            return response
          })
          .catch(() => caches.match(event.request).then((cached) => cached || new Response(JSON.stringify({ error: 'Offline', fromCache: true }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' }
          })))
      )
      return
    }
    // Non-GET API requests: just try network, let client handle offline queueing
    return
  }

  // Static assets: cache-first
  if (url.pathname.startsWith('/assets/') || url.pathname === '/favicon.ico') {
    event.respondWith(
      caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, response.clone()))
        return response
      }))
    )
    return
  }

  // Navigation: network-first, fallback to cached index.html
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => caches.match('/index.html'))
    )
    return
  }

  // Everything else: network-first
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  )
})

// Listen for sync queue messages from client
self.addEventListener('message', (event) => {
  if (event.data?.type === 'CACHE_URLS') {
    caches.open(CACHE_NAME).then((cache) => {
      cache.addAll(event.data.urls || [])
    })
  }
})
