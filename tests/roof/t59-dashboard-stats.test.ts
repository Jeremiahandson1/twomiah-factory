// Roofing's home figures. (T59) The mobile roofing dashboard asked GET /api/dashboard/stats and crm-roof
// had no such route: a 404, and no cards. This checks the new route counts what a roofing job has —
// inspections and installs on the company's day, the open pipeline, pending quotes, the balance owed —
// and drops the money and the lead count for a caller who may not see them.
import { Hono } from 'hono'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 400)) }
}

const { setupSchema } = await import('./setup.ts')
await setupSchema()
const { db } = await import('./db/index.ts')
const { company, user, contact, job, quote, invoice, lead } = await import('./db/schema.ts')

const [co] = await db.insert(company).values({ name: 'Roof Stats Co', slug: 'roofstats-t59', email: 'rs59@test.local', state: 'WI', settings: {}, enabledFeatures: ['lead_inbox'] } as any).returning()
const [owner] = await db.insert(user).values({ email: 'owner-rs59@test.local', passwordHash: 'x', firstName: 'O', lastName: 'R', role: 'owner', companyId: co.id, isActive: true } as any).returning()
const [crew] = await db.insert(user).values({ email: 'crew-rs59@test.local', passwordHash: 'x', firstName: 'C', lastName: 'R', role: 'field', companyId: co.id, isActive: true } as any).returning()
const [ct] = await db.insert(contact).values({ firstName: 'Hank', lastName: 'Homeowner', companyId: co.id } as any).returning()

const base = { companyId: co.id, contactId: ct.id, jobType: 'replacement', propertyAddress: '1 Shingle Ln', city: 'Madison', state: 'WI', zip: '53703', source: 'storm' }
const now = new Date(), lastWeek = new Date(Date.now() - 7 * 864e5)
await db.insert(job).values([
  { ...base, jobNumber: 'R-1', status: 'inspection_scheduled', inspectionDate: now },
  { ...base, jobNumber: 'R-2', status: 'in_production', installDate: now },
  { ...base, jobNumber: 'R-3', status: 'proposal_sent', inspectionDate: lastWeek },
  { ...base, jobNumber: 'R-4', status: 'collected', installDate: lastWeek },
] as any)
const [j1] = await db.select().from(job).limit(1)
const money = { lineItems: [], subtotal: '1000', taxRate: '0', taxAmount: '0', total: '1000' }
await db.insert(quote).values([
  { ...money, companyId: co.id, contactId: ct.id, quoteNumber: 'Q-1', status: 'draft', expiresAt: now },
  { ...money, companyId: co.id, contactId: ct.id, quoteNumber: 'Q-2', status: 'sent', expiresAt: now },
  { ...money, companyId: co.id, contactId: ct.id, quoteNumber: 'Q-3', status: 'approved', expiresAt: now },
] as any)
await db.insert(invoice).values([
  { ...money, companyId: co.id, contactId: ct.id, jobId: j1.id, invoiceNumber: 'I-1', status: 'sent', balance: '1000' },
  { ...money, companyId: co.id, contactId: ct.id, jobId: j1.id, invoiceNumber: 'I-2', status: 'partial', amountPaid: '400', balance: '600' },
  { ...money, companyId: co.id, contactId: ct.id, jobId: j1.id, invoiceNumber: 'I-3', status: 'paid', amountPaid: '1000', balance: '0' },
  { ...money, companyId: co.id, contactId: ct.id, jobId: j1.id, invoiceNumber: 'I-4', status: 'draft', balance: '1000' },
] as any)
await db.insert(lead).values({ sourcePlatform: 'phone', homeownerName: 'Unknown Caller', status: 'new', companyId: co.id } as any)

const app = new Hono()
app.route('/api/dashboard', (await import('./src/routes/dashboard.ts')).default)
app.onError((err: any, c: any) => c.json({ error: err?.message || 'Internal error' }, err?.status || 500))
const stats = async (who: any) => {
  const res = await app.request('/api/dashboard/stats', { headers: { 'x-test-user': who.id, 'x-test-company': co.id, 'x-test-role': who.role } })
  return { status: res.status, json: await res.json().catch(() => null) as any }
}

console.log('\n══════════ the owner ══════════')
{
  const s = await stats(owner)
  check('the route exists and answers (it was a 404)', s.status === 200, s)
  check('inspections today: 1 (the one last week does not count)', s.json?.jobs?.inspectionsToday === 1, s.json?.jobs)
  check('installs today: 1', s.json?.jobs?.installsToday === 1, s.json?.jobs)
  check('open pipeline: 3 (collected is closed)', s.json?.jobs?.open === 3, s.json?.jobs)
  check('in production: 1', s.json?.jobs?.inProduction === 1, s.json?.jobs)
  check('pending quotes: draft + sent = 2', s.json?.quotes?.pending === 2, s.json?.quotes)
  check('outstanding: the balance still owed on issued invoices, $1,600 (paid and draft excluded)', s.json?.invoices?.outstandingValue === 1600 && s.json?.invoices?.outstanding === 2, s.json?.invoices)
  check('new leads: the inbox at new', s.json?.newLeads === 1, { newLeads: s.json?.newLeads })
}

console.log('\n══════════ a crew member ══════════')
{
  const s = await stats(crew)
  check('the crew sees the work', s.status === 200 && s.json?.jobs?.open === 3, s)
  check('…but not the money: the key is ABSENT, not $0', s.json && !('invoices' in s.json), { keys: Object.keys(s.json || {}) })
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
