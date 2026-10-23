// Consumer financing (server/crm/financing), through the real server as a contractor, with a stand-in lender.
//
// Wisetack publishes no partner API: its address, bodies and webhook signature are given only to signed partners
// (lender.ts). The stand-in below speaks THIS APP's contract for that API (lender.ts SPEC-PENDING) — it proves the
// machinery (gates, the estimate, applications, links, signed webhooks applied once, the funded payment) and nothing
// about Wisetack's real wire format. That is why the feature is registered not ready until a real sandbox run passes.
//
// What the tests hold that IS public: the disclosure's own example payments ($5,500: $253.54/mo for 24 months at 9.9%
// APR, $1,833.33/mo for 3 months at 0%), the $500–$65,000 range, and that every merchant has its own prequal link.
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import crypto from 'node:crypto'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { monthlyPayment, normalizeStatus, verifyWisetackWebhook, DISCLOSURE } from '../server/crm/financing/lender.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = ''
let token = ''
let managerToken = ''
const as = (p: string, init: any = {}, tok = token) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tok}` } })
const json = async (r: Response) => r.json() as any
const features = async (list: string[]) => {
  await t.db.update(t.schema.company).set({ enabledFeatures: list } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
}
const ON = ['contacts', 'jobs', 'quotes', 'invoices', 'pricebook', 'consumer_financing']
const PREQUAL = 'https://wisetack.us/#/abc123/prequalify'
const SECRET = 'whsec-test-financing'
const sign = (raw: string, secret = SECRET) => crypto.createHmac('sha256', secret).update(raw).digest('hex')
const hook = (body: unknown, sig?: string) => {
  const raw = JSON.stringify(body)
  return t.call('/api/financing-public/webhook/wisetack', { method: 'POST', body: raw, headers: { 'content-type': 'application/json', 'x-wisetack-signature': sig ?? sign(raw) } })
}

// The stand-in lender: POST /transactions with the partner key opens a transaction and answers its link.
const opened: any[] = []
let lender: ReturnType<typeof Bun.serve>
let n = 0

let annId = ''
async function quoteFor(total: number) {
  const q = await json(await as('/api/quotes', { method: 'POST', json: { name: 'Kitchen remodel', contactId: annId, lineItems: [{ description: 'Work', quantity: 1, unitPrice: total }] } }))
  return q
}
async function invoiceFor(total: number) {
  return json(await as('/api/invoices', { method: 'POST', json: { contactId: annId, lineItems: [{ description: 'Work', quantity: 1, unitPrice: total }] } }))
}

beforeAll(async () => {
  lender = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url)
      if (req.method !== 'POST' || url.pathname !== '/transactions') return Response.json({ message: 'not found' }, { status: 404 })
      if (req.headers.get('authorization') !== 'Bearer partner-key-test') return Response.json({ message: 'unauthorised' }, { status: 401 })
      const body: any = await req.json()
      opened.push(body)
      const id = 'txn_' + (++n)
      return Response.json({ transactionId: id, applyUrl: `https://wisetack.us/#/apply/${id}`, status: 'Pending' })
    },
  })
  t = await bootTenant()
  const s = await seedOwner(t)
  companyId = s.company.id
  await features(ON)
  token = (await json(await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } }))).accessToken
  await t.db.insert(t.schema.user).values({ email: 'manager@test.example', passwordHash: await Bun.password.hash('Manager-pass-1', 'bcrypt'), firstName: 'Mae', lastName: 'Manager', role: 'manager', companyId } as any)
  managerToken = (await json(await t.call('/api/auth/login', { method: 'POST', json: { email: 'manager@test.example', password: 'Manager-pass-1' } }))).accessToken
  const [ann] = await t.db.insert(t.schema.contact).values({ companyId, name: 'Ann Able', email: 'ann@example.com', phone: '6085550100', type: 'client' } as any).returning()
  annId = ann.id
}, 120_000)

afterAll(() => {
  lender?.stop(true)
  delete process.env.WISETACK_API_URL; delete process.env.WISETACK_API_KEY; delete process.env.WISETACK_WEBHOOK_SECRET
})

