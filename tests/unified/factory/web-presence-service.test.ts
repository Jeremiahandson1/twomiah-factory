// The Web presence plan on the Factory side, end to end with every outside thing stood in: the database (fakeStore), the Netlify API
// (a fake fetch that behaves like it, behind the REAL Netlify client), Netlify Forms, mail, Stripe. No live call is made anywhere here.
// Covers: one site per customer, set-up order and what the site's settings hold, sign-in links, the site asking the Factory (signed),
// cancel at the end of the paid period, the move up to the full plan, a change of trade, the credit watch, the signup — and that
// with the switch off every one of those refuses.
import { describe, test, expect, beforeEach } from 'bun:test'
import { fakeStore } from './fakeStore'
import { Netlify } from '../../../apps/api/src/webPresence/netlify'
import {
  provisionSite, verifySiteRequest, renderForSite, requestLink, staffLink, signinLinkFor, cancelAtPeriodEnd, removeSite, sweep, SignatureError,
  siteRowFor, type Deps,
} from '../../../apps/api/src/webPresence/service'
import { startUpgrade, changeTrade, homeCompositionFrom, type UpgradeDeps } from '../../../apps/api/src/webPresence/upgrade'
import { creditWatch, siteUsage } from '../../../apps/api/src/webPresence/watch'
import { webPresenceSignup } from '../../../apps/api/src/webPresence/signup'
import { webPresenceOn, WebPresenceOffError, planListFor, planAccepted, requireWebPresence } from '../../../apps/api/src/webPresence/switch'
import { composeOnePage } from '../../../apps/api/src/webPresence/compose'
import { buildSpec, canonicalise } from '../../../apps/api/src/webPresence/spec'
import { siteSecret, verifySignin, signRequest } from '../../../apps/api/src/webPresence/site/session.mjs'
import { createHandler } from '../../../apps/api/src/webPresence/site/handler.mjs'

const MASTER = 'master-key-for-tests'
const ON = { WEB_PRESENCE_ON: '1', WEB_PRESENCE_SECRET_KEY: MASTER, TWOMIAH_FACTORY_URL: 'https://factory.test' }
const NOW = Date.UTC(2026, 9, 29, 12, 0, 0)

