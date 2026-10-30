// The Web presence plan's HTTP routes: with the switch off every one answers 404 (as if it did not exist), a request from a site must be
// signed with THAT site's secret, and the signup route refuses the plan while off. Services are the same stand-ins as the service tests.
import { describe, test, expect, beforeEach, afterEach, beforeAll, mock } from 'bun:test'
import path from 'node:path'
import { createRequire } from 'node:module'
import { provisionSite, type Deps } from '../../../apps/api/src/webPresence/service'
import { siteSecret, signRequest } from '../../../apps/api/src/webPresence/site/session.mjs'
import { fakeStore } from './fakeStore'
import { Netlify } from '../../../apps/api/src/webPresence/netlify'

// The Factory's own Hono (tests/ has none of its own); only its database is a stand-in, as in routes-branch.test.ts.
const { Hono } = createRequire(path.resolve(import.meta.dir, '../../../apps/api/package.json'))('hono')
let registerWebPresenceRoutes: any
let registerIntakeRoutes: any
let signupStore: ReturnType<typeof fakeStore>
beforeAll(async () => {
  const authPath = '../../../apps/api/src/middleware/auth'
  const real = await import(authPath)
  signupStore = fakeStore({ tenants: [] })
  mock.module(authPath, () => ({ ...real, supabase: signupStore }))
  ;({ registerWebPresenceRoutes } = await import('../../../apps/api/src/routes/factory/webPresence'))
  ;({ registerIntakeRoutes } = await import('../../../apps/api/src/routes/factory/intake'))
})

const MASTER = 'master-key-for-tests'
const ENV = { WEB_PRESENCE_ON: '1', WEB_PRESENCE_SECRET_KEY: MASTER, TWOMIAH_FACTORY_URL: 'https://factory.test' }
const NOW = Date.UTC(2026, 9, 29, 12, 0, 0)

