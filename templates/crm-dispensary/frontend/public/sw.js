// Service worker for {{COMPANY_NAME}}.
//
// T45 H17: "Offline POS enabled" was claimed in Features, and there was no service worker running,
// no app cache and no sale queue — a reload with no internet could not even open the register. This
// file existed but nothing ever registered it, and the routes it cached (/api/jobs, /api/projects,
// /api/quotes, /api/invoices) belong to the contractor CRM, not a dispensary.
//
// What it does now, and deliberately does not:
//
//   · The app SHELL is cached, so a reload with no internet opens the register instead of the
//     browser's dinosaur. The shell is whatever the built page actually loads, discovered at
//     runtime rather than listed by hand — Vite fingerprints its bundles, so a hand-written list
//     goes stale on the next deploy and silently caches nothing.
//
//   · /api/ responses are NEVER cached, and never served from a cache. At a register, a stale stock
//     figure, a stale price or a stale purchase-limit is worse than no answer at all: it is a sale
//     made on numbers that are not true. Sales made while the connection is down are held by the
//     app's own queue (src/offline/queue.ts) and replayed to /api/offline/sync, where the server
//     re-checks them against live data before anything is committed.
const SHELL_CACHE = '{{COMPANY_SLUG}}-shell-v2'

// The bare minimum to boot the app. Everything else the shell pulls is cached as it is fetched.
const SHELL_SEED = ['/', '/index.html', '/manifest.json', '/favicon.svg']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      // One miss must not fail the whole install — a missing favicon should not cost the register
      // its offline shell.
      .then((cache) => Promise.allSettled(SHELL_SEED.map((path) => cache.add(path))))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((n) => n !== SHELL_CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  )
})

const isApi = (url) => url.pathname.startsWith('/api/')

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)

  // Anything that changes state, and anything on another origin, goes straight to the network.
  if (request.method !== 'GET' || url.origin !== self.location.origin) return

  // The API is never cached and never served from cache. See the header.
  if (isApi(url)) return

  // A navigation: network first so a deploy is picked up, cache as the fallback so a reload with no
  // connection still opens the app.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone()
            caches.open(SHELL_CACHE).then((cache) => cache.put('/index.html', copy))
          }
          return response
        })
        .catch(() => caches.match('/index.html').then((hit) => hit || Response.error())),
    )
    return
  }

  // Everything else the shell needs — the fingerprinted JS and CSS, fonts, icons: serve from cache
  // when it is there, otherwise fetch and keep a copy.
  event.respondWith(
    caches.match(request).then((hit) => {
      if (hit) return hit
      return fetch(request).then((response) => {
        if (response.ok && response.type === 'basic') {
          const copy = response.clone()
          caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy))
        }
        return response
      })
    }),
  )
})

// The app tells the worker when the queue has something to send, so a browser that supports
// Background Sync can flush it even if the tab is closed. The actual sending is done by the page —
// the worker has no session token — so this only wakes it.
self.addEventListener('sync', (event) => {
  if (event.tag !== 'flush-offline-queue') return
  event.waitUntil(
    self.clients.matchAll({ includeUncontrolled: true }).then((clients) => {
      clients.forEach((client) => client.postMessage({ type: 'FLUSH_OFFLINE_QUEUE' }))
    }),
  )
})

self.addEventListener('push', (event) => {
  if (!event.data) return
  const data = event.data.json()
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/favicon.svg',
      badge: '/favicon.svg',
      data: { url: data.url || '/' },
      actions: data.actions || [],
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data?.url || '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clientList) => {
      for (const client of clientList) {
        if (client.url === url && 'focus' in client) return client.focus()
      }
      return self.clients.openWindow ? self.clients.openWindow(url) : undefined
    }),
  )
})

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting()
  if (event.data?.type === 'CLEAR_SHELL_CACHE') caches.delete(SHELL_CACHE)
})
