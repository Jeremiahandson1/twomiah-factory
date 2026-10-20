// The unified server boots on an empty database and its core holds: sign-in, the one API door, feature switches,
// the Factory's key, paging, replies in the rulebook's shapes, an audit row for a sign-in, and the admin screens served.
import { describe, test, expect, beforeAll } from 'bun:test'
import { Hono } from 'hono'
import { eq, getTableName, is } from 'drizzle-orm'
import { PgTable } from 'drizzle-orm/pg-core'
import * as schema from '../server/db/schema/index.ts'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { bootTenant, seedOwner } from './harness.ts'
import { mountAll } from '../server/http/registry.ts'
import { one } from '../server/http/reply.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let seeded: Awaited<ReturnType<typeof seedOwner>>

beforeAll(async () => {
  t = await bootTenant()
  seeded = await seedOwner(t)
})

const login = (password: string) => t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password } })

describe('boot', () => {
  test('every migration applies to an empty database, and builds exactly the schema', async () => {
    const r: any = await t.client.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY 1`)
    const declared = Object.values(schema).filter((x) => is(x, PgTable)).map((x) => getTableName(x as PgTable)).sort()
    expect(r.rows.map((x: any) => x.table_name)).toEqual(declared)
    // Every layer: 15 core, website and enquiry tables, 11 bookings, the base CRM's other 135 (the CRM's own three
    // booking tables are replaced by the bookings layer), the 65 the near-copy CRMs add (migration 0006), home care's
    // 123 (0007), roofing's own 16 (0012), the store's 13 (0013), and what each job was last announced as (0015, phone notifications).
    expect(declared.length).toBe(379)
    for (const name of ['job', 'invoice', 'change_order', 'pricebook_item', 'sms_message', 'support_ticket', 'insurance_claim', 'orders', 'store_settings']) expect(declared).toContain(name)
  })

  test('health answers', async () => {
    const res = await t.call('/health')
    expect(res.status).toBe(200)
    expect((await res.json()).status).toBe('ok')
  })

  test('an unknown API path is a JSON 404, not a page', async () => {
    const res = await t.call('/api/nothing-here')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Route not found: GET /api/nothing-here' })
  })

  test('a bad page number is refused in the error shape', async () => {
    const res = await t.call('/api/nothing-here?page=-1')
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Invalid page: must be an integer ≥ 1', code: 'invalid_pagination' })
  })
})

describe('sign-in', () => {
  test('a wrong password is refused', async () => {
    const res = await login('wrong-password-1')
    expect(res.status).toBe(401)
    expect(typeof (await res.json()).error).toBe('string')
  })

  test('the owner signs in and /me answers who they are, as the contractor vertical', async () => {
    const res = await login(seeded.password)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(typeof body.accessToken).toBe('string')
    const me = await t.call('/api/auth/me', { headers: { Authorization: `Bearer ${body.accessToken}` } })
    expect(me.status).toBe(200)
    const who = await me.json()
    expect(JSON.stringify(who)).toContain('owner@test.example')
    expect(JSON.stringify(who)).toContain('"vertical":"contractor"')
  })

  test('the sign-in is in the audit log, with the person', async () => {
    const rows = await t.db.select().from(t.schema.auditLog).where(eq(t.schema.auditLog.action, 'login'))
    expect(rows.length).toBeGreaterThan(0)
    expect(rows[0].userEmail).toBe('owner@test.example')
    expect(rows[0].companyId).toBe(seeded.company.id)
  })

  test('two-factor enrolment needs a session', async () => {
    const res = await t.call('/api/auth/mfa-devices')
    expect(res.status).toBe(401)
  })
})

describe('the browser session in cookies (SPEC §5.3)', () => {
  const cookieLogin = () => t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: seeded.password }, headers: { 'X-Auth-Mode': 'cookie' } })
  /** name=value pairs from a response's Set-Cookie headers, plus each cookie's attributes. */
  const cookiesOf = (res: Response) => {
    const out: Record<string, { value: string; attrs: string }> = {}
    for (const line of res.headers.getSetCookie()) {
      const [pair, ...attrs] = line.split(';')
      const i = pair.indexOf('=')
      out[pair.slice(0, i).trim()] = { value: pair.slice(i + 1).trim(), attrs: attrs.join(';') }
    }
    return out
  }

  test('sign-in sets both tokens as httpOnly, SameSite=Strict cookies and leaves them out of the reply', async () => {
    const res = await cookieLogin()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.accessToken).toBeUndefined()
    expect(body.refreshToken).toBeUndefined()
    expect(body.user.email).toBe('owner@test.example')
    const c = cookiesOf(res)
    expect(c.tw_access.value.length).toBeGreaterThan(20)
    expect(c.tw_access.attrs).toMatch(/HttpOnly/i)
    expect(c.tw_access.attrs).toMatch(/SameSite=Strict/i)
    expect(c.tw_refresh.attrs).toMatch(/Path=\/api\/auth/i)
  })

  test('the cookie signs a request in; a change it signs without X-Auth-Mode is refused', async () => {
    const c = cookiesOf(await cookieLogin())
    const cookie = `tw_access=${c.tw_access.value}`
    expect((await t.call('/api/auth/me', { headers: { Cookie: cookie } })).status).toBe(200)
    const bare = await t.call('/api/auth/logout', { method: 'POST', json: {}, headers: { Cookie: cookie } })
    expect(bare.status).toBe(403)
    expect((await bare.json()).code).toBe('auth_mode_required')
  })

  test('refresh renews the access cookie from the refresh cookie; sign-out clears both and revokes the device', async () => {
    const c = cookiesOf(await cookieLogin())
    const both = `tw_access=${c.tw_access.value}; tw_refresh=${c.tw_refresh.value}`
    const refreshed = await t.call('/api/auth/refresh', { method: 'POST', json: {}, headers: { Cookie: `tw_refresh=${c.tw_refresh.value}`, 'X-Auth-Mode': 'cookie' } })
    expect(refreshed.status).toBe(200)
    expect(await refreshed.json()).toEqual({ refreshed: true })
    expect(cookiesOf(refreshed).tw_access.value.length).toBeGreaterThan(20)

    const out = await t.call('/api/auth/logout', { method: 'POST', json: {}, headers: { Cookie: both, 'X-Auth-Mode': 'cookie' } })
    expect(out.status).toBe(200)
    const cleared = cookiesOf(out)
    expect(cleared.tw_access.attrs).toMatch(/Max-Age=0/i)
    expect(cleared.tw_refresh.attrs).toMatch(/Max-Age=0/i)
    const again = await t.call('/api/auth/refresh', { method: 'POST', json: {}, headers: { Cookie: `tw_refresh=${c.tw_refresh.value}`, 'X-Auth-Mode': 'cookie' } })
    expect(again.status).toBe(401)
  })

  test('without the header, sign-in answers with the tokens as it always has (the mobile app, scripts)', async () => {
    const body = await (await login(seeded.password)).json()
    expect(typeof body.accessToken).toBe('string')
    expect(typeof body.refreshToken).toBe('string')
  })
})

describe('the one API door (registry)', () => {
  // A small app with three probe modules mounted the only way the rulebook allows.
  const probe = () => new Hono().get('/', (c) => one(c, { reached: true }))
  let app: Hono
  let token: string

  beforeAll(async () => {
    app = new Hono()
    mountAll(app, [
      { path: '/api/probe-user', access: 'user', router: probe(), feature: 'probe_feature' },
      { path: '/api/probe-public', access: 'public', router: probe(), feature: 'probe_feature' },
      { path: '/api/probe-factory', access: 'factory', router: probe() },
    ], {
      authenticate: t.services.authenticate,
      requireEnabledFeature: t.services.features.requireEnabledFeature,
      isFeatureEnabled: t.services.features.isFeatureEnabled,
      companyId: t.services.companyId,
    })
    token = (await (await login(seeded.password)).json()).accessToken
  })

  const get = (path: string, headers: Record<string, string> = {}) => app.request(path, { headers })

  test('a signed-in module refuses anyone not signed in', async () => {
    expect((await get('/api/probe-user')).status).toBe(401)
  })

  test('a switched-off module is refused at the server, signed in or public', async () => {
    const res = await get('/api/probe-user', { Authorization: `Bearer ${token}` })
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('FEATURE_NOT_ENABLED')
    expect((await get('/api/probe-public')).status).toBe(404)
  })

  test('switching the feature on opens both', async () => {
    await t.db.update(t.schema.company).set({ enabledFeatures: ['probe_feature'] }).where(eq(t.schema.company.id, seeded.company.id))
    t.services.features.forgetFeatures()
    expect((await get('/api/probe-user', { Authorization: `Bearer ${token}` })).status).toBe(200)
    expect((await get('/api/probe-public')).status).toBe(200)
  })

  test("the Factory's door: closed with no key configured, refused with a wrong key, open with the right one", async () => {
    delete process.env.FACTORY_SYNC_KEY
    expect((await get('/api/probe-factory')).status).toBe(503)
    process.env.FACTORY_SYNC_KEY = 'factory-key-for-test'
    expect((await get('/api/probe-factory', { 'X-Factory-Key': 'wrong-key-for-test!!' })).status).toBe(401)
    expect((await get('/api/probe-factory', { 'X-Factory-Key': 'factory-key-for-test' })).status).toBe(200)
  })

  test('a path declared twice is a startup error, not a silent second mount', () => {
    expect(() => mountAll(new Hono(), [
      { path: '/api/twice', access: 'public', router: probe() },
      { path: '/api/twice', access: 'public', router: probe() },
    ], {} as any)).toThrow('declared twice')
  })

  test('the admin screens mount once, before the website, and the website and they share "/"', () => {
    const site = { path: '/', site: true as const, access: 'public' as const, router: probe() }
    const admin = { path: '/', admin: true as const, access: 'public' as const, router: probe() }
    expect(() => mountAll(new Hono(), [admin, site], {} as any)).not.toThrow()
    expect(() => mountAll(new Hono(), [site, admin], {} as any)).toThrow('before the website')
    expect(() => mountAll(new Hono(), [admin, { ...admin }], {} as any)).toThrow('declared twice')
  })
})

describe('the admin screens', () => {
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-dist-'))
  fs.mkdirSync(path.join(dist, 'assets'))
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><html><head><title>Admin</title><script type="module" src="/crm-assets/assets/app-1a2b.js"></script></head><body><div id="root"></div></body></html>')
  fs.writeFileSync(path.join(dist, 'assets', 'app-1a2b.js'), 'console.log(1)')
  let a: Awaited<ReturnType<typeof bootTenant>>
  beforeAll(async () => {
    a = await bootTenant({ adminDist: dist })
    await a.db.insert(a.schema.company).values({ name: 'Smith & Sons', slug: 'smith-sons' })
  })

  test('the sign-in pages and everything under /crm are the admin page, named for the business, never cached', async () => {
    for (const p of ['/login', '/forgot-password', '/reset-password?token=x', '/crm', '/crm/website/pages/home']) {
      const res = await a.call(p)
      expect(res.status).toBe(200)
      expect(res.headers.get('cache-control')).toBe('no-store')
      const html = await res.text()
      expect(html).toContain('<meta name="company-name" content="Smith &amp; Sons">')
      expect(html).toContain('<title>Smith &amp; Sons · Admin</title>')
    }
  })

  test('its built files are served for good; nothing outside the build, and not the page itself', async () => {
    const js = await a.call('/crm-assets/assets/app-1a2b.js')
    expect(js.status).toBe(200)
    expect(js.headers.get('content-type')).toContain('text/javascript')
    expect(js.headers.get('cache-control')).toContain('immutable')
    expect((await a.call('/crm-assets/index.html')).status).toBe(404)
    expect((await a.call('/crm-assets/..%2F..%2Fpackage.json')).status).toBe(404)
    expect((await a.call('/crm-assets/assets/missing.js')).status).toBe(404)
  })

  test("the website gets the website's policy (its inline scripts and tracking run); the admin keeps the strict one", async () => {
    const site = (await a.call('/')).headers.get('content-security-policy') || ''
    expect(site).toContain("script-src 'self' 'unsafe-inline'")
    expect(site).toContain('https://www.googletagmanager.com')
    expect(site).toContain("frame-ancestors 'self'")
    const admin = (await a.call('/crm')).headers.get('content-security-policy') || ''
    const adminScripts = admin.split('; ').find((d) => d.startsWith('script-src')) || ''
    expect(adminScripts).toMatch(/^script-src 'self' https:\/\/js\.stripe\.com/)
    expect(adminScripts).not.toContain('unsafe-inline')
    const api = (await a.call('/api/nothing')).headers.get('content-security-policy') || ''
    expect(api).not.toContain("'unsafe-inline' https://www.googletagmanager")
  })

  test('the public website keeps its own paths', async () => {
    expect((await a.call('/')).headers.get('content-type')).toContain('text/html')
    expect(await (await a.call('/')).text()).not.toContain('company-name')
  })

  // A home-care agency's portals, invoice payment, onboarding packet and careers page are the app's pages
  // (server/http/adminScreens.ts HOMECARE_PAGES); for every other business those paths stay the website's.
  test("home care's public pages are the admin page for an agency only", async () => {
    const pages = ['/portal', '/portal/setup?token=x', '/family', '/family/schedule', '/pay/abc', '/payment-success', '/onboarding/tok', '/careers', '/careers/cna']
    const agency = await bootTenant({ adminDist: dist, vertical: 'homecare' })
    await agency.db.insert(agency.schema.company).values({ name: 'Mary’s Care', slug: 'marys-care', primaryColor: '#0f766e', secondaryColor: '#b45309', email: 'office@marys.example' })
    for (const p of pages) {
      const res = await agency.call(p)
      expect(res.status).toBe(200)
      const html = await res.text()
      expect(html).toContain('<div id="root"></div>')
      // No shell loads the company for a visitor who isn't signed in: the agency's colours come with the page.
      expect(html).toContain('<meta name="brand-primary" content="#0f766e"><meta name="brand-secondary" content="#b45309">')
      // The invoice payment page names the agency's email, as the template's did.
      expect(html).toContain('<meta name="company-email" content="office@marys.example">')
    }
    expect(await (await agency.call('/vertical-check-none')).text()).not.toContain('<div id="root"></div>')
    for (const p of ['/family', '/careers', '/pay/abc', '/onboarding/tok']) {
      expect(await (await a.call(p)).text()).not.toContain('<div id="root"></div>')
    }
  })

  test('a server without the build says so instead of a blank page', async () => {
    const bare = await bootTenant({ adminDist: path.join(dist, 'nope') })
    const res = await bare.call('/crm')
    expect(res.status).toBe(503)
    expect(await res.text()).toContain('build:web')
  })
})