describe('the lender’s published numbers', () => {
  test('the estimate is the disclosure’s own arithmetic', () => {
    expect(monthlyPayment(5500, 9.9, 24)).toBe(253.54)
    expect(monthlyPayment(5500, 0, 3)).toBe(1833.33)
    expect(DISCLOSURE).toContain('$253.54 per month for 24 months, based on a 9.9% APR')
  })
  test('the merchant portal’s statuses read as ours', () => {
    expect(['Prequal Started', 'Prequalified', 'Action required', 'Offer locked', 'Confirmed', 'Paid', 'Declined', 'Expired', 'Canceled', 'Prequal declined'].map(normalizeStatus))
      .toEqual(['pending', 'prequalified', 'action_required', 'approved', 'confirmed', 'funded', 'declined', 'expired', 'canceled', 'declined'])
    expect(normalizeStatus('something new')).toBeNull()
  })
  test('a signature is the HMAC-SHA256 of the raw body', () => {
    const raw = '{"a":1}'
    expect(verifyWisetackWebhook(raw, sign(raw), SECRET)).toBe(true)
    expect(verifyWisetackWebhook(raw + ' ', sign(raw), SECRET)).toBe(false)
    expect(verifyWisetackWebhook(raw, sign(raw, 'other'), SECRET)).toBe(false)
    expect(verifyWisetackWebhook(raw, '', SECRET)).toBe(false)
  })
})

describe('switched off, it is not there', () => {
  test('every door refuses without consumer_financing', async () => {
    await features(ON.filter((f) => f !== 'consumer_financing'))
    expect((await as('/api/financing/status')).status).toBe(403)
    expect((await as('/api/financing/applications')).status).toBe(403)
    expect((await t.call('/api/financing-public/d/' + 'a'.repeat(64))).status).toBe(404)
    process.env.WISETACK_WEBHOOK_SECRET = SECRET
    expect((await hook({ eventId: 'e0', transactionId: 'x', status: 'Paid' })).status).toBe(404)
    await features(ON)
  })
})

describe('connecting the lender account', () => {
  test('a link that is not Wisetack’s, or not https, is refused by name', async () => {
    let r = await as('/api/financing/connection', { method: 'PUT', json: { merchantId: 'M-1001', prequalUrl: 'https://example.com/prequal' } })
    expect(r.status).toBe(400)
    expect((await json(r)).fields.prequalUrl).toMatch(/not a Wisetack link/)
    r = await as('/api/financing/connection', { method: 'PUT', json: { merchantId: 'M-1001', prequalUrl: 'http://wisetack.us/x' } })
    expect((await json(r)).fields.prequalUrl).toMatch(/https/)
    r = await as('/api/financing/connection', { method: 'PUT', json: { merchantId: '', prequalUrl: PREQUAL } })
    expect((await json(r)).fields.merchantId).toBeTruthy()
  })
  test('a manager may not connect it; the owner does', async () => {
    expect((await as('/api/financing/connection', { method: 'PUT', json: { merchantId: 'M-1001', prequalUrl: PREQUAL } }, managerToken)).status).toBe(403)
    const r = await as('/api/financing/connection', { method: 'PUT', json: { merchantId: 'M-1001', prequalUrl: PREQUAL } })
    expect(r.status).toBe(200)
    const st = await json(r)
    expect(st).toMatchObject({ connected: true, merchantId: 'M-1001', prequalUrl: PREQUAL, partnerApi: false })
  })
})

describe('the estimate on a quote', () => {
  test('in range: as low as the example payment; out of range: none, with the reason', async () => {
    const q = await quoteFor(8000)
    const r = await json(await as(`/api/financing/quotes/${q.id}`))
    expect(r.offer).toMatchObject({ lender: 'Wisetack', amount: 8000, asLowAs: monthlyPayment(8000, 9.9, 24), apr: 9.9, termMonths: 24 })
    expect(r.offer.disclosure).toBe(DISCLOSURE)
    const small = await quoteFor(300)
    const r2 = await json(await as(`/api/financing/quotes/${small.id}`))
    expect(r2.offer).toBeNull()
    expect(r2.reason).toMatch(/\$500 to \$65,000/)
  })
})

