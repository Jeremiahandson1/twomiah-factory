// A premium website's records read through its admin API and its site.db rebuilt from them (apps/api/src/unified/
// siteExport.ts): the token the template's own middleware takes, each page read whole, every value back in the column
// form the template stores it in — and a site with rows the export cannot carry refused, not emptied.
import { test, expect, describe } from 'bun:test'
import crypto from 'node:crypto'
import path from 'node:path'
import { Database } from 'bun:sqlite'
import fs from 'node:fs'
import os from 'node:os'
import { exportPremiumSite, buildSiteDb, factoryToken } from '../../../apps/api/src/unified/siteExport'

const ROOT = path.resolve(import.meta.dir, '..', '..', '..')
const BAR = path.join(ROOT, 'templates/website-premium-bar')
const SECRET = 'site-jwt-secret'
const T = '2026-09-01T12:00:00.000Z'

/** The site's admin API as the template answers it: drizzle rows as JSON (Dates as ISO strings). */
function site(over: Record<string, unknown> = {}) {
  const pages = [
    { id: 'pg-home', slug: 'home', title: 'Home', sections: [{ type: 'hero', variant: 'split', data: { title: 'Supper club', image: '/media/photos/h.jpg' } }], metaTitle: 'Amber-like', metaDescription: null, isPublished: true, navOrder: 0, createdAt: T, updatedAt: T },
    { id: 'pg-menu', slug: 'menu', title: 'Menu', sections: [], metaTitle: null, metaDescription: null, isPublished: false, navOrder: 2, createdAt: T, updatedAt: T },
  ]
  const answers: Record<string, unknown> = {
    settings: { settings: { id: 's1', companyName: 'Amber-like Inn', tagline: 'Since 1946', phone: '715-555-0100', email: null, address: null, seoTitle: 'Supper club', seoDescription: null,
      nav: [{ label: 'Menu', href: '/menu' }], photoCredits: [], contentGaps: [{ id: 'hours', label: 'Hours' }], serviceAreas: [], inventoryFeedUrl: null, contactCtaLabel: 'Reserve',
      primaryColor: '#7a1f1f', secondaryColor: null, accentColor: null, logoUrl: '/media/photos/logo.png', faviconUrl: null, googleTagManagerId: null, googleAnalyticsId: null, googleAdsId: null,
      facebookPixelId: null, microsoftClarityId: null, bookingHeroTitle: null, bookingHeroSubtitle: null, bookingConfirmCta: null, bookingThanksMessage: null, bookingDefaultDriveTimeMinutes: 15,
      bookingIcalFeedToken: null, customizerToken: null, crmUrl: 'https://crm.example', crmReadyAt: T, updatedAt: T } },
    pages: { pages: pages.map(({ id, slug, title, isPublished, navOrder, updatedAt }) => ({ id, slug, title, isPublished, navOrder, updatedAt })) },
    'pages/home': { page: pages[0] }, 'pages/menu': { page: pages[1] },
    photos: { photos: [{ id: 'ph1', url: '/media/photos/h.jpg', storageKey: 'photos/h.jpg', alt: 'The room', width: 1600, height: 900, bytes: 8, contentType: 'image/jpeg', tag: 'hero', createdAt: T }] },
    leads: { leads: [{ id: 'l1', name: 'Lena', email: 'lena@x.example', phone: null, message: 'Party of 12', source: '/contact', status: 'new', notes: null, createdAt: T }] },
    users: { users: [{ id: 'u1', email: 'owner@x.example', name: 'Owner', role: 'admin', lastLoginAt: null, createdAt: T }] },
    posts: { posts: [] }, projects: { projects: [] },
    'booking-services': { services: [] }, 'booking-availability': { rules: [] }, 'booking-blackouts': { blackouts: [] }, 'booking-zones': { zones: [] },
    bookings: { bookings: [] }, 'booking-series': { series: [] }, 'booking-waitlist': { waitlist: [] }, 'booking-bans': { bans: [] }, 'booking-webhooks': { webhooks: [] },
    'email-aliases': { aliases: [] },
    ...over,
  }
  const asked: string[] = []
  const fetchImpl = async (url: string, init?: RequestInit) => {
    const p = new URL(url).pathname.replace('/api/admin/', '')
    asked.push(p)
    // The template's middleware: HS256 with the site's secret.
    const [h, b, sig] = String((init?.headers as any)?.Authorization || '').replace('Bearer ', '').split('.')
    if (crypto.createHmac('sha256', SECRET).update(`${h}.${b}`).digest('base64url') !== sig) return new Response('{}', { status: 401 })
    return p in answers ? Response.json(answers[p]) : new Response('{}', { status: 404 })
  }
  return { fetchImpl: fetchImpl as any, asked }
}

