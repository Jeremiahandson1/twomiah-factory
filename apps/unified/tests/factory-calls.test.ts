// Every call the live Factory makes to a tenant, against the unified app (docs/CUTOVER_FACTORY_MAP.md gap 10, 22): each
// door answers the Factory's exact request (apps/api/src) with the tenant's key and refuses without it; each job the
// premium site waited on a Factory cron for, the unified app runs on its own clock.
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import sharp from 'sharp'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { decrypt } from '../server/core/crypto.ts'

// Every tenant service has an ENCRYPTION_KEY (unified/build.ts tenantEnv); Google's tokens are sealed with it.
process.env.ENCRYPTION_KEY ||= 'test-encryption-key'
import { createRoofReportService } from '../server/crm/roof/reports/roofReportService.ts'

const KEY = 'factory-calls-test-key'
const saved: Record<string, string | undefined> = {}
const setEnv = (k: string, v: string | undefined) => { if (!(k in saved)) saved[k] = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v }
const withKey = (extra: Record<string, string> = {}) => ({ 'Content-Type': 'application/json', 'X-Factory-Key': KEY, ...extra })

let t: Awaited<ReturnType<typeof bootTenant>>
let co: { id: string }
// Stands in for the Factory's signed intake links and for the Factory itself (no live service from a test).
let server: ReturnType<typeof Bun.serve>
let base = ''
const factoryHeard: Array<{ path: string; key: string | null; body: any }> = []
let JPEG: Buffer

beforeAll(async () => {
  setEnv('FACTORY_SYNC_KEY', KEY)
  JPEG = await sharp({ create: { width: 4, height: 3, channels: 3, background: '#c33' } }).jpeg().toBuffer()
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const u = new URL(req.url)
      if (u.pathname === '/intake/front.jpg') return new Response(new Uint8Array(JPEG), { headers: { 'Content-Type': 'image/jpeg' } })
      if (u.pathname === '/intake/notes.txt') return new Response('not a picture', { headers: { 'Content-Type': 'text/plain' } })
      if (u.pathname.startsWith('/api/v1/factory/')) {
        factoryHeard.push({ path: u.pathname, key: req.headers.get('X-Factory-Key'), body: await req.json().catch(() => null) })
        return Response.json({ success: true })
      }
      return new Response('gone', { status: 404 })
    },
  })
  base = `http://localhost:${server.port}`
  t = await bootTenant()
  co = (await seedOwner(t)).company
})

afterAll(() => {
  server?.stop(true)
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
})