// ─── a fake Netlify ──────────────────────────────────────────────────────────
function fakeNetlify() {
  const log: Array<{ op: string; [k: string]: any }> = []
  const sites = new Map<string, any>(); const hooks: any[] = []; const env = new Map<string, any[]>()
  const formsOn = new Set<string>(); const formsFound = new Set<string>()
  let n = 0; let h = 0
  const taken = new Set<string>()
  const respond = (data: any, status = 200) => new Response(data === null ? '' : JSON.stringify(data), { status })
  const fetch = async (url: string, init: any = {}): Promise<Response> => {
    const u = new URL(url); const p = u.pathname.replace('/api/v1', ''); const m = init.method || 'GET'
    const body = typeof init.body === 'string' ? safe(init.body) : init.body
    let mm: RegExpMatchArray | null
    if (m === 'POST' && (mm = p.match(/^\/([^/]+)\/sites$/))) {
      if (taken.has(body.name)) return respond({ error: 'name taken' }, 422)
      taken.add(body.name)
      const id = 'ns-' + ++n; sites.set(id, { id, name: body.name, team: mm[1] }); log.push({ op: 'createSite', name: body.name, team: mm[1], token: init.headers.Authorization })
      return respond({ id, name: body.name, url: `http://${body.name}.netlify.app`, ssl_url: `https://${body.name}.netlify.app` })
    }
    // Netlify's answers on the team's plan (measured 10/30): chosen scopes are refused, and so is a secret without them.
    if (m === 'POST' && p.match(/^\/accounts\/[^/]+\/env$/) && body.some((b: any) => b.scopes)) return respond({ code: 403, message: 'Upgrade your Netlify account to set specific scopes' }, 403)
    if (m === 'POST' && p.match(/^\/accounts\/[^/]+\/env$/) && body.some((b: any) => b.is_secret)) return respond({ code: 422, message: "Secrets are not allowed to run in 'post_processing' scopes." }, 422)
    // …and as Netlify answers a setting already on the site: creating it again is refused (422), updating it (PUT) is not.
    if (m === 'GET' && p.match(/^\/accounts\/[^/]+\/env$/)) return respond(env.get(u.searchParams.get('site_id')!) || [])
    if (m === 'POST' && p.match(/^\/accounts\/[^/]+\/env$/)) {
      const id = u.searchParams.get('site_id')!; const had = env.get(id) || []
      const dup = body.find((b: any) => had.some((x: any) => x.key === b.key))
      if (dup) return respond({ code: 422, message: `Environment variable ${dup.key} already exists on this site.` }, 422)
      env.set(id, [...had, ...body]); log.push({ op: 'setEnv', siteId: id, keys: body.map((b: any) => b.key), body }); return respond(null, 201)
    }
    if (m === 'PUT' && (mm = p.match(/^\/accounts\/[^/]+\/env\/([^/]+)$/))) {
      const id = u.searchParams.get('site_id')!; const had = env.get(id) || []
      if (!had.some((x: any) => x.key === mm![1])) return respond({ code: 404, message: 'Not found' }, 404)
      env.set(id, had.map((x: any) => (x.key === mm![1] ? body : x))); log.push({ op: 'updateEnv', siteId: id, keys: [mm[1]], body: [body] }); return respond(body)
    }
    // As Netlify does (read 10/30): a new site comes with form detection OFF; forms register only from a deploy made while it is on.
    if (m === 'POST' && (mm = p.match(/^\/sites\/([^/]+)\/deploys$/)) && formsOn.has(mm[1])) formsFound.add(mm[1])
    if (m === 'POST' && (mm = p.match(/^\/sites\/([^/]+)\/deploys$/))) { log.push({ op: 'deploy', siteId: mm[1], files: Object.keys(body.files), functions: Object.keys(body.functions), envAtDeploy: (env.get(mm[1]) || []).map((e: any) => e.key) }); return respond({ id: 'dep-' + ++n, required: Object.values(body.files), required_functions: Object.values(body.functions) }) }
    if (m === 'PUT' && p.match(/^\/deploys\/[^/]+\/(files|functions)/)) { log.push({ op: 'upload', path: p }); return respond({}) }
    if (m === 'GET' && p.match(/^\/deploys\/[^/]+$/)) return respond({ state: 'ready', ssl_url: 'https://x.netlify.app' })
    if (m === 'GET' && (mm = p.match(/^\/sites\/([^/]+)\/forms$/))) return respond(sites.has(mm[1]) && !formsFound.has(mm[1]) ? [] : [{ id: 'form-lead', name: 'lead' }, { id: 'form-apply', name: 'apply' }])
    if (m === 'GET' && p === '/hooks') return respond(hooks.filter((x) => x.site_id === u.searchParams.get('site_id')))
    if (m === 'POST' && p === '/hooks') { const hk = { id: 'hook-' + ++h, ...body }; hooks.push(hk); log.push({ op: 'hook+', form: body.form_id, to: body.data.email }); return respond(hk, 201) }
    if (m === 'DELETE' && (mm = p.match(/^\/hooks\/(.+)$/))) { const i = hooks.findIndex((x) => x.id === mm![1]); if (i >= 0) hooks.splice(i, 1); log.push({ op: 'hook-', id: mm[1] }); return respond(null, 204) }
    if (m === 'DELETE' && (mm = p.match(/^\/sites\/([^/]+)$/))) { sites.delete(mm[1]); log.push({ op: 'deleteSite', siteId: mm[1] }); return respond(null, 204) }
    if (m === 'PATCH' && (mm = p.match(/^\/sites\/([^/]+)$/)) && body?.processing_settings) { if (body.processing_settings.ignore_html_forms === false) formsOn.add(mm[1]); log.push({ op: 'enableForms', siteId: mm[1] }); return respond({}) }
    if (m === 'PATCH' && (mm = p.match(/^\/sites\/([^/]+)$/))) { log.push({ op: 'domain', siteId: mm[1], body }); return respond({}) }
    if (m === 'POST' && p.match(/^\/sites\/[^/]+\/ssl$/)) { log.push({ op: 'ssl' }); return respond({}) }
    return respond({ error: 'unexpected ' + m + ' ' + p }, 599)
  }
  return { fetch, log, sites, hooks, env, taken }
}
const safe = (s: string) => { try { return JSON.parse(s) } catch { return s } }

// ─── the Factory's side ──────────────────────────────────────────────────────
const tenant = (over: Record<string, any> = {}) => ({
  id: 't-1', name: 'Acme Roofing', slug: 'acme-roofing', email: 'owner@acme.test', admin_email: 'owner@acme.test', industry: 'roofing', city: 'Madison', state: 'WI',
  phone: '6085551234', plan: 'webpresence', preview_premium_pages: null, intake_data: {}, factory_sync_key: null, stripe_subscription_id: 'sub_1', billing_status: 'active', status: 'pending', ...over,
})

