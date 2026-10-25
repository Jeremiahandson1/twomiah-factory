// The live Factory's unified path (apps/api/src/unified/factory.ts): the UNIFIED_SIGNUPS switch, deployUnifiedTenant
// (runDeploy's equivalent) and updateUnifiedTenantCode, against stand-ins for GitHub, Render, the Factory database and
// the email/audit services. The tenant tree is the real one.
import { test, expect, describe, beforeAll, afterAll } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import {
  unifiedSignupsMode, engineForSignup, isOwnerTestEmail, unifiedVerticalFor, deployUnifiedTenant, updateUnifiedTenantCode,
  unifiedIntegrationEnv, provisionBody, unifiedFeatures, type UnifiedDeps,
} from '../../../apps/api/src/unified/factory'
import { resolveCrmFeatures } from '../../../apps/api/src/services/generator'
import { crmTemplateFor, crmServiceSuffixFor, startingFeaturesFor } from '../../../apps/api/src/config/industryRouting'
import * as deploySvc from '../../../apps/api/src/services/deploy'
import { quickbooksTenantEnv } from '../../../apps/api/src/services/quickbooksEnv'
import { fakeStore } from './fakeStore'

const ROOT = path.resolve(import.meta.dir, '..', '..', '..')
const bcrypt = createRequire(path.join(ROOT, 'apps/api/package.json'))('bcryptjs')
const VERSION = 'abcdef1'
const PLAIN = 'Secret-Plain-123'

// ─── The switch ────────────────────────────────────────────────────────────────

describe('UNIFIED_SIGNUPS', () => {
  const owner = { industry: 'roofing', email: 'twomiah14@gmail.com' }
  const customer = { industry: 'roofing', email: 'owner@acme-roofing.com' }

  test('unset, empty or a typo is off', () => {
    expect(unifiedSignupsMode({})).toBe('off')
    expect(unifiedSignupsMode({ UNIFIED_SIGNUPS: '' })).toBe('off')
    expect(unifiedSignupsMode({ UNIFIED_SIGNUPS: 'yes' })).toBe('off')
    expect(unifiedSignupsMode({ UNIFIED_SIGNUPS: ' TEST ' })).toBe('test')
    expect(unifiedSignupsMode({ UNIFIED_SIGNUPS: 'all' })).toBe('all')
  })

  test('off: every signup — the owner\'s test inbox included — stays on the templates', () => {
    expect(engineForSignup(owner, 'off')).toBe('templates')
    expect(engineForSignup(customer, 'off')).toBe('templates')
    expect(engineForSignup({ ...customer, is_test_tenant: true }, 'off')).toBe('templates')
  })

  test('test: a test signup becomes unified, a normal one stays on the templates', () => {
    expect(engineForSignup(owner, 'test')).toBe('unified')
    expect(engineForSignup({ industry: 'salon', email: 'Twomiah.14+run3@GoogleMail.com' }, 'test')).toBe('unified')
    expect(engineForSignup({ industry: 'salon', email: 'x@acme.com', admin_email: 'twomiah14+a@gmail.com' }, 'test')).toBe('unified')
    expect(engineForSignup({ ...customer, is_test_tenant: true }, 'test')).toBe('unified')
    expect(engineForSignup(customer, 'test')).toBe('templates')
    expect(isOwnerTestEmail('twomiah14@example.com')).toBe(false)
    expect(isOwnerTestEmail('twomiah145@gmail.com')).toBe(false)
  })

  test('all: every signup with a unified vertical; a dispensary stays on the templates whatever the switch says', () => {
    expect(engineForSignup(customer, 'all')).toBe('unified')
    expect(engineForSignup({ industry: 'dispensary', email: 'twomiah14@gmail.com' }, 'all')).toBe('templates')
    expect(unifiedVerticalFor('veterinary')).toBe('vet')
    expect(unifiedVerticalFor('restaurant')).toBe('restaurant')
    // Food trucks run the restaurant CRM's food side (2026-10-24).
    expect(unifiedVerticalFor('food_truck')).toBe('restaurant')
  })
})

