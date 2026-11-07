// The salon's own client app and its directory listing (salon parity row 25; Fresha, Vagaro, Boulevard; feature `salon_client_app`, not
// ready). No commission is taken on the salon's clients, as the owner decided.
//
// THE APP: the client portal (/portal/<token>: book, rebook, upcoming and past visits, gift cards, memberships, loyalty) installed on the
// client's phone in the SALON'S name, colour and icon — the way the home care family portal is (homecare/portals/familyApp.ts). Public files:
//   GET /api/client-app/manifest.webmanifest?t=<portal token>  the salon's name, colour and icon; opens at that client's own portal
//   GET /api/client-app/sw.js        a service worker that shows the salon's notices and caches nothing (the portal reads live data)
//   GET /api/client-app/icon.svg     the salon's first letter on its colour (its logo too, when it has one on https)
// A store-built native app in the salon's name is the partner step: an Apple and a Google developer account in the salon's (or Twomiah's)
// name, and the build (apps/mobile's variants) submitted to both stores.
//
// THE LISTING: a salon that opts in (Settings, `PUT /api/client-app-settings { directoryListing: true }`) publishes its card for a
// directory — name, address, phone, its own booking page and its services with prices as the menu shows them — at
//   GET /api/client-app/listing       404 until the salon opts in
// The site already marks itself up for search engines' own directories (site/structuredData.ts: HairSalon, NailSalon, …).
import { Hono } from 'hono'
import { and, asc, eq, isNotNull } from 'drizzle-orm'
import { bookingService, company } from '../../db/schema/index.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, one } from '../../http/reply.ts'
import type { CrmDeps } from '../deps.ts'
import { siteOrigin } from '../../booking/happenings.ts'

export const CLIENT_APP_SW = `// The salon's client app service worker. Notices only; nothing is cached.
self.addEventListener('install', () => { self.skipWaiting() })
self.addEventListener('activate', (e) => { e.waitUntil(self.clients.claim()) })
self.addEventListener('push', (e) => {
  let d = {}
  try { d = e.data ? e.data.json() : {} } catch (_) { d = { title: e.data ? e.data.text() : '' } }
  e.waitUntil(self.registration.showNotification(d.title || 'Your salon', { body: d.body || '', tag: d.tag || undefined, data: d.data || {}, icon: '/api/client-app/icon.svg' }))
})
self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  const url = (e.notification.data && e.notification.data.url) || '/portal/'
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) { if (c.url.includes('/portal/') && 'focus' in c) return c.focus() }
    return self.clients.openWindow(url)
  }))
})
`

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
const HEX = /^#[0-9a-f]{6}$/i
/** A portal token as the portal makes them (URL-safe); anything else opens the portal's own front door. */
const tokenOf = (v: unknown) => { const s = String(v ?? ''); return /^[A-Za-z0-9_-]{8,128}$/.test(s) ? s : '' }

type Salon = { id: string; name: string; primaryColor: string | null; logo: string | null; phone: string | null; address: string | null; city: string | null; state: string | null; zip: string | null; settings: any }
const colourOf = (s: Salon | null) => (s?.primaryColor && HEX.test(s.primaryColor) ? s.primaryColor : '#0f766e')
export const listingOn = (settings: any) => settings?.clientApp?.directoryListing === true

