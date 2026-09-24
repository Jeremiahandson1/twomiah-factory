// Landscaping T14 H4 — a refund never takes a sale out of "invoiced". Real Postgres (PGlite), the template's real
// invoices routes (payments, refunds, send, void) and real Reports routes. Copied into CRM harnesses.
import { Hono } from 'hono'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user, contact } from './db/schema.ts'
import { errorHandler } from './src/utils/errors.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => { if (ok) { passed++; console.log(`  ok   ${name}`) } else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 500)) } }

await setupSchema()
const [co] = await db.insert(company).values({ name: 'Refunds', slug: 'refund-rev', email: 'r@test.local', settings: {}, enabledFeatures: ['invoices', 'reports'] } as any).returning()
const [owner] = await db.insert(user).values({ email: 'r@test.local', passwordHash: 'x', firstName: 'O', lastName: 'R', role: 'owner', companyId: co.id } as any).returning()
const [ct] = await db.insert(contact).values({ type: 'client', name: 'Dana Refund', email: 'dana@refund.test', companyId: co.id } as any).returning()
const app = new Hono()
app.route('/api/invoices', (await import('./src/routes/invoices.ts')).default)
app.route('/api/reports', (await import('./src/routes/reporting.ts')).default)
app.onError(errorHandler)
const call = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, { method, headers: { 'content-type': 'application/json', 'x-test-user': owner.id, 'x-test-company': co.id, 'x-test-role': 'owner' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await res.text(); let json: any = text; try { json = JSON.parse(text) } catch {}
  return { status: res.status, json }
}
const mkInvoice = async (amount: number, send = true) => {
  const r = await call('POST', '/api/invoices', { contactId: ct.id, lineItems: [{ description: 'Service', quantity: 1, unitPrice: amount }] })
  if (r.status !== 201) throw new Error('create failed ' + JSON.stringify(r))
  if (send) { const s = await call('POST', `/api/invoices/${r.json.id}/send`, {}); if (s.status !== 200) throw new Error('send failed ' + JSON.stringify(s)) }
  return r.json
}
const revenue = async () => (await call('GET', '/api/reports/revenue')).json
const stats = async () => (await call('GET', '/api/invoices/stats')).json

const a = await mkInvoice(1000)     // the tester's INV-00040: $1,000 paid in full, then refunded in two steps
const b = await mkInvoice(500)      // unpaid
const v = await mkInvoice(300)      // voided below — never counts
await mkInvoice(200, false)         // a draft — never counts
check('fixture: void the $300 invoice', (await call('POST', `/api/invoices/${v.id}/void`, {})).status === 200)

const before = await revenue()
check('baseline: $1,500 invoiced across 2 invoices (void and draft excluded)', before.invoiced === 1500 && before.invoiceCount === 2 && before.refunded === 0, before)
check('paying the $1,000 invoice in full → 201', (await call('POST', `/api/invoices/${a.id}/payments`, { amount: 1000, method: 'card' })).status === 201)
const partial = await call('POST', `/api/invoices/${a.id}/refund`, { amount: 250 })
const afterPartial = await revenue()
check('a $250 partial refund: still paid, still $1,500 invoiced (unchanged from T14)', partial.status === 200 && partial.json.invoice?.status === 'paid' && afterPartial.invoiced === 1500 && afterPartial.invoiceCount === 2, { status: partial.json.invoice?.status, afterPartial })
const rest = await call('POST', `/api/invoices/${a.id}/refund`, { amount: 750 })
const afterFull = await revenue()
check('refunding the remaining $750: the invoice is refunded…', rest.status === 200 && rest.json.invoice?.status === 'refunded', rest.json.invoice?.status)
check('…and it stays in invoiced: $1,500 across 2 invoices (T14: dropped to $500 / 1)', afterFull.invoiced === 1500 && afterFull.invoiceCount === 2, afterFull)
check('the refunds show on their own: refunded $1,000; collected is net ($0); outstanding is the unpaid $500 only', afterFull.refunded === 1000 && afterFull.collected === 0 && afterFull.outstanding === 500 && afterFull.outstandingCount === 1, afterFull)
check('collection rate is collected ÷ invoiced: 0%', afterFull.collectionRate === 0, afterFull.collectionRate)

const month = new Date().toISOString().slice(0, 7)
const monthly = (await call('GET', '/api/reports/revenue/monthly?months=2')).json
const thisMonth = monthly.find((m: any) => m.month === month)
check("this month's trend keeps the refunded sale: invoiced $1,500, collected $0 (payment − refunds)", thisMonth?.invoiced === 1500 && thisMonth?.collected === 0, thisMonth)
const customers = (await call('GET', '/api/reports/revenue/customers')).json
check('top customers: the customer still shows $1,500 invoiced over 2 invoices, $0 collected', customers[0]?.invoiced === 1500 && customers[0]?.invoiceCount === 2 && customers[0]?.collected === 0, customers[0])
const dash = (await call('GET', '/api/reports/dashboard')).json
check('the Reports summary carries the same numbers', dash.revenue?.invoiced === 1500 && dash.revenue?.refunded === 1000, dash.revenue)
const s = await stats()
check('invoice stats: totalAmount $1,500 gross, refundedAmount $1,000, paidAmount $0 net, outstanding $500', s.totalAmount === 1500 && s.refundedAmount === 1000 && s.paidAmount === 0 && s.outstanding === 500, s)

const range = await (async () => { const y = new Date(Date.now() - 400 * 86400000).toISOString().slice(0, 10), y2 = new Date(Date.now() - 370 * 86400000).toISOString().slice(0, 10); return (await call('GET', `/api/reports/revenue?startDate=${y}&endDate=${y2}`)).json })()
check('a period with nothing in it shows no invoiced and no refunds', range.invoiced === 0 && range.refunded === 0, range)

console.log(`\nrefund-revenue: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