function world(over: { env?: Record<string, string>; tenants?: any[]; sites?: any[] } = {}) {
  const db = fakeStore({ tenants: over.tenants || [tenant()], web_presence_sites: over.sites || [], factory_jobs: [] })
  const nl = fakeNetlify()
  const mail: Array<{ to: string; link: string; why: string }> = []
  const alerts: Array<{ key: string; what: string; detail: string }> = []
  const ended: string[] = []; const cancelled: string[] = []
  const calls: Array<{ url: string; init: any }> = []
  const clock = { now: NOW }
  const sites = new Map<string, ReturnType<typeof createHandler>>()    // a running site function, by origin, for the Factory's signed calls
  const d: UpgradeDeps = {
    db,
    netlify: () => new Netlify({ token: 'team-token', team: 'twomiah', fetch: nl.fetch, sleep: async () => {} }),
    env: { ...ON, ...(over.env || {}) },
    now: () => clock.now,
    sendLink: async (to, _n, link, why) => { mail.push({ to, link, why }) },
    alert: async (key, what, detail) => { alerts.push({ key, what, detail }) },
    fetch: async (url, init) => {
      calls.push({ url, init })
      const o = new URL(url); const fn = sites.get(o.origin)
      if (fn) return fn(new Request(o.origin + o.pathname + o.search, { method: init?.method, headers: init?.headers, body: init?.body }))
      return new Response('{}', { status: 200 })
    },
    sleep: async () => {},
    endSubscriptionAtPeriodEnd: async (id) => { ended.push(id); return new Date(NOW + 20 * 86400_000) },
    cancelSubscriptionNow: async (id) => { cancelled.push(id) },
    allocateSlug: async (b) => b + '-full',
    checkout: async (t) => ({ url: 'https://checkout.test/' + t.id, stripeCustomerId: 'cus_1' }),
  }
  /** Run the deployed site's function for a row, with a store of its own and the settings the Factory gave it. */
  const runSite = async (siteRowId: string, origin: string, model: any, mount = sites) => {
    const store = new Map<string, any>()
    const kv = { get: async (k: string) => store.get(k) ?? null, set: async (k: string, v: any, o?: any) => { if (o?.onlyIfNew && store.has(k)) return { modified: false }; store.set(k, v); return { modified: true } }, getWithMetadata: async () => null }
    store.set('model', JSON.stringify(model))
    mount.set(origin, createHandler({ store: kv, env: { WP_SITE_ID: siteRowId, WP_SECRET: await siteSecret(MASTER, siteRowId), WP_FACTORY_URL: 'https://factory.test', WP_TENANT_ID: 't-1', WP_FACTORY_KEY: 'k' }, fetchImpl: fetch, now: () => clock.now, initial: { index: '<html/>', privacy: '', model }, spec: {} }))
    return store
  }
  return { db, nl, mail, alerts, ended, cancelled, calls, clock, d, runSite, sites }
}
/** The first page a customer gets: what the signup composes, laid on one page and cleaned — what the editor opens with. */
const firstModel = (t: any = tenant()) => canonicalise(composeOnePage({ businessName: t.name, businessType: t.industry, city: t.city, state: t.state, email: t.admin_email, phone: t.phone } as any, { pages: {} } as any, {}).model, buildSpec(t.industry), null).model as any
const signedHeaders = async (rowId: string, body: string, ts = String(Math.floor(NOW / 1000))) => ({ site: rowId, ts, sig: await signRequest(await siteSecret(MASTER, rowId), ts, body) })

beforeEach(() => { delete process.env.WEB_PRESENCE_ON })

describe('the switch', () => {
  test('only an explicit yes turns it on', () => {
    for (const v of [undefined, '', '0', 'false', 'off', 'no', 'maybe', 'tru']) expect(webPresenceOn({ WEB_PRESENCE_ON: v })).toBe(false)
    for (const v of ['1', 'true', 'ON', ' yes ']) expect(webPresenceOn({ WEB_PRESENCE_ON: v })).toBe(true)
    expect(webPresenceOn({})).toBe(false)
  })
  test('off: the plan is missing from every public list and a signup naming it is not accepted', () => {
    const plans = [{ id: 'website' }, { id: 'webpresence' }, { id: 'team25' }]
    expect(planListFor(plans, {}).map((p) => p.id)).toEqual(['website', 'team25'])
    expect(planListFor(plans, { WEB_PRESENCE_ON: '1' }).map((p) => p.id)).toEqual(['website', 'webpresence', 'team25'])
    expect(planAccepted('webpresence', {})).toBe(false)
    expect(planAccepted('webpresence', { WEB_PRESENCE_ON: 'true' })).toBe(true)
    expect(planAccepted('team25', {})).toBe(true)
    expect(() => requireWebPresence({})).toThrow(WebPresenceOffError)
  })
  test('off: every Factory path refuses and makes no call to Netlify', async () => {
    const w = world({ env: { WEB_PRESENCE_ON: '' }, sites: [{ id: 's-1', tenant_id: 't-1', netlify_site_id: 'ns-1', status: 'live', origin: 'https://acme.netlify.app' }] })
    const refused = async (f: () => Promise<any>) => { await expect(f()).rejects.toBeInstanceOf(WebPresenceOffError) }
    await refused(() => provisionSite(w.d, 't-1'))
    await refused(() => verifySiteRequest(w.d, { site: 's-1', ts: '1', sig: 'x' }, '{}'))
    await refused(() => staffLink(w.d, 't-1'))
    await refused(() => cancelAtPeriodEnd(w.d, 't-1'))
    await refused(() => startUpgrade(w.d, 't-1'))
    await refused(() => changeTrade(w.d, 't-1', 'bar'))
    await refused(() => creditWatch(w.d))
    await refused(() => siteUsage(w.d))
    await refused(() => webPresenceSignup({ name: 'Acme', email: 'a@b.co' }, { db: w.db, env: {}, allocateSlug: async (b) => b, compose: () => ({}), checkout: async () => ({ url: 'x' }) }))
    await refused(() => signinLinkFor(w.d, { id: 's-1' } as any))
    expect(await sweep(w.d)).toEqual({ removed: [], secured: [], retried: [] })
    expect(w.nl.log).toEqual([])
    expect(w.db.writes.filter((x) => x.table === 'tenants' || x.table === 'factory_jobs')).toEqual([])
  })
})

