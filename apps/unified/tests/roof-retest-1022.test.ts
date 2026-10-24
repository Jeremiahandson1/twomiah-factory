// Roofing, live retest 2026-10-22 (server/crm/roof/jobs.ts, modules/crm.ts, packages/tenant-backend invoicing/quotes.ts):
//  1. a job made with the city, state and ZIP blank is refused in words ("Enter the city, state and ZIP code."), never
//     the validator's "city: String must contain at least 1 character(s)";
//  2. a job showed "No quotes" / "No invoices" beside the homeowner's QTE-00001 and INV-00001, and Reports $0 against
//     $9,125.75 invoiced: a homeowner's quote or invoice on no job is attached to the job; an approved quote on no job
//     converts to a ROOFING job (ROOF-0001, signed) that the quote sits on, and its invoice follows the quote's job; the
//     job list carries what its own quotes and invoices say it is worth (quotedValue / invoicedValue);
//  4. a roofing quote's and invoice's emails each carry the document's own link (approve / view and pay);
//  5. a material order is added against a job, and the job's orders are listed.
// Email is not delivered from a test: the email service's send is wrapped to record what each message was handed.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { crmTemplates } from '../server/crm/messages.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = ''
let token = ''
const ids: Record<string, string> = {}
const sent: Array<{ template: string; data: any }> = []
const as = (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } })
const json = async (r: Response) => ({ status: r.status, body: await r.json() as any })
const FEATURES = ['jobs', 'contacts', 'quotes', 'invoices', 'scheduling', 'materials', 'reports']
const APP = 'https://app.test.example'
const BRAND = { companyName: 'Test Builders', colourOnWhite: '#c2410c' }

beforeAll(async () => {
  t = await bootTenant({ vertical: 'roofing' })
  const seeded = await seedOwner(t)
  companyId = seeded.company.id
  token = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: seeded.password } })).json()).accessToken
  await t.db.update(t.schema.company).set({ enabledFeatures: FEATURES, email: 'office@test.example' } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
  const email: any = t.services.email
  const real = email.send.bind(email)
  email.send = async (to: string, template: string, data: any, options?: any) => { sent.push({ template, data }); return real(to, template, data, options) }
  const [ann] = await t.db.insert(t.schema.contact).values({ companyId, name: 'Ann Able', email: 'ann@test.example', address: '9 Elm St', city: 'Akron', state: 'OH', zip: '44301', type: 'client' } as any).returning()
  const [bob] = await t.db.insert(t.schema.contact).values({ companyId, name: 'Bob Other', email: 'bob@test.example', type: 'client' } as any).returning()
  ids.ann = ann.id; ids.bob = bob.id
}, 120_000)

const newJob = (extra: Record<string, unknown> = {}) => ({
  contactId: ids.ann, jobType: 'retail', propertyAddress: '9 Elm St', city: 'Akron', state: 'OH', zip: '44301', ...extra,
})
const quoteFor = (contactId: string, extra: Record<string, unknown> = {}) =>
  as('/api/quotes', { method: 'POST', json: { name: 'Full roof replacement', contactId, taxRate: 10, lineItems: [{ description: 'Tear-off and shingles', quantity: 25, unitPrice: 300 }], ...extra } })
const invoiceFor = (contactId: string, extra: Record<string, unknown> = {}) =>
  as('/api/invoices', { method: 'POST', json: { contactId, lineItems: [{ description: 'Roof replacement', quantity: 1, unitPrice: 9125.75 }], ...extra } })

describe('1. a job without its address is refused in words', () => {
  test('city, state and ZIP blank: one sentence naming them, each box marked, nothing raw', async () => {
    const r = await json(await as('/api/jobs', { method: 'POST', json: newJob({ city: '', state: '  ', zip: '' }) }))
    expect(r.status).toBe(400)
    expect(r.body.error).toBe('Enter the city, state and ZIP code.')
    expect(Object.keys(r.body.fields).sort()).toEqual(['city', 'state', 'zip'])
    expect(JSON.stringify(r.body)).not.toMatch(/String must contain|Required|invalid_type|character\(s\)/)
  })
  test('nothing sent at all: every required field named in the one sentence', async () => {
    const r = await json(await as('/api/jobs', { method: 'POST', json: {} }))
    expect([r.status, r.body.error]).toEqual([400, 'Enter the homeowner, job type, property address, city, state and ZIP code.'])
  })
  test('an edit that blanks the city is refused the same way; a wrong phone is named by its label', async () => {
    const made = await json(await as('/api/jobs', { method: 'POST', json: newJob() }))
    expect(made.status).toBe(201)
    const r = await json(await as(`/api/jobs/${made.body.id}`, { method: 'PUT', json: { city: '', adjusterPhone: 'abc' } }))
    expect([r.status, r.body.error]).toEqual([400, 'Enter the city. Adjuster phone must be a phone number with 10 to 15 digits.'])
  })
})

