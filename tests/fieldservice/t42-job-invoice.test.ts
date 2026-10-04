// crm-fieldservice — T42. Billing a job bills the QUOTE behind it, with its lines and its tax.
//
// THE FINDING, measured on the live tenant:
//
//   "Invoicing from a completed job collapses the lines into one and drops the tax
//    (INV-00170, INV-00172: $178 instead of $191.35)"
//
// and the numbers off that tenant, which say exactly what happened:
//
//   INV-00171  quote → invoice   2 lines   taxRate 7.50   total 191.35   quoteId set
//   INV-00170  job   → invoice   1 line    taxRate 0.00   total 178.00   quoteId null
//   INV-00172  job   → invoice   1 line    taxRate 0.00   total 178.00   quoteId null
//
// 178.00 is the quote's SUBTOTAL. POST /jobs/:id/invoice billed `job.estimated_value` as a single
// line with taxRate hard-coded to 0, so a job that came from a quote lost its lines, its tax and
// its link back to the quote — three things the quote was holding all along.
//
// Four things are pinned here, because each was separately wrong or separately at risk:
//   1. a job WITH a quote bills the quote's lines, rate and discount, and carries quoteId;
//   2. a job WITHOUT a quote still bills — one line from the estimate — but at the COMPANY's
//      default tax rate, not zero (the other half of "drops the tax");
//   3. billing the job after converting its quote is refused, naming the invoice that already
//      exists. The duplicate check claimed in its own comment to look at "both doors" and only
//      ever looked at job_id, which is how one piece of work got two invoices on the tenant;
//   4. a quoteless job with no value is still refused rather than invoiced for $0.00.
import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { errorHandler } from './src/utils/errors.ts'
import { createJobRoutes, createQuoteRoutes } from './src/shared/index.ts'
import {
  company, user, contact, quote as quoteT, quoteLineItem, project, invoice, invoiceLineItem,
  job, equipment, site, timeEntry, jobPhoto, teamMember,
} from './db/schema.ts'
import { authenticate } from './src/middleware/auth.ts'
import { requirePermission, hasPermission, getExtraPermissions } from './src/middleware/permissions.ts'
// The template's own sanitiser, not a stand-in: `cleanText` is a zod-schema FACTORY
// (z.string().transform(stripHtml).pipe(…)), so a string→string stub makes the job schema throw
// "cleanText(1).pipe is not a function" before a single assertion runs.
import { cleanText } from './src/utils/sanitize.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 320)) }
}

await setupSchema()

const app = new Hono()
// Exactly what templates/crm-fieldservice/backend/src/routes/jobs.ts passes — billing is the option
// that mounts POST /:id/invoice at all, and fieldservice is the only template that sets it.
app.route('/api/jobs', createJobRoutes({
  db,
  tables: { job, project, contact, user, timeEntry, equipment, jobPhoto, teamMember, invoice, invoiceLineItem },
  authenticate,
  requirePermission,
  canSee: async (role: string, permission: string, userId?: string) =>
    hasPermission(role, permission, await getExtraPermissions(userId)),
  emitToCompany: () => {},
  EVENTS: {},
  cleanText,
  options: { billing: { numbering: { prefix: 'INV', pad: 5 }, termsDays: 30 } },
}) as any)
app.route('/api/quotes', createQuoteRoutes({
  db,
  tables: { quote: quoteT, quoteLineItem, contact, project, invoice, invoiceLineItem, company, job, equipment, site },
  authenticate,
  requirePermission,
  emitToCompany: () => {},
  EVENTS: {},
  loadPdf: async () => async () => Buffer.from(''),
  options: { extraFields: ['siteId', 'equipmentId', 'customerMessage'], hasDeclinedAt: true, hasConvertedToJobId: true, jobHasSiteAndEquipment: true, hasLineCost: true },
}) as any)
app.onError(errorHandler)