describe('applications without the partner API: the business’s own prequal link', () => {
  test('Apply opens one at not_started with the merchant’s link; a second is the same one', async () => {
    const q = await quoteFor(9000)
    const r = await as(`/api/financing/quotes/${q.id}/applications`, { method: 'POST' })
    expect(r.status).toBe(201)
    const a = await json(r)
    expect(a).toMatchObject({ status: 'not_started', applicationUrl: PREQUAL, quoteId: q.id, externalId: null })
    const again = await as(`/api/financing/quotes/${q.id}/applications`, { method: 'POST' })
    expect(again.status).toBe(200)
    expect((await json(again)).id).toBe(a.id)
    // The office keeps a link-only application's status by hand; never "funded" by hand.
    expect((await as(`/api/financing/applications/${a.id}/status`, { method: 'POST', json: { status: 'approved' } })).status).toBe(200)
    expect((await as(`/api/financing/applications/${a.id}/status`, { method: 'POST', json: { status: 'funded' } })).status).toBe(400)
  })

  test('the link goes by email, and a text is refused in words when texting is not set up', async () => {
    const q = await quoteFor(7000)
    const a = await json(await as(`/api/financing/quotes/${q.id}/applications`, { method: 'POST' }))
    const r = await as(`/api/financing/applications/${a.id}/send`, { method: 'POST', json: { channel: 'email' } })
    expect(r.status).toBe(200)
    expect(await json(r)).toMatchObject({ sentVia: 'email' })
    const s = await as(`/api/financing/applications/${a.id}/send`, { method: 'POST', json: { channel: 'sms' } })
    expect(s.status).toBe(409)
    expect((await json(s)).error).toMatch(/wallet|Texting is not set up/)
    expect((await as(`/api/financing/applications/${a.id}/send`, { method: 'POST', json: { channel: 'fax' } })).status).toBe(400)
  })
})

describe('the customer’s quote page (/d/<token>)', () => {
  test('shows the estimate and Apply sends them to the lender', async () => {
    const q = await quoteFor(12000)
    expect((await as(`/api/quotes/${q.id}/send`, { method: 'POST' })).status).toBe(200)
    const [row] = await t.db.select({ token: t.schema.quote.publicToken }).from(t.schema.quote).where(eq(t.schema.quote.id, q.id))
    const offer = await json(await t.call(`/api/financing-public/d/${row.token}`))
    expect(offer).toMatchObject({ asLowAs: monthlyPayment(12000, 9.9, 24), lender: 'Wisetack' })
    const apply = await json(await t.call(`/api/financing-public/d/${row.token}/apply`, { method: 'POST' }))
    expect(apply.url).toBe(PREQUAL)
    expect((await t.call(`/api/financing-public/d/${'f'.repeat(64)}`)).status).toBe(404)
  })
  test('disconnected, the page shows nothing about it', async () => {
    const q = await quoteFor(12500)
    await as(`/api/quotes/${q.id}/send`, { method: 'POST' })
    const [row] = await t.db.select({ token: t.schema.quote.publicToken }).from(t.schema.quote).where(eq(t.schema.quote.id, q.id))
    await as('/api/financing/connection', { method: 'DELETE' })
    expect((await t.call(`/api/financing-public/d/${row.token}`)).status).toBe(404)
    await as('/api/financing/connection', { method: 'PUT', json: { merchantId: 'M-1001', prequalUrl: PREQUAL } })
  })
})

