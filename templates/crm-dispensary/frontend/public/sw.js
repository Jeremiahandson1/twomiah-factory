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
// v3, not v2: every register already running carries a cached /health in its v2 shell, and the
// activate handler drops any cache that is not the current name. Renaming is what evicts the stale
// answer from the tills that already have one. (T52 N7)
const SHELL_CACHE = '{{COMPANY_SLUG}}-shell-v3'

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

/**
 * Everything the CURRENT index.html actually asks for.
 *
 * The bundle is hashed per build — index-CUB83aoE.js — so every deploy puts new files in the cache
 * and the old ones have nothing to evict them. T47 P17 found the previous build's JS and CSS still
 * sitting beside the new ones. Deleting the whole cache on activate would work and would also take
 * the register offline until it had re-fetched everything, which is the opposite of the point.
 *
 * So the fresh index is read and anything under /assets/ it no longer references is dropped. If the
 * network is down the index cannot be read, and nothing is deleted — a service worker waking up
 * offline must not clear the shell it is there to serve.
 */
async function dropAssetsNoLongerReferenced() {
  let html
  try {
    const fresh = await fetch('/index.html', { cache: 'no-store' })
    if (!fresh || !fresh.ok) return
    html = await fresh.text()
  } catch { return }
  if (!html || !/<script|<link/i.test(html)) return

  const referenced = new Set()
  for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) referenced.add(m[1].split('?')[0])

  const cache = await caches.open(SHELL_CACHE)
  for (const request of await cache.keys()) {
    const path = new URL(request.url).pathname
    if (!path.startsWith('/assets/')) continue
    if (referenced.has(path)) continue
    await cache.delete(request)
  }
}

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((n) => n !== SHELL_CACHE).map((n) => caches.delete(n))))
      .then(() => dropAssetsNoLongerReferenced())
      .then(() => self.clients.claim()),
  )
})

/**
 * Is this path part of the app SHELL — the only thing this worker is allowed to keep?
 *
 * ── T52 N7: an allowlist, because a denylist froze /health for 22 hours ─────────────────────────
 *
 * This used to exclude /api/ and cache everything else, so /health — a server route that lives
 * OUTSIDE /api/ — went into the shell cache and was then served from it, cache-first, for as long as
 * the cache lived. A tester checking whether a deploy had landed got a response about 22 hours
 * stale, reporting an uptime for a process that had been replaced, and only a cache-busted request
 * told the truth. Any method that reads /health to tell whether the new build is live was quietly
 * broken, which is the method everyone uses.
 *
 * The prefix list was never the rule; it was a guess at the rule. The rule is that this worker
 * exists to make the register open with no internet, and the only thing that needs is the built
 * shell. So: name the shell, send everything else to the network. A server route added next year is
 * live by default instead of silently frozen — and being wrong in that direction costs a round trip,
 * where being wrong the other way costs a sale rung on numbers that are not true.
 */
const isShell = (url) => {
  const p = url.pathname
  return p === '/'
    || p === '/index.html'
    || p === '/manifest.json'
    || p.startsWith('/assets/')          // Vite's fingerprinted JS and CSS
    || /^\/(?:favicon|apple-touch-icon|icon-|logo)[^/]*$/.test(p)
}

/** Kept for the explicit refusal below — the API is never cached, and that is worth saying twice. */
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

  // Anything that is not part of the built shell goes to the network, untouched and uncached. That
  // is /health, /media/*, and every server route added after this was written. (T52 N7)
  if (!isShell(url)) return

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
