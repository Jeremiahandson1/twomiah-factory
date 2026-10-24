// T69 — "Landscaping: contact records show Stripe customer IDs to the viewer, and one contact also exposes the
// connected Stripe account ID (acct_…). Staff probably gets them too."
//
// payments/stripe.ts keeps the customer it created in contact.customFields — stripeCustomerId, and the connected
// account it lives on as stripeCustomerAccount. Every door that hands a contact out carried them, for EVERY seat.
// Asserted on the raw response text, through the real routers, for owner / manager / staff / viewer:
//   · the contacts list and detail
//   · the job detail (it stripped the portal token by hand and kept the rest)
//   · quote, invoice, recurring-invoice (raw SQL to_jsonb of the whole contact) and agreement details and lists
// …and the ids are still in the database afterwards — the payments module needs them to find the customer again —
// while the shop's own custom fields still reach the screen.
//
// Also: the Agreements "Open" chevron (T69) opens the agreement — the edit form for agreements:update holders, a
// record (disabled fieldset, Close only, no prices) for everyone else. Pinned on the shared page's source.
import { Hono } from 'hono'
import { readFileSync } from 'node:fs'
import { eq } from 'drizzle-orm'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}

const { setupSchema } = await import('./setup.ts')
await setupSchema()
const { db } = await import('./db/index.ts')
const { company, user, contact, job, quote, invoice, recurringInvoice, serviceAgreement, agreementPlan } = await import('./db/schema.ts') as any

const [co] = await db.insert(company).values({
  name: 'Verge Payments', slug: 'verge-t69', email: 'v69@test.local', settings: {},
  enabledFeatures: ['contacts', 'jobs', 'quotes', 'invoices', 'recurring_invoices', 'service_agreements', 'agreements'],
} as any).returning()
const mk = async (role: string, tag: string) => (await db.insert(user).values({ email: `${tag}@v69.local`, passwordHash: 'x', firstName: tag, lastName: 'U', role, companyId: co.id, isActive: true } as any).returning())[0]
const seats = [[await mk('owner', 'owner'), 'owner'], [await mk('manager', 'manager'), 'manager'], [await mk('field', 'staff'), 'staff'], [await mk('viewer', 'viewer'), 'viewer']] as const

// ids nothing else in a payload can produce
const CUS = 'cus_T69leakQx7', ACCT = 'acct_T69leakZq4'
const [client] = await db.insert(contact).values({
  companyId: co.id, name: 'Hollis Ward', email: 'hollis-t69@test.local', portalEnabled: true, portalToken: 'tok-t69-secret',
  customFields: { stripeCustomerId: CUS, stripeCustomerAccount: ACCT, gateCode: '4471' },
} as any).returning()
const [onlyCus] = await db.insert(contact).values({
  companyId: co.id, name: 'Ines Park', email: 'ines-t69@test.local', customFields: { stripeCustomerId: CUS + 'b' },
} as any).returning()
// Assigned to the staff seat: a landscaping crew login reads only its own jobs and the customers on them (unified,
// Jobber's rule, 2026-10-24), so the staff seat's reads here are of its own work — still the payloads this file checks.
const [jb] = await db.insert(job).values({ number: 'JOB-T69-1', title: 'Spring cleanup', status: 'scheduled', contactId: client.id, companyId: co.id, assignedToId: seats[2][0].id } as any).returning()
await db.insert(job).values({ number: 'JOB-T69-2', title: 'Edging', status: 'scheduled', contactId: onlyCus.id, companyId: co.id, assignedToId: seats[2][0].id } as any)
const [qt] = await db.insert(quote).values({ number: 'Q-T69-1', name: 'Mulch', status: 'draft', contactId: client.id, total: '400.00', subtotal: '400.00', companyId: co.id } as any).returning()
const [inv] = await db.insert(invoice).values({ number: 'INV-T69-1', status: 'sent', contactId: client.id, total: '400.00', subtotal: '400.00', companyId: co.id } as any).returning()
const [ri] = await db.insert(recurringInvoice).values({ companyId: co.id, contactId: client.id, frequency: 'monthly', startDate: new Date('2026-10-01T00:00:00Z'), nextRunDate: new Date('2026-11-01T00:00:00Z') } as any).returning()
const [plan] = await db.insert(agreementPlan).values({ companyId: co.id, name: 'Lawn care', price: '55', visitsIncluded: 4 } as any).returning()
const [ag] = await db.insert(serviceAgreement).values({ companyId: co.id, contactId: client.id, planId: plan.id, number: 'AGR-T69-1', name: 'Lawn care', startDate: new Date('2026-10-01T00:00:00Z'), amount: '55' } as any).returning()