describe('the food side: restaurants and food trucks', () => {
  test('a food truck routes to the restaurant CRM, its services named -events', () => {
    expect(crmTemplateFor('food_truck')).toBe('crm-restaurant')
    expect(crmServiceSuffixFor('food_truck')).toBe('events')
    expect(crmTemplateFor('restaurant')).toBe('crm-restaurant')
  })

  test('the unified app starts a restaurant with the food side, a truck without event rooms; the reader, kiosk, online ordering and taps stay off', () => {
    const restaurant = startingFeaturesFor('restaurant', { unified: true })
    const truck = startingFeaturesFor('food_truck', { unified: true })
    for (const f of ['bar_menu', 'bar_register', 'bar_tonight', 'event_bookings', 'catering_menus']) { expect(restaurant).toContain(f); expect(truck).toContain(f) }
    expect(restaurant).toContain('event_spaces')
    expect(truck).not.toContain('event_spaces')
    for (const f of ['card_reader', 'order_kiosk', 'online_ordering', 'draft_taps']) { expect(restaurant).not.toContain(f); expect(truck).not.toContain(f) }
    // The template-built restaurant CRM has no food screens: its starting set is as it was.
    const template = startingFeaturesFor('restaurant', { unified: false })
    for (const f of ['bar_menu', 'bar_register', 'bar_tonight', 'card_reader']) expect(template).not.toContain(f)
    // A bar starts as before: the new food-service features are switched on by the owner.
    const bar = startingFeaturesFor('bar', { unified: true })
    expect(bar).toContain('bar_register')
    for (const f of ['card_reader', 'order_kiosk', 'online_ordering']) expect(bar).not.toContain(f)
  })

  test('the provision body for a unified food truck carries the preset', () => {
    const seed = unifiedFeatures({ industry: 'food_truck', features: [] }, {})
    expect(seed).toContain('bar_register')
    expect(seed).not.toContain('event_spaces')
    // What a signup picked is kept as picked.
    expect(unifiedFeatures({ industry: 'food_truck', features: ['contacts', 'bar_menu'] }, {}).sort()).toEqual(['bar_menu', 'contacts'])
  })
})

// ─── The deploy ────────────────────────────────────────────────────────────────

const ENV: Record<string, string> = {
  TWOMIAH_TWILIO_ACCOUNT_SID: 'AC-factory', TWOMIAH_TWILIO_AUTH_TOKEN: 'tw-token', TWOMIAH_TWILIO_PHONE: '+17155550000',
  TWOMIAH_RESEND_API_KEY: 're_factory', TWOMIAH_GOOGLE_MAPS_KEY: 'maps-key', GOOGLE_MAPS_BROWSER_KEY: 'browser-maps-key', TWOMIAH_NEARMAP_KEY: 'nearmap-key',
  TWOMIAH_REPLICATE_TOKEN: 'r8-token', GOOGLE_CALENDAR_CLIENT_ID: 'gcal-id', GOOGLE_CALENDAR_CLIENT_SECRET: 'gcal-secret', OUTLOOK_CALENDAR_CLIENT_ID: 'ms-id', OUTLOOK_CALENDAR_CLIENT_SECRET: 'ms-secret',
  TWOMIAH_ADS_URL: 'https://ads.test', FACTORY_FROM_EMAIL: 'hello@twomiah.com', ANTHROPIC_API_KEY: 'sk-ant-test',
  STRIPE_SECRET_KEY: 'sk_test_factory', STRIPE_PUBLISHABLE_KEY: 'pk_test_factory', QBO_CLIENT_ID: 'qbo-id', QBO_CLIENT_SECRET: 'qbo-secret',
  R2_ACCOUNT_ID: 'r2acct', R2_ACCESS_KEY_ID: 'r2-key', R2_SECRET_ACCESS_KEY: 'r2-secret',
}
const saved: Record<string, string | undefined> = {}
beforeAll(() => { for (const [k, v] of Object.entries(ENV)) { saved[k] = process.env[k]; process.env[k] = v } })
afterAll(() => { for (const k of Object.keys(ENV)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] } })