describe('the export', () => {
  test('signs the template\'s server-to-server token: no jti, an admin, ten minutes', () => {
    const [, body] = factoryToken(SECRET, 1000).split('.')
    expect(JSON.parse(Buffer.from(body, 'base64url').toString())).toEqual({ sub: 'factory-export', email: 'factory@twomiah.com', role: 'admin', iat: 1000, exp: 1600 })
  })

  test('reads every table whole — each page by its slug, not the list\'s summary', async () => {
    const s = site()
    const ex = await exportPremiumSite({ baseUrl: 'https://old.example/', jwtSecret: SECRET, fetchImpl: s.fetchImpl })
    expect(ex.tables.pages.map((p) => p.slug)).toEqual(['home', 'menu'])
    expect((ex.tables.pages[0] as any).sections[0].data.title).toBe('Supper club')
    expect(s.asked).toContain('pages/home')
    expect(s.asked.every((p) => !p.includes('..'))).toBe(true)
  })

  test('a site holding bookings is refused — moving it would lose them', async () => {
    const s = site({ bookings: { bookings: [{ id: 'b1' }] }, 'email-aliases': { aliases: [{ id: 'a1' }, { id: 'a2' }] } })
    await expect(exportPremiumSite({ baseUrl: 'https://old.example', jwtSecret: SECRET, fetchImpl: s.fetchImpl })).rejects.toThrow(/bookings \(1\), email aliases \(2\)/)
  })

  test('a wrong secret is an error, not an empty site', async () => {
    const s = site()
    await expect(exportPremiumSite({ baseUrl: 'https://old.example', jwtSecret: 'wrong', fetchImpl: s.fetchImpl })).rejects.toThrow(/answered 401/)
  })
})

describe('the rebuilt site.db', () => {
  test('every value lands in the column form the template stores: json as text, times as ms, flags as 0/1', async () => {
    const s = site()
    const bytes = buildSiteDb(BAR, await exportPremiumSite({ baseUrl: 'https://old.example', jwtSecret: SECRET, fetchImpl: s.fetchImpl }))
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'site-export-test-'))
    fs.writeFileSync(path.join(dir, 'site.db'), bytes)
    const db = new Database(path.join(dir, 'site.db'), { readonly: true })
    const set = db.query('SELECT * FROM settings').get() as any
    expect(JSON.parse(set.nav)).toEqual([{ label: 'Menu', href: '/menu' }])
    expect(JSON.parse(set.content_gaps)).toEqual([{ id: 'hours', label: 'Hours' }])
    expect(set.updated_at).toBe(Date.parse(T))
    expect(set.crm_ready_at).toBe(Date.parse(T))
    expect(set.booking_default_drive_time_minutes).toBe(15)
    const pages = db.query('SELECT slug, is_published, nav_order, meta_title, sections, created_at FROM pages ORDER BY nav_order').all() as any[]
    expect(pages.map((p) => [p.slug, p.is_published, p.nav_order, p.meta_title])).toEqual([['home', 1, 0, 'Amber-like'], ['menu', 0, 2, null]])
    expect(JSON.parse(pages[0].sections)[0].data.image).toBe('/media/photos/h.jpg')
    expect(pages[0].created_at).toBe(Date.parse(T))
    expect(db.query('SELECT storage_key, width FROM photos').get()).toEqual({ storage_key: 'photos/h.jpg', width: 1600 })
    expect(db.query('SELECT email, role, password_hash FROM users').get()).toEqual({ email: 'owner@x.example', role: 'admin', password_hash: '!' })
    expect((db.query('SELECT count(*) AS n FROM leads').get() as any).n).toBe(1)
    db.close()
  })
})
