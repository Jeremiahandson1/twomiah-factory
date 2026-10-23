// A quote the customer has opened is still open (2026-10-23). Opening the private link marks it 'viewed' (portal.ts),
// and every office move listed only draft and sent: once the customer had looked, the office could not mark it
// approved when they rang to say yes, nor declined, nor edit or send it again. tenant-backend quotes.ts
// OPEN_QUOTE_STATUSES is now the one list those moves read.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let token = ''
let contactId = ''
const sent: Array<{ template: string; data: any }> = []
const call = (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } })
const json = async (r: Response) => ({ status: r.status, body: await r.json() as any })

beforeAll(async () => {
  t = await bootTenant({ vertical: 'contractor' })
  const seeded = await seedOwner(t)
  await t.db.update(t.schema.company).set({ enabledFeatures: ['contacts', 'quotes', 'invoices', 'jobs'], email: 'office@test.example' } as any).where(eq(t.schema.company.id, seeded.company.id))
  token = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: seeded.password } })).json()).accessToken
  const email: any = t.services.email
  const real = email.send.bind(email)
  email.send = async (to: string, template: string, data: any, options?: any) => { sent.push({ template, data }); return real(to, template, data, options) }
  const [ann] = await t.db.insert(t.schema.contact).values({ companyId: seeded.company.id, name: 'Ann Able', email: 'ann@example.com' } as any).returning()
  contactId = ann.id
}, 120_000)

/** A quote sent and opened by the customer on its private link. */
async function viewedQuote(name: string) {
  const q = await json(await call('/api/quotes', { method: 'POST', json: { name, contactId, lineItems: [{ description: 'Cabinets', quantity: 1, unitPrice: 500 }] } }))
  expect((await call(`/api/quotes/${q.body.id}/send`, { method: 'POST' })).status).toBe(200)
  const link = String(sent.filter((m) => m.template === 'quoteSent').at(-1)!.data.documentPath).replace('/d/', '')
  expect((await t.call(`/api/portal/d/${link}/quotes/${q.body.id}`)).status).toBe(200)
  expect((await json(await call(`/api/quotes/${q.body.id}`))).body.status).toBe('viewed')
  return q.body.id as string
}

describe('a viewed quote is still open', () => {
  test('the office marks it approved', async () => {
    const id = await viewedQuote('Approve me')
    const r = await json(await call(`/api/quotes/${id}/approve`, { method: 'POST', json: {} }))
    expect(r.status).toBe(200)
    expect(r.body.status).toBe('approved')
  })

  test('…or rejected', async () => {
    const id = await viewedQuote('Reject me')
    const r = await json(await call(`/api/quotes/${id}/reject`, { method: 'POST', json: {} }))
    expect([r.status, r.body.status]).toEqual([200, 'rejected'])
  })

  test('…edits it and sends it again', async () => {
    const id = await viewedQuote('Edit me')
    const put = await json(await call(`/api/quotes/${id}`, { method: 'PUT', json: { name: 'Edited', contactId, lineItems: [{ description: 'Cabinets', quantity: 2, unitPrice: 500 }] } }))
    expect(put.status).toBe(200)
    const again = await json(await call(`/api/quotes/${id}/send`, { method: 'POST' }))
    expect(again.status).toBe(200)
  })

  test('the list finds viewed quotes, the stats count them as awaiting an answer, and an edit cannot type "viewed"', async () => {
    const id = await viewedQuote('Filter me')
    const list = await json(await call('/api/quotes?status=viewed'))
    expect(list.status).toBe(200)
    expect(list.body.data.map((q: any) => q.id)).toContain(id)
    const stats = await json(await call('/api/quotes/stats'))
    const all = (await json(await call('/api/quotes?limit=100'))).body.data
    expect(stats.body.sent).toBe(all.filter((q: any) => q.status === 'sent' || q.status === 'viewed').length)
    expect(all.some((q: any) => q.status === 'viewed')).toBe(true)
    const draft = await json(await call('/api/quotes', { method: 'POST', json: { name: 'Draft', contactId, lineItems: [{ description: 'X', quantity: 1, unitPrice: 1 }] } }))
    await call(`/api/quotes/${draft.body.id}`, { method: 'PUT', json: { status: 'viewed' } })
    expect((await json(await call(`/api/quotes/${draft.body.id}`))).body.status).toBe('draft')
  })

  test('an answered quote stays answered', async () => {
    const id = await viewedQuote('Done')
    expect((await call(`/api/quotes/${id}/approve`, { method: 'POST', json: {} })).status).toBe(200)
    expect((await call(`/api/quotes/${id}/reject`, { method: 'POST', json: {} })).status).toBe(400)
  })
})
