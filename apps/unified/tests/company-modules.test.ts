// The company-wide modules every tenant has, through the real server: the company and its people, the audit log,
// the lead inbox behind sign-in (and the public enquiry beside it), the admin-only settings, and the Factory's sync.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let seeded: Awaited<ReturnType<typeof seedOwner>>
let owner: string
let staff: string

const signIn = async (email: string, password: string) => (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken as string
const as = (token: string, path: string, init: any = {}) => t.call(path, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } })

beforeAll(async () => {
  t = await bootTenant()
  seeded = await seedOwner(t)
  await t.db.insert(t.schema.user).values({
    email: 'staff@test.example', passwordHash: await Bun.password.hash('Staff-pass-1', 'bcrypt'),
    firstName: 'Sam', lastName: 'Staff', role: 'field', companyId: seeded.company.id,
  })
  owner = await signIn('owner@test.example', seeded.password)
  staff = await signIn('staff@test.example', 'Staff-pass-1')
})

describe('the company and its people', () => {
  test('the signed-in owner reads the company and its users', async () => {
    const co = await as(owner, '/api/company')
    expect(co.status).toBe(200)
    expect(JSON.stringify(await co.json())).toContain('Test Builders')
    const users = await as(owner, '/api/company/users')
    expect(users.status).toBe(200)
    expect(JSON.stringify(await users.json())).toContain('staff@test.example')
  })

  test('the feature catalogue is the vertical\'s', async () => {
    const res = await as(owner, '/api/company/features/catalog')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.template).toBe('crm')
    expect(body.features.length).toBeGreaterThan(10)
  })

  test('nobody reads the company without signing in', async () => {
    expect((await t.call('/api/company')).status).toBe(401)
  })
})

describe('the audit log', () => {
  test('owners read it as { data, pagination }, in camelCase with real instants', async () => {
    const res = await as(owner, '/api/audit?limit=5')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.pagination).toEqual({ page: 1, limit: 5, total: expect.any(Number), pages: expect.any(Number) })
    const login = body.data.find((r: any) => r.action === 'login')
    expect(login.userEmail).toBeTruthy()
    expect(login.created_at).toBeUndefined()
    expect(login.createdAt).toMatch(/Z$/)
    const filters = await (await as(owner, '/api/audit/filters')).json()
    expect(filters.actions.find((a: any) => a.value === 'login').count).toBeGreaterThan(0)
  })

  test('staff may not read it', async () => {
    expect((await as(staff, '/api/audit')).status).toBe(403)
  })
})

describe('leads', () => {
  test('the lead inbox is the lead_inbox feature\'s: refused while it is off, open once it is on', async () => {
    const off = await as(owner, '/api/leads')
    expect(off.status).toBe(403)
    expect((await off.json()).code).toBe('FEATURE_NOT_ENABLED')
    expect((await as(owner, '/api/company/features', { method: 'PUT', json: { features: ['lead_inbox'] } })).status).toBe(200)
    expect((await as(owner, '/api/leads')).status).toBe(200)
  })

  test('the lead inbox needs a session; the public enquiry beside it does not', async () => {
    expect((await t.call('/api/leads')).status).toBe(401)
    expect((await as(owner, '/api/leads')).status).toBe(200)
    const sent = await t.call('/api/leads', { method: 'POST', json: { name: 'Pat Jones', email: 'pat@example.com', message: 'Please call me' }, headers: { 'X-Forwarded-For': '203.0.113.50' } })
    expect(sent.status).toBe(200)
  })
})

describe('owner and admin settings', () => {
  test('billing, account and email addresses refuse staff', async () => {
    for (const path of ['/api/billing', '/api/account/offboard/status', '/api/email-aliases']) {
      expect((await as(staff, path)).status).toBe(403)
    }
  })

  test('the owner reaches the email addresses', async () => {
    expect((await as(owner, '/api/email-aliases')).status).toBe(200)
  })
})

describe("the Factory's sync", () => {
  test('feature sync: refused without the key, replaces the list with it', async () => {
    delete process.env.FACTORY_SYNC_KEY
    expect((await t.call('/api/internal/sync-features', { method: 'POST', json: { features: ['lead_inbox'] } })).status).toBe(503)
    process.env.FACTORY_SYNC_KEY = 'factory-key-for-test'
    expect((await t.call('/api/internal/sync-features', { method: 'POST', json: { features: ['lead_inbox'] }, headers: { 'X-Factory-Key': 'nope-nope-nope-nope-' } })).status).toBe(401)
    const ok = await t.call('/api/internal/sync-features', { method: 'POST', json: { features: ['lead_inbox', 'reports'] }, headers: { 'X-Factory-Key': 'factory-key-for-test' } })
    expect(ok.status).toBe(200)
    const [co] = await t.db.select().from(t.schema.company).where(eq(t.schema.company.id, seeded.company.id))
    expect(co.enabledFeatures).toEqual(['lead_inbox', 'reports'])
    expect((await t.call('/api/internal/sync-features', { method: 'POST', json: { features: 'all' }, headers: { 'X-Factory-Key': 'factory-key-for-test' } })).status).toBe(400)
  })
})