describe("the Factory's doors", () => {
  test('every factory door refuses a caller without the key, or with the wrong one', async () => {
    const doors = t.services.mounts.filter((m) => m.access === 'factory').map((m) => m.path)
    for (const p of ['/api/internal/seed-photos', '/api/internal/booking-jobs', '/api/internal/gbp', '/api/internal/inbound-email', '/api/internal/sync-features', '/api/internal/sync-subscription', '/api/internal/email-aliases', '/api/internal/provision']) {
      expect(doors).toContain(p)
    }
    for (const p of doors) {
      expect((await t.call(p, { method: 'POST', json: {} })).status).toBe(401)
      expect((await t.call(p, { method: 'POST', json: {}, headers: { 'X-Factory-Key': 'wrong' } })).status).toBe(401)
    }
  })

  test('seed-photos: the intake photos land in the website library, kept in the store (routes/factory/deploy.ts seedIntakePhotosIfPremium)', async () => {
    const photos = [
      { url: `${base}/intake/front.jpg`, tag: 'misc', alt: 'Test Builders logo' },
      { url: `${base}/intake/front.jpg?X-Amz-Signature=abc` },
      { url: `${base}/intake/missing.jpg` },
      { url: `${base}/intake/notes.txt` },
    ]
    const r = await t.call('/api/internal/seed-photos', { method: 'POST', headers: withKey(), body: JSON.stringify({ photos }) })
    expect(r.status).toBe(200)
    const body = await r.json() as any
    expect(body.seeded).toBe(2)
    expect(body.errors.map((e: any) => e.url)).toEqual([`${base}/intake/missing.jpg`, `${base}/intake/notes.txt`])
    const rows = await t.db.select().from(t.schema.photo).where(eq(t.schema.photo.companyId, co.id))
    expect(rows).toHaveLength(2)
    const logo = rows.find((p: any) => p.alt === 'Test Builders logo')!
    expect(logo).toMatchObject({ isPublic: true, tags: ['misc'], mimeType: 'image/jpeg', userId: null })
    expect(t.store.objects.has(logo.filename)).toBe(true)
    // The website serves it.
    const media = await t.call(logo.publicUrl!)
    expect(media.status).toBe(200)
    expect(media.headers.get('content-type')).toContain('image/jpeg')
  })

  test('seed-photos: nothing to seed is an answer; no key is refused', async () => {
    const r = await t.call('/api/internal/seed-photos', { method: 'POST', headers: withKey(), body: JSON.stringify({ photos: [] }) })
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ seeded: 0 })
    const refused = await t.call('/api/internal/seed-photos', { method: 'POST', json: { photos: [{ url: `${base}/intake/front.jpg` }] } })
    expect(refused.status).toBe(401)
  })

  test('/api/stripe/factory-event: a forwarded Connect event (services/connectWebhook.ts) is taken with the key, refused without', async () => {
    const event = { id: 'evt_test', type: 'customer.created', account: 'acct_test', data: { object: { id: 'cus_test' } } }
    const ok = await t.call('/api/stripe/factory-event', { method: 'POST', headers: withKey(), body: JSON.stringify({ event }) })
    expect(ok.status).toBe(200)
    expect(await ok.json()).toMatchObject({ received: true })
    expect((await t.call('/api/stripe/factory-event', { method: 'POST', json: { event } })).status).toBe(401)
    expect((await t.call('/api/stripe/factory-event', { method: 'POST', headers: withKey(), body: JSON.stringify({ event: { type: 'x' } }) })).status).toBe(400)
  })

  test('/api/leads/inbound/email: a lead-source email (routes/factory/lifecycle.ts) becomes a lead', async () => {
    await t.db.insert(t.schema.leadSource).values({ companyId: co.id, platform: 'angi', label: 'Angi' })
    const mail = { platform: 'angi', from: 'Angi Leads <leads@angi.com>', subject: 'New lead: Jane Doe', text: 'Name: Jane Doe\nPhone: 555-123-4567\nEmail: jane@example.com', html: '' }
    const ok = await t.call('/api/leads/inbound/email', { method: 'POST', headers: withKey(), body: JSON.stringify(mail) })
    expect(ok.status).toBe(201)
    const { leadId } = await ok.json() as any
    const [row] = await t.db.select().from(t.schema.lead).where(eq(t.schema.lead.id, leadId))
    expect(row).toMatchObject({ companyId: co.id, sourcePlatform: 'angi' })
    expect((await t.call('/api/leads/inbound/email', { method: 'POST', json: mail })).status).toBe(401)
  })

  test('/api/internal/inbound-email: a message to an address (routes/factory/lifecycle.ts) is kept', async () => {
    const msg = { toLocalPart: 'info', fromEmail: 'jane@example.com', fromName: 'Jane', subject: 'Hello', textBody: 'Hi there', htmlBody: '', spfVerdict: 'pass', dkimVerdict: 'pass', rawHeaders: '' }
    const ok = await t.call('/api/internal/inbound-email', { method: 'POST', headers: withKey(), body: JSON.stringify(msg) })
    expect(ok.status).toBe(200)
    expect(await ok.json()).toMatchObject({ success: true })
  })

  test('/api/internal/gbp/store-tokens: the Google Business Profile sign-in (routes/factory/lifecycle.ts) is kept', async () => {
    const tokens = { userId: 'u1', externalAccountEmail: 'owner@example.com', accessToken: 'at', refreshToken: 'rt', expiresInSec: 3600 }
    const ok = await t.call('/api/internal/gbp/store-tokens', { method: 'POST', headers: withKey(), body: JSON.stringify(tokens) })
    expect(ok.status).toBe(200)
    const [conn] = await t.db.select().from(t.schema.gbpConnection)
    // Kept sealed with the tenant's key (gbp.ts secrets), as the privacy policy says Google's access is stored.
    expect(conn.externalEmail).toBe('owner@example.com')
    expect([decrypt(conn.accessToken), decrypt(conn.refreshToken!)]).toEqual(['at', 'rt'])
  })

  test('/api/internal/booking-jobs: the Factory may still run the pass', async () => {
    const r = await t.call('/api/internal/booking-jobs', { method: 'POST', headers: withKey() })
    expect(r.status).toBe(200)
    expect(await r.json()).toMatchObject({ reminders: expect.any(Number), rebooks: expect.any(Number), reviews: expect.any(Number) })
  })
})

