// Field Service T30 — "send quote" has to actually send the quote.
//
// The route set the status to `sent` and called onSent, which is the SMS hook, so the customer got a text
// if they had a mobile and nothing at all otherwise. Every template's email service has exported
// sendQuote() the whole time; nothing ever called it.
//
// It could only be caught from outside, and T30 caught it: the app reported INV-00163 and QTE-00050 both
// sent in the same minute, the invoice arrived, and the mail provider had no record of a quote ever
// existing. Marked as sent, never sent — the worst kind, because the business believes the customer has
// the price.
//
// The route file is imported directly here with a stub sender, because what is being tested is whether
// the SHARED route calls it at all.
import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user, contact, quote } from './db/schema.ts'
import { errorHandler } from './src/utils/errors.ts'
import { createQuoteRoutes } from './src/shared/index.ts'
import { quote as quoteT, quoteLineItem, contact as contactT, project, invoice, invoiceLineItem, company as companyT, job, equipment, site } from './db/schema.ts'
import { authenticate } from './src/middleware/auth.ts'
import { requirePermission } from './src/middleware/permissions.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => { if (ok) { passed++; console.log(`  ok   ${name}`) } else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) } }

await setupSchema()

const sent: Array<{ to: string; data: Record<string, unknown> }> = []
let failNext = false

const app = new Hono()
app.route('/api/quotes', createQuoteRoutes({
  db,
  tables: { quote: quoteT, quoteLineItem, contact: contactT, project, invoice, invoiceLineItem, company: companyT, job, equipment, site },
  authenticate,
  requirePermission,
  emitToCompany: () => {},
  EVENTS: { QUOTE_SENT: 'quote.sent', QUOTE_APPROVED: 'quote.approved', QUOTE_REJECTED: 'quote.rejected', QUOTE_CREATED: 'quote.created', QUOTE_UPDATED: 'quote.updated', QUOTE_DELETED: 'quote.deleted' },
  loadPdf: async () => async () => Buffer.from(''),
  sendQuoteEmail: async (to: string, data: Record<string, unknown>) => {
    if (failNext) throw new Error('Mailbox unavailable')
    sent.push({ to, data })
  },
  options: { extraFields: ['siteId', 'equipmentId', 'customerMessage'], hasDeclinedAt: true },
}) as any)
app.onError(errorHandler)

const [co] = await db.insert(company).values({ name: 'T30 Quote Co', slug: 't30quote', email: 'office-t30@test.local', settings: { quoteValidityDays: 14 }, enabledFeatures: ['quotes', 'contacts'] } as any).returning()
const [owner] = await db.insert(user).values({ email: 'owner-t30quote@test.local', passwordHash: 'x', firstName: 'Ada', lastName: 'Owner', role: 'owner', companyId: co.id } as any).returning()
const [cust] = await db.insert(contact).values({ type: 'client', name: 'Quinn Customer', email: 'quinn-t30@test.local', companyId: co.id } as any).returning()
const [noEmail] = await db.insert(contact).values({ type: 'client', name: 'No Email', companyId: co.id } as any).returning()

const call = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, { method, headers: { 'content-type': 'application/json', 'x-test-user': owner.id, 'x-test-company': co.id, 'x-test-role': 'owner' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}
const mkQuote = async (contactId: string, name: string) => {
  const r = await call('POST', '/api/quotes', { contactId, name, taxRate: 0, lineItems: [{ description: 'Callout', quantity: 1, unitPrice: 99 }] })
  return r.json?.data ?? r.json
}

console.log('\n── sending a quote sends the quote ──')
{
  const q = await mkQuote(cust.id, 'T30 quote to send')
  const before = sent.length
  const r = await call('POST', `/api/quotes/${q.id}/send`)
  check('the send is accepted', r.status === 200, r)
  check('…and an email actually went out', sent.length === before + 1, { sentCount: sent.length })
  const last = sent[sent.length - 1]
  check('…to the customer', last?.to === 'quinn-t30@test.local', { to: last?.to })
  check('…naming the quote', String(last?.data?.quoteNumber || '') === q.number, { quoteNumber: last?.data?.quoteNumber, want: q.number })
  check('…and carrying the total the customer owes', String(last?.data?.total ?? '') === String(q.total), { total: last?.data?.total, want: q.total })
  const [row] = await db.select().from(quote).where(eq(quote.id, q.id))
  check('the quote is marked sent', row?.status === 'sent' && !!row?.sentAt, { status: row?.status, sentAt: row?.sentAt })
}

console.log('\n── a quote that could NOT be delivered is not marked sent ──')
{
  const q = await mkQuote(cust.id, 'T30 quote that fails')
  failNext = true
  const r = await call('POST', `/api/quotes/${q.id}/send`)
  failNext = false
  check('the failure is reported, not swallowed', r.status === 502, { status: r.status, error: r.json?.error })
  check('…with the provider reason the owner can act on', /Mailbox unavailable/.test(String(r.json?.error)), r.json?.error)
  const [row] = await db.select().from(quote).where(eq(quote.id, q.id))
  check('…and the quote is still a draft, not lying in the list', row?.status === 'draft' && !row?.sentAt, { status: row?.status, sentAt: row?.sentAt })
}

console.log('\n── a customer with no email is refused before anything changes ──')
{
  const q = await mkQuote(noEmail.id, 'T30 quote no email')
  const r = await call('POST', `/api/quotes/${q.id}/send`)
  check('the send is refused', r.status === 400, { status: r.status, error: r.json?.error })
  check('…saying what to fix', /email/i.test(String(r.json?.error)), r.json?.error)
  const [row] = await db.select().from(quote).where(eq(quote.id, q.id))
  check('…and the quote stays a draft', row?.status === 'draft', { status: row?.status })
}

console.log(`\nfs-t30-quote-send: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
