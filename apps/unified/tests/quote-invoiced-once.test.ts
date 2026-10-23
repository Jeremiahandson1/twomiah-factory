// A quote is invoiced once (live test 2026-10-22, roofing P3.3): "Create Invoice" was still offered on a quote that had
// INV-00001. The server already refused a second invoice from the same quote (convert-to-invoice, under a lock); the
// screens did not know the quote was billed. A quote now says so — `invoiced`, and the invoice's number to a seat that
// reads invoices — on the quote and on the list, and the screens offer the invoice instead of a second one.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let token = ''
const ids: Record<string, string> = {}
const call = (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } })
const json = async (r: Response) => ({ status: r.status, body: await r.json() as any })

beforeAll(async () => {
  t = await bootTenant({ vertical: 'roofing' })
  const seeded = await seedOwner(t)
  token = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: seeded.password } })).json()).accessToken
  const [casey] = await t.db.insert(t.schema.contact).values({ companyId: seeded.company.id, name: 'Casey Customer', email: 'casey@example.com' } as any).returning()
  ids.contact = casey.id
  await t.db.update(t.schema.company).set({ enabledFeatures: ['contacts', 'jobs', 'quotes', 'invoices'] } as any).where(eq(t.schema.company.id, seeded.company.id))
}, 120_000)

describe('a quote is invoiced once', () => {
  test('before: not invoiced; converted: the quote and the list name its invoice; a second convert is refused', async () => {
    const q = await json(await call('/api/quotes', { method: 'POST', json: { name: 'Roof replacement', contactId: ids.contact, lineItems: [{ description: 'Tear-off and shingles', quantity: 1, unitPrice: 9125.75 }] } }))
    expect(q.status).toBe(201)
    ids.quote = q.body.id
    expect((await call(`/api/quotes/${ids.quote}/approve`, { method: 'POST', json: {} })).status).toBe(200)
    const before = await json(await call(`/api/quotes/${ids.quote}`))
    expect(before.body).toMatchObject({ invoiced: false, invoice: null })

    const inv = await json(await call(`/api/quotes/${ids.quote}/convert-to-invoice`, { method: 'POST', json: {} }))
    expect(inv.status).toBe(201)

    const after = await json(await call(`/api/quotes/${ids.quote}`))
    expect(after.body).toMatchObject({ invoiced: true, invoice: { id: inv.body.id, number: inv.body.number } })
    const list = await json(await call('/api/quotes'))
    expect(list.body.data.find((r: any) => r.id === ids.quote)).toMatchObject({ invoiced: true, invoice: { number: inv.body.number } })

    const again = await json(await call(`/api/quotes/${ids.quote}/convert-to-invoice`, { method: 'POST', json: {} }))
    expect(again.status).toBe(400)
    expect(again.body.error).toBe(`This quote was already converted to invoice ${inv.body.number}.`)
    const all = await json(await call('/api/invoices'))
    expect(all.body.data.filter((i: any) => i.quoteId === ids.quote)).toHaveLength(1)
  })

  test('another quote is not marked by this one', async () => {
    const q = await json(await call('/api/quotes', { method: 'POST', json: { name: 'Gutters', contactId: ids.contact, lineItems: [{ description: 'Seamless gutters', quantity: 1, unitPrice: 900 }] } }))
    const list = await json(await call('/api/quotes'))
    expect(list.body.data.find((r: any) => r.id === q.body.id)).toMatchObject({ invoiced: false, invoice: null })
  })
})
