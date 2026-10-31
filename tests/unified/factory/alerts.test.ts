// The owner hears about failures before a customer does (apps/api/src/services/alerts.ts). Every failure source wired to
// it produces ONE alert, a repeat produces none, and a recovery makes the next failure news again. The mail sender is a
// stand-in (setAlertHooks) and the Factory database, Stripe and Anthropic are stand-ins too: nothing here sends email or
// calls a live API.
import { test, expect, mock, describe, beforeAll, beforeEach, afterEach, afterAll, spyOn } from 'bun:test'
import { installAuth, restoreAuth } from './stubs.ts'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fakeStore } from './fakeStore'
import {
  raiseAlert, clearAlert, resetAlerts, setAlertHooks, activeAlertKeys, aiProblem, REMINDER_MS, MAX_PER_HOUR,
} from '../../../apps/api/src/services/alerts'
import { composeSignupSite, signupComposition, MAX_ATTEMPTS } from '../../../apps/api/src/services/signupSite'
import { fireJob } from '../../../apps/api/src/services/scheduler'
import { unhandledErrorHandler } from '../../../apps/api/src/services/unhandledAlerts'
import { deployUnifiedTenant, type UnifiedDeps } from '../../../apps/api/src/unified/factory'
import type { SiteResult } from '../../../apps/api/src/services/sectionComposer'

const ROOT = path.resolve(import.meta.dir, '..', '..', '..')
const apiRequire = createRequire(path.resolve(ROOT, 'apps/api/package.json'))
const { Hono } = apiRequire('hono')
const { HTTPException } = apiRequire('hono/http-exception')

// ─── The mail stand-in and the clock ─────────────────────────────────────────

let sent: Array<{ subject: string; detail: string; tenantId: string | null }> = []
let now = Date.UTC(2026, 9, 28, 12, 0, 0)
let sendOk = true
beforeEach(() => {
  resetAlerts()
  sent = []
  now = Date.UTC(2026, 9, 28, 12, 0, 0)
  sendOk = true
  setAlertHooks({ send: async (subject, detail, tenantId) => { if (sendOk) sent.push({ subject, detail, tenantId }); return sendOk }, now: () => now })
})
afterEach(() => setAlertHooks())
const subjects = () => sent.map((s) => s.subject)
const tick = (ms: number) => { now += ms }
const settle = () => new Promise((r) => setTimeout(r, 15))

// ─── 1. The rule ─────────────────────────────────────────────────────────────

describe('the alert rule', () => {
  const failing = { key: 'route:signup', what: 'New signups are failing (500)', business: 'Acme Roofing', detail: 'db down' }

  test('a failure alerts once, saying what broke and for which business; a repeat does not', async () => {
    expect(await raiseAlert(failing)).toBe('sent')
    expect(await raiseAlert(failing)).toBe('repeat')
    expect(subjects()).toEqual(['⚠ New signups are failing (500) — Acme Roofing'])
    expect(sent[0].detail).toContain('db down')
  })

  test('a burst of the same error is one email', async () => {
    await Promise.all(Array.from({ length: 50 }, () => raiseAlert(failing)))
    expect(sent).toHaveLength(1)
  })

  test('still failing a day later: one reminder, then quiet again until the next day', async () => {
    await raiseAlert(failing)
    tick(REMINDER_MS - 1000)
    expect(await raiseAlert(failing)).toBe('repeat')
    tick(2000)
    expect(await raiseAlert(failing)).toBe('reminded')
    expect(subjects()[1]).toBe('Still broken: New signups are failing (500) — Acme Roofing')
    expect(sent[1].detail).toMatch(/3 time\(s\)/)
    tick(60_000)
    expect(await raiseAlert(failing)).toBe('repeat')
    expect(sent).toHaveLength(2)
  })

  test('a recovery resets it: the next failure is news again', async () => {
    await raiseAlert(failing)
    clearAlert('route:signup')
    expect(activeAlertKeys()).toEqual([])
    expect(await raiseAlert(failing)).toBe('sent')
    expect(sent).toHaveLength(2)
    expect(subjects()[1].startsWith('⚠ ')).toBe(true) // a fresh alert, not a reminder
  })

  test('different failures are different emails; a prefix clears a family', async () => {
    await raiseAlert({ ...failing, key: 'a:1' }); await raiseAlert({ ...failing, key: 'a:2' }); await raiseAlert({ ...failing, key: 'b:1' })
    expect(sent).toHaveLength(3)
    clearAlert({ prefix: 'a:' })
    expect(activeAlertKeys()).toEqual(['b:1'])
  })

  test('an email that did not go out is not counted as sent: the next failure tries again', async () => {
    sendOk = false
    expect(await raiseAlert(failing)).toBe('unsent')
    sendOk = true
    expect(await raiseAlert(failing)).toBe('sent')
    expect(sent).toHaveLength(1)
  })

  test('a mail failure never throws into the caller', async () => {
    setAlertHooks({ send: async () => { throw new Error('resend is down') }, now: () => now })
    expect(await raiseAlert(failing)).toBe('unsent')
  })

  test('a flood of DIFFERENT failures is capped per hour, and the next email says how many were held back', async () => {
    for (let i = 0; i < MAX_PER_HOUR + 3; i++) await raiseAlert({ ...failing, key: 'k' + i })
    expect(sent).toHaveLength(MAX_PER_HOUR)
    tick(61 * 60_000)
    expect(await raiseAlert({ ...failing, key: 'late' })).toBe('sent')
    expect(sent.at(-1)!.detail).toMatch(/3 other alert\(s\) were held back/)
    // a held one was never marked sent, so it is still news when it happens again
    expect(await raiseAlert({ ...failing, key: 'k' + MAX_PER_HOUR })).toBe('sent')
  })

  test('the detail is escaped; a Factory-wide failure sends no tenant', async () => {
    await raiseAlert({ key: 'x', what: 'Boom', detail: '<script>alert(1)</script>' })
    expect(sent[0].detail).not.toContain('<script>')
    expect(sent[0].detail).toContain('&lt;script&gt;')
    expect(sent[0].tenantId).toBeNull()
  })

  test('Anthropic: out of credit and a refused key are told apart from a bad answer', () => {
    expect(aiProblem(Object.assign(new Error('400 {"error":{"message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing"}}'), { status: 400 }))).toBe('credit')
    expect(aiProblem(Object.assign(new Error('401 invalid x-api-key'), { status: 401 }))).toBe('auth')
    expect(aiProblem(new Error('ANTHROPIC_API_KEY not configured'))).toBe('auth')
    expect(aiProblem(new Error('Site composer returned un-parseable output after retry'))).toBe('other')
  })
})

