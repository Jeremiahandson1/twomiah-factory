// ADAPTED COPY of tests/roof/t59-dashboard-stats.test.ts, for the unified app (tests/unified/harness/adapted.ts). Unchanged except the
// 14 read(s) marked "unified:", where the rulebook's reply shapes replaced the template's. The original keeps
// running against the template; tests/unified/harness/unified-divergences.ts names the assertions this copy stands in for.
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
const [ct] = await db.insert(contact).values({ name: 'Hank Homeowner', companyId: co.id } /* unified: a contact has one name (plan decision 3) */ as any).returning()

const base = { companyId: co.id, contactId: ct.id, jobType: 'replacement', address: '1 Shingle Ln', title: '1 Shingle Ln', /* unified: a roofing job is the CRM's job: job_number → number, property_address → address, and the address is its title (plan decision 2) */ city: 'Madison', state: 'WI', zip: '53703', source: 'storm' }
const now = new Date(), lastWeek = new Date(Date.now() - 7 * 864e5)
await db.insert(job).values([
  { ...base, number: 'R-1', /* unified: a roofing job is the CRM's job: job_number → number, property_address → address, and the address is its title (plan decision 2) */ status: 'inspection_scheduled', inspectionDate: now },
  { ...base, number: 'R-2', /* unified: a roofing job is the CRM's job: job_number → number, property_address → address, and the address is its title (plan decision 2) */ status: 'in_production', installDate: now },
  { ...base, number: 'R-3', /* unified: a roofing job is the CRM's job: job_number → number, property_address → address, and the address is its title (plan decision 2) */ status: 'proposal_sent', inspectionDate: lastWeek },
  { ...base, number: 'R-4', /* unified: a roofing job is the CRM's job: job_number → number, property_address → address, and the address is its title (plan decision 2) */ status: 'collected', installDate: lastWeek },
] as any)
const [j1] = await db.select().from(job).limit(1)
const money = { subtotal: '1000', /* unified: a quote's and an invoice's lines are the CRM's line-item tables (plan decision 4) */ taxRate: '0', taxAmount: '0', total: '1000' }
await db.insert(quote).values([
  { ...money, companyId: co.id, contactId: ct.id, number: 'Q-1', name: 'Roof', status: 'draft', expiryDate: now } /* unified: a quote is the CRM's: number, a name, expiry_date (plan decision 4) */,
  { ...money, companyId: co.id, contactId: ct.id, number: 'Q-2', name: 'Roof', status: 'sent', expiryDate: now } /* unified: a quote is the CRM's (plan decision 4) */,
  { ...money, companyId: co.id, contactId: ct.id, number: 'Q-3', name: 'Roof', status: 'approved', expiryDate: now } /* unified: a quote is the CRM's (plan decision 4) */,
] as any)
await db.insert(invoice).values([
  { ...money, companyId: co.id, contactId: ct.id, jobId: j1.id, number: 'I-1', status: 'sent' } /* unified: an invoice is the CRM's: number; its balance follows from total and paid (plan decision 4) */,
  { ...money, companyId: co.id, contactId: ct.id, jobId: j1.id, number: 'I-2', status: 'partial', amountPaid: '400' } /* unified: an invoice is the CRM's (plan decision 4) */,
  { ...money, companyId: co.id, contactId: ct.id, jobId: j1.id, number: 'I-3', status: 'paid', amountPaid: '1000' } /* unified: an invoice is the CRM's (plan decision 4) */,
  { ...money, companyId: co.id, contactId: ct.id, jobId: j1.id, number: 'I-4', status: 'draft' } /* unified: an invoice is the CRM's (plan decision 4) */,
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