describe('with the partner API: a transaction per document, and the signed webhook', () => {
  let invoiceId = ''
  let app: any
  // Read before any toMatchObject: Bun 1.3's asymmetric matchers write into the object they are given.
  let txn = ''
  test('the invoice’s application opens a transaction at the lender', async () => {
    process.env.WISETACK_API_URL = lender.url.origin
    process.env.WISETACK_API_KEY = 'partner-key-test'
    const inv = await invoiceFor(6400)
    invoiceId = inv.id
    const r = await as(`/api/financing/invoices/${inv.id}/applications`, { method: 'POST' })
    expect(r.status).toBe(201)
    app = await json(r)
    txn = String(app.externalId)
    expect(app).toMatchObject({ status: 'pending', externalId: expect.stringMatching(/^txn_/), invoiceId: inv.id })
    expect(app.applicationUrl).toMatch(/^https:\/\/wisetack\.us\/#\/apply\/txn_/)
    expect(opened.at(-1)).toMatchObject({ merchantId: 'M-1001', amount: '6400.00', reference: `invoice:${inv.id}`, customer: { firstName: 'Ann', lastName: 'Able', email: 'ann@example.com' } })
  })

  test('no secret: 503; a bad signature: 401; a body that is not an event: 400', async () => {
    delete process.env.WISETACK_WEBHOOK_SECRET
    expect((await hook({ eventId: 'e1', transactionId: txn, status: 'Offer locked' })).status).toBe(503)
    process.env.WISETACK_WEBHOOK_SECRET = SECRET
    expect((await hook({ eventId: 'e1', transactionId: txn, status: 'Offer locked' }, sign('{}'))).status).toBe(401)
    expect((await hook({ eventId: 'e1', transactionId: txn, status: 'Offer locked' }, 'nope')).status).toBe(401)
    expect((await hook({ eventId: 'e1', transactionId: txn })).status).toBe(400)
    expect((await hook({ eventId: 'e1', transactionId: txn, status: 'Teleported' })).status).toBe(400)
  })

  test('a status moves forward once; a repeat and a late one change nothing', async () => {
    let r = await json(await hook({ eventId: 'e1', transactionId: txn, status: 'Offer locked', amount: 6400 }))
    expect(r).toMatchObject({ processed: true, duplicate: false, status: 'approved' })
    r = await json(await hook({ eventId: 'e1', transactionId: txn, status: 'Offer locked' }))
    expect(r).toMatchObject({ duplicate: true, status: 'approved' })
    r = await json(await hook({ eventId: 'e2', transactionId: txn, status: 'Pending' }))
    expect(r.status).toBe('approved')
    const unknown = await json(await hook({ eventId: 'e9', transactionId: 'txn_nope', status: 'Paid' }))
    expect(unknown.processed).toBe(false)
  })

  test('paid: the money is recorded once as a financing payment on the invoice', async () => {
    const r = await json(await hook({ eventId: 'e3', transactionId: txn, status: 'Paid', amount: 6400 }))
    expect(r).toMatchObject({ status: 'funded', paymentId: expect.any(String) })
    const again = await json(await hook({ eventId: 'e3', transactionId: txn, status: 'Paid', amount: 6400 }))
    expect(again).toMatchObject({ duplicate: true, paymentId: r.paymentId })
    const pays = await t.db.select().from(t.schema.payment).where(eq(t.schema.payment.invoiceId, invoiceId))
    expect(pays.map((p: any) => [Number(p.amount), p.method, p.reference])).toEqual([[6400, 'financing', `wisetack:${txn}`]])
    const [inv] = await t.db.select().from(t.schema.invoice).where(eq(t.schema.invoice.id, invoiceId))
    expect(inv.status).toBe('paid')
    // A closed application takes no more events.
    const late = await json(await hook({ eventId: 'e4', transactionId: txn, status: 'Canceled' }))
    expect(late.status).toBe('funded')
  })

  test('paid on a quote with no invoice yet: funded, then recorded once the invoice exists', async () => {
    const q = await quoteFor(5000)
    const a = await json(await as(`/api/financing/quotes/${q.id}/applications`, { method: 'POST' }))
    const r = await json(await hook({ eventId: 'q1', transactionId: a.externalId, status: 'Paid' }))
    expect(r).toMatchObject({ status: 'funded', paymentId: null })
    const early = await as(`/api/financing/applications/${a.id}/record-payment`, { method: 'POST' })
    expect(early.status).toBe(409)
    expect((await json(early)).error).toMatch(/create the invoice/)
    await as(`/api/quotes/${q.id}/approve`, { method: 'POST' })
    const inv = await json(await as(`/api/quotes/${q.id}/convert-to-invoice`, { method: 'POST' }))
    const done = await as(`/api/financing/applications/${a.id}/record-payment`, { method: 'POST' })
    expect(done.status).toBe(200)
    expect((await json(done)).paymentId).toBeTruthy()
    const pays = await t.db.select().from(t.schema.payment).where(eq(t.schema.payment.invoiceId, inv.id))
    expect(pays.map((p: any) => [Number(p.amount), p.method])).toEqual([[5000, 'financing']])
  })

  test('the Financing page lists them, each with its customer and document', async () => {
    const r = await as('/api/financing/applications')
    expect(r.status).toBe(200)
    const rows = (await json(r)).data
    expect(rows.length).toBeGreaterThanOrEqual(5)
    const paid = rows.find((x: any) => x.id === app.id)
    expect(paid).toMatchObject({ status: 'funded', contact: { name: 'Ann Able' }, invoice: { id: invoiceId }, reportsBack: true })
    // A manager reads and files; the viewer seat does not see it.
    expect((await as('/api/financing/applications', {}, managerToken)).status).toBe(200)
  })
})

describe('the pricebook presentation', () => {
  test('shows the estimate only with the feature on and the lender connected', async () => {
    const item = await json(await as('/api/pricebook/items', { method: 'POST', json: { name: 'Furnace', price: 7200 } }))
    await t.db.update(t.schema.pricebookItem).set({ showToCustomer: true, active: true } as any).where(eq(t.schema.pricebookItem.id, item.id))
    let html = await (await t.call(`/api/pricebook-present/${item.id}`)).text()
    expect(html).toContain('As low as')
    expect(html).toContain(DISCLOSURE.slice(0, 60))
    await features(ON.filter((f) => f !== 'consumer_financing'))
    html = await (await t.call(`/api/pricebook-present/${item.id}`)).text()
    expect(html).not.toMatch(/financ|wisetack|as low as/i)
    await features(ON)
  })
})
