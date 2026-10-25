// Quotes billed the way Jobber and Housecall Pro bill them (server crm/billing/quoteBilling.ts, tenant-backend
// invoicing/quoteOptions.ts): optional lines the office or the customer ticks, a deposit asked on approval that becomes a
// deposit invoice, progress invoices by percent or by line, and a final invoice that credits them — never more than the
// quote's total.
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
  t = await bootTenant({ vertical: 'contractor' })
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

describe('optional lines', () => {
  test('an optional line is offered, not counted, until ticked — by the office, then by the customer on the link', async () => {
    const { quote, link } = await sentQuote({ name: 'Deck', lineItems: [
      { description: 'Deck boards', quantity: 1, unitPrice: 1000 },
      { description: 'Railing upgrade', quantity: 1, unitPrice: 500, optional: true },
      { description: 'Stain', quantity: 1, unitPrice: 200, optional: true, selected: true },
    ] })
    ids.optQuote = quote.id
    expect(Number(quote.total)).toBe(1200)
    const railing = quote.lineItems.find((l: any) => l.description === 'Railing upgrade')
    const boards = quote.lineItems.find((l: any) => l.description === 'Deck boards')
    // The office ticks it: the total follows.
    const ticked = await json(await as('owner', `/api/quotes/${quote.id}/options`, { method: 'POST', json: { lineItemId: railing.id, selected: true } }))
    expect(ticked.status).toBe(200)
    expect(Number(ticked.body.total)).toBe(1700)
    // A line that is not optional is not anyone's to take off (server rule).
    expect((await as('owner', `/api/quotes/${quote.id}/options`, { method: 'POST', json: { lineItemId: boards.id, selected: false } })).status).toBe(400)
    // The customer unticks it on the quote's own link, and sees the new total.
    const page = await json(await t.call(`/api/portal/d/${link}/quotes/${quote.id}`))
    expect(page.body.lineItems.find((l: any) => l.id === railing.id)).toMatchObject({ optional: true, selected: true })
    const unticked = await json(await t.call(`/api/portal/d/${link}/quotes/${quote.id}/options`, { method: 'POST', json: { lineItemId: railing.id, selected: false } }))
    expect(unticked.status).toBe(200)
    expect(Number(unticked.body.total)).toBe(1200)
    expect((await t.call(`/api/portal/d/${link}/quotes/${quote.id}/options`, { method: 'POST', json: { lineItemId: boards.id, selected: false } })).status).toBe(400)
    // Signed and approved: the choice is fixed.
    expect((await t.call(`/api/portal/d/${link}/quotes/${quote.id}/approve`, { method: 'POST', json: SIGN })).status).toBe(200)
    expect((await t.call(`/api/portal/d/${link}/quotes/${quote.id}/options`, { method: 'POST', json: { lineItemId: railing.id, selected: true } })).status).toBe(400)
    expect((await as('owner', `/api/quotes/${quote.id}/options`, { method: 'POST', json: { lineItemId: railing.id, selected: true } })).status).toBe(400)
  })

  test('only ticked optional lines carry into the job and the invoice', async () => {
    const jobR = await json(await as('owner', `/api/quotes/${ids.optQuote}/convert-to-job`, { method: 'POST' }))
    expect(jobR.status).toBe(201)
    expect(jobR.body.description).toContain('Stain')
    expect(jobR.body.description).not.toContain('Railing')
    expect(Number(jobR.body.estimatedValue)).toBe(1200)
    const inv = await json(await as('owner', `/api/quotes/${ids.optQuote}/convert-to-invoice`, { method: 'POST' }))
    expect(inv.status).toBe(201)
    expect(inv.body.lineItems.map((l: any) => l.description)).toEqual(['Deck boards', 'Stain'])
    expect(Number(inv.body.total)).toBe(1200)
  })
})