// ─── 2. The AI site builder ──────────────────────────────────────────────────

const aiSite = (name: string): SiteResult => ({
  pages: {
    home: { sections: [{ type: 'hero', variant: 'centered-stats', data: { title: name + ' — AI' } }] },
    services: { sections: [{ type: 'services', variant: 'cards-grid', data: { items: [{ title: 'Roof repair', description: 'x' }] } }] },
    contact: { sections: [{ type: 'contact', variant: 'form-info', data: {} }] },
  },
  heldPages: [], contentGaps: [], removedClaims: [], rationale: 'stand-in',
})
const OUT_OF_CREDIT = Object.assign(new Error('400 Your credit balance is too low to access the Anthropic API'), { status: 400 })

function siteStage(compose: (i: any) => Promise<SiteResult>, id = 't-1') {
  const input = { businessName: 'Acme Roofing', businessType: 'roofing', city: 'Eau Claire', state: 'WI', email: 'o@acme.example', services: ['Roof repair'], goals: [] } as any
  const store = fakeStore({ tenants: [{ id, slug: 'acme-roofing', status: 'pending', created_at: new Date().toISOString(), preview_premium_pages: signupComposition(input, { ai: true }) }] })
  return { store, deps: { db: store, compose, bootedAt: Date.now() - 60_000, sleep: async () => {} } as any }
}

describe('the AI site builder', () => {
  test('out of Anthropic credit: one alert naming the business, however many sites it hits; a working compose clears it', async () => {
    const a = siteStage(async () => { throw OUT_OF_CREDIT }, 't-1')
    const b = siteStage(async () => { throw OUT_OF_CREDIT }, 't-2')
    await composeSignupSite('t-1', a.deps); await settle()
    expect(subjects()).toEqual(['⚠ The AI site builder is out of Anthropic credit — new sites fall back to the template site — Acme Roofing'])
    await composeSignupSite('t-1', a.deps); await composeSignupSite('t-2', b.deps); await settle()
    expect(sent).toHaveLength(1)

    const ok = siteStage(async (i) => aiSite(i.businessName), 't-3')
    await composeSignupSite('t-3', ok.deps); await settle()
    expect(activeAlertKeys()).not.toContain('ai:credit')
    await composeSignupSite('t-2', siteStage(async () => { throw OUT_OF_CREDIT }, 't-2').deps); await settle()
    expect(sent).toHaveLength(2) // the credit ran out AGAIN: news again
  })

  test('any other failure alerts when the attempts run out and the template site stands — once', async () => {
    const s = siteStage(async () => { throw new Error('Site composer returned un-parseable output after retry') })
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      await composeSignupSite('t-1', s.deps); await settle()
      if (i < MAX_ATTEMPTS - 1) expect(sent).toHaveLength(0) // a retry is still coming: not yet news
    }
    expect(subjects()).toEqual(['⚠ The AI site builder failed — the template site is used instead — Acme Roofing'])
    await composeSignupSite('t-1', s.deps); await settle()
    expect(sent).toHaveLength(1)
    expect(s.store.tables.tenants[0].preview_premium_pages.aiCompose.status).toBe('failed')
  })
})