describe('the jobs the unified app runs itself', () => {
  /** Runs `fn` with the clock's two schedulers recorded instead of armed. */
  function captureTimers(fn: () => void) {
    const timeouts: Array<{ cb: () => void; ms: number }> = [], intervals: Array<{ cb: () => void; ms: number }> = []
    const realTimeout = globalThis.setTimeout, realInterval = globalThis.setInterval
    globalThis.setTimeout = ((cb: any, ms: number) => { timeouts.push({ cb, ms }); return 0 as any }) as any
    globalThis.setInterval = ((cb: any, ms: number) => { intervals.push({ cb, ms }); return 0 as any }) as any
    try { fn() } finally { globalThis.setTimeout = realTimeout; globalThis.setInterval = realInterval }
    return { timeouts, intervals }
  }

  test("the booking reminders, rebook nudges and review requests run hourly on the app's own clock, started with the CRM's jobs", async () => {
    // Started at boot with the rest of the timed work (server/index.ts → crm.startJobs).
    const real = t.services.bookings.startJobs
    let started = 0
    t.services.bookings.startJobs = () => { started++ }
    try { captureTimers(() => t.services.crm.startJobs()) } finally { t.services.bookings.startJobs = real }
    expect(started).toBe(1)

    // A booking tomorrow, due its reminder; the pass the timer runs sends it.
    await t.db.insert(t.schema.bookingSettings).values({ companyId: co.id })
    const start = new Date(Date.now() + 24 * 3600_000)
    const [b] = await t.db.insert(t.schema.booking).values({
      companyId: co.id, startAt: start, endAt: new Date(start.getTime() + 3600_000), customerName: 'Jane Doe', customerEmail: 'jane@example.com', token: 'tok-reminder',
    }).returning()
    const { timeouts, intervals } = captureTimers(() => t.services.bookings.startJobs())
    expect(timeouts.map((x) => x.ms)).toEqual([60_000])
    expect(intervals.map((x) => x.ms)).toEqual([60 * 60 * 1000])
    intervals[0].cb()
    // One pass at a time: a second call while the first runs shares it.
    const [a1, a2] = await Promise.all([t.services.bookings.runJobs(), t.services.bookings.runJobs()])
    expect(a1).toBe(a2)
    const [after] = await t.db.select().from(t.schema.booking).where(eq(t.schema.booking.id, b.id))
    expect(after.reminderEmailSentAt).toBeInstanceOf(Date)
  })

  test('a roof report needing review reaches the Factory at FACTORY_URL (the build sets no FACTORY_API_URL)', async () => {
    setEnv('FACTORY_URL', base + '/')
    setEnv('RENDER_EXTERNAL_URL', 'https://tenant.example')
    const reports = createRoofReportService({ db: t.db, logger: { info() {}, warn() {}, error() {} } } as any)
    await reports.notifyFactoryNewReport('rep_1', '12 Pine St', 'Akron', 'OH', co.id)
    expect(factoryHeard).toEqual([{
      path: '/api/v1/factory/roof-review/notify', key: KEY,
      body: { reportId: 'rep_1', address: '12 Pine St, Akron, OH', companyId: co.id, backendUrl: 'https://tenant.example' },
    }])
  })
})