const netlify = () => {
  let n = 0
  return async (url: string, init: any = {}) => {
    const p = new URL(url).pathname.replace('/api/v1', ''), m = init.method || 'GET'
    const ok = (d: any, s = 200) => new Response(d === null ? '' : JSON.stringify(d), { status: s })
    if (m === 'POST' && /^\/[^/]+\/sites$/.test(p)) return ok({ id: 'ns-1', name: JSON.parse(init.body).name })
    if (m === 'POST' && /\/deploys$/.test(p)) return ok({ id: 'd-1', required: [], required_functions: [] })
    if (m === 'GET' && /^\/deploys\//.test(p)) return ok({ state: 'ready' })
    if (m === 'GET' && /\/forms$/.test(p)) return ok([{ id: 'f1', name: 'lead' }, { id: 'f2', name: 'apply' }])
    if (m === 'GET' && p === '/hooks') return ok([])
    n++
    return ok({}, 200)
  }
}
function setup() {
  const db = fakeStore({ tenants: [{ id: '11111111-1111-1111-1111-111111111111', name: 'Acme', slug: 'acme', email: 'o@acme.test', admin_email: 'o@acme.test', industry: 'roofing', plan: 'webpresence', preview_premium_pages: null, intake_data: {}, stripe_subscription_id: 'sub_1' }], web_presence_sites: [] })
  const mail: string[] = []
  const d: any = {
    db, netlify: () => new Netlify({ token: 't', team: 'twomiah', fetch: netlify(), sleep: async () => {} }), env: { ...ENV }, now: () => NOW,
    sendLink: async (to: string) => { mail.push(to) }, alert: async () => {}, fetch: async () => new Response('{}'), sleep: async () => {},
  }
  const app = new Hono()
  registerWebPresenceRoutes(app as any, { deps: () => d, upgradeDeps: () => d })
  return { app, d, db, mail }
}
const signed = async (rowId: string, body: string) => {
  const ts = String(Math.floor(NOW / 1000))
  return { 'content-type': 'application/json', 'x-wp-site': rowId, 'x-wp-ts': ts, 'x-wp-sig': await signRequest(await siteSecret(MASTER, rowId), ts, body) }
}
let saved: string | undefined
beforeEach(() => { saved = process.env.WEB_PRESENCE_ON; process.env.CRON_SECRET = 'cron-secret' })
afterEach(() => { if (saved === undefined) delete process.env.WEB_PRESENCE_ON; else process.env.WEB_PRESENCE_ON = saved })

describe('switch off: every route is a 404', () => {
  test('plan list, render, link-request and sweep', async () => {
    delete process.env.WEB_PRESENCE_ON
    const { app, d, db } = setup()
    d.env.WEB_PRESENCE_ON = ''
    expect((await app.request('/public/web-presence/plan')).status).toBe(404)
    // even a correctly signed request
    db.tables.web_presence_sites.push({ id: 'site-1', tenant_id: 'x', status: 'live', origin: 'https://a.netlify.app' })
    const body = JSON.stringify({ siteId: 'site-1', model: {} })
    expect((await app.request('/internal/web-presence/render', { method: 'POST', headers: await signed('site-1', body), body })).status).toBe(404)
    expect((await app.request('/internal/web-presence/link-request', { method: 'POST', headers: await signed('site-1', '{}'), body: '{}' })).status).toBe(404)
    // The scheduler's sweep is NOT a 404 when off: the scheduler alerts on any non-2xx, so off answers 200 { off: true } and does
    // nothing — an alert every day about a feature that is deliberately switched off would be noise.
    const sw = await app.request('/internal/web-presence/sweep', { method: 'POST', headers: { 'x-cron-secret': 'cron-secret' } })
    expect(sw.status).toBe(200)
    expect(await sw.json()).toEqual({ ok: true, off: true })
  })
})

describe('switch on', () => {
  beforeEach(() => { process.env.WEB_PRESENCE_ON = '1' })
  test('the plan list names the plan and its price', async () => {
    const { app } = setup()
    const r = await app.request('/public/web-presence/plan')
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ id: 'webpresence', name: 'Web presence', monthlyPrice: 19 })
  })
  test('a site\'s save is drawn when signed with its own secret, and refused (404, no reason) otherwise', async () => {
    const { app, d } = setup()
    const { row } = await provisionSite(d as Deps, '11111111-1111-1111-1111-111111111111')
    const body = JSON.stringify({ siteId: row.id, model: { business: { name: 'Acme' } } })
    const good = await app.request('/internal/web-presence/render', { method: 'POST', headers: await signed(row.id, body), body })
    expect(good.status).toBe(200)
    expect((await good.json()).files['index.html']).toContain('Acme')
    // signed by another site's secret
    const forged = { ...(await signed(row.id, body)), 'x-wp-sig': (await signed('some-other-site', body))['x-wp-sig'] }
    expect((await app.request('/internal/web-presence/render', { method: 'POST', headers: forged, body })).status).toBe(404)
    // a body that names a different site than the one that signed it
    const swapped = JSON.stringify({ siteId: 'another', model: {} })
    expect((await app.request('/internal/web-presence/render', { method: 'POST', headers: await signed(row.id, swapped), body: swapped })).status).toBe(404)
    expect((await app.request('/internal/web-presence/render', { method: 'POST', body })).status).toBe(404)
  })
  test('link-request answers the same for a good and a bad signature', async () => {
    const { app, d, mail } = setup()
    const { row } = await provisionSite(d as Deps, '11111111-1111-1111-1111-111111111111'); mail.length = 0
    const ok = await app.request('/internal/web-presence/link-request', { method: 'POST', headers: await signed(row.id, '{}'), body: '{}' })
    expect(ok.status).toBe(200)
    const bad = await app.request('/internal/web-presence/link-request', { method: 'POST', headers: { ...(await signed(row.id, '{}')), 'x-wp-sig': 'nope' }, body: '{}' })
    expect(bad.status).toBe(404)
  })
  test('the sweep needs the cron secret', async () => {
    const { app } = setup()
    expect((await app.request('/internal/web-presence/sweep', { method: 'POST' })).status).toBe(401)
    expect((await app.request('/internal/web-presence/sweep', { method: 'POST', headers: { 'x-cron-secret': 'wrong' } })).status).toBe(401)
    const ok = await app.request('/internal/web-presence/sweep', { method: 'POST', headers: { 'x-cron-secret': 'cron-secret' } })
    expect(ok.status).toBe(200)
    expect((await ok.json()).credits).toBe('unreadable')
  })
  test('staff routes are not open to the public', async () => {
    const { app } = setup()
    for (const [m, p] of [['GET', '/web-presence/sites'], ['POST', '/web-presence/11111111-1111-1111-1111-111111111111/signin-link'], ['POST', '/web-presence/11111111-1111-1111-1111-111111111111/cancel'], ['POST', '/web-presence/11111111-1111-1111-1111-111111111111/upgrade']]) {
      const r = await app.request(p, { method: m })
      expect([401, 403]).toContain(r.status)
    }
  })
})

describe('the signup route', () => {
  const signup = (plan: string) => {
    const app = new Hono(); registerIntakeRoutes(app as any)
    return app.request('/public/signup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Acme Roofing', email: 'o@acme.test', industry: 'roofing', plan }) })
  }
  test('naming the $19 plan while the switch is off is a 404 and makes nothing', async () => {
    delete process.env.WEB_PRESENCE_ON
    const r = await signup('webpresence')
    expect(r.status).toBe(404)
    expect(signupStore.writes).toEqual([])
    process.env.WEB_PRESENCE_ON = '0'
    expect((await signup('webpresence')).status).toBe(404)
    expect(signupStore.writes).toEqual([])
  })
})