const composition = {
  pages: {
    home: { sections: [{ type: 'hero', variant: 'centered-stats', data: { title: 'Acme Roofing' } }] },
    projects: { sections: [] },
    contact: { sections: [{ type: 'contact', variant: 'form-info', data: { heading: 'Get in touch' } }] },
  },
  heldPages: ['projects'], contentGaps: [{ id: 'photos', label: 'Photos of your work', unlocks: 'projects' }],
}
const tenantRow = (over: Record<string, any> = {}) => ({
  id: 't-1', slug: 'acme-roofing', name: 'Acme Roofing', email: 'twomiah14+e2e@gmail.com', admin_email: 'twomiah14+e2e@gmail.com',
  phone: '715-555-0100', industry: 'roofing', city: 'Eau Claire', state: 'WI', zip: '54701', plan: 'starter10',
  products: ['crm', 'website'], features: ['contacts', 'jobs', 'quotes', 'invoices'], primary_color: '#FF3D00',
  admin_password: PLAIN, status: 'deploying', engine: 'unified', preview_premium_pages: composition, domain: null, ...over,
})
const jobRow = () => ({
  id: 'job-1', tenant_id: 't-1', template: 'unified', status: 'deploying', created_at: '2026-10-20T00:00:00Z',
  config: { company: { name: 'Acme Roofing', email: 'twomiah14+e2e@gmail.com', ownerFirstName: 'Jo', ownerLastName: 'Tester', plan: 'starter10', defaultPassword: PLAIN }, branding: { primaryColor: '#FF3D00' }, features: { crm: ['contacts', 'jobs', 'quotes', 'invoices'] } },
})

function stage(opts: { provisionStatus?: number; db?: any; owned?: { repos?: string[]; serviceIds?: string[]; databaseIds?: string[] }; tenant?: Record<string, any> } = {}) {
  const store = fakeStore({ tenants: [tenantRow(opts.tenant)], factory_jobs: [jobRow()] })
  const calls = { provision: [] as any[], created: [] as any[], setEnv: [] as any[], fetch: [] as any[], audit: [] as any[], complete: [] as any[], failed: [] as any[], subs: [] as string[], seeded: [] as string[], buckets: [] as string[] }
  const hosts: any = {
    repoFullName: (n: string) => 'acct/' + n,
    getRepo: async () => null, findService: async () => null,
    findDatabase: async () => opts.db ?? null, getEnv: async () => ({}),
    createDatabase: async () => ({ id: 'dpg-new1' }), getDatabase: async () => opts.db ?? { status: 'available', suspended: 'not_suspended' },
    databaseUrl: async () => 'postgres://u:p@dpg-new1-a/acme_roofing',
    createRepo: async () => ({ fullName: 'acct/acme-roofing-app' }),
    createService: async (input: any) => { calls.created.push(input); return { id: 'srv-1', url: 'https://acme-roofing-app.onrender.com' } },
    setEnv: async (_id: string, vars: any) => { calls.setEnv.push(vars) }, deploy: async () => {}, updateServiceCommands: async () => {},
    health: async () => ({ commit: 'c0ffee1', version: VERSION }),
    callTenant: async (_url: string, p: string, _key: string, body: any) => { calls.provision.push({ path: p, body }); const s = opts.provisionStatus ?? 201; return { status: s, body: s === 201 ? { companyId: 'c' } : { error: 'refused' } } },
  }
  const deps: UnifiedDeps = {
    db: store, io: { hosts, push: async () => 'c0ffee1', sleep: async () => {} }, root: ROOT, version: VERSION,
    factoryUrl: 'https://factory.test',
    fetch: async (url: string, init?: RequestInit) => { calls.fetch.push({ url, init }); return new Response('{}', { status: 200 }) },
    owned: async () => ({ repos: new Set(opts.owned?.repos || []), serviceIds: new Set(opts.owned?.serviceIds || []), databaseIds: new Set(opts.owned?.databaseIds || []), hosts: new Set() }),
    integrationEnv: unifiedIntegrationEnv,
    hashPassword: (p: string) => bcrypt.hash(p, 4),
    audit: async (...a: any[]) => { calls.audit.push(a) },
    notify: { complete: async (t: any, u: any) => { calls.complete.push({ t, u }) }, failed: async (t: any, r: string) => { calls.failed.push({ t, r }) }, stillWorking: async () => {} },
    pushSubscription: async (id: string) => { calls.subs.push(id) },
    r2: { configured: deploySvc.isR2Configured, ensureBucket: async (s: string) => { calls.buckets.push(s); return { bucketName: s + '-media', created: true } }, envVars: deploySvc.getR2EnvVars },
    seedPhotos: async (id: string) => { calls.seeded.push(id) },
    domains: { targets: async () => null, wire: async () => ({ success: true, steps: [], errors: [] }), reconcileAliases: () => {} },
    stillWorkingMs: 60 * 60_000, waitMs: 0,
  }
  return { store, calls, deps }
}

