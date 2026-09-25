// Field Service T28 M4 — the evening date problem, on both documents this time.
//
// Salon T27 H1 fixed invoices by asking the business what day it is. Only crm-salon ever answered, and
// only for invoices: nine verticals still stamped an invoice raised after 19:00 Central with tomorrow's
// date, and EVERY vertical's quote expiry was a day late the same evening. The customer sees the
// disagreement — the portal printed "Valid until 10/25" while the invoice form said 10/24.
//
// The clock is pinned rather than waited for: the defect only shows between 19:00 and midnight local, so
// a run at any other hour cannot tell the UTC day from the business day. Nothing is stubbed except what
// time it is — the real routes, the real shared invoicing and the real date helpers all run.
import { Hono } from 'hono'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user, contact } from './db/schema.ts'
import { errorHandler } from './src/utils/errors.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => { if (ok) { passed++; console.log(`  ok   ${name}`) } else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) } }

const TZ = 'America/Chicago'
const TERMS = 30, VALIDITY = 14
const dayIn = (d: Date, tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)

await setupSchema()

// ── the clock: tomorrow 01:30 UTC = 20:30 TODAY in Chicago ──────────────────────────────────────
const RealDate = Date
const frozen = new RealDate(RealDate.UTC(
  new RealDate().getUTCFullYear(), new RealDate().getUTCMonth(), new RealDate().getUTCDate() + 1, 1, 30, 0,
))
const utcDay = frozen.toISOString().slice(0, 10)
const shopDay = dayIn(frozen, TZ)
console.log(`\nfrozen at ${frozen.toISOString()}  ·  UTC day ${utcDay}  ·  ${TZ} day ${shopDay}`)
if (utcDay === shopDay) { console.log('FAIL the two days are the same — this test cannot discriminate'); process.exit(1) }

class FrozenDate extends RealDate {
  constructor(...args: any[]) {
    // @ts-expect-error — forwarding the real constructor's overloads
    if (args.length === 0) super(frozen.getTime()); else super(...args)
  }
  static now() { return frozen.getTime() }
}
;(globalThis as any).Date = FrozenDate

const plusDays = (isoDay: string, n: number) => {
  const d = new RealDate(`${isoDay}T00:00:00.000Z`)
  return new RealDate(d.getTime() + n * 86400000).toISOString().slice(0, 10)
}

const app = new Hono()
app.route('/api/invoices', (await import('./src/routes/invoices.ts')).default)
app.route('/api/quotes', (await import('./src/routes/quotes.ts')).default)
app.onError(errorHandler)

const [co] = await db.insert(company).values({
  name: 'Evening Wrench', slug: 'evening-fs', email: 'evening-fs@t.local',
  settings: { timezone: TZ, paymentTermsDays: TERMS, quoteValidityDays: VALIDITY },
  enabledFeatures: ['invoices', 'quotes', 'contacts', 'jobs'],
} as any).returning()
const [owner] = await db.insert(user).values({ email: 'owner-evening-fs@t.local', passwordHash: 'x', firstName: 'Ada', lastName: 'Owner', role: 'owner', companyId: co.id } as any).returning()
const [cust] = await db.insert(contact).values({ companyId: co.id, type: 'client', name: 'Evening Customer', email: 'evening-cust@t.local' } as any).returning()

const call = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, { method, headers: { 'content-type': 'application/json', 'x-test-user': owner.id, 'x-test-company': co.id, 'x-test-role': 'owner' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}
const day = (v: unknown) => String(v || '').slice(0, 10)

// ── the invoice ─────────────────────────────────────────────────────────────────────────────────
console.log('\n── an invoice raised at 8:30 PM Central is dated TODAY, not tomorrow ──')
let invoiceDue = ''
{
  const r = await call('POST', '/api/invoices', { contactId: cust.id, lineItems: [{ description: 'Callout', quantity: 1, unitPrice: 120 }] })
  check('the invoice is created', r.status === 200 || r.status === 201, r)
  const inv = r.json?.data ?? r.json
  check(`issue date is the shop's day (${shopDay}), not the UTC day (${utcDay})`, day(inv?.issueDate) === shopDay, { issueDate: day(inv?.issueDate), shopDay, utcDay })
  invoiceDue = day(inv?.dueDate)
  check(`…and it falls due ${TERMS} days after the shop's today`, invoiceDue === plusDays(shopDay, TERMS), { dueDate: invoiceDue, want: plusDays(shopDay, TERMS) })
}

// ── the quote ───────────────────────────────────────────────────────────────────────────────────
console.log('\n── and a quote raised the same minute expires on the same calendar ──')
let quoteExpiry = ''
{
  const r = await call('POST', '/api/quotes', { contactId: cust.id, name: 'T28 evening quote', lineItems: [{ description: 'Callout', quantity: 1, unitPrice: 120 }] })
  check('the quote is created', r.status === 200 || r.status === 201, r)
  const q = r.json?.data ?? r.json
  quoteExpiry = day(q?.expiryDate)
  check(`expiry is ${VALIDITY} days after the shop's today, not the server's`, quoteExpiry === plusDays(shopDay, VALIDITY), { expiryDate: quoteExpiry, want: plusDays(shopDay, VALIDITY), utcWouldGive: plusDays(utcDay, VALIDITY) })
}

// ── the two documents agree ─────────────────────────────────────────────────────────────────────
// This is what the customer actually saw: the portal printing one day and the invoice form another,
// for two documents raised in the same minute.
console.log('\n── the two documents raised in the same minute agree about what day it is ──')
{
  const invoiceToday = plusDays(invoiceDue, -TERMS)
  const quoteToday = plusDays(quoteExpiry, -VALIDITY)
  check('the invoice and the quote were raised on the same day', invoiceToday === quoteToday, { invoiceToday, quoteToday })
  check('…and that day is the shop\'s', invoiceToday === shopDay, { invoiceToday, shopDay })
}

// ── an explicit date is still exactly what was typed ────────────────────────────────────────────
console.log('\n── a date the user typed is never rewritten ──')
{
  const typed = plusDays(shopDay, 5)
  const r = await call('POST', '/api/invoices', { contactId: cust.id, dueDate: typed, issueDate: shopDay, lineItems: [{ description: 'Callout', quantity: 1, unitPrice: 50 }] })
  const inv = r.json?.data ?? r.json
  check('the typed due date survives', day(inv?.dueDate) === typed, { got: day(inv?.dueDate), want: typed })
  const q = await call('POST', '/api/quotes', { contactId: cust.id, name: 'T28 typed expiry', expiryDate: typed, lineItems: [{ description: 'Callout', quantity: 1, unitPrice: 50 }] })
  const qq = q.json?.data ?? q.json
  check('the typed expiry survives', day(qq?.expiryDate) === typed, { got: day(qq?.expiryDate), want: typed })
}

console.log(`\nfs-t28-dates: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