// 7.5% is the rate the live tenant carries, and the one that turns 178.00 into 191.35.
const [co] = await db.insert(company).values({
  name: 'T42 Job Billing', slug: 't42jobinv', email: 'office-t42ji@test.local',
  settings: { defaultTaxRate: 7.5 },
  enabledFeatures: ['quotes', 'contacts', 'jobs', 'invoices', 'job_costing'],
} as any).returning()
const [owner] = await db.insert(user).values({
  email: 'owner-t42ji@test.local', passwordHash: 'x', firstName: 'Ada', lastName: 'Owner',
  role: 'owner', companyId: co.id,
} as any).returning()
const [cust] = await db.insert(contact).values({
  type: 'client', name: 'Beechwood Flats', email: 'bw-t42ji@test.local', companyId: co.id,
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

/** The quote the live tenant had: two lines, 178.00 subtotal, 7.5% → 191.35. */
const makeQuote = async (name: string) => {
  const made = await call('POST', '/api/quotes', {
    contactId: cust.id, name, taxRate: 7.5,
    lineItems: [
      { description: 'T42 Furnace Inspection', quantity: 1, unitPrice: 129 },
      { description: 'T42 Filter 16x25', quantity: 2, unitPrice: 24.5 },
    ],
  })
  return made.json?.data ?? made.json
}

// ═════════ 1. a job that came from a quote bills the quote ═══════════════════════════════════════
console.log('\n── a job raised from a quote bills the quote, not the estimate ──')
{
  const q = await makeQuote('T42 Pricebook Quote')
  check('the quote totals 191.35 at 7.5%', Number(q?.total) === 191.35 && Number(q?.subtotal) === 178, { subtotal: q?.subtotal, total: q?.total })

  // estimated_value deliberately set to the quote's SUBTOTAL — which is what the tenant had, and
  // what the old code billed.
  const [j] = await db.insert(job).values({
    number: 'JOB-T42-1', title: 'T42 Pricebook Quote', status: 'completed',
    estimatedValue: '178.00', contactId: cust.id, companyId: co.id, quoteId: q.id,
  } as any).returning()

  const billed = await call('POST', `/api/jobs/${j.id}/invoice`)
  check('the job is billed', billed.status === 201, { status: billed.status, body: billed.text?.slice(0, 240) })
  const inv = billed.json
  check('…for 191.35, not 178.00', Number(inv?.total) === 191.35, { total: inv?.total, subtotal: inv?.subtotal })
  check('…at the quote\'s 7.5%, not 0%', Number(inv?.taxRate) === 7.5 && Number(inv?.taxAmount) === 13.35, { taxRate: inv?.taxRate, taxAmount: inv?.taxAmount })
  check('…with both of the quote\'s lines, not one collapsed line', (inv?.lineItems || []).length === 2, { lines: (inv?.lineItems || []).map((l: any) => l.description) })
  check('…carrying the quote\'s own line descriptions', (inv?.lineItems || []).some((l: any) => l.description === 'T42 Filter 16x25'), { lines: (inv?.lineItems || []).map((l: any) => l.description) })
  check('…linked to the job for job costing', inv?.jobId === j.id, { jobId: inv?.jobId })
  check('…and linked to the quote, which used to be lost', inv?.quoteId === q.id, { quoteId: inv?.quoteId })
}

// ═════════ 2. a job with no quote is taxed at the company's rate ═════════════════════════════════
console.log('\n── a call with no quote behind it: one line, but taxed ──')
{
  const [j] = await db.insert(job).values({
    number: 'JOB-T42-2', title: 'Emergency call-out', status: 'completed',
    estimatedValue: '200.00', contactId: cust.id, companyId: co.id,
  } as any).returning()

  const billed = await call('POST', `/api/jobs/${j.id}/invoice`)
  check('the job is billed', billed.status === 201, { status: billed.status, body: billed.text?.slice(0, 240) })
  const inv = billed.json
  check('…one line from the estimate', (inv?.lineItems || []).length === 1, { lines: (inv?.lineItems || []).length })
  check('…at the company default 7.5%, not 0%', Number(inv?.taxRate) === 7.5, { taxRate: inv?.taxRate })
  check('…so 200.00 bills as 215.00', Number(inv?.total) === 215, { total: inv?.total })
  check('…with no quote to link', !inv?.quoteId, { quoteId: inv?.quoteId })
}

// ═════════ 3. the quote door and the job door cannot both bill the same work ══════════════════════
console.log('\n── converting the quote, then billing the job, is refused ──')
{
  const q = await makeQuote('T42 Both Doors')
  const [j] = await db.insert(job).values({
    number: 'JOB-T42-3', title: 'T42 Both Doors', status: 'completed',
    estimatedValue: '178.00', contactId: cust.id, companyId: co.id, quoteId: q.id,
  } as any).returning()

  const viaQuote = await call('POST', `/api/quotes/${q.id}/convert-to-invoice`)
  check('the quote converts', viaQuote.status === 201, { status: viaQuote.status, body: viaQuote.text?.slice(0, 200) })
  const first = viaQuote.json?.data ?? viaQuote.json

  const viaJob = await call('POST', `/api/jobs/${j.id}/invoice`)
  check('billing the job is then refused', viaJob.status === 409, { status: viaJob.status, body: viaJob.text?.slice(0, 200) })
  check('…naming the invoice that already exists', String(viaJob.json?.error || '').includes(String(first?.number)), { error: viaJob.json?.error })
  const all = await db.select({ id: invoice.id }).from(invoice).where(eq(invoice.quoteId, q.id))
  check('…and one piece of work still has exactly one invoice', all.length === 1, { invoices: all.length })
}

// ═════════ 4. a quoteless job with nothing to bill is still refused ══════════════════════════════
console.log('\n── a call with no quote and no value is refused, not invoiced for $0.00 ──')
{
  const [j] = await db.insert(job).values({
    number: 'JOB-T42-4', title: 'Nothing agreed yet', status: 'completed',
    contactId: cust.id, companyId: co.id,
  } as any).returning()
  const billed = await call('POST', `/api/jobs/${j.id}/invoice`)
  check('refused with 400', billed.status === 400, { status: billed.status, body: billed.text?.slice(0, 200) })
}

console.log(`\nfs-t42-job-invoice: ${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