// ─── 3. A unified build that stalls ──────────────────────────────────────────

describe('a unified build', () => {
  function buildStage(slowMs: number) {
    const store = fakeStore({
      tenants: [{ id: 't-1', slug: 'acme-roofing', name: 'Acme Roofing', email: 'o@acme.example', admin_email: 'o@acme.example', industry: 'roofing', plan: 'starter10', products: ['crm'], features: ['contacts'], status: 'deploying', engine: 'unified', admin_password: 'pw', preview_premium_pages: null }],
      factory_jobs: [{ id: 'job-1', tenant_id: 't-1', template: 'unified', status: 'deploying', created_at: '2026-10-25T00:00:00Z', config: { company: { plan: 'starter10' } } }],
    })
    const hosts: any = {
      repoFullName: (n: string) => 'acct/' + n, getRepo: async () => null, findService: async () => null, findDatabase: async () => null,
      getEnv: async () => ({}), createDatabase: async () => { await new Promise((r) => setTimeout(r, slowMs)); return { id: 'dpg-1' } },
      getDatabase: async () => ({ status: 'available', suspended: 'not_suspended' }), databaseUrl: async () => 'postgres://u:p@dpg-1-a/acme',
      createRepo: async () => ({}), createService: async () => ({ id: 'srv-1', url: 'https://acme-roofing-app.onrender.com' }),
      setEnv: async () => {}, deploy: async () => {}, updateServiceCommands: async () => {}, health: async () => ({ commit: 'c0ffee1' }),
      callTenant: async () => ({ status: 201, body: {} }),
    }
    const stillWorking: string[] = []
    const deps: UnifiedDeps = {
      db: store, io: { hosts, push: async () => 'c0ffee1', sleep: async () => {} }, root: ROOT, version: 'abcdef1', factoryUrl: 'https://factory.test',
      fetch: async () => new Response('{}', { status: 200 }),
      owned: async () => ({ repos: new Set(), serviceIds: new Set(), databaseIds: new Set(), hosts: new Set() }) as any,
      integrationEnv: async () => () => [], hashPassword: async () => '$2b$04$' + 'a'.repeat(53), audit: async () => {},
      notify: { complete: async () => {}, failed: async () => {}, stillWorking: async (t: any) => { stillWorking.push(t.slug) } },
      pushSubscription: async () => {}, r2: { configured: () => false, ensureBucket: async () => ({ bucketName: '', created: false }), envVars: () => [] },
      seedPhotos: async () => {}, domains: { targets: async () => null, wire: async () => ({ success: true, steps: [], errors: [] }), reconcileAliases: () => {} },
      stillWorkingMs: 10, waitMs: 0,
    }
    return { deps, stillWorking }
  }

  test('a build still running at the 15-minute mark alerts the owner once, and is forgotten when it finishes', async () => {
    const s = buildStage(120)
    const run = deployUnifiedTenant('t-1', s.deps)
    await new Promise((r) => setTimeout(r, 60))
    expect(subjects()).toEqual(['⚠ A new customer\'s build is taking over 15 minutes — Acme Roofing'])
    expect(sent[0].tenantId).toBe('t-1')
    expect(activeAlertKeys()).toEqual(['deploy-stalled:t-1'])
    await run
    expect(activeAlertKeys()).not.toContain('deploy-stalled:t-1')
  }, 30_000)

  test('a build that finishes in time says nothing', async () => {
    const s = buildStage(0)
    s.deps.stillWorkingMs = 60_000
    await deployUnifiedTenant('t-1', s.deps)
    expect(sent).toHaveLength(0)
  }, 30_000)
})

// ─── 4. The scheduled jobs ───────────────────────────────────────────────────

