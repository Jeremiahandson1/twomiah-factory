// crm-fieldservice — T41. A quote line can say what the work COSTS, and job costing reads it.
//
// THE BUG, in two halves.
//
// `quote_line_item.type` has been read by services/jobCosting.ts for as long as that file has
// existed, to split the estimate into labour and material. Nothing ever WROTE it: the shared quote
// route's line schema had no `type` field, so toRow never set one, so every row in the fleet was
// NULL and both CASE expressions summed to zero. And a quote line had no cost column at all, so
// even a correctly-typed line could only have reported the customer's PRICE back as our cost.
//
// Reported as "pricebook cost never reaches job costing (100% margin)". The deeper truth was worse
// than a wrong cost: there was no estimate at all, and 100% is the margin you get when you divide
// revenue by nothing.
//
// t32-job-costing pins the READ side by inserting rows directly. This pins the WRITE side, through
// the real route, because a column nothing persists is the fault being fixed: create, read back,
// and edit — since PUT replaces the whole line set and would otherwise wipe every cost on a quote
// the moment anybody re-saved it.
import { Hono } from 'hono'
import { eq, asc } from 'drizzle-orm'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { errorHandler } from './src/utils/errors.ts'
import { createQuoteRoutes } from './src/shared/index.ts'
import {
  company, user, contact, quote as quoteT, quoteLineItem, project, invoice, invoiceLineItem,
  company as companyT, job, equipment, site,
} from './db/schema.ts'
import { authenticate } from './src/middleware/auth.ts'
import { requirePermission } from './src/middleware/permissions.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 320)) }
}

await setupSchema()

const app = new Hono()
app.route('/api/quotes', createQuoteRoutes({
  db,
  tables: { quote: quoteT, quoteLineItem, contact, project, invoice, invoiceLineItem, company: companyT, job, equipment, site },
  authenticate,
  requirePermission,
  emitToCompany: () => {},
  EVENTS: {},
  loadPdf: async () => async () => Buffer.from(''),
  // Exactly what templates/crm-fieldservice/backend/src/routes/quotes.ts passes. hasLineCost is the
  // flag under test: without it the three fields are accepted by the schema and dropped by toRow.
  options: {
    extraFields: ['siteId', 'equipmentId', 'customerMessage'],
    hasDeclinedAt: true, hasConvertedToJobId: true, jobHasSiteAndEquipment: true,
    hasLineCost: true,
  },
}) as any)
app.onError(errorHandler)

const [co] = await db.insert(company).values({
  name: 'T41 Costed Quotes', slug: 't41cost', email: 'office-t41@test.local', settings: {},
  enabledFeatures: ['quotes', 'contacts', 'pricebook', 'job_costing'],
} as any).returning()
const [owner] = await db.insert(user).values({
  email: 'owner-t41cost@test.local', passwordHash: 'x', firstName: 'Ada', lastName: 'Owner',
  role: 'owner', companyId: co.id,
} as any).returning()
const [cust] = await db.insert(contact).values({
  type: 'client', name: 'Beechwood Flats', email: 'bw-t41@test.local', companyId: co.id,
} as any).returning()

const call = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json', 'x-test-user': owner.id, 'x-test-company': co.id, 'x-test-role': 'owner' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j, text: t }
}
const linesOf = (quoteId: string) =>
  db.select().from(quoteLineItem).where(eq(quoteLineItem.quoteId, quoteId)).orderBy(asc(quoteLineItem.sortOrder))

// ══════════ create: the three fields are persisted ══════════════════════════════════════════════
console.log('\n── a line priced from the pricebook keeps its kind and its cost ──')
let quoteId = ''
{
  const made = await call('POST', '/api/quotes', {
    contactId: cust.id, name: 'Unit 3 — condenser swap', taxRate: 0,
    lineItems: [
      { description: 'Install labour (6h)', quantity: 6, unitPrice: 150, type: 'labor', unitCost: 50, pricebookItemId: 'pb-labour-1' },
      { description: 'Condenser unit', quantity: 1, unitPrice: 800, type: 'part', unitCost: 450, pricebookItemId: 'pb-cond-1' },
      // Typed by hand, no cost: the common case, and it must stay legal.
      { description: 'Haulaway', quantity: 1, unitPrice: 300 },
    ],
  })
  check('the quote is created', made.status === 201, { status: made.status, body: made.text?.slice(0, 220) })
  const q = made.json?.data ?? made.json
  quoteId = q?.id
  check('…for 6×150 + 800 + 300 = 2000', Number(q?.total) === 2000, { total: q?.total })

  const rows = await linesOf(quoteId)
  check('…with three lines stored', rows.length === 3, rows.length)

  // THE ASSERTION THIS FILE EXISTS FOR. `type` was NULL on every quote line in the fleet.
  check('…the labour line records type=labor', rows[0]?.type === 'labor', { type: rows[0]?.type })
  check('…and its cost of 50.00, not its 150.00 price', Number(rows[0]?.unitCost) === 50,
    { unitCost: rows[0]?.unitCost, unitPrice: rows[0]?.unitPrice })
  check('…and which catalogue item it came from', rows[0]?.pricebookItemId === 'pb-labour-1', { id: rows[0]?.pricebookItemId })

  check('…the part line records type=part and cost 450', rows[1]?.type === 'part' && Number(rows[1]?.unitCost) === 450,
    { type: rows[1]?.type, unitCost: rows[1]?.unitCost })

  // An uncosted line stores NULL, not 0 — "not costed" and "free" are different claims.
  check('…and the hand-typed line is left UNCOSTED rather than costed at zero',
    rows[2]?.unitCost === null && rows[2]?.type === null,
    { unitCost: rows[2]?.unitCost, type: rows[2]?.type })
}