describe("2. a job's quotes and invoices, and what it is worth", () => {
  test('a quote and an invoice made for the homeowner on no job are attached; the job lists them and is worth them', async () => {
    const job = await json(await as('/api/jobs', { method: 'POST', json: newJob() }))
    ids.job = job.body.id
    const q = await json(await quoteFor(ids.ann))
    const inv = await json(await invoiceFor(ids.ann))
    expect([q.status, inv.status]).toEqual([201, 201])
    ids.q = q.body.id; ids.inv = inv.body.id
    // Before: the job shows neither (the live finding).
    let detail = (await json(await as(`/api/jobs/${ids.job}`))).body
    expect([detail.quotes.length, detail.invoices.length]).toEqual([0, 0])

    expect((await as(`/api/jobs/${ids.job}/attach`, { method: 'POST', json: { quoteId: ids.q } })).status).toBe(200)
    expect((await as(`/api/jobs/${ids.job}/attach`, { method: 'POST', json: { invoiceId: ids.inv } })).status).toBe(200)
    detail = (await json(await as(`/api/jobs/${ids.job}`))).body
    expect(detail.quotes.map((x: any) => x.number)).toEqual([q.body.number])
    expect(detail.invoices.map((x: any) => x.number)).toEqual([inv.body.number])

    // The list carries the quote's value without its tax (25 × 300 = 7500; tax 750) — the invoice is a draft, not billed.
    let row = (await json(await as('/api/jobs'))).body.data.find((j: any) => j.id === ids.job)
    expect([Number(row.quotedValue), row.invoicedValue]).toEqual([7500, null])
    // Sent, it is billed: the job is worth what it was billed.
    expect((await as(`/api/invoices/${ids.inv}/send`, { method: 'POST' })).status).toBe(200)
    row = (await json(await as('/api/jobs'))).body.data.find((j: any) => j.id === ids.job)
    expect(Number(row.invoicedValue)).toBe(9125.75)
  })

  test("another homeowner's quote is refused; a quote already on a job says which; detach takes it off", async () => {
    const other = await json(await quoteFor(ids.bob))
    const r = await json(await as(`/api/jobs/${ids.job}/attach`, { method: 'POST', json: { quoteId: other.body.id } }))
    expect([r.status, r.body.code]).toEqual([400, 'other_customer'])
    const job2 = await json(await as('/api/jobs', { method: 'POST', json: newJob({ propertyAddress: '11 Elm St' }) }))
    const taken = await json(await as(`/api/jobs/${job2.body.id}/attach`, { method: 'POST', json: { quoteId: ids.q } }))
    expect([taken.status, taken.body.code]).toEqual([409, 'on_another_job'])
    expect(taken.body.error).toContain('already on job ROOF-')
    // Off and back on.
    expect((await as(`/api/jobs/${ids.job}/detach`, { method: 'POST', json: { quoteId: ids.q } })).status).toBe(200)
    expect((await json(await as(`/api/jobs/${ids.job}`))).body.quotes).toEqual([])
    expect((await as(`/api/jobs/${ids.job}/attach`, { method: 'POST', json: { quoteId: ids.q } })).status).toBe(200)
  })

  test('a seat without quotes:update may not attach a quote, and never sees the job’s money on the list', async () => {
    const hash = await Bun.password.hash('Correct-horse-1', 'bcrypt')
    const [cal] = await t.db.insert(t.schema.user).values({ email: 'crew@test.example', passwordHash: hash, firstName: 'Cal', lastName: 'Crew', role: 'field', companyId } as any).returning()
    // Cal sells this job (crew scope, 2026-10-24: a field seat reads only its own work), so it is on his list.
    await t.db.update(t.schema.job).set({ assignedSalesRepId: cal.id } as any).where(eq(t.schema.job.id, ids.job))
    const crewToken = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'crew@test.example', password: 'Correct-horse-1' } })).json()).accessToken
    const crew = (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${crewToken}` } })
    const r = await crew(`/api/jobs/${ids.job}/attach`, { method: 'POST', json: { quoteId: ids.q } })
    expect([403]).toContain(r.status)
    const list = await (await crew('/api/jobs')).json() as any
    const row = list.data.find((j: any) => j.id === ids.job)
    expect('quotedValue' in row || 'invoicedValue' in row).toBe(false)
  })

  test('an approved quote on no job converts to a roofing job; the quote sits on it, and its invoice follows', async () => {
    const q = await json(await quoteFor(ids.ann, { name: 'Gutters and flashing' }))
    expect((await as(`/api/quotes/${q.body.id}/approve`, { method: 'POST' })).status).toBe(200)
    const made = await json(await as(`/api/quotes/${q.body.id}/convert-to-job`, { method: 'POST' }))
    expect(made.status).toBe(201)
    expect(made.body.number).toMatch(/^ROOF-\d{4}$/)
    expect([made.body.status, made.body.address, made.body.city, Number(made.body.estimatedValue)]).toEqual(['signed', '9 Elm St', 'Akron', 7500])
    const quote = (await json(await as(`/api/quotes/${q.body.id}`))).body
    expect([quote.jobId, quote.convertedToJobId]).toEqual([made.body.id, made.body.id])
    // Its invoice is the job's bill.
    const inv = await json(await as(`/api/quotes/${q.body.id}/convert-to-invoice`, { method: 'POST' }))
    expect([inv.status, inv.body.jobId]).toEqual([201, made.body.id])
    const detail = (await json(await as(`/api/jobs/${made.body.id}`))).body
    expect([detail.quotes.map((x: any) => x.id), detail.invoices.map((x: any) => x.id)]).toEqual([[q.body.id], [inv.body.id]])
    // A second convert is refused; so is converting a quote written for a job.
    expect((await as(`/api/quotes/${q.body.id}/convert-to-job`, { method: 'POST' })).status).toBe(400)
    const forJob = await json(await quoteFor(ids.ann, { jobId: ids.job }))
    await as(`/api/quotes/${forJob.body.id}/approve`, { method: 'POST' })
    const again = await json(await as(`/api/quotes/${forJob.body.id}/convert-to-job`, { method: 'POST' }))
    expect([again.status, again.body.error, again.body.jobId]).toEqual([400, 'This quote is already on a job.', ids.job])
  })

  test("an invoice is filed under a job by ?jobId and refused another business's job", async () => {
    const inv = await json(await invoiceFor(ids.ann, { jobId: ids.job }))
    expect([inv.status, inv.body.jobId]).toEqual([201, ids.job])
    const listed = (await json(await as(`/api/invoices?jobId=${ids.job}`))).body.data.map((x: any) => x.id)
    expect(listed).toContain(inv.body.id)
    expect((await invoiceFor(ids.ann, { jobId: 'not-a-job' })).status).toBe(404)
  })
})

describe('4. what a roofing quote and invoice send', () => {
  test("the quote's email links to its own page to approve; the invoice's to view and pay", async () => {
    const q = await json(await quoteFor(ids.ann, { name: 'Ridge vent' }))
    expect((await as(`/api/quotes/${q.body.id}/send`, { method: 'POST' })).status).toBe(200)
    const qm = sent.filter((m) => m.template === 'quoteSent').at(-1)!
    const qt = String(qm.data.documentPath || '').replace('/d/', '')
    expect(qt).toMatch(/^[0-9a-f]{64}$/)
    const qh = crmTemplates.quoteSent(qm.data, BRAND, APP).html
    expect(qh).toContain(`${APP}/d/${qt}`)
    expect(qh).toContain('Review and approve')

    const inv = await json(await invoiceFor(ids.ann))
    expect((await as(`/api/invoices/${inv.body.id}/send`, { method: 'POST' })).status).toBe(200)
    const im = sent.filter((m) => m.template === 'invoiceSent').at(-1)!
    const it = String(im.data.documentPath || '').replace('/d/', '')
    expect(it).toMatch(/^[0-9a-f]{64}$/)
    const ih = crmTemplates.invoiceSent(im.data, BRAND, APP).html
    expect(ih).toContain(`${APP}/d/${it}`)
    expect(ih).toContain('View and pay invoice')
    console.log(`[roof emails] quote ${q.body.number}: ${APP}/d/${qt.slice(0, 8)}… · invoice ${inv.body.number}: ${APP}/d/${it.slice(0, 8)}…`)
  })
})

describe('5. materials for a job', () => {
  test('an order is added against the job, priced from its lines, and listed for the job', async () => {
    const r = await json(await as('/api/materials', { method: 'POST', json: {
      jobId: ids.job, supplier: 'ABC Supply', orderStatus: 'ordered', orderDate: '2026-10-22',
      lineItems: [{ description: 'Architectural shingles', qty: 25, unit: 'sq', unitPrice: 120 }, { description: 'Ice and water shield', qty: 4, unit: 'roll', unitPrice: 85.5 }],
    } }))
    expect(r.status).toBe(201)
    expect(Number(r.body.totalCost)).toBe(3342)
    const listed = (await json(await as(`/api/materials?jobId=${ids.job}`))).body.data
    expect(listed.map((o: any) => [o.supplier, o.status, o.jobNumber])).toEqual([['ABC Supply', 'ordered', expect.stringMatching(/^ROOF-/)]])
  })
})