describe('set-up: one Netlify site per customer', () => {
  test('creates exactly one site, sets its settings BEFORE the first deploy, and the team token reaches no customer site', async () => {
    const w = world()
    const out = await provisionSite(w.d, 't-1')
    expect(out.existing).toBe(false)
    const ops = w.nl.log.map((x) => x.op)
    expect(ops.filter((o) => o === 'createSite')).toHaveLength(1)
    expect(ops.indexOf('setEnv')).toBeLessThan(ops.indexOf('deploy'))
    const env = w.nl.log.find((x) => x.op === 'setEnv')!
    expect(env.keys.sort()).toEqual(['WP_FACTORY_KEY', 'WP_FACTORY_URL', 'WP_SECRET', 'WP_SITE_ID', 'WP_TENANT_ID'])
    const all = JSON.stringify(env.body)
    expect(all).not.toContain('team-token')
    expect(all).not.toContain(MASTER)
    // the per-site secret is derived, and differs per site
    expect(env.body.find((b: any) => b.key === 'WP_SECRET').values[0].value).toBe(await siteSecret(MASTER, out.row.id))
    expect(await siteSecret(MASTER, 'a')).not.toBe(await siteSecret(MASTER, 'b'))
    // the deploy: static files + the function, no page files (the function serves them from the site's own Blobs)
    const dep = w.nl.log.find((x) => x.op === 'deploy')!
    expect(dep.functions).toEqual(['site'])
    expect(dep.files).toEqual(expect.arrayContaining(['/styles/main.css', '/sitemap.xml', '/robots.txt', '/llms.txt', '/edit/index.html', '/forms.html', '/_redirects', '/_headers']))
    expect(dep.files).not.toContain('/index.html')
    expect(dep.envAtDeploy).toContain('WP_SECRET')
    // the row and the tenant
    const row = (await siteRowFor(w.d, { tenantId: 't-1' }))!
    expect(row.status).toBe('live'); expect(row.origin).toMatch(/^https:\/\/twomiah-acme-roofing\.netlify\.app$/)
    const t = w.db.tables.tenants[0]
    expect(t.website_url).toBe(row.origin); expect(t.render_backend_url).toBeUndefined() /* no CRM: the health monitor would probe a /health it does not have */; expect(t.factory_sync_key).toMatch(/./); expect(t.status).toBe('active')
    // the content is NOT in the Factory's table
    expect(Object.keys(w.db.tables.web_presence_sites[0]).sort().join()).not.toMatch(/model|page|content|lead|applicant/)
  })
  test('the lead form emails the owner as soon as the site is up; the hiring form (off) emails nobody', async () => {
    const w = world(); await provisionSite(w.d, 't-1')
    expect(w.nl.hooks).toHaveLength(1)
    expect(w.nl.hooks[0].form_id).toBe('form-lead'); expect(w.nl.hooks[0].data.email).toBe('owner@acme.test')
  })
  test('the owner gets one sign-in link, bound to the site, that opens with the site secret and nothing else', async () => {
    const w = world(); const { row } = await provisionSite(w.d, 't-1')
    expect(w.mail).toHaveLength(1); expect(w.mail[0].to).toBe('owner@acme.test'); expect(w.mail[0].why).toBe('welcome')
    const m = w.mail[0].link.match(/^(https:\/\/[^/]+)\/edit\/#t=(.+)$/)!
    expect(m[1]).toBe(row.origin)
    const secret = await siteSecret(MASTER, row.id)
    expect((await verifySignin(secret, m[2], row.id, NOW)).ok).toBe(true)
    expect((await verifySignin(secret, m[2], 'another-site', NOW)).ok).toBe(false)
    expect((await verifySignin(await siteSecret(MASTER, 'another-site'), m[2], row.id, NOW)).ok).toBe(false)
    expect((await verifySignin(secret, m[2], row.id, NOW + 16 * 60_000)).error).toBe('expired')
  })
  test('asking again does not make a second site (a retry, a double webhook, a second request)', async () => {
    const w = world()
    await provisionSite(w.d, 't-1')
    const again = await provisionSite(w.d, 't-1')
    expect(again.existing).toBe(true)
    expect(w.nl.log.filter((x) => x.op === 'createSite')).toHaveLength(1)
    expect(w.db.tables.web_presence_sites).toHaveLength(1)
    expect(w.mail).toHaveLength(1)
  })
  test('two customers get two sites with two secrets', async () => {
    const w = world({ tenants: [tenant(), tenant({ id: 't-2', slug: 'other-co', name: 'Other', email: 'o@o.test', admin_email: 'o@o.test' })] })
    const a = await provisionSite(w.d, 't-1'); const b = await provisionSite(w.d, 't-2')
    expect(a.row.netlify_site_id).not.toBe(b.row.netlify_site_id)
    expect(w.mail[0].link).not.toBe(w.mail[1].link)
  })
  // 10/29, the first live $19 signup: the site row was refused (42501), the failure was a log line, nothing retried it.
  test('a paid customer whose site could not even be recorded: staff are alerted, and the hourly sweep sets it up once it can', async () => {
    const w = world({ tenants: [tenant(), tenant({ id: 't-2', slug: 'unpaid-co', billing_status: 'pending' })] })
    const db = w.d.db as any
    const refuse = { message: 'permission denied for table web_presence_sites' }
    w.d.db = { from: (t: string) => t !== 'web_presence_sites' ? db.from(t) : { ...db.from(t), insert: () => ({ select: () => ({ single: async () => ({ data: null, error: refuse }) }) }) } } as any
    await expect(provisionSite(w.d, 't-1')).rejects.toThrow(/permission denied/)
    expect(w.alerts.map((a) => a.key)).toEqual(['web-presence-provision:t-1'])
    expect(w.nl.log.some((x) => x.op === 'createSite')).toBe(false)
    expect((await sweep(w.d)).retried).toEqual([])                       // still refused: not set up, alerted again
    w.d.db = db                                                          // the grant is run
    expect((await sweep(w.d)).retried).toEqual(['t-1'])                  // the unpaid customer is not set up
    expect(w.db.tables.web_presence_sites.map((r: any) => [r.tenant_id, r.status])).toEqual([['t-1', 'live']])
    expect(w.mail.map((m) => m.why)).toEqual(['welcome'])
    expect((await sweep(w.d)).retried).toEqual([])                       // live: never made again
    expect(w.nl.log.filter((x) => x.op === 'createSite')).toHaveLength(1)
  })
  test('a taken site name is retried with a suffix', async () => {
    const w = world(); w.nl.taken.add('twomiah-acme-roofing')
    const { row } = await provisionSite(w.d, 't-1')
    expect(row.netlify_site_name).toMatch(/^twomiah-acme-roofing-[0-9a-f]{4}$/)
  })
  test('only a customer on this plan, and only with the Factory settings in place', async () => {
    await expect(provisionSite(world({ tenants: [tenant({ plan: 'website' })] }).d, 't-1')).rejects.toThrow(/not on the Web presence plan/)
    await expect(provisionSite(world({ env: { WEB_PRESENCE_SECRET_KEY: '' } }).d, 't-1')).rejects.toThrow(/WEB_PRESENCE_SECRET_KEY/)
    await expect(provisionSite(world({ env: { TWOMIAH_FACTORY_URL: '' } }).d, 't-1')).rejects.toThrow(/TWOMIAH_FACTORY_URL/)
  })
  test('a Netlify failure marks the site failed, tells the owner of the Factory, and a retry resumes the SAME Netlify site', async () => {
    const w = world(); let fail = true
    const real = w.d.netlify
    w.d.netlify = () => { const n = real(); const dep = n.deploy.bind(n); n.deploy = async (...a: any[]) => { if (fail) throw new Error('netlify down'); return (dep as any)(...a) }; return n }
    await expect(provisionSite(w.d, 't-1')).rejects.toThrow(/netlify down/)
    expect(w.db.tables.web_presence_sites[0].status).toBe('failed')
    expect(w.alerts[0].key).toBe('web-presence-provision:t-1')
    fail = false
    const out = await provisionSite(w.d, 't-1')
    expect(out.row.status).toBe('live')
    expect(w.nl.log.filter((x) => x.op === 'createSite')).toHaveLength(1)
    // The settings the first try set are UPDATED on the retry — creating them again is refused by Netlify (10/30).
    expect(w.nl.log.filter((x) => x.op === 'updateEnv').map((x) => x.keys[0]).sort()).toEqual(['WP_FACTORY_KEY', 'WP_FACTORY_URL', 'WP_SECRET', 'WP_SITE_ID', 'WP_TENANT_ID'])
  })
})

describe('the site asks the Factory (signed with the site\'s own secret)', () => {
  const body = (model: any, prev?: any) => JSON.stringify({ siteId: 's', model, prev })
  async function live() { const w = world(); const { row } = await provisionSite(w.d, 't-1'); return { w, row } }
  test('a good signature is accepted; wrong, stale, missing or another site\'s is not', async () => {
    const { w, row } = await live(); const b = '{"x":1}'
    expect((await verifySiteRequest(w.d, await signedHeaders(row.id, b), b)).id).toBe(row.id)
    await expect(verifySiteRequest(w.d, { ...(await signedHeaders(row.id, b)), sig: 'bad' }, b)).rejects.toBeInstanceOf(SignatureError)
    await expect(verifySiteRequest(w.d, await signedHeaders(row.id, b, String(Math.floor(NOW / 1000) - 3600)), b)).rejects.toBeInstanceOf(SignatureError)
    await expect(verifySiteRequest(w.d, await signedHeaders(row.id, b), b + ' ')).rejects.toBeInstanceOf(SignatureError)
    await expect(verifySiteRequest(w.d, { site: row.id, ts: '', sig: '' }, b)).rejects.toBeInstanceOf(SignatureError)
    await expect(verifySiteRequest(w.d, { site: 'no-such-site', ts: '1', sig: 'x' }, b)).rejects.toBeInstanceOf(SignatureError)
    // another site's secret cannot speak for this one
    const other = await signRequest(await siteSecret(MASTER, 'someone-else'), String(Math.floor(NOW / 1000)), b)
    await expect(verifySiteRequest(w.d, { site: row.id, ts: String(Math.floor(NOW / 1000)), sig: other }, b)).rejects.toBeInstanceOf(SignatureError)
  })
  test('a save is drawn and returned, and the Factory keeps none of it', async () => {
    const { w, row } = await live()
    const first = await renderForSite(w.d, row, { model: { ...firstModel(), business: { name: 'Acme Roofing & Sons' } } })
    expect(first.status).toBe(200)
    expect((first.body as any).files['index.html']).toContain('Acme Roofing &amp; Sons')
    expect(JSON.stringify(w.db.tables)).not.toContain('Sons')
  })
  test('turning the lead form off removes its email; unchanged saves make no Netlify calls', async () => {
    const { w, row } = await live()
    const m1 = ((await renderForSite(w.d, row, { model: firstModel() })).body as any).model
    const before = w.nl.log.length
    await renderForSite(w.d, row, { model: m1, prev: m1 })
    expect(w.nl.log.length).toBe(before)
    const off = { ...m1, forms: { ...m1.forms, lead: { ...m1.forms.lead, on: false } } }
    const res = await renderForSite(w.d, row, { model: off, prev: m1 })
    expect(res.status).toBe(200)
    expect((res.body as any).files['index.html']).not.toContain('/api/leads')
    expect(w.nl.hooks).toHaveLength(0)
  })
  test('a form that is on shows on the page and posts to the site; one that is off is absent', async () => {
    const { w, row } = await live()
    const m1 = ((await renderForSite(w.d, row, { model: firstModel() })).body as any).model
    const page = ((await renderForSite(w.d, row, { model: m1, prev: m1 })).body as any).files['index.html'] as string
    expect(page).toContain('/api/leads'); expect(page).not.toContain('/api/apply')
    const withHiring = { ...m1, forms: { ...m1.forms, hiring: { on: true, inbox: 'jobs@acme.test' } }, sections: [...m1.sections, { id: 'hiring', type: 'hiring', variant: 'form', hidden: false, data: { heading: 'Now hiring', jobs: [{ title: 'Roofer', blurb: 'Full time', kind: 'Full-time' }] } }] }
    const hp = ((await renderForSite(w.d, row, { model: withHiring, prev: m1 })).body as any).files['index.html'] as string
    expect(hp).toContain('/api/apply')
    expect(w.nl.hooks.map((h) => h.form_id).sort()).toEqual(['form-apply', 'form-lead'])
    const noHiringSection = { ...withHiring, sections: withHiring.sections.map((s: any) => (s.type === 'hiring' ? { ...s, hidden: true } : s)) }
    const gone = ((await renderForSite(w.d, row, { model: noHiringSection, prev: withHiring })).body as any).files['index.html'] as string
    expect(gone).not.toContain('/api/apply')
  })
  test('a site that is not live takes no changes', async () => {
    const { w, row } = await live()
    await expect(renderForSite(w.d, { ...row, status: 'removed' }, { model: {} })).rejects.toThrow(/not taking changes/)
  })
})

describe('sign-in links', () => {
  test('"email me a new link" mails only the owner the Factory holds, at most one a minute, whoever asks', async () => {
    const w = world(); const { row } = await provisionSite(w.d, 't-1'); w.mail.length = 0
    await requestLink(w.d, (await siteRowFor(w.d, { tenantId: 't-1' }))!)
    expect(w.mail).toHaveLength(0)                      // a link was made at set-up less than a minute ago
    w.clock.now += 61_000
    await requestLink(w.d, (await siteRowFor(w.d, { tenantId: 't-1' }))!)
    expect(w.mail.map((m) => m.to)).toEqual(['owner@acme.test']); expect(w.mail[0].why).toBe('request')
    await requestLink(w.d, (await siteRowFor(w.d, { tenantId: 't-1' }))!)
    expect(w.mail).toHaveLength(1)
    void row
  })
  test('staff reach a site only through the Factory: a link made on request, for a live site only', async () => {
    const w = world(); await provisionSite(w.d, 't-1')
    expect(await staffLink(w.d, 't-1')).toMatch(/\/edit\/#t=/)
    w.db.tables.web_presence_sites[0].status = 'removed'
    await expect(staffLink(w.d, 't-1')).rejects.toThrow(/no live/)
  })
})

describe('cancel and removal', () => {
  test('cancel ends the subscription at the end of the paid period; the site stays until then and goes after', async () => {
    const w = world(); await provisionSite(w.d, 't-1')
    const out = await cancelAtPeriodEnd(w.d, 't-1')
    expect(w.ended).toEqual(['sub_1']); expect(out.cancelAt).toBe(new Date(NOW + 20 * 86400_000).toISOString())
    expect(w.db.tables.web_presence_sites[0].status).toBe('canceling')
    expect((await sweep(w.d)).removed).toEqual([])
    expect(w.nl.log.some((x) => x.op === 'deleteSite')).toBe(false)
    w.clock.now += 21 * 86400_000
    expect((await sweep(w.d)).removed).toEqual(['t-1'])
    expect(w.nl.log.filter((x) => x.op === 'deleteSite')).toHaveLength(1)
    expect(w.db.tables.web_presence_sites[0].status).toBe('removed')
    expect((await sweep(w.d)).removed).toEqual([])      // idempotent
  })
  test('removing twice deletes once; a site Netlify no longer has is not an error', async () => {
    const w = world(); await provisionSite(w.d, 't-1')
    expect(await removeSite(w.d, 't-1', 'test')).toBe(true)
    expect(await removeSite(w.d, 't-1', 'test')).toBe(false)
  })
  test('nothing to cancel is said plainly', async () => {
    const w = world()
    await expect(cancelAtPeriodEnd(w.d, 't-1')).rejects.toThrow(/no live/)
  })
})

describe('moving up to the full plan', () => {
  beforeEach(() => { process.env.UNIFIED_SIGNUPS = 'all' })
  async function readyToMove() {
    const w = world(); const { row } = await provisionSite(w.d, 't-1')
    const m1 = ((await renderForSite(w.d, row, { model: { ...firstModel(), look: { design: 'heritage', palette: {}, style: {} } } as any })).body as any).model
    const model = { ...m1, sections: [...m1.sections, { id: 'about', type: 'about', variant: 'story', hidden: false, data: { heading: 'Our story', body: 'Family owned since 1999' } }, { id: 'hiring', type: 'hiring', variant: 'form', hidden: false, data: { jobs: [{ title: 'Roofer' }] } }] }
    await w.runSite(row.id, row.origin!, model)
    return { w, row, model }
  }
  test('a full-plan business is built from the page, with the content carried over; the one-page site stays up and paid until it is live', async () => {
    const { w, row, model } = await readyToMove()
    const out = await startUpgrade(w.d as UpgradeDeps, 't-1')
    expect(out.checkoutUrl).toMatch(/^https:\/\/checkout\.test\//)
    const created = w.db.tables.tenants.find((t) => t.id === out.tenantId)!
    expect(created.plan).toBe('website'); expect(created.engine).toBe('unified'); expect(created.billing_status).toBe('pending')
    expect(created.preview_premium_pages.pages.home.sections.length).toBeGreaterThan(1)
    expect(JSON.stringify(created.preview_premium_pages)).toContain('Family owned since 1999')
    expect(JSON.stringify(created.preview_premium_pages)).not.toContain('Roofer')                         // the hiring form is not part of the full plan
    expect(created.intake_data.signup.design).toBe('heritage')
    expect(w.db.tables.factory_jobs.some((j) => j.tenant_id === created.id && j.template === 'unified')).toBe(true)
    const site = w.db.tables.web_presence_sites[0]
    expect(site.status).toBe('upgrading'); expect(site.previous_subscription_id).toBe('sub_1')
    expect(w.nl.log.some((x) => x.op === 'deleteSite')).toBe(false)
    // the export that carried it over was a SIGNED request to the site
    expect(w.calls.find((c) => c.url.endsWith('/api/export'))!.init.headers['x-wp-sig']).toMatch(/./)
    void row; void model
  })
  test('asking again reuses the same new business (no second one)', async () => {
    const { w } = await readyToMove()
    const a = await startUpgrade(w.d as UpgradeDeps, 't-1'); const b = await startUpgrade(w.d as UpgradeDeps, 't-1')
    expect(b.tenantId).toBe(a.tenantId)
    expect(w.db.tables.tenants.filter((t) => t.plan === 'website')).toHaveLength(1)
  })
  test('the Netlify site is retired — and the $19 subscription ended — only once the new business is live and paid', async () => {
    const { w } = await readyToMove()
    const { tenantId } = await startUpgrade(w.d as UpgradeDeps, 't-1')
    expect((await sweep(w.d)).removed).toEqual([])
    const nt = w.db.tables.tenants.find((t) => t.id === tenantId)!
    nt.status = 'active'; nt.billing_status = 'active'
    expect((await sweep(w.d)).removed).toEqual([])        // paid and active but not deployed yet
    nt.render_frontend_url = 'https://acme-full.onrender.com'
    expect((await sweep(w.d)).removed).toEqual(['t-1'])
    expect(w.cancelled).toEqual(['sub_1'])
    expect(w.db.tables.web_presence_sites[0].status).toBe('removed')
  })
  test('a trade the full plan does not run yet is refused before anything is made', async () => {
    process.env.UNIFIED_SIGNUPS = 'off'
    const { w } = await readyToMove()
    await expect(startUpgrade(w.d as UpgradeDeps, 't-1')).rejects.toThrow(/not open/)
    expect(w.db.tables.tenants).toHaveLength(1)
  })
  test('home composition: hidden sections, the hiring form and plan-only sections are left out', () => {
    const c = homeCompositionFrom({ sections: [
      { id: 'hero', type: 'hero', variant: 'split', hidden: false, data: { heading: 'H' } },
      { id: 'about', type: 'about', variant: 'story', hidden: true, data: {} },
      { id: 'hiring', type: 'hiring', variant: 'form', hidden: false, data: {} },
      { id: 'todays', type: 'spot', variant: 'today', hidden: false, data: {} },
      { id: 'contact', type: 'contact', variant: 'form-info', hidden: false, data: {} },
    ] })
    expect(c.pages.home.sections.map((s: any) => s.type)).toEqual(['hero', 'contact'])
  })
})

describe('a change of trade', () => {
  beforeEach(() => { process.env.UNIFIED_SIGNUPS = 'all' })
  test('what can be added changes; nothing on the page is removed; the site is handed the page drawn again', async () => {
    const w = world(); const { row } = await provisionSite(w.d, 't-1')
    const m1 = ((await renderForSite(w.d, row, { model: firstModel() })).body as any).model
    const store = await w.runSite(row.id, row.origin!, m1)
    const res = await changeTrade(w.d as UpgradeDeps, 't-1', 'food truck')
    expect(res.added).toEqual(expect.arrayContaining(['todaysSpot', 'savedPlaces']))
    const kept = JSON.parse(store.get('model')).sections.map((s: any) => s.id)
    for (const s of m1.sections) expect(kept).toContain(s.id)
    expect(store.get('page')).toContain('<html')
    expect(w.db.tables.tenants[0].industry).toBe('food truck')
    const deploys = w.nl.log.filter((x) => x.op === 'deploy'); expect(deploys.length).toBe(2)
  })
})

describe('the signup', () => {
  const deps = (over: Record<string, any> = {}) => {
    const db = fakeStore({ tenants: [], factory_jobs: [] })
    const seen: any[] = []; const ai: string[] = []
    return { db, seen, ai, d: { db, env: { WEB_PRESENCE_ON: '1' }, allocateSlug: async (b: string) => b, compose: () => ({ pages: { home: { sections: [] } } }), checkout: async (t: any, u: any) => { seen.push({ t, u }); return { url: 'https://checkout.test/x', stripeCustomerId: 'cus_9' } }, composeAi: (id: string) => ai.push(id), design: 'studio', ...over } }
  }
  test('on: a pending account on the $19 plan, a checkout, no CRM or Render build', async () => {
    const x = deps()
    const r = await webPresenceSignup({ name: ' Acme  Roofing ', email: 'owner@acme.test', industry: 'roofing', city: 'Madison' }, x.d as any)
    expect(r.status).toBe(200); expect((r.body as any).checkoutUrl).toBe('https://checkout.test/x')
    const t = x.db.tables.tenants[0]
    expect(t).toMatchObject({ plan: 'webpresence', products: ['website'], billing_status: 'pending', status: 'pending', monthly_amount: 19, slug: 'acme-roofing', name: 'Acme Roofing' })
    expect(t.stripe_customer_id).toBe('cus_9')
    expect(t.render_backend_url).toBeUndefined(); expect(x.db.tables.factory_jobs).toHaveLength(0)
    expect(x.seen[0].u.successUrl).toMatch(/^https:\/\/twomiah\.com\/welcome\?tenant=/)
    expect(x.ai).toEqual([t.id])
  })
  test('bad answers are refused before an account is made', async () => {
    const x = deps()
    expect((await webPresenceSignup({ name: 'A', email: 'a@b.co' }, x.d as any)).status).toBe(400)
    expect((await webPresenceSignup({ name: 'Acme', email: 'nope' }, x.d as any)).status).toBe(400)
    expect(x.db.tables.tenants ?? []).toHaveLength(0)
    expect((await webPresenceSignup({ name: 'Acme', email: 'a@b.co' }, deps({ allocateSlug: async () => null }).d as any)).status).toBe(503)
  })
  test('when checkout cannot start, the owner is told and the account id is returned for support', async () => {
    const x = deps({ checkout: async () => { throw new Error('stripe down') } })
    const r = await webPresenceSignup({ name: 'Acme', email: 'a@b.co' }, x.d as any)
    expect(r.status).toBe(502); expect((r.body as any).tenantId).toBeTruthy()
  })
})

describe('watching Netlify', () => {
  test('credit use that cannot be read is said plainly — never guessed', async () => {
    // No endpoint named: unreadable, shown to staff, and NO alert (it would repeat daily forever; Netlify's own emails cover it).
    const w = world()
    expect((await creditWatch(w.d)).state).toBe('unreadable')
    expect(w.alerts).toEqual([])
    // An endpoint the owner named that stops answering IS news.
    const w2 = world({ env: { WEB_PRESENCE_CREDITS_PATH: '/credits' } })
    const real = w2.d.netlify
    w2.d.netlify = () => { const n = real(); n.creditsFromEndpoint = async () => null; return n }
    expect((await creditWatch(w2.d)).state).toBe('unreadable')
    expect(w2.alerts[0].key).toBe('web-presence:credits-unreadable')
  })
  test('with a reading: quiet below 75%, a warning at 75%, urgent at 90%', async () => {
    const levels: Array<[number, string]> = [[500, 'ok'], [760, 'warn'], [950, 'urgent']]
    for (const [used, state] of levels) {
      const w = world({ env: { WEB_PRESENCE_CREDITS_PATH: '/credits' } })
      const real = w.d.netlify
      w.d.netlify = () => { const n = real(); n.creditsFromEndpoint = async () => ({ used, total: 1000 }); return n }
      expect((await creditWatch(w.d)).state).toBe(state)
      expect(w.alerts.length).toBe(state === 'ok' ? 0 : 1)
    }
  })
  test('each site\'s usage is read from the site itself, and carries counts only', async () => {
    const w = world(); const { row } = await provisionSite(w.d, 't-1')
    const store = await w.runSite(row.id, row.origin!, { v: 1, forms: {}, sections: [] })
    store.set('n:2026-10:page', '41'); store.set('n:2026-10:lead', '3')
    const [u] = await siteUsage(w.d)
    expect(u.usage).toEqual({ month: '2026-10', page: 41, save: 0, upload: 0, lead: 3, apply: 0 })
    expect(Object.keys(u).sort()).toEqual(['name', 'origin', 'siteId', 'status', 'tenantId', 'usage'])
  })
})