describe('deposit on approval', () => {
  test('a deposit is a percent (never over 100) or a fixed amount (never over the total)', async () => {
    const base = { name: 'Porch', lineItems: [{ description: 'Porch', quantity: 1, unitPrice: 1000 }] }
    expect((await as('owner', '/api/quotes', { method: 'POST', json: { contactId: ids.contact, ...base, depositType: 'percent', depositValue: 101 } })).status).toBe(400)
    expect((await as('owner', '/api/quotes', { method: 'POST', json: { contactId: ids.contact, ...base, depositType: 'fixed', depositValue: 1000.01 } })).status).toBe(400)
    expect((await as('owner', '/api/quotes', { method: 'POST', json: { contactId: ids.contact, ...base, depositType: 'fixed', depositValue: 250 } })).status).toBe(201)
  })

  test('the customer approves: the deposit becomes an invoice linked to the quote, payable on its own link (or how to pay)', async () => {
    const { quote, link } = await sentQuote({ name: 'Kitchen', depositType: 'percent', depositValue: 25, lineItems: [{ description: 'Cabinets', quantity: 1, unitPrice: 8000 }, { description: 'Install', quantity: 1, unitPrice: 2000 }] })
    ids.kitchen = quote.id
    const before = await json(await t.call(`/api/portal/d/${link}/quotes/${quote.id}`))
    expect(before.body.depositAmount).toBe('2500.00')
    const approved = await json(await t.call(`/api/portal/d/${link}/quotes/${quote.id}/approve`, { method: 'POST', json: SIGN }))
    expect(approved.status).toBe(200)
    // No online payments here: the page is told so, and says how to pay instead.
    expect(approved.body.deposit).toMatchObject({ total: '2500.00', billKind: 'deposit', payOnline: false })
    expect(approved.body.deposit.path).toMatch(/^\/d\/[0-9a-f]{64}$/)
    const [dep] = await t.db.select().from(t.schema.invoice).where(and(eq(t.schema.invoice.billedQuoteId, quote.id), eq(t.schema.invoice.billKind, 'deposit')))
    expect(dep).toMatchObject({ status: 'sent', total: '2500.00', quoteId: null })
    // Its own link opens it for the customer.
    const page = await json(await t.call(`/api/portal${approved.body.deposit.path}/invoices/${dep.id}`))
    expect(page.status).toBe(200)
    expect(page.body.payOnline).toBe(false)
    // The office records the deposit like any payment.
    expect((await as('owner', `/api/invoices/${dep.id}/payments`, { method: 'POST', json: { amount: 2500, method: 'check' } })).status).toBe(201)
    const again = await json(await t.call(`/api/portal/d/${link}/quotes/${quote.id}`))
    expect(again.body.deposit).toMatchObject({ number: dep.number, balance: 0 })
  })

  test('the office marking a quote approved raises its deposit once, however many times it is pressed', async () => {
    const q = await json(await as('owner', '/api/quotes', { method: 'POST', json: { contactId: ids.contact, name: 'Fence', depositType: 'fixed', depositValue: 300, lineItems: [{ description: 'Fence', quantity: 1, unitPrice: 1200 }] } }))
    const a1 = await json(await as('owner', `/api/quotes/${q.body.id}/approve`, { method: 'POST' }))
    const a2 = await json(await as('owner', `/api/quotes/${q.body.id}/approve`, { method: 'POST' }))
    expect(a1.body.deposit.total).toBe('300.00')
    expect(a2.body.deposit.id).toBe(a1.body.deposit.id)
    const rows = await t.db.select().from(t.schema.invoice).where(eq(t.schema.invoice.billedQuoteId, q.body.id))
    expect(rows.length).toBe(1)
  })
})