describe('the scheduled jobs', () => {
  const realFetch = globalThis.fetch
  afterEach(() => { globalThis.fetch = realFetch })
  const job = { name: 'booking-reminders', path: '/x', schedule: 'hourly' as const }
  const answer = (status: number) => { globalThis.fetch = (async () => new Response('{"ok":true}', { status })) as any }

  test('a job answering an error alerts once; every later tick of it is quiet; it working clears it; failing again is news', async () => {
    answer(500)
    await fireJob(job, 3001, 's'); await fireJob(job, 3001, 's'); await fireJob(job, 3001, 's')
    expect(subjects()).toEqual(['⚠ The "booking-reminders" background job is failing'])
    expect(sent[0].detail).toContain('HTTP 500')
    answer(200)
    await fireJob(job, 3001, 's')
    expect(activeAlertKeys()).toEqual([])
    answer(500)
    await fireJob(job, 3001, 's')
    expect(sent).toHaveLength(2)
  })

  test('a job that cannot be reached alerts too', async () => {
    globalThis.fetch = (async () => { throw new Error('connect ECONNREFUSED') }) as any
    await fireJob(job, 3001, 's'); await fireJob(job, 3001, 's')
    expect(sent).toHaveLength(1)
    expect(sent[0].detail).toContain('ECONNREFUSED')
  })

  test('a different job is a different alert', async () => {
    answer(500)
    await fireJob(job, 3001, 's'); await fireJob({ ...job, name: 'a2p-poll' }, 3001, 's')
    expect(subjects()).toHaveLength(2)
  })
})

// ─── 5. Errors nothing caught ────────────────────────────────────────────────

describe('unhandled errors', () => {
  function app() {
    const a = new Hono()
    a.onError(unhandledErrorHandler)
    a.get('/boom/:id', (c: any) => { throw new Error('row ' + c.req.param('id') + ' is corrupt') })
    a.get('/other', () => { throw new Error('different bug') })
    a.get('/teapot', () => { throw new HTTPException(418, { message: 'short and stout' }) })
    a.get('/fine', (c: any) => c.text('ok'))
    return a
  }
  const quiet = () => spyOn(console, 'error').mockImplementation(() => {})

  test('the visitor sees what Hono always showed; the owner is told once per route + error, ids and all', async () => {
    const spy = quiet()
    try {
      const a = app()
      const r = await a.request('/boom/1')
      expect(r.status).toBe(500)
      expect(await r.text()).toBe('Internal Server Error')
      await a.request('/boom/2'); await a.request('/boom/3')
      expect(subjects()).toEqual(['⚠ The Factory hit an unexpected error on GET /boom/:id'])
      await a.request('/other')
      expect(sent).toHaveLength(2)
    } finally { spy.mockRestore() }
  })

  test('a deliberate HTTP error is not an alert, and a working route says nothing', async () => {
    const a = app()
    expect((await a.request('/teapot')).status).toBe(418)
    expect((await a.request('/fine')).status).toBe(200)
    expect(sent).toHaveLength(0)
  })
})

// ─── 6. The public routes and Stripe, over a database that is down ───────────

