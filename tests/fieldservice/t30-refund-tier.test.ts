// Field Service T30 L-RB — "Manager can refund and apply credits (200) … Confirm these are intended."
//
// The codebase had already answered, twice, differently:
//
//   POST /api/payments/refund      requirePermission('payments:delete')   admin and owner
//   POST /api/invoices/:id/refund  requirePermission('invoices:update')   manager and up
//
// Two doors onto the same money with two different locks. The matrix says which was meant — admin's list
// carries refunds as admin-tier next to company config, and manager has no payments right at all.
//
// The over-correction to guard against: a manager who cannot raise, edit, send or void an invoice cannot
// run the office. Only the money going back OUT moves up a tier.
import { Hono } from 'hono'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user, contact, invoice } from './db/schema.ts'
import { errorHandler } from './src/utils/errors.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => { if (ok) { passed++; console.log(`  ok   ${name}`) } else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) } }

await setupSchema()

const [co] = await db.insert(company).values({ name: 'T30 Refund Co', slug: 't30ref', email: 't30ref@test.local', settings: { taxRate: 0 }, enabledFeatures: ['invoices', 'contacts', 'jobs'] } as any).returning()
const mkUser = async (role: string, tag: string) => (await db.insert(user).values({ email: `${tag}-t30ref@test.local`, passwordHash: 'x', firstName: tag, lastName: 'User', role, companyId: co.id } as any).returning())[0]
const owner = await mkUser('owner', 'owner')
const admin = await mkUser('admin', 'admin')
const manager = await mkUser('manager', 'manager')
const [cust] = await db.insert(contact).values({ type: 'client', name: 'T30 Refund Customer', email: 'ref-t30@test.local', companyId: co.id } as any).returning()

const app = new Hono()
app.route('/api/invoices', (await import('./src/routes/invoices.ts')).default)
app.onError(errorHandler)
const as = (who: any) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, { method, headers: { 'content-type': 'application/json', 'x-test-user': who.id, 'x-test-company': co.id, 'x-test-role': who.role }, body: body === undefined ? undefined : JSON.stringify(body) })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}
let n = 0
const paidInvoice = async () => (await db.insert(invoice).values({
  number: `INV-T30REF-${++n}`, status: 'paid', contactId: cust.id, companyId: co.id,
  subtotal: '100.00', total: '100.00', amountPaid: '100.00', amountRefunded: '0.00',
} as any).returning())[0]

console.log('\n── money going back out is admin-tier ──')
{
  const inv = await paidInvoice()
  const m = await as(manager)('POST', `/api/invoices/${inv.id}/refund`, { amount: 10 })
  check('a manager cannot refund', m.status === 403, { status: m.status, body: m.json })
  check('…and is told which right it needs', m.json?.required === 'payments:delete', { body: m.json })

  const a = await as(admin)('POST', `/api/invoices/${inv.id}/refund`, { amount: 10 })
  check('an admin can', a.status === 200, { status: a.status, body: a.json })
  const o = await as(owner)('POST', `/api/invoices/${inv.id}/refund`, { amount: 10 })
  check('…and so can the owner', o.status === 200, { status: o.status, body: o.json })
}

console.log('\n── a credit is the same decision with a different instrument ──')
{
  // A credit lowers a real price, and the cap is worked out from the line items — so this one is raised
  // through the API rather than inserted, or the most you can credit is $0.00 and the test proves nothing.
  const made = await as(owner)('POST', '/api/invoices', { contactId: cust.id, lineItems: [{ description: 'Repair', quantity: 1, unitPrice: 100 }], taxRate: 0 })
  const inv = (made.json?.data ?? made.json)
  check('the invoice to credit was raised', !!inv?.id, made.json)
  const m = await as(manager)('POST', `/api/invoices/${inv.id}/credit`, { amount: 5, reason: 'goodwill' })
  check('a manager cannot write money off either', m.status === 403, { status: m.status, body: m.json })
  const a = await as(admin)('POST', `/api/invoices/${inv.id}/credit`, { amount: 5, reason: 'goodwill' })
  check('an admin can', a.status === 200, { status: a.status, body: a.json })
}

console.log('\n── and a manager still runs the office ──')
{
  const call = as(manager)
  const made = await call('POST', '/api/invoices', { contactId: cust.id, lineItems: [{ description: 'Service call', quantity: 1, unitPrice: 120 }], taxRate: 0 })
  check('a manager raises an invoice', made.status === 200 || made.status === 201, { status: made.status, error: made.json?.error })
  const id = (made.json?.data ?? made.json)?.id
  const upd = await call('PUT', `/api/invoices/${id}`, { notes: 'agreed with the customer' })
  check('…edits it', upd.status === 200, { status: upd.status })
  const list = await call('GET', '/api/invoices')
  check('…and reads the list', list.status === 200, { status: list.status })
  const voided = await call('POST', `/api/invoices/${id}/void`, { reason: 'raised in error' })
  check('…and voids an unpaid one — a correction, not a payout', voided.status === 200, { status: voided.status, body: voided.json })
}

console.log(`\nfs-t30-refund-tier: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