describe('progress billing and the final invoice', () => {
  test('bill a percent, then chosen lines; billed against remaining; never more than the quote', async () => {
    const q = ids.kitchen // $10,000, deposit $2,500 billed and paid
    const p1 = await json(await as('owner', `/api/quote-billing/quotes/${q}/progress`, { method: 'POST', json: { percent: 30 } }))
    expect(p1.status).toBe(201)
    expect(p1.body).toMatchObject({ total: '3000.00', billKind: 'progress', billedQuoteId: q })
    const sum1 = await json(await as('owner', `/api/quote-billing/quotes/${q}`))
    expect(sum1.body).toMatchObject({ total: '10000.00', billed: '5500.00', remaining: '4500.00' })
    const install = sum1.body.lines.find((l: any) => l.description === 'Install')
    const p2 = await json(await as('owner', `/api/quote-billing/quotes/${q}/progress`, { method: 'POST', json: { lineItemIds: [install.id] } }))
    expect(p2.status).toBe(201)
    expect(p2.body.total).toBe('2000.00')
    // A line billed once is not billed again; more than is left is refused (server rules).
    expect((await as('owner', `/api/quote-billing/quotes/${q}/progress`, { method: 'POST', json: { lineItemIds: [install.id] } })).status).toBe(409)
    expect((await as('owner', `/api/quote-billing/quotes/${q}/progress`, { method: 'POST', json: { percent: 30 } })).status).toBe(409)
    // An edit to a progress invoice is held to the same sum.
    const over = await as('owner', `/api/invoices/${p2.body.id}`, { method: 'PUT', json: { lineItems: [{ description: 'Install', quantity: 1, unitPrice: 5000 }] } })
    expect(over.status).toBe(400)
    // A seat that may not raise invoices may not bill in parts.
    expect((await as('field', `/api/quote-billing/quotes/${q}/progress`, { method: 'POST', json: { percent: 1 } })).status).toBe(403)
  })

  test('the final invoice bills the whole job, crediting the deposit and progress invoices', async () => {
    const q = ids.kitchen
    const fin = await json(await as('owner', `/api/quotes/${q}/convert-to-invoice`, { method: 'POST' }))
    expect(fin.status).toBe(201)
    expect(fin.body).toMatchObject({ billKind: 'final', creditApplied: '7500.00', total: '2500.00', subtotal: '10000.00', quoteId: q })
    const sum = await json(await as('owner', `/api/quote-billing/quotes/${q}`))
    expect(sum.body).toMatchObject({ billed: '10000.00', remaining: '0.00', invoicedInFull: true })
    // Editing the final invoice keeps its credit.
    const edited = await json(await as('owner', `/api/invoices/${fin.body.id}`, { method: 'PUT', json: { notes: 'Thanks', discount: 0 } }))
    expect(edited.body.total).toBe('2500.00')
    expect((await as('owner', `/api/quote-billing/quotes/${q}/progress`, { method: 'POST', json: { percent: 1 } })).status).toBe(409)
  })

  test("a job is billed against its quote's remaining", async () => {
    const q = await json(await as('owner', '/api/quotes', { method: 'POST', json: { contactId: ids.contact, name: 'Shed', lineItems: [{ description: 'Shed', quantity: 1, unitPrice: 4000 }] } }))
    await as('owner', `/api/quotes/${q.body.id}/approve`, { method: 'POST' })
    const job = await json(await as('owner', `/api/quotes/${q.body.id}/convert-to-job`, { method: 'POST' }))
    const p = await json(await as('owner', `/api/quote-billing/jobs/${job.body.id}/progress`, { method: 'POST', json: { percent: 100 } }))
    expect(p.status).toBe(201)
    expect(p.body).toMatchObject({ total: '4000.00', jobId: job.body.id, quoteId: q.body.id })
    const sum = await json(await as('owner', `/api/quote-billing/jobs/${job.body.id}`))
    expect(sum.body).toMatchObject({ remaining: '0.00', invoicedInFull: true })
    // The last of it billed: the quote reads invoiced, and Create Invoice is refused, not doubled.
    expect((await as('owner', `/api/quotes/${q.body.id}/convert-to-invoice`, { method: 'POST' })).status).toBe(400)
  })
})
