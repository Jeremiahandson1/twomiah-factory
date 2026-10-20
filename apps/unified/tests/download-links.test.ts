// One-time download links (server/http/downloads.ts): a quote's PDF fetched by a link a browser with no session can
// open, as the person who asked — their permission, an ended session and the single use all hold.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { createDownloadLinks } from '../server/http/downloads.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let s: Awaited<ReturnType<typeof seedOwner>>
const tokens: Record<string, string> = {}
let quoteId = ''
const as = (who: string, path: string, init: any = {}) => t.call(path, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tokens[who]}` } })
const signIn = async (email: string, password: string) => (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken

beforeAll(async () => {
  t = await bootTenant({ vertical: 'contractor' })
  s = await seedOwner(t)
  await t.db.update(t.schema.company).set({ enabledFeatures: ['contacts', 'quotes', 'invoices'] }).where(eq(t.schema.company.id, s.company.id))
  tokens.owner = await signIn(s.owner.email, s.password)
  await t.db.insert(t.schema.user).values({ email: 'tech@test.example', passwordHash: await Bun.password.hash('Seat-pass-1', 'bcrypt'), firstName: 'Tech', lastName: 'Seat', role: 'field', companyId: s.company.id })
  tokens.field = await signIn('tech@test.example', 'Seat-pass-1')
  const contact = await (await as('owner', '/api/contacts', { method: 'POST', json: { name: 'Pat Client', type: 'client' } })).json()
  quoteId = (await (await as('owner', '/api/quotes', { method: 'POST', json: { name: 'Deck', contactId: contact.id, lineItems: [{ description: 'Boards', quantity: 10, unitPrice: 25 }] } })).json()).id
})

describe('download links', () => {
  test("the owner's link downloads the quote's PDF with no sign-in on the request, once", async () => {
    const r = await as('owner', '/api/downloads', { method: 'POST', json: { path: `/api/quotes/${quoteId}/pdf` } })
    expect(r.status).toBe(201)
    const { url } = await r.json()
    expect(url).toMatch(/^\/api\/download\/[A-Za-z0-9_-]{40,}$/)
    const pdf = await t.call(url)
    expect(pdf.status).toBe(200)
    expect(pdf.headers.get('content-type')).toBe('application/pdf')
    expect(new TextDecoder().decode((await pdf.arrayBuffer()).slice(0, 5))).toBe('%PDF-')
    expect((await t.call(url)).status).toBe(404)
  })

  test('a seat that may not read quotes gets no PDF: the route\'s own permission applies at download', async () => {
    const { url } = await (await as('field', '/api/downloads', { method: 'POST', json: { path: `/api/quotes/${quoteId}/pdf` } })).json()
    expect((await t.call(url)).status).toBe(403)
  })

  test('only a quote or invoice PDF can be linked; no sign-in, no link; a made-up token is nothing', async () => {
    for (const path of ['/api/contacts', '/api/quotes', `/api/quotes/${quoteId}`, `/api/quotes/${quoteId}/pdf/../../contacts`, 'https://evil.example/x'])
      expect((await as('owner', '/api/downloads', { method: 'POST', json: { path } })).status).toBe(400)
    expect((await t.call('/api/downloads', { method: 'POST', json: { path: `/api/quotes/${quoteId}/pdf` } })).status).toBe(401)
    expect((await t.call('/api/download/not-a-real-token')).status).toBe(404)
  })

  test('a password changed after the link was asked for: the download is refused (the original sign-in has ended)', async () => {
    const { url } = await (await as('owner', '/api/downloads', { method: 'POST', json: { path: `/api/quotes/${quoteId}/pdf` } })).json()
    await Bun.sleep(1100)
    await t.db.update(t.schema.user).set({ sessionsValidFrom: new Date() }).where(eq(t.schema.user.id, s.owner.id))
    expect((await t.call(url)).status).toBe(401)
    await t.db.update(t.schema.user).set({ sessionsValidFrom: null }).where(eq(t.schema.user.id, s.owner.id))
  })

  test('a link lasts 60 seconds', async () => {
    let clock = 1_000_000
    const fetched: string[] = []
    const d = createDownloadLinks({ now: () => clock, fetchApp: (req) => { fetched.push(new URL(req.url).pathname); return new Response('ok') } })
    const { Hono } = await import('hono')
    const app = new Hono()
    app.use('*', async (c, next) => { c.req.raw.headers.set('Authorization', `Bearer ${tokens.owner}`); await next() })
    app.route('/api/downloads', d.linkRoutes)
    app.route('/api/download', d.downloadRoutes)
    const ask = async () => (await (await app.request('/api/downloads', { method: 'POST', headers: { 'content-type': 'application/json', Authorization: `Bearer ${tokens.owner}` }, body: JSON.stringify({ path: `/api/quotes/${quoteId}/pdf` }) })).json()).url
    const late = await ask()
    clock += 60_001
    expect((await app.request(late)).status).toBe(404)
    const fresh = await ask()
    clock += 59_000
    expect((await app.request(fresh)).status).toBe(200)
    expect(fetched).toEqual([`/api/quotes/${quoteId}/pdf`])
  })
})
