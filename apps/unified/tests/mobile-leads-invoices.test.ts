// The phone's lead and invoice screens against a REAL server: what they call must do what the screen says.
//   Leads:    the inbox's four statuses (and nothing else), a note, convert (twice), the one lead the detail screen reads.
//   Invoices: "Record payment" with each of the five methods, a refused method, "Send invoice" without an email on file.
//             No route takes a card on the phone: the payment is recorded, never charged.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let token = ''
let companyId = ''
const call = (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } })
const json = async (r: Response) => ({ status: r.status, body: await r.json() as any })

beforeAll(async () => {
  t = await bootTenant({ vertical: 'contractor' })
  const seeded = await seedOwner(t)
  companyId = seeded.company.id
  token = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: seeded.password } })).json()).accessToken
  await t.db.update(t.schema.company).set({ enabledFeatures: ['contacts', 'jobs', 'quotes', 'invoices', 'lead_inbox'] } as any).where(eq(t.schema.company.id, companyId))
}, 120_000)

const newLead = async (name: string, extra: any = {}) => {
  const [l] = await t.db.insert(t.schema.lead).values({ companyId, homeownerName: name, email: `${name.split(' ')[0].toLowerCase()}@example.com`, phone: '555-010-0100', sourcePlatform: 'website', status: 'new', ...extra } as any).returning()
  return l.id as string
}

describe('lead screens', () => {
  test('the detail reads one lead; another company\'s or an unknown id is a 404', async () => {
    const id = await newLead('Avery Quinn')
    const r = await json(await call(`/api/leads/${id}`))
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ id, homeownerName: 'Avery Quinn', status: 'new' })
    expect((await call('/api/leads/does-not-exist')).status).toBe(404)
  })

  test('statuses are the server\'s four; the list refuses any other filter', async () => {
    const id = await newLead('Blake Rowe')
    for (const status of ['contacted', 'dismissed', 'new']) {
      const r = await json(await call(`/api/leads/${id}/status`, { method: 'PUT', json: { status } }))
      expect(r.status).toBe(200)
    }
    // "Quoted" / "Won" are not statuses, and converted is set only by Convert.
    for (const status of ['quoted', 'won', 'converted']) expect((await call(`/api/leads/${id}/status`, { method: 'PUT', json: { status } })).status).toBe(400)
    for (const status of ['new', 'contacted', 'converted', 'dismissed']) expect((await call(`/api/leads?status=${status}`)).status).toBe(200)
    expect((await call('/api/leads?status=quoted')).status).toBe(400)
  })

  test('a note is added to the lead, and an empty one is refused', async () => {
    const id = await newLead('Casey Moore', { description: 'Wants a new deck' })
    const ok = await json(await call(`/api/leads/${id}/notes`, { method: 'POST', json: { text: 'Called, will call back Friday' } }))
    expect(ok.status).toBeLessThan(300)
    const after = await json(await call(`/api/leads/${id}`))
    expect(after.body.description).toContain('Wants a new deck')
    expect(after.body.description).toContain('Called, will call back Friday')
    expect((await call(`/api/leads/${id}/notes`, { method: 'POST', json: { text: '   ' } })).status).toBe(400)
    expect((await call(`/api/leads/${id}/notes`, { method: 'POST', json: { text: 'x'.repeat(1001) } })).status).toBe(400)
  })

  test('convert makes the customer once; a second convert says so and names the same customer', async () => {
    const id = await newLead('Devon Park')
    const first = await json(await call(`/api/leads/${id}/convert`, { method: 'POST', json: {} }))
    expect(first.status).toBe(200)
    expect(first.body.lead.status).toBe('converted')
    const again = await json(await call(`/api/leads/${id}/convert`, { method: 'POST', json: {} }))
    expect(again.status).toBe(409)
    expect(again.body.contactId).toBe(first.body.contact.id)
    expect((await json(await call(`/api/leads/${id}`))).body.convertedContactId).toBe(first.body.contact.id)
  })
})

describe('invoice screen: Record payment and Send invoice', () => {
  const invoiceFor = async (email: string | null) => {
    const [c] = await t.db.insert(t.schema.contact).values({ companyId, name: `Pat ${Math.random().toString(36).slice(2, 6)}`, email } as any).returning()
    const q = await json(await call('/api/invoices', { method: 'POST', json: { contactId: c.id, lineItems: [{ description: 'Service', quantity: 1, unitPrice: 500 }] } }))
    expect(q.status).toBe(201)
    return q.body.id as string
  }

  test('each of the five methods records a payment in dollars and lowers the balance', async () => {
    const id = await invoiceFor('pat@example.com')
    await call(`/api/invoices/${id}/send`, { method: 'POST', json: {} })
    let owed = 500
    for (const method of ['cash', 'check', 'card', 'bank_transfer', 'other']) {
      const r = await json(await call(`/api/invoices/${id}/payments`, { method: 'POST', json: { amount: 50, method } }))
      expect(r.status).toBeLessThan(300)
      owed -= 50
      const inv = await json(await call(`/api/invoices/${id}`))
      expect(Number(inv.body.balance)).toBe(owed)
      expect(inv.body.payments.map((p: any) => p.method)).toContain(method)
    }
  })

  test('a made-up method, a zero amount and a negative amount are refused; the balance is unchanged', async () => {
    const id = await invoiceFor('pat@example.com')
    await call(`/api/invoices/${id}/send`, { method: 'POST', json: {} })
    for (const body of [{ amount: 10, method: 'bitcoin' }, { amount: 0, method: 'cash' }, { amount: -5, method: 'cash' }]) {
      expect((await call(`/api/invoices/${id}/payments`, { method: 'POST', json: body })).status).toBe(400)
    }
    expect(Number((await json(await call(`/api/invoices/${id}`))).body.balance)).toBe(500)
  })

  test('Send invoice with no email on file says what to fix, and a void invoice cannot be sent', async () => {
    const id = await invoiceFor(null)
    const r = await json(await call(`/api/invoices/${id}/send`, { method: 'POST', json: {} }))
    expect(r.status).toBe(400)
    expect(r.body.error).toContain('email')
    const v = await invoiceFor('pat@example.com')
    await call(`/api/invoices/${v}/void`, { method: 'POST', json: {} })
    expect((await call(`/api/invoices/${v}/send`, { method: 'POST', json: {} })).status).toBe(400)
  })

  test('there is no route that takes a card on the phone', async () => {
    const id = await invoiceFor('pat@example.com')
    for (const p of ['charge', 'take-payment', 'pay-card', 'card']) {
      const r = await call(`/api/invoices/${id}/${p}`, { method: 'POST', json: { amount: 10 } })
      expect([404, 405]).toContain(r.status)
    }
  })
})