// ══════════ the quote reads back with them, so the editor can round-trip ════════════════════════
{
  const got = await call('GET', `/api/quotes/${quoteId}`)
  const items = (got.json?.data ?? got.json)?.lineItems || []
  check('GET returns the cost fields, or the editor cannot show them', items.length === 3 && items[0]?.unitCost != null,
    items.map((li: any) => ({ t: li.type, c: li.unitCost })))
}

// ══════════ edit: a re-save must not wipe what create recorded ══════════════════════════════════
console.log('\n── editing the quote keeps the costs ──')
{
  // The editor sends the whole line set back, including the fields it read. One price changes.
  const put = await call('PUT', `/api/quotes/${quoteId}`, {
    lineItems: [
      { description: 'Install labour (6h)', quantity: 6, unitPrice: 160, type: 'labor', unitCost: 50, pricebookItemId: 'pb-labour-1' },
      { description: 'Condenser unit', quantity: 1, unitPrice: 800, type: 'part', unitCost: 450, pricebookItemId: 'pb-cond-1' },
      { description: 'Haulaway', quantity: 1, unitPrice: 300 },
    ],
  })
  check('the edit is accepted', put.status === 200, { status: put.status, body: put.text?.slice(0, 220) })
  const rows = await linesOf(quoteId)
  check('…the new price took', Number(rows[0]?.unitPrice) === 160, { unitPrice: rows[0]?.unitPrice })
  check('…and the costs SURVIVED the replace', Number(rows[0]?.unitCost) === 50 && Number(rows[1]?.unitCost) === 450,
    rows.map((r: any) => r.unitCost))
  check('…as did the kinds', rows[0]?.type === 'labor' && rows[1]?.type === 'part', rows.map((r: any) => r.type))
}

// ══════════ a cost cannot be negative ═══════════════════════════════════════════════════════════
{
  const bad = await call('POST', '/api/quotes', {
    contactId: cust.id, name: 'Negative cost', taxRate: 0,
    lineItems: [{ description: 'Impossible', quantity: 1, unitPrice: 100, type: 'part', unitCost: -5 }],
  })
  check('a negative unit cost is refused', bad.status === 400, { status: bad.status, body: bad.text?.slice(0, 200) })
  const unknownKind = await call('POST', '/api/quotes', {
    contactId: cust.id, name: 'Nonsense kind', taxRate: 0,
    lineItems: [{ description: 'Mystery', quantity: 1, unitPrice: 100, type: 'wizardry' }],
  })
  check('…and a line kind the costing code cannot read is refused, not stored', unknownKind.status === 400,
    { status: unknownKind.status, body: unknownKind.text?.slice(0, 200) })
}

// ══════════ and the estimate the whole thing exists for ═════════════════════════════════════════
console.log('\n── the job estimate now has inputs ──')
{
  const [j] = await db.insert(job).values({
    companyId: co.id, contactId: cust.id, number: 'T41-J1', title: 'Condenser swap',
    status: 'completed', completedAt: new Date('2026-09-20T14:00:00Z'), quoteId,
  } as any).returning()

  const costing = new Hono()
  costing.route('/api/job-costing', (await import('./src/routes/jobCosting.ts')).default)
  costing.onError(errorHandler)
  const res = await costing.request(`/api/job-costing/job/${j.id}`, { headers: { 'x-test-user': owner.id } })
  const body: any = await res.json().catch(() => ({}))
  check('the job cost analysis answers', res.status === 200, { status: res.status })

  const est = body?.estimated
  // 6 × 50 = 300 labour, 1 × 450 = 450 material. The haulaway line is uncosted and excluded.
  check('estimated labour cost is 300 — read from the quote the route wrote', Number(est?.laborCost) === 300,
    { laborCost: est?.laborCost })
  check('estimated material cost is 450', Number(est?.materialCost) === 450, { materialCost: est?.materialCost })
  check('estimated total cost is 750, not 0 and not the 2,060 it sells for', Number(est?.totalCost) === 750,
    { totalCost: est?.totalCost })
  check('…and the uncosted line is reported rather than priced at its selling price',
    Number(est?.uncostedLines) === 1, { uncostedLines: est?.uncostedLines })
}

