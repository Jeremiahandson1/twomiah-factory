// Buy it outright, from the business's own app: owner only, the offer and the checkout go through the Factory (a fake one on
// localhost here — no Stripe, no GitHub), and the Factory's call for the data export after payment is its alone.
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { bootTenant, seedOwner } from './harness.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let owner = '', admin = '', manager = ''
let factory: ReturnType<typeof Bun.serve>
const seen: Array<{ method: string; path: string; key: string | null; body: any }> = []
const OFFER = { eligible: true, reason: null, planName: 'Starter', monthlyCents: 9900, months: 36, priceCents: 356400, includes: ['Your code'], terms: ['Not for resale (§7)'], termsVersion: 'v1', license: null }

const as = (p: string, tok: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tok}` } })
const login = async (email: string, password: string) => (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken as string

beforeAll(async () => {
  factory = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url)
      const body = req.method === 'POST' ? await req.json().catch(() => null) : null
      seen.push({ method: req.method, path: url.pathname, key: req.headers.get('x-factory-key'), body })
      if (url.pathname.endsWith('/license') && req.method === 'GET') return Response.json(OFFER)
      if (url.pathname.endsWith('/license-checkout')) {
        if (body?.githubUsername === 'nobody-here') return Response.json({ error: 'GitHub has no user called "nobody-here".', code: 'github_user_not_found' }, { status: 400 })
        return Response.json({ url: 'https://checkout.stripe.example/c/test' })
      }
      return Response.json({ error: 'nope' }, { status: 404 })
    },
  })
  process.env.FACTORY_URL = `http://localhost:${factory.port}`
  process.env.TENANT_ID = 'tenant-uuid-1'
  process.env.FACTORY_SYNC_KEY = 'sync-key-1'
  t = await bootTenant()
  const s = await seedOwner(t)
  for (const [email, role] of [['admin@test.example', 'admin'], ['manager@test.example', 'manager']] as const) {
    await t.db.insert(t.schema.user).values({ email, passwordHash: await Bun.password.hash('Other-pass-1', 'bcrypt'), firstName: role, lastName: 'Person', role, companyId: s.company.id } as any)
  }
  await t.db.insert(t.schema.contact).values({ companyId: s.company.id, name: 'Ann Able', email: 'ann@example.com', type: 'client' } as any)
  owner = await login('owner@test.example', s.password)
  admin = await login('admin@test.example', 'Other-pass-1')
  manager = await login('manager@test.example', 'Other-pass-1')
}, 120_000)
afterAll(() => { factory?.stop(true); delete process.env.FACTORY_URL; delete process.env.TENANT_ID; delete process.env.FACTORY_SYNC_KEY })

describe('the offer', () => {
  test('the owner sees the Factory’s offer, asked with the business’s own key', async () => {
    const res = await as('/api/license', owner)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(OFFER)
    const call = seen.find((s) => s.path === '/api/v1/factory/customers/tenant-uuid-1/license')!
    expect(call.key).toBe('sync-key-1')
  })
  test('owner only: an admin and a manager are refused, and the Factory is not asked', async () => {
    const before = seen.length
    for (const tok of [admin, manager]) {
      const res = await as('/api/license', tok)
      expect(res.status).toBe(403)
      expect((await res.json()).code).toBe('owner_only')
      expect((await as('/api/license/checkout', tok, { method: 'POST', json: { githubUsername: 'x', acceptedTerms: true, hosting: 'twomiah', termsVersion: 'v1' } })).status).toBe(403)
    }
    expect((await t.call('/api/license')).status).toBe(401)
    expect(seen.length).toBe(before)
  })
})

describe('the checkout', () => {
  const post = (json: unknown) => as('/api/license/checkout', owner, { method: 'POST', json })
  test('GitHub name and accepted terms go to the Factory; the owner is handed Stripe’s page', async () => {
    const res = await post({ githubUsername: 'acme-owner', acceptedTerms: true, hosting: 'twomiah', termsVersion: 'v1' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ url: 'https://checkout.stripe.example/c/test' })
    const call = seen.filter((s) => s.path.endsWith('/license-checkout')).pop()!
    expect(call.body).toEqual({ githubUsername: 'acme-owner', acceptedTerms: true, hosting: 'twomiah', termsVersion: 'v1' })
  })
  test('terms not accepted, or no GitHub name: refused here, in the error shape with the field named; the Factory is not asked', async () => {
    const before = seen.length
    const noTerms = await post({ githubUsername: 'acme-owner', acceptedTerms: false, hosting: 'twomiah', termsVersion: 'v1' })
    expect(noTerms.status).toBe(400)
    expect((await noTerms.json()).fields.acceptedTerms).toMatch(/accept/i)
    const noName = await post({ githubUsername: '  ', acceptedTerms: true, hosting: 'twomiah', termsVersion: 'v1' })
    expect(noName.status).toBe(400)
    expect((await noName.json()).fields.githubUsername).toMatch(/GitHub/)
    expect(seen.length).toBe(before)
  })
  test('the hosting choice is required and goes to the Factory as chosen (both ways)', async () => {
    const before = seen.length
    for (const hosting of [undefined, 'both']) {
      const res = await post({ githubUsername: 'acme-owner', hosting, acceptedTerms: true, termsVersion: 'v1' })
      expect(res.status).toBe(400)
      expect((await res.json()).fields.hosting).toMatch(/hosting it/)
    }
    expect(seen.length).toBe(before)
    for (const hosting of ['twomiah', 'self']) {
      expect((await post({ githubUsername: 'acme-owner', hosting, acceptedTerms: true, termsVersion: 'v1' })).status).toBe(200)
      expect(seen.filter((s) => s.path.endsWith('/license-checkout')).pop()!.body.hosting).toBe(hosting)
    }
  })
  test('the Factory’s own refusal (GitHub has no such user) keeps its sentence', async () => {
    const res = await post({ githubUsername: 'nobody-here', acceptedTerms: true, hosting: 'twomiah', termsVersion: 'v1' })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/no user called/)
    expect(body.code).toBe('github_user_not_found')
  })
})

describe('the Factory’s call for the data export after payment', () => {
  test('it is the Factory’s alone: no key and a wrong key are refused', async () => {
    expect((await t.call('/api/internal/handover-export', { method: 'POST' })).status).toBe(401)
    expect((await t.call('/api/internal/handover-export', { method: 'POST', headers: { 'X-Factory-Key': 'wrong-key-1' } })).status).toBe(401)
    expect((await as('/api/internal/handover-export', owner, { method: 'POST' })).status).toBe(401)
  })
  test('with the key: the business’s whole export as a ZIP, counted in headers, and an audit row', async () => {
    const res = await t.call('/api/internal/handover-export', { method: 'POST', headers: { 'X-Factory-Key': 'sync-key-1' } })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/zip')
    expect(Number(res.headers.get('x-export-files'))).toBeGreaterThan(2)
    expect(Number(res.headers.get('x-export-rows'))).toBeGreaterThan(0)
    const bytes = Buffer.from(await res.arrayBuffer())
    expect(bytes.subarray(0, 2).toString()).toBe('PK')
    expect(bytes.toString('latin1')).toContain('data/contact.csv')
    await new Promise((r) => setTimeout(r, 50))
    const rows = await t.db.select().from(t.schema.auditLog)
    expect(rows.some((r: any) => r.entity === 'handover' && r.action === 'export')).toBe(true)
  })
})