export function createClientAppRoutes(d: CrmDeps) {
  const app = new Hono()
  const salon = async (): Promise<Salon | null> => (await d.db.select({ id: company.id, name: company.name, primaryColor: company.primaryColor, logo: company.logo, phone: company.phone, address: company.address, city: company.city, state: company.state, zip: company.zip, settings: company.settings }).from(company).orderBy(asc(company.createdAt)).limit(1))[0] ?? null

  app.get('/sw.js', (c) => c.body(CLIENT_APP_SW, 200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache', 'Service-Worker-Allowed': '/portal/' }))

  app.get('/manifest.webmanifest', async (c) => {
    const s = await salon()
    const name = s?.name?.trim() || 'My salon'
    const token = tokenOf(c.req.query('t'))
    const logo = s?.logo && /^https:\/\//.test(s.logo) ? s.logo : null
    return c.body(JSON.stringify({
      name, short_name: name.length > 12 ? name.slice(0, 12).trim() : name, description: `Book, rebook and see your visits at ${name}.`,
      // Each client's app opens on their own portal (the private link they were sent); no token, the portal's front door.
      start_url: token ? `/portal/${token}` : '/portal/', scope: '/portal/', display: 'standalone',
      background_color: '#ffffff', theme_color: colourOf(s),
      icons: [
        { src: '/api/client-app/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ...(logo ? [{ src: logo, sizes: '512x512', purpose: 'any' }] : []),
      ],
    }), 200, { 'Content-Type': 'application/manifest+json; charset=utf-8', 'Cache-Control': 'private, max-age=3600' })
  })

  app.get('/icon.svg', async (c) => {
    const s = await salon()
    const letter = esc((s?.name?.trim()?.[0] || 'S').toUpperCase())
    return c.body(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="96" fill="${colourOf(s)}"/><text x="256" y="330" font-family="Arial, Helvetica, sans-serif" font-size="260" font-weight="700" text-anchor="middle" fill="#ffffff">${letter}</text></svg>`,
      200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=3600' })
  })

  // The salon's card for a directory, only once it opted in. Nothing about any client; prices only as the menu shows them online.
  app.get('/listing', async (c) => {
    const s = await salon()
    if (!s || !listingOn(s.settings)) return fail(c, 404, 'Not listed')
    const origin = siteOrigin()
    // What the booking page offers: switched on and on the Service Menu (the salon's list; onlineBooking.ts keepOnlineService).
    const services = await d.db.select().from(bookingService).where(and(eq(bookingService.companyId, s.id), eq(bookingService.active, true), isNotNull(bookingService.serviceMenuId))).orderBy(asc(bookingService.name)) as any[]
    c.header('Cache-Control', 'public, max-age=900')
    return one(c, {
      name: s.name, phone: s.phone, logo: s.logo && /^https:\/\//.test(s.logo) ? s.logo : null, colour: colourOf(s),
      address: { street: s.address, city: s.city, region: s.state, postalCode: s.zip, country: 'US' },
      website: origin || null, bookingUrl: origin ? `${origin}/book` : null,
      services: services.map((x) => ({ name: x.name, minutes: x.durationMinutes, price: x.price != null && Number(x.price) > 0 ? Number(x.price) : null, priceIsFrom: !!x.priceIsFrom, url: origin ? `${origin}/book/${x.slug}` : null })),
      commission: 'none',
    })
  })
  return app
}

/** The owner's switch for the directory listing (company:update): /api/client-app-settings. */
export function createClientAppSettingsRoutes(d: CrmDeps) {
  const app = new Hono<AppEnv>()
  const { requirePermission } = d.permissions
  const read = async (companyId: string) => {
    const [row] = await d.db.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1)
    return { directoryListing: listingOn(row?.settings) }
  }
  app.get('/', requirePermission('company:read'), async (c) => one(c, await read((c.get('user') as any).companyId)))
  app.put('/', requirePermission('company:update'), async (c) => {
    const u = c.get('user') as any
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
    if (typeof b.directoryListing !== 'boolean') return fail(c, 400, 'directoryListing is true or false.', 'BAD_SETTING')
    const [row] = await d.db.select({ settings: company.settings }).from(company).where(eq(company.id, u.companyId)).limit(1)
    const settings = { ...((row?.settings as any) || {}), clientApp: { ...(((row?.settings as any) || {}).clientApp || {}), directoryListing: b.directoryListing } }
    await d.db.update(company).set({ settings } as any).where(eq(company.id, u.companyId))
    d.audit.log({ req: c, action: 'update', entity: 'company', entityId: u.companyId, changes: { directoryListing: b.directoryListing } })
    return one(c, await read(u.companyId))
  })
  return app
}