// ══════════ T41 · a service call can be BILLED, and the money reaches the job ═══════════════════
//
// There was no job→invoice path at all. A quote converts to an invoice and a quote converts to a
// job; a job converted to nothing — and a field-service call often has no quote behind it. The only
// way to bill one was to raise an invoice by hand, and that invoice belonged to no work: job costing
// attributes revenue through invoice.quote_id and invoice.project_id, so a completed, invoiced, PAID
// call showed its cost against zero revenue and read as a pure loss.
//
// Also pinned: BILL ONCE. The route locks the job row FOR UPDATE and re-checks inside the lock,
// because that is precisely the shape that was raising two invoices for one piece of work elsewhere
// in this round. PGlite serialises requests so the race itself cannot be observed here; what is
// asserted is that the second attempt is refused and names the invoice already raised.
console.log('\n── billing a service call ──')
{
  const jobsApp = new Hono()
  jobsApp.route('/api/jobs', (await import('./src/routes/jobs.ts')).default)
  jobsApp.onError(errorHandler)
  const callJobs = async (method: string, path: string, body?: unknown) => {
    const res = await jobsApp.request(path, {
      method,
      headers: { 'content-type': 'application/json', 'x-test-user': owner.id, 'x-test-company': co.id, 'x-test-role': 'owner' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
    return { status: res.status, json: j, text: t }
  }

  const [billable] = await db.insert(job).values({
    companyId: co.id, contactId: cust.id, number: 'T41-BILL-1', title: 'Boiler service',
    status: 'completed', completedAt: new Date('2026-09-21T10:00:00Z'), estimatedValue: '480.00',
  } as any).returning()

  const raised = await callJobs('POST', `/api/jobs/${billable.id}/invoice`)
  check('a completed call can be invoiced', raised.status === 201, { status: raised.status, body: raised.text?.slice(0, 240) })
  const inv = raised.json?.data ?? raised.json
  check('…for the value of the work, 480.00', Number(inv?.total) === 480, { total: inv?.total })
  check('…numbered by the shared helper, not invented here', /^INV-\d{5}$/.test(String(inv?.number || '')), { number: inv?.number })
  check('…billed to the job\'s customer', inv?.contactId === cust.id, { contactId: inv?.contactId })
  check('…and STAMPED WITH THE JOB, which is the whole point', inv?.jobId === billable.id, { jobId: inv?.jobId })
  check('…with one line naming the work', (inv?.lineItems || []).length === 1 && /Boiler service/.test(String(inv.lineItems[0]?.description)),
    (inv?.lineItems || []).map((l: any) => l.description))

  // BILL ONCE.
  const again = await callJobs('POST', `/api/jobs/${billable.id}/invoice`)
  check('billing the same call twice is refused', again.status === 409, { status: again.status, body: again.text?.slice(0, 200) })
  check('…and the refusal names the invoice already raised', String(again.json?.error || '').includes(String(inv?.number)),
    again.json?.error)
  const count = await db.select().from(invoice).where(eq(invoice.jobId, billable.id))
  check('…and there is still exactly one invoice for it', count.length === 1, count.length)

  // A call with nothing agreed is refused rather than invoiced for $0.00.
  const [worthless] = await db.insert(job).values({
    companyId: co.id, contactId: cust.id, number: 'T41-BILL-2', title: 'No price set', status: 'completed',
  } as any).returning()
  const zero = await callJobs('POST', `/api/jobs/${worthless.id}/invoice`)
  check('a call with no value is refused, not invoiced for nothing', zero.status === 400, { status: zero.status, body: zero.text?.slice(0, 200) })
  check('…saying what to do about it', /value|worth/i.test(String(zero.json?.error)), zero.json?.error)

  // A call with no customer cannot be billed to nobody.
  const [orphan] = await db.insert(job).values({
    companyId: co.id, number: 'T41-BILL-3', title: 'Nobody to bill', status: 'completed', estimatedValue: '100.00',
  } as any).returning()
  const noCust = await callJobs('POST', `/api/jobs/${orphan.id}/invoice`)
  check('a call with no customer is refused', noCust.status === 400, { status: noCust.status, body: noCust.text?.slice(0, 180) })

  // ── and the revenue reaches the job ──
  // The invoice is a draft, which job costing excludes from revenue the same as invoicing does.
  await db.update(invoice).set({ status: 'sent' } as any).where(eq(invoice.id, inv.id))

  const costing = new Hono()
  costing.route('/api/job-costing', (await import('./src/routes/jobCosting.ts')).default)
  costing.onError(errorHandler)
  const res = await costing.request(`/api/job-costing/job/${billable.id}`, { headers: { 'x-test-user': owner.id } })
  const body: any = await res.json().catch(() => ({}))
  check('the job cost analysis answers for the billed call', res.status === 200, { status: res.status })
  // THE ASSERTION THIS SECTION EXISTS FOR: 480 of revenue on a job with no quote and no project.
  check('the invoice raised FROM the job is revenue FOR the job — it used to be nobody\'s',
    Number(body?.actual?.revenue) === 480, { revenue: body?.actual?.revenue, collected: body?.actual?.collected })
  check('…counted as DIRECT revenue, not shared across a project', Number(body?.actual?.sharedRevenue || 0) === 0,
    { direct: body?.actual?.directRevenue, shared: body?.actual?.sharedRevenue })
}

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
