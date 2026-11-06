// /api/family-app — the family portal as an app relatives can put on their phone's home screen (row 7, care_family_comms; AlayaCare's
// family app). Public files, no sign-in:
//   GET /sw.js                  the service worker: shows the arrival / finish notices the portal sends by push, and opens the portal
//                               when one is tapped. It never caches anything (no fetch handler): the portal always reads live data.
//                               Served with Service-Worker-Allowed: /family, so it can look after the portal's pages.
//   GET /manifest.webmanifest   the app's name (the agency's), its colour, its icon, and that it opens at /family on its own screen.
//   GET /icon.svg               the icon: the agency's first letter on its colour (a logo URL is used instead when the agency has one).
// Before this the portal asked the browser for a service worker that nobody registered, so turning on app notices could never finish.
import { Hono } from 'hono'
import { asc } from 'drizzle-orm'
import { company } from '../../../db/schema/index.ts'
import type { CrmDeps } from '../../deps.ts'

export const FAMILY_SW = `// Family portal service worker (served by the agency's app). Notices only; nothing is cached.
self.addEventListener('install', (e) => { self.skipWaiting() })
self.addEventListener('activate', (e) => { e.waitUntil(self.clients.claim()) })
self.addEventListener('push', (e) => {
  let d = {}
  try { d = e.data ? e.data.json() : {} } catch (_) { d = { title: e.data ? e.data.text() : '' } }
  const title = d.title || 'Visit update'
  e.waitUntil(self.registration.showNotification(title, { body: d.body || '', tag: d.tag || undefined, data: d.data || {}, icon: '/api/family-app/icon.svg' }))
})
self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  const url = (e.notification.data && e.notification.data.url) || '/family'
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) { if (c.url.includes('/family') && 'focus' in c) return c.focus() }
    return self.clients.openWindow(url)
  }))
})
`

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
const HEX = /^#[0-9a-f]{6}$/i

export function createFamilyAppRoutes(d: CrmDeps) {
  const app = new Hono()
  const agency = async () => (await d.db.select({ name: company.name, primaryColor: company.primaryColor, logo: company.logo }).from(company).orderBy(asc(company.createdAt)).limit(1))[0] ?? null

  app.get('/sw.js', (c) => c.body(FAMILY_SW, 200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache', 'Service-Worker-Allowed': '/family' }))

  app.get('/manifest.webmanifest', async (c) => {
    const a = await agency()
    const name = a?.name?.trim() || 'Family portal'
    const color = a?.primaryColor && HEX.test(a.primaryColor) ? a.primaryColor : '#0f766e'
    const logo = a?.logo && /^https:\/\//.test(a.logo) ? a.logo : null
    return c.body(JSON.stringify({
      name: `${name} — Family`, short_name: name.length > 12 ? 'Family' : name, start_url: '/family', scope: '/family', display: 'standalone',
      background_color: '#ffffff', theme_color: color,
      icons: [
        { src: '/api/family-app/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ...(logo ? [{ src: logo, sizes: '512x512', purpose: 'any' }] : []),
      ],
    }), 200, { 'Content-Type': 'application/manifest+json; charset=utf-8', 'Cache-Control': 'public, max-age=3600' })
  })

  app.get('/icon.svg', async (c) => {
    const a = await agency()
    const color = a?.primaryColor && HEX.test(a.primaryColor) ? a.primaryColor : '#0f766e'
    const letter = esc((a?.name?.trim()?.[0] || 'F').toUpperCase())
    return c.body(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="96" fill="${color}"/><text x="256" y="330" font-family="Arial, Helvetica, sans-serif" font-size="260" font-weight="700" text-anchor="middle" fill="#ffffff">${letter}</text></svg>`,
      200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=3600' })
  })

  return app
}