describe('deployUnifiedTenant', () => {
  test('a first build writes every record, sends the right provision body, and never the plaintext password', async () => {
    const s = stage()
    const r = await deployUnifiedTenant('t-1', s.deps)
    expect(r.errors).toEqual([])
    expect(r.success).toBe(true)

    // factory_jobs: what services/resourceOwnership.ts reads as this tenant's next time.
    const job = s.store.tables.factory_jobs[0]
    expect(job.status).toBe('complete')
    expect(job.github_repo).toBe('https://github.com/acct/acme-roofing-app')
    expect(job.render_url).toBe('https://acme-roofing-app.onrender.com')
    expect(job.render_service_ids).toEqual({ backend: 'srv-1', database: 'dpg-new1' })
    expect(job.config.company.defaultPassword).toBeUndefined()

    // tenants
    const t = s.store.tables.tenants[0]
    expect(t.render_backend_url).toBe('https://acme-roofing-app.onrender.com')
    expect(t.render_frontend_url).toBe('https://acme-roofing-app.onrender.com')
    expect(t.website_url).toBe('https://acme-roofing-app.onrender.com')
    expect(t.database_url).toBe('postgres://u:p@dpg-new1-a/acme_roofing')
    expect(t.factory_sync_key).toMatch(/^[0-9a-f]{64}$/)
    expect(t.r2_bucket_name).toBe('acme-roofing-app-media')
    expect(t.status).toBe('active')
    expect(t.admin_password).toBeNull()
    const features = resolveCrmFeatures('crm-roof', 'starter10', ['contacts', 'jobs', 'quotes', 'invoices']).seed
    expect(t.features).toEqual(features)

    // The provision body: the hash, the owner, the features, the zone, the site from preview_premium_pages.
    expect(s.calls.provision).toHaveLength(1)
    const body = s.calls.provision[0].body
    expect(s.calls.provision[0].path).toBe('/api/internal/provision')
    expect(bcrypt.compareSync(PLAIN, body.owner.passwordHash)).toBe(true)
    expect(body.owner).toMatchObject({ email: 'twomiah14+e2e@gmail.com', firstName: 'Jo', lastName: 'Tester' })
    expect(body.company).toMatchObject({ name: 'Acme Roofing', slug: 'acme-roofing', timezone: 'America/Chicago', primaryColor: '#FF3D00' })
    expect(body.features).toEqual(features)
    expect(body.site.pages.map((p: any) => [p.slug, p.isPublished])).toEqual([['home', true], ['projects', false], ['contact', true]])
    expect(body.site.pages[0].sections[0]).toMatchObject({ type: 'hero', data: { title: 'Acme Roofing' } })
    expect(body.site.contentGaps).toEqual(composition.contentGaps)

    // The plaintext is in nothing the Factory sent or wrote.
    const sent = JSON.stringify([s.calls.provision, s.calls.created, s.calls.setEnv, s.calls.fetch.map((f) => f.init?.body), s.store.writes, s.calls.complete])
    expect(sent.includes(PLAIN)).toBe(false)

    // The service's settings carry the integration env and the media bucket.
    const env = Object.fromEntries(s.calls.created[0].envVars.map((v: any) => [v.key, v.value]))
    expect(env).toMatchObject({ RESEND_API_KEY: 're_factory', TWILIO_ACCOUNT_SID: 'AC-factory', R2_BUCKET_NAME: 'acme-roofing-app-media', R2_ACCESS_KEY_ID: 'r2-key', R2_SECRET_ACCESS_KEY: 'r2-secret', R2_ACCOUNT_ID: 'r2acct', VERTICAL: 'roofing', TENANT_ID: 't-1', FACTORY_URL: 'https://factory.test' })
    expect(s.calls.buckets).toEqual(['acme-roofing-app'])

    // Sync, subscription, photos, audit, the ready email (no password in it).
    const sync = s.calls.fetch.find((f) => f.url.endsWith('/api/internal/sync-features'))
    expect(sync.url).toBe('https://acme-roofing-app.onrender.com/api/internal/sync-features')
    expect(JSON.parse(sync.init.body)).toEqual({ features })
    expect((sync.init.headers as any)['X-Factory-Key']).toBe(t.factory_sync_key)
    expect(s.calls.subs).toEqual(['t-1'])
    expect(s.calls.seeded).toEqual(['t-1'])
    expect(s.calls.audit.map((a) => a[1])).toEqual(['deploy', 'deploy'])
    expect(s.calls.audit[1][2]).toEqual({ status: { old: 'deploying', new: 'active' } })
    expect(s.calls.complete).toHaveLength(1)
    expect(s.calls.complete[0].t.admin_password).toBeUndefined()
    expect(s.calls.complete[0].u).toMatchObject({ deployedUrl: 'https://acme-roofing-app.onrender.com/login', siteUrl: 'https://acme-roofing-app.onrender.com' })
    expect(s.calls.failed).toHaveLength(0)
  }, 180_000)

  test('a refused provision: deploy_failed, the failure email, the record kept for the next build, the password not scrubbed', async () => {
    const s = stage({ provisionStatus: 400 })
    const r = await deployUnifiedTenant('t-1', s.deps)
    expect(r.success).toBe(false)
    const t = s.store.tables.tenants[0], job = s.store.tables.factory_jobs[0]
    expect(t.status).toBe('deploy_failed')
    expect(job.status).toBe('failed')
    expect(job.render_service_ids).toEqual({ backend: 'srv-1', database: 'dpg-new1' })
    expect(t.render_backend_url).toBe('https://acme-roofing-app.onrender.com')
    expect(t.admin_password).toBe(PLAIN)
    expect(s.calls.failed).toHaveLength(1)
    expect(s.calls.failed[0].r).toContain('400')
    expect(s.calls.complete).toHaveLength(0)
    expect(s.calls.fetch).toHaveLength(0)
    expect(s.calls.seeded).toHaveLength(0)
  }, 180_000)

  test('a suspended database (gap 15) stops the build, nothing is made, and the tenant is marked failed', async () => {
    const s = stage({ db: { id: 'dpg-old', status: 'available', suspended: 'suspended' }, owned: { databaseIds: ['dpg-old'] } })
    const r = await deployUnifiedTenant('t-1', s.deps)
    expect(r.success).toBe(false)
    expect(r.errors.join(' ')).toContain('suspended')
    expect(s.calls.created).toHaveLength(0)
    expect(s.store.tables.tenants[0].status).toBe('deploy_failed')
    expect(s.store.tables.factory_jobs[0].render_service_ids).toBeUndefined()
  }, 60_000)

  test('a template tenant is never built here and nothing about it is written', async () => {
    const s = stage({ tenant: { engine: undefined } })
    const r = await deployUnifiedTenant('t-1', s.deps)
    expect(r.success).toBe(false)
    expect(s.store.writes).toHaveLength(0)
    expect(s.calls.failed).toHaveLength(0)
  })
})