const app = new Hono()
app.route('/api/contacts', (await import('./src/routes/contacts.ts')).default)
app.route('/api/jobs', (await import('./src/routes/jobs.ts')).default)
app.route('/api/quotes', (await import('./src/routes/quotes.ts')).default)
app.route('/api/invoices', (await import('./src/routes/invoices.ts')).default)
app.route('/api/recurring', (await import('./src/routes/recurring.ts')).default)
app.route('/api/agreements', (await import('./src/routes/agreements.ts')).default)
app.onError((await import('./src/utils/errors.ts')).errorHandler)
const as = (who: any) => async (path: string) => {
  const res = await app.request(path, { headers: { 'x-test-user': who.id } })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j, text: t }
}

const doors: [string, string][] = [
  ['contacts list', '/api/contacts'],
  ['contact detail', `/api/contacts/${client.id}`],
  ['contact detail (customer id only)', `/api/contacts/${onlyCus.id}`],
  ['job detail', `/api/jobs/${jb.id}`],
  ['jobs list', '/api/jobs'],
  ['quote detail', `/api/quotes/${qt.id}`],
  ['quotes list', '/api/quotes'],
  ['invoice detail', `/api/invoices/${inv.id}`],
  ['invoices list', '/api/invoices'],
  ['recurring list', '/api/recurring'],
  ['recurring detail', `/api/recurring/${ri.id}`],
  ['agreements list', '/api/agreements'],
  ['agreement detail', `/api/agreements/${ag.id}`],
]
for (const [who, label] of seats) {
  let answered = 0
  for (const [door, path] of doors) {
    const r = await as(who)(path)
    if (r.status === 403) continue // the seat cannot open that door at all — nothing to leak through it
    answered++
    check(`${label}: ${door} answers (${r.status})`, r.status === 200, r.text.slice(0, 200))
    check(`${label}: ${door} carries no Stripe customer id, no connected account, no portal token`,
      !/cus_T69leak|acct_T69leak|stripeCustomer|tok-t69-secret/.test(r.text), r.text.match(/.{60}(?:cus_T69|acct_T69|stripeCustomer|tok-t69).{40}/)?.[0])
  }
  // the viewer is the seat T69 named: it must actually have reached the contact, or the check above proves nothing
  check(`${label}: reached at least the contact doors (${answered} answered)`, answered >= 3, answered)
  const d = await as(who)(`/api/contacts/${client.id}`)
  if (d.status === 200) check(`${label}: the shop's own custom field still reaches the screen`, d.json?.customFields?.gateCode === '4471', d.json?.customFields)
}

// the strip is on the way OUT: the payments module still finds its customer next time
const [still] = await db.select({ customFields: contact.customFields }).from(contact).where(eq(contact.id, client.id))
check('the database still holds both ids for payments/stripe.ts', (still as any).customFields?.stripeCustomerId === CUS && (still as any).customFields?.stripeCustomerAccount === ACCT, still)

// ── the Agreements "Open" chevron ──
const ROOT = (() => { const r = process.env.FACTORY_ROOT; if (!r) throw new Error('FACTORY_ROOT is not set'); return r.endsWith('/') ? r : r + '/' })()
const page = readFileSync(ROOT + 'packages/tenant-ui/src/agreements/AgreementsPage.tsx', 'utf8').replace(/\r\n/g, '\n')
check('the row\'s Open opens the agreement modal (it only set the selection)', /onView=\{\(\) => \{ setSelectedAgreement\(agreement\); setShowAgreementForm\(true\); \}\}/.test(page))
const modal = page.slice(page.indexOf('function AgreementFormModal('))
check('…read-only without agreements:update: every field in a disabled fieldset', /const readOnly = !!agreement && !mayUpdate/.test(modal) && /<fieldset disabled=\{readOnly\}/.test(modal))
check('…Close only — no Save for a seat the PUT would refuse', /\{!readOnly && \(\s*<button type="submit"/.test(modal) && /\{readOnly \? 'Close' : 'Cancel'\}/.test(modal))
check('…an existing agreement saves as "Save Changes", not "Create Agreement"', /agreement \? 'Save Changes' : 'Create Agreement'/.test(modal))
check('…plan prices only with invoices:read, as in the table', /maySeeMoney && p\.price != null/.test(modal))

console.log(`\nt69 payment ids: ${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