describe('the routes', () => {
  const down = { from: () => { throw new Error('database is down') } }
  let app: any
  const savedEnv: Record<string, string | undefined> = {}
  beforeAll(async () => {
    for (const k of ['STRIPE_WEBHOOK_SECRET', 'STRIPE_SECRET_KEY']) savedEnv[k] = process.env[k]
    installAuth({ supabase: down, requireRole: () => async (_c: any, next: any) => next() })
    const { registerIntakeRoutes } = await import('../../../apps/api/src/routes/factory/intake')
    const { registerBillingRoutes } = await import('../../../apps/api/src/routes/factory/billing')
    app = new Hono()
    registerIntakeRoutes(app as any)
    registerBillingRoutes(app as any)
  })
  afterAll(() => { for (const [k, v] of Object.entries(savedEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v } })
  afterAll(restoreAuth)

  const post = (p: string, body: any, headers: Record<string, string> = {}) =>
    app.request(p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) })
  const quiet = () => spyOn(console, 'error').mockImplementation(() => {})

  test('POST /public/signup answering 500: one alert naming the business, the customer sees the same message; a repeat is quiet', async () => {
    const spy = quiet()
    try {
      const body = { name: 'Acme Roofing', email: 'owner@acme.example', industry: 'roofing' }
      const r = await post('/public/signup', body)
      expect(r.status).toBe(500)
      expect(((await r.json()) as any).error).toBe('Something went wrong. Please try again.')
      await post('/public/signup', body); await post('/public/signup', { ...body, name: 'Beta Plumbing' })
      expect(subjects()).toEqual(['⚠ New signups are failing (500) — Acme Roofing'])
    } finally { spy.mockRestore() }
  })

  test('a signup that works afterwards resets it (the route clears its key on success)', () => {
    const src = require('node:fs').readFileSync(path.join(ROOT, 'apps/api/src/routes/factory/intake.ts'), 'utf8')
    const ok = src.slice(src.indexOf("message: 'Account created — complete checkout to launch your site.'") - 400)
    expect(ok.slice(0, 450)).toContain("clearAlert('route:signup')")
  })

  test('POST /public/preview answering 500: one alert, the visitor sees the same message; a render that works resets it', async () => {
    const renderer = await import('../../../apps/api/src/services/previewRenderer')
    const render = spyOn(renderer, 'renderHomepagePreview').mockRejectedValue(new Error('template folder missing'))
    const spy = quiet()
    try {
      const go = (name: string) => post('/public/preview', { businessName: name, businessType: 'roofing', engine: 'standard' })
      const r = await go('Acme Roofing')
      expect(r.status).toBe(500)
      expect(((await r.json()) as any).error).toBe('Preview failed to render — please try again.')
      await go('Beta Roofing')
      expect(subjects()).toEqual(['⚠ The homepage preview is failing (500) — visitors see "Preview failed to render" — Acme Roofing'])
      render.mockResolvedValue({ html: '<html>ok</html>' } as any)
      expect((await go('Gamma Roofing')).status).toBe(200)
      expect(activeAlertKeys()).not.toContain('route:preview')
      render.mockRejectedValue(new Error('template folder missing'))
      await go('Delta Roofing')
      expect(sent).toHaveLength(2)
    } finally { spy.mockRestore(); render.mockRestore() }
  })

  test('Stripe notifications rejected for a bad signature: one alert, the same 400; a verified event clears it', async () => {
    const spy = quiet()
    try {
      const r = await post('/stripe/webhook', '{}', { 'stripe-signature': 't=1,v1=bad' })
      expect(r.status).toBe(400)
      await post('/stripe/webhook', '{}', { 'stripe-signature': 't=1,v1=bad' })
      expect(subjects()).toHaveLength(1)
      expect(subjects()[0]).toContain('Stripe payment notifications are being rejected')
    } finally { spy.mockRestore() }
  })

  test('Stripe events that fail to process (500): one alert per event type, cleared by the next one that works', async () => {
    const stripe = (await import('../../../apps/api/src/services/factoryStripe')).default
    const verify = spyOn(stripe, 'verifyWebhookSignature').mockResolvedValue({ type: 'invoice.paid', data: { object: {} } } as any)
    const handle = spyOn(stripe, 'handleFactoryWebhook').mockRejectedValue(new Error('tenant update failed'))
    const spy = quiet()
    try {
      const go = () => post('/stripe/webhook', '{}', { 'stripe-signature': 'x' })
      expect((await go()).status).toBe(500)
      await go()
      expect(subjects()).toEqual(['⚠ Stripe payment events are failing to process (invoice.paid, 500) — Stripe will retry'])
      handle.mockResolvedValue({ handled: false } as any)
      expect((await go()).status).toBe(200)
      expect(activeAlertKeys()).not.toContain('stripe-webhook:invoice.paid')
      handle.mockRejectedValue(new Error('tenant update failed'))
      await go()
      expect(sent).toHaveLength(2)
    } finally { spy.mockRestore(); verify.mockRestore(); handle.mockRestore() }
  })

  test('a payment that fails: one alert naming the business; paying again resets it', async () => {
    const stripe = (await import('../../../apps/api/src/services/factoryStripe')).default
    const store = fakeStore({ tenants: [{ id: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', name: 'Acme Roofing', email: 'o@acme.example', stripe_subscription_id: 'sub_1' }] })
    ;(down as any).from = (t: string) => store.from(t)
    const verify = spyOn(stripe, 'verifyWebhookSignature').mockResolvedValue({ type: 'invoice.payment_failed', data: { object: {} } } as any)
    const handle = spyOn(stripe, 'handleFactoryWebhook').mockResolvedValue({ handled: true, factoryCustomerId: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', updates: { billing_status: 'past_due' } } as any)
    try {
      const go = () => post('/stripe/webhook', '{}', { 'stripe-signature': 'x' })
      expect((await go()).status).toBe(200); await settle()
      await go(); await settle()
      expect(subjects()).toEqual(['⚠ A customer\'s payment failed — their account is past due — Acme Roofing'])
      handle.mockResolvedValue({ handled: true, factoryCustomerId: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', updates: { billing_status: 'active' } } as any)
      await go(); await settle()
      expect(activeAlertKeys().filter((k) => k.startsWith('payment-failed:'))).toEqual([])
    } finally {
      verify.mockRestore(); handle.mockRestore()
      ;(down as any).from = () => { throw new Error('database is down') }
    }
  })
})