// ─── The integration env is the template path's ───────────────────────────────

describe('integration env', () => {
  test('equals what deployCustomer + refreshPlatformIntegrationEnv give a template CRM of the same tenant', async () => {
    const tenant = tenantRow({ products: ['crm', 'website'] }), config = jobRow().config
    const url = 'https://acme-roofing-app.onrender.com'
    const envFor = await unifiedIntegrationEnv(tenant, config, { factoryUrl: 'https://factory.test', guessUrl: url })
    const got = Object.fromEntries(envFor(url).map((v) => [v.key, v.value]))
    // The template CRM's Factory-side settings, in deployCustomer's order, then refreshPlatformIntegrationEnv's — with the
    // site's calendar apps (Outlook beside Google), since the one service is the site too.
    const template: Record<string, string> = {}
    for (const v of [
      ...deploySvc.crmPlanEnv('starter10'), ...deploySvc.calendarOAuthEnv(), ...(await deploySvc.tenantIntegrationEnv('t-1', undefined)),
      ...deploySvc.crmServiceEnv({ hasVisualizer: false, name: 'Acme Roofing', ownerEmail: 'twomiah14+e2e@gmail.com', domain: '' }),
      ...quickbooksTenantEnv(url), ...deploySvc.platformIntegrationEnv(url, { customerHasStripeKey: false }),
    ]) if (!(v.key in template)) template[v.key] = v.value
    // …but never the platform's shared texting NUMBER: a unified business texts from its own registered number (the
    // Factory writes it into the CRM once the carriers approve — services/a2p.ts), or not at all. (2026-10-21)
    expect(template.TWILIO_PHONE_NUMBER).toBe('+17155550000')
    delete template.TWILIO_PHONE_NUMBER
    expect(got).toEqual(template)
    // …and those are the values the env gives (written out, not derived).
    expect(got).toMatchObject({
      FEATURE_PACKAGE: 'starter10', GOOGLE_CALENDAR_CLIENT_ID: 'gcal-id', OUTLOOK_CALENDAR_CLIENT_ID: 'ms-id', TWILIO_ACCOUNT_SID: 'AC-factory', TWILIO_AUTH_TOKEN: 'tw-token',
      RESEND_API_KEY: 're_factory', GOOGLE_MAPS_API_KEY: 'maps-key', GOOGLE_MAPS_BROWSER_KEY: 'browser-maps-key', NEARMAP_API_KEY: 'nearmap-key',
      REPLICATE_API_TOKEN: 'r8-token', ADS_URL: 'https://ads.test', FROM_EMAIL: 'hello@twomiah.com', FROM_NAME: 'Acme Roofing',
      REPLY_TO_EMAIL: 'twomiah14+e2e@gmail.com', ANTHROPIC_API_KEY: 'sk-ant-test', API_URL: url, BACKEND_URL: url,
      STRIPE_SECRET_KEY: 'sk_test_factory', STRIPE_PUBLISHABLE_KEY: 'pk_test_factory',
    })
    expect(Object.keys(got).some((k) => k.startsWith('QBO') || k.startsWith('QUICKBOOKS'))).toBe(true)
    expect('TWILIO_PHONE_NUMBER' in got).toBe(false)
    expect('TWILIO_MESSAGING_SERVICE_SID' in got).toBe(false)
  })

  test('deployCustomer builds its CRM env from those same functions (no second copy)', () => {
    const src = fs.readFileSync(path.join(ROOT, 'apps/api/src/services/deploy.ts'), 'utf8')
    const body = src.slice(src.indexOf('export async function deployCustomer('))
    for (const call of ['tenantIntegrationEnv(factoryCustomer.id', '...crmPlanEnv(tenantPlan)', '...googleOAuthEnv()', '...crmServiceEnv(', 'getR2EnvVars(']) expect(body).toContain(call)
    expect(src.split("process.env.TWOMIAH_TWILIO_ACCOUNT_SID").length - 1).toBe(1)
    expect(src.split("'FEATURE_PACKAGE'").length - 1).toBe(1)
  })

  test('the provision body never carries a password, only its hash', () => {
    const b: any = provisionBody(tenantRow(), jobRow().config, '$2b$04$' + 'a'.repeat(53))
    expect(JSON.stringify(b).includes(PLAIN)).toBe(false)
    expect(b.owner.passwordHash).toMatch(/^\$2b\$04\$/)
  })
})

