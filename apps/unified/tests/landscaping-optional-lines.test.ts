// Landscaping gap 8, "optional lines on quotes": proved on a LANDSCAPING tenant (the existing proof, quote-billing.test.ts, boots
// the contractor one). Aeration and fertilising are offered as add-ons on a lawn-care quote; the office and the customer on the
// quote's own link tick them, the totals follow, and only ticked lines reach the job and the invoice. The quote form's
// "Optional" box is on for every vertical (web/src/crm/screens.tsx quoteOptions), so landscaping already had it: this is the test
// that says so. It does not fail without a change in this branch, because none was needed.
import { describe, test, expect, beforeAll } from 'bun:test'
import { and, eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
const tokens: Record<string, string> = {}
const ids: Record<string, string> = {}
const sent: Array<{ template: string; data: any }> = []
const as = (who: string, path: string, init: any = {}) => t.call(path, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tokens[who]}` } })
const json = async (r: Response) => ({ status: r.status, body: await r.json() as any })
const signIn = async (email: string, password: string) => (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken
const SIGN = { signature: 'data:image/png;base64,iVBORw0KGgo=', signedBy: 'Pat Client', consent: true }

/** A sent quote and its own link's token. */
async function sentQuote(body: any) {
  const q = await json(await as('owner', '/api/quotes', { method: 'POST', json: { contactId: ids.contact, ...body } }))
  expect(q.status).toBe(201)
  expect((await as('owner', `/api/quotes/${q.body.id}/send`, { method: 'POST' })).status).toBe(200)
  const link = String(sent.filter((m) => m.template === 'quoteSent').at(-1)!.data.documentPath).replace('/d/', '')
  return { quote: q.body, link }
}

beforeAll(async () => {
  t = await bootTenant({ vertical: 'landscaping' })
  const s = await seedOwner(t)
  ids.company = s.company.id
  await t.db.update(t.schema.company).set({ enabledFeatures: ['contacts', 'quotes', 'invoices', 'jobs'], email: 'office@test.example' } as any).where(eq(t.schema.company.id, s.company.id))
  tokens.owner = await signIn(s.owner.email, s.password)
  await t.db.insert(t.schema.user).values({ email: 'field@test.example', passwordHash: await Bun.password.hash('Seat-pass-1', 'bcrypt'), firstName: 'Fay', lastName: 'Field', role: 'field', companyId: s.company.id })
  tokens.field = await signIn('field@test.example', 'Seat-pass-1')
  const email: any = t.services.email
  const real = email.send.bind(email)
  email.send = async (to: string, template: string, data: any, options?: any) => { sent.push({ template, data }); return real(to, template, data, options) }
  const [pat] = await t.db.insert(t.schema.contact).values({ companyId: s.company.id, name: 'Pat Client', email: 'pat@example.com', type: 'client' } as any).returning()
  ids.contact = pat.id
}, 120_000)

test('landscaping: add-ons are offered, ticked by the office and the customer, and only ticked ones are billed', async () => {
  const { quote, link } = await sentQuote({ name: 'Lawn care 2027', lineItems: [
    { description: 'Weekly mowing, season', quantity: 1, unitPrice: 1200 },
    { description: 'Core aeration', quantity: 1, unitPrice: 150, optional: true },
    { description: 'Fertiliser, 4 rounds', quantity: 1, unitPrice: 320, optional: true, selected: true },
  ] })
  expect(Number(quote.total)).toBe(1520)
  const aeration = quote.lineItems.find((l: any) => l.description === 'Core aeration')
  const mowing = quote.lineItems.find((l: any) => l.description === 'Weekly mowing, season')
  const ticked = await json(await as('owner', `/api/quotes/${quote.id}/options`, { method: 'POST', json: { lineItemId: aeration.id, selected: true } }))
  expect(Number(ticked.body.total)).toBe(1670)
  expect((await as('owner', `/api/quotes/${quote.id}/options`, { method: 'POST', json: { lineItemId: mowing.id, selected: false } })).status).toBe(400)
  const unticked = await json(await t.call(`/api/portal/d/${link}/quotes/${quote.id}/options`, { method: 'POST', json: { lineItemId: aeration.id, selected: false } }))
  expect(Number(unticked.body.total)).toBe(1520)
  expect((await t.call(`/api/portal/d/${link}/quotes/${quote.id}/approve`, { method: 'POST', json: SIGN })).status).toBe(200)
  const inv = await json(await as('owner', `/api/quotes/${quote.id}/convert-to-invoice`, { method: 'POST' }))
  expect(inv.status).toBe(201)
  expect(inv.body.lineItems.map((l: any) => l.description)).toEqual(['Weekly mowing, season', 'Fertiliser, 4 rounds'])
  expect(Number(inv.body.total)).toBe(1520)
  // A seat that may not edit quotes cannot tick for the customer.
  expect((await as('field', `/api/quotes/${quote.id}/options`, { method: 'POST', json: { lineItemId: aeration.id, selected: true } })).status).toBe(403)
})
