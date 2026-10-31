// Landscaping gap 1, billing a route's visits the way the leaders do: per visit when the crew finishes it (LMN), or one DRAFT
// invoice per customer from the completed visits in a date range, grouped by property, reviewable, undoable (Yardbook).
// Never a visit twice; a route whose customers already have an agreement or recurring invoice is billed elsewhere until the
// owner says otherwise. Each test fails on the Route Board as it was (it billed nothing).
import { describe, test, expect, beforeAll } from 'bun:test'
import { and, eq, inArray } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId: string
let ownerId: string
let owner: string
let field: string
let viewer: string
const as = (token: string, path: string, init: any = {}) => t.call(path, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } })
const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
const login = async (email: string, password: string) => (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken as string
async function seat(role: string) {
  const password = 'Correct-horse-1'
  await ins(t.schema.user, { companyId, email: `${role}@test.example`, firstName: role, lastName: 'Seat', role, passwordHash: await Bun.password.hash(password, 'bcrypt') })
  return login(`${role}@test.example`, password)
}
function nextWeekday(dow: number): string {
  const d = new Date(); d.setUTCHours(0, 0, 0, 0)
  do { d.setUTCDate(d.getUTCDate() + 1) } while (d.getUTCDay() !== dow)
  return d.toISOString().slice(0, 10)
}
const addDays = (ymd: string, n: number) => new Date(Date.parse(ymd) + n * 86_400_000).toISOString().slice(0, 10)

beforeAll(async () => {
  t = await bootTenant({ vertical: 'landscaping' })
  const s = await seedOwner(t)
  companyId = s.company.id; ownerId = s.owner.id
  await t.db.update(t.schema.company).set({ enabledFeatures: ['contacts', 'jobs', 'quotes', 'invoices', 'recurring_routes', 'area_pricing', 'snow_billing'] }).where(eq(t.schema.company.id, companyId))
  owner = await login('owner@test.example', s.password)
  field = await seat('field')
  viewer = await seat('viewer')
})

// Every route gets its own four weeks on the calendar, so one test's visits never fall in another test's date range.
let slot = 0

/** A Monday route for one customer with two properties ($40 and $55), visits made for `weeks` weeks from `first`. */
async function route(name: string, weeks = 2) {
  const ct = await (await as(owner, '/api/contacts', { method: 'POST', json: { name: `Cust ${name}`, type: 'client' } })).json()
  const zed = await (await as(owner, '/api/sites', { method: 'POST', json: { name: `Zed ${name}`, contactId: ct.id } })).json()
  const abe = await (await as(owner, '/api/sites', { method: 'POST', json: { name: `Abe ${name}`, contactId: ct.id } })).json()
  const r = await (await as(owner, '/api/recurring-routes', { method: 'POST', json: { name, dayOfWeek: 1, assignedToId: ownerId } })).json()
  const stopZ = await (await as(owner, `/api/recurring-routes/${r.id}/stops`, { method: 'POST', json: { siteId: zed.id, pricePerVisit: 40 } })).json()
  const stopA = await (await as(owner, `/api/recurring-routes/${r.id}/stops`, { method: 'POST', json: { siteId: abe.id, pricePerVisit: 55 } })).json()
  const first = addDays(nextWeekday(1), 28 * slot++)
  await as(owner, `/api/recurring-routes/${r.id}/visits`, { method: 'POST', json: { from: first, weeks } })
  const visits = await t.db.select().from(t.schema.job).where(inArray(t.schema.job.recurringRouteStopId, [stopZ.id, stopA.id]))
  return { ct, r, stopZ, stopA, first, visits: visits as any[], range: { from: first, to: addDays(first, 7 * weeks - 1) } }
}
const complete = (id: string) => as(owner, `/api/jobs/${id}/complete`, { method: 'POST' })
const linkOf = (jobId: string) => t.db.select().from(t.schema.routeVisitInvoice).where(eq(t.schema.routeVisitInvoice.jobId, jobId)).then((r: any[]) => r[0])
const invoiceRow = (id: string) => t.db.select().from(t.schema.invoice).where(eq(t.schema.invoice.id, id)).then((r: any[]) => r[0])

describe('route billing', () => {
  test('a route reads as billed elsewhere when a customer has an agreement or recurring invoice — until the owner chooses', async () => {
    const a = await route('Agreement')
    await ins(t.schema.serviceAgreement, { companyId, contactId: a.ct.id, number: 'SA-1', name: 'Season', startDate: new Date(), amount: '100' })
    const got = await (await as(owner, `/api/recurring-routes/${a.r.id}`)).json()
    expect(got.billing.mode).toBe('elsewhere')
    expect(got.billing.chosen).toBe(false)
    expect(got.billing.covered[0].name).toBe('Cust Agreement')
    expect(got.billing.note).toContain('agreement')

    const b = await route('Recurring')
    await ins(t.schema.recurringInvoice, { companyId, contactId: b.ct.id, startDate: new Date(), nextRunDate: new Date(), subtotal: '50', total: '50' })
    expect((await (await as(owner, `/api/recurring-routes/${b.r.id}`)).json()).billing.covered[0].by).toBe('recurring_invoice')

    const free = await route('Free')
    expect((await (await as(owner, `/api/recurring-routes/${free.r.id}`)).json()).billing.mode).toBe('monthly')
    // The owner's choice wins, and can be set back to automatic.
    expect((await as(owner, `/api/recurring-routes/${a.r.id}`, { method: 'PUT', json: { billingMode: 'monthly' } })).status).toBe(200)
    const chosen = (await (await as(owner, `/api/recurring-routes/${a.r.id}`)).json()).billing
    expect([chosen.mode, chosen.chosen]).toEqual(['monthly', true])
    await as(owner, `/api/recurring-routes/${a.r.id}`, { method: 'PUT', json: { billingMode: '' } })
    expect((await (await as(owner, `/api/recurring-routes/${a.r.id}`)).json()).billing.mode).toBe('elsewhere')
    const bad = await as(owner, `/api/recurring-routes/${a.r.id}`, { method: 'PUT', json: { billingMode: 'weekly' } })
    expect(bad.status).toBe(400)
    expect((await bad.json()).fields.billingMode).toContain('billed elsewhere')
  })

  test('the monthly run makes ONE draft invoice per customer from completed visits, lines grouped by property, and never bills a visit twice', async () => {
    const x = await route('Monthly')
    const done = x.visits.slice(0, 3)
    for (const v of done) expect((await complete(v.id)).status).toBe(200)
    const qs = `from=${x.range.from}&to=${x.range.to}&groupBy=property`

    // Reviewed first: nothing is made by looking.
    const preview = await (await as(owner, `/api/recurring-routes/billing/preview?${qs}`)).json()
    expect(preview.totals.invoices).toBe(1)
    expect(preview.totals.visits).toBe(3)
    expect(preview.customers[0].name).toBe('Cust Monthly')
    expect(preview.customers[0].visits.map((v: any) => v.siteName)).toEqual([...preview.customers[0].visits.map((v: any) => v.siteName)].sort())
    expect(await t.db.select().from(t.schema.routeVisitInvoice).where(inArray(t.schema.routeVisitInvoice.jobId, x.visits.map((v) => v.id)))).toEqual([])

    const res = await as(owner, '/api/recurring-routes/billing/batches', { method: 'POST', json: { from: x.range.from, to: x.range.to, groupBy: 'property' } })
    expect(res.status).toBe(201)
    const out = await res.json()
    expect(out.invoices.length).toBe(1)
    const inv = await invoiceRow(out.invoices[0].id)
    expect(inv.status).toBe('draft')
    expect(inv.contactId).toBe(x.ct.id)
    const expected = done.reduce((s, v) => s + Number(v.estimatedValue), 0)
    expect(Number(inv.subtotal)).toBe(expected)
    const lines = await t.db.select().from(t.schema.invoiceLineItem).where(eq(t.schema.invoiceLineItem.invoiceId, inv.id))
    expect(lines.length).toBe(3)
    // grouped by property: every Abe line before every Zed line
    const names = (lines as any[]).sort((a, b) => a.sortOrder - b.sortOrder).map((l) => l.description.split(' · ')[0])
    expect(names).toEqual([...names].sort())
    // one link per billed visit, and the unfinished fourth visit is untouched
    for (const v of done) expect((await linkOf(v.id)).invoiceId).toBe(inv.id)
    expect(await linkOf(x.visits[3].id)).toBeUndefined()

    // Again: nothing left to bill, and no second invoice.
    const again = await as(owner, '/api/recurring-routes/billing/batches', { method: 'POST', json: { from: x.range.from, to: x.range.to } })
    expect(again.status).toBe(400)
    expect((await again.json()).code).toBe('NOTHING_TO_BILL')
    const after = await (await as(owner, `/api/recurring-routes/billing/preview?${qs}`)).json()
    expect(after.skipped.alreadyBilled).toBe(3)
  })

  test('a route billed elsewhere is left out of the run and refuses a single bill, until the owner chooses monthly', async () => {
    const x = await route('Elsewhere', 1)
    await ins(t.schema.serviceAgreement, { companyId, contactId: x.ct.id, number: 'SA-2', name: 'Season 2', startDate: new Date(), amount: '100' })
    await complete(x.visits[0].id)
    const qs = `from=${x.range.from}&to=${x.range.to}`
    const preview = await (await as(owner, `/api/recurring-routes/billing/preview?${qs}`)).json()
    expect(preview.totals.visits).toBe(0)
    expect(preview.leftOutRoutes.find((r: any) => r.routeId === x.r.id).mode).toBe('elsewhere')
    expect((await as(owner, '/api/recurring-routes/billing/batches', { method: 'POST', json: { from: x.range.from, to: x.range.to } })).status).toBe(400)
    const one = await as(owner, `/api/recurring-routes/billing/visits/${x.visits[0].id}`, { method: 'POST' })
    expect(one.status).toBe(409)
    expect((await one.json()).error).toContain('billed by an agreement')
    expect(await linkOf(x.visits[0].id)).toBeUndefined()

    await as(owner, `/api/recurring-routes/${x.r.id}`, { method: 'PUT', json: { billingMode: 'monthly' } })
    expect((await as(owner, `/api/recurring-routes/billing/visits/${x.visits[0].id}`, { method: 'POST' })).status).toBe(201)
  })

  test('per visit: the draft invoice is made as the crew finishes the visit, carries the visit as its job, and is made once', async () => {
    const x = await route('PerVisit', 1)
    await as(owner, `/api/recurring-routes/${x.r.id}`, { method: 'PUT', json: { billingMode: 'per_visit' } })
    const v = x.visits.find((row) => row.siteId === x.visits[0].siteId)!
    // Not finished: refused with what to do.
    const early = await as(owner, `/api/recurring-routes/billing/visits/${v.id}`, { method: 'POST' })
    expect(early.status).toBe(400)
    expect((await early.json()).error).toContain('Finish the visit')

    expect((await complete(v.id)).status).toBe(200)
    const link = await linkOf(v.id)
    expect(link).toBeDefined()
    const inv = await invoiceRow(link.invoiceId)
    expect(inv.status).toBe('draft')
    expect(inv.jobId).toBe(v.id) // the same "already billed" link as any job
    expect(Number(inv.subtotal)).toBe(Number(v.estimatedValue))

    // Finished again (reopen and complete): still one invoice. A click on Bill says so.
    await complete(v.id)
    expect((await t.db.select().from(t.schema.invoice).where(eq(t.schema.invoice.jobId, v.id))).length).toBe(1)
    const dup = await as(owner, `/api/recurring-routes/billing/visits/${v.id}`, { method: 'POST' })
    expect(dup.status).toBe(409)
    expect((await dup.json()).error).toContain(inv.number)
    // The monthly run does not pick it up again either (this route is per visit, and the visit is billed).
    const pre = await (await as(owner, `/api/recurring-routes/billing/preview?from=${x.range.from}&to=${x.range.to}`)).json()
    expect(pre.totals.visits).toBe(0)
  })

  test('a visit billed on its own is skipped by the monthly run; a voided bill makes it billable again', async () => {
    const x = await route('Void', 1)
    const [a, b] = x.visits
    await complete(a.id); await complete(b.id)
    expect((await as(owner, `/api/recurring-routes/billing/visits/${a.id}`, { method: 'POST' })).status).toBe(201)
    const range = { from: x.range.from, to: x.range.to }
    const pre = await (await as(owner, `/api/recurring-routes/billing/preview?from=${range.from}&to=${range.to}`)).json()
    expect(pre.skipped.alreadyBilled).toBe(1)
    expect(pre.totals.visits).toBe(1)
    // Void the single bill: that visit is billable again.
    const link = await linkOf(a.id)
    await t.db.update(t.schema.invoice).set({ status: 'void' }).where(eq(t.schema.invoice.id, link.invoiceId))
    const run = await (await as(owner, '/api/recurring-routes/billing/batches', { method: 'POST', json: range })).json()
    expect(run.batch.visitCount).toBe(2)
    expect((await linkOf(a.id)).invoiceId).not.toBe(link.invoiceId)
  })

  test('undo removes the run\'s untouched drafts and frees their visits; a sent invoice stays and is named', async () => {
    const x = await route('Undo', 1)
    for (const v of x.visits) await complete(v.id)
    const range = { from: x.range.from, to: x.range.to }
    const run = await (await as(owner, '/api/recurring-routes/billing/batches', { method: 'POST', json: range })).json()
    const invoiceId = run.invoices[0].id
    const list = await (await as(owner, '/api/recurring-routes/billing/batches')).json()
    expect(list.data.find((b: any) => b.id === run.batch.id).draftsLeft).toBe(1)

    const undo = await as(owner, `/api/recurring-routes/billing/batches/${run.batch.id}/undo`, { method: 'POST' })
    expect(undo.status).toBe(200)
    expect((await undo.json()).removed).toBe(1)
    expect(await invoiceRow(invoiceId)).toBeUndefined()
    for (const v of x.visits) expect(await linkOf(v.id)).toBeUndefined()
    expect((await as(owner, `/api/recurring-routes/billing/batches/${run.batch.id}/undo`, { method: 'POST' })).status).toBe(409)

    // Billed again, then sent: the undo keeps it.
    const run2 = await (await as(owner, '/api/recurring-routes/billing/batches', { method: 'POST', json: range })).json()
    await t.db.update(t.schema.invoice).set({ status: 'sent', sentAt: new Date() }).where(eq(t.schema.invoice.id, run2.invoices[0].id))
    const keep = await (await as(owner, `/api/recurring-routes/billing/batches/${run2.batch.id}/undo`, { method: 'POST' })).json()
    expect(keep.removed).toBe(0)
    expect(keep.undone).toBe(false)
    expect(keep.kept[0].number).toBe(run2.invoices[0].number)
    expect(await invoiceRow(run2.invoices[0].id)).toBeDefined()
  })

  test('refusals say what to do, and the server asks the seat', async () => {
    const x = await route('Seats', 1)
    await complete(x.visits[0].id)
    const body = { from: x.range.from, to: x.range.to }
    const bad = await as(owner, '/api/recurring-routes/billing/batches', { method: 'POST', json: { from: 'last month', to: x.range.to } })
    expect(bad.status).toBe(400)
    expect((await bad.json()).fields.from).toContain('YYYY-MM-DD')
    expect((await as(owner, '/api/recurring-routes/billing/batches', { method: 'POST', json: { from: x.range.to, to: x.range.from } })).status).toBe(400)
    expect((await as(owner, `/api/recurring-routes/billing/preview?from=${x.range.from}&to=2099-01-01`)).status).toBe(400)

    for (const who of [field, viewer]) {
      expect((await as(who, '/api/recurring-routes/billing/batches', { method: 'POST', json: body })).status).toBe(403)
      expect((await as(who, `/api/recurring-routes/billing/visits/${x.visits[0].id}`, { method: 'POST' })).status).toBe(403)
      expect((await as(who, '/api/recurring-routes/billing/batches/nope/undo', { method: 'POST' })).status).toBe(403)
    }
    // The crew can work the route but not choose how it is billed, and does not see the billing at all.
    const put = await as(field, `/api/recurring-routes/${x.r.id}`, { method: 'PUT', json: { billingMode: 'monthly' } })
    expect(put.status).toBe(403)
    expect('billing' in (await (await as(field, `/api/recurring-routes/${x.r.id}`)).json())).toBe(false)
    expect((await as(owner, '/api/recurring-routes/billing/batches/not-a-batch/undo', { method: 'POST' })).status).toBe(404)
  })
})