// ─── Update Code ───────────────────────────────────────────────────────────────

describe('updateUnifiedTenantCode', () => {
  test('adds only the settings the service lacks, then pushes and waits for the new commit', async () => {
    const s = stage({ owned: { repos: ['acct/acme-roofing-app'], serviceIds: ['srv-1'] }, tenant: { render_backend_url: 'https://acme-roofing-app.onrender.com', status: 'active' } })
    Object.assign(s.store.tables.factory_jobs[0], { github_repo: 'https://github.com/acct/acme-roofing-app', render_service_ids: { backend: 'srv-1', database: 'dpg-1' } })
    const hosts: any = s.deps.io.hosts
    hosts.getService = async () => ({ repo: 'https://github.com/acct/acme-roofing-app' })
    hosts.getEnv = async () => ({ RESEND_API_KEY: 'tenant-own-key', TWILIO_ACCOUNT_SID: 'AC-tenant' })
    let pushed = ''
    s.deps.io.push = async (repo: string) => { pushed = repo; return 'c0ffee1' }
    const r = await updateUnifiedTenantCode('t-1', s.deps)
    expect(r.errors).toEqual([])
    expect(r.success).toBe(true)
    expect(pushed).toBe('acct/acme-roofing-app')
    const added = s.calls.setEnv[0].map((v: any) => v.key)
    expect(added).toContain('NEARMAP_API_KEY')
    expect(added).not.toContain('RESEND_API_KEY')
    expect(added).not.toContain('TWILIO_ACCOUNT_SID')
    expect(r.steps.map((x) => x.step)).toEqual(['settings', 'ownership', 'push', 'live'])
  }, 180_000)

  test('a template tenant, or a unified one never built, is refused with nothing changed', async () => {
    const t = stage({ tenant: { engine: 'templates' } })
    expect((await updateUnifiedTenantCode('t-1', t.deps)).success).toBe(false)
    const u = stage()
    const r = await updateUnifiedTenantCode('t-1', u.deps)
    expect(r.success).toBe(false)
    expect(r.errors[0]).toContain('deploy it first')
    expect(u.calls.setEnv).toHaveLength(0)
  })
})
