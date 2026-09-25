// Field Service T26 — the four findings whose live counts cannot tell you whether the code is fixed.
//
// M2, L1, L2 and L12 all reproduce on the tenant as row COUNTS: 8 jobs pointing at a deleted member, 25
// invoices with a null due date, 39 quotes with no expiry, 19.5 billable hours worth nothing. Every one of
// those counts rows written BEFORE the fix, so redeploying changes none of them and the numbers look
// frozen whether the code works or not. Behaviour is the only thing worth asserting, and behaviour needs
// a write — which is what this sandbox is for, rather than writing to a tenant a human is testing.
//
// Real Postgres (PGlite), the real route files, the real permission layer.
import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user, contact, job, quote, invoice, timeEntry, teamMember } from './db/schema.ts'
import { errorHandler } from './src/utils/errors.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => { if (ok) { passed++; console.log(`  ok   ${name}`) } else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) } }

await setupSchema()

// 14-day quote validity and 45-day payment terms: both deliberately NOT the 30-day defaults, so a test
// that passes because the fallback happens to match the default cannot happen.
const [co] = await db.insert(company).values({
  name: 'T26 Wrench', slug: 't26fs', email: 't26fs@test.local',
  settings: { timezone: 'UTC', quoteValidityDays: 14, paymentTermsDays: 45 },
  enabledFeatures: ['jobs', 'team', 'contacts', 'quotes', 'invoices', 'time_tracking'],
} as any).returning()
const [owner] = await db.insert(user).values({ email: 'owner-t26fs@test.local', passwordHash: 'x', firstName: 'Ada', lastName: 'Owner', role: 'owner', companyId: co.id } as any).returning()
const [cust] = await db.insert(contact).values({ type: 'client', name: 'T26 Customer', email: 'cust-t26fs@test.local', companyId: co.id } as any).returning()

const app = new Hono()
app.route('/api/team', (await import('./src/routes/team.ts')).default)
app.route('/api/quotes', (await import('./src/routes/quotes.ts')).default)
app.route('/api/invoices', (await import('./src/routes/invoices.ts')).default)
app.route('/api/time', (await import('./src/routes/time.ts')).default)
app.onError(errorHandler)

const H = { 'x-test-user': owner.id, 'x-test-company': co.id, 'x-test-role': 'owner', 'content-type': 'application/json' }
const call = async (method: string, path: string, body?: any) => {
  const res = await app.request(path, { method, headers: H, ...(body ? { body: JSON.stringify(body) } : {}) })
  const text = await res.text(); let json: any = text; try { json = JSON.parse(text) } catch {}
  return { status: res.status, json }
}
const dayUTC = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString().slice(0, 10)
const inDays = (n: number) => dayUTC(new Date(Date.now() + n * 86400000))

// ── L2: a quote with no expiry gets the company's validity, not null ────────────────────────────
console.log('\n── L2: a blank expiry is "our usual validity", not "never expires" ──')
{
  const made = await call('POST', '/api/quotes', {
    contactId: cust.id, name: 'T26 L2 no expiry',
    lineItems: [{ description: 'Callout', quantity: 1, unitPrice: 100 }],
  })
  check('the quote is created', made.status === 200 || made.status === 201, made)
  const q = made.json?.data ?? made.json
  check('…and carries an expiry rather than null', !!q?.expiryDate, { expiryDate: q?.expiryDate })
  check('…taken from the company validity (14 days), not the 30-day default',
    String(q?.expiryDate || '').slice(0, 10) === inDays(14), { got: String(q?.expiryDate || '').slice(0, 10), want: inDays(14) })

  const explicit = await call('POST', '/api/quotes', {
    contactId: cust.id, name: 'T26 L2 explicit expiry', expiryDate: inDays(3),
    lineItems: [{ description: 'Callout', quantity: 1, unitPrice: 100 }],
  })
  const q2 = explicit.json?.data ?? explicit.json
  check('an expiry the user typed is still honoured', String(q2?.expiryDate || '').slice(0, 10) === inDays(3), { got: q2?.expiryDate })
}

// ── L1: an invoice with no due date falls back to the payment terms ─────────────────────────────
// The migration path (templates/crm-fieldservice/backend/src/services/migration.ts) now calls the same
// helper; this pins the contract that path was aligned to.
console.log('\n── L1: a blank due date is "our payment terms", not "never overdue" ──')
{
  const made = await call('POST', '/api/invoices', {
    contactId: cust.id,
    lineItems: [{ description: 'Repair', quantity: 1, unitPrice: 250 }],
  })
  check('the invoice is created', made.status === 200 || made.status === 201, made)
  const inv = made.json?.data ?? made.json
  check('…and carries a due date rather than null', !!inv?.dueDate, { dueDate: inv?.dueDate })
  check('…taken from the company terms (45 days), not the 30-day default',
    String(inv?.dueDate || '').slice(0, 10) === inDays(45), { got: String(inv?.dueDate || '').slice(0, 10), want: inDays(45) })
}

// ── L12: billable hours become money when the roster card carries a rate ────────────────────────
console.log('\n── L12: billable hours are worth something ──')
{
  const [tech] = await db.insert(user).values({ email: 'tech-t26fs@test.local', passwordHash: 'x', firstName: 'Tim', lastName: 'Tech', role: 'user', companyId: co.id } as any).returning()
  await db.insert(teamMember).values({ name: 'Tim Tech', email: 'tech-t26fs@test.local', role: 'field', active: true, hourlyRate: '50.00', companyId: co.id } as any)
  await db.insert(timeEntry).values({ companyId: co.id, userId: tech.id, date: new Date('2026-09-22T00:00:00.000Z'), hours: '4.00', billable: true, description: 'T26 L12 billable' } as any)

  const sum = await call('GET', '/api/time/summary')
  const s = sum.json?.data ?? sum.json
  check('the summary answers', sum.status === 200, sum)
  check('billable hours are counted', Number(s?.billableHours) === 4, { billableHours: s?.billableHours })
  check('…and are worth 4 × $50, not $0 — the rate comes off the roster card',
    Number(s?.billableAmount) === 200, { billableAmount: s?.billableAmount })
}

// ── M2: removing a roster member does not leave work pointing at them ───────────────────────────
console.log('\n── M2: deleting a member really does unassign their work ──')
{
  const HOLDS_WORK = !!(job as any).assignedToMemberId
  check('field service jobs can be held by roster crew', HOLDS_WORK, { assignedToMemberId: HOLDS_WORK })
  const [m] = await db.insert(teamMember).values({ name: 'T26 Leaver', role: 'field', active: true, companyId: co.id } as any).returning()
  await db.insert(job).values({ number: 'JOB-T26M2-1', title: 'Held work', status: 'scheduled', contactId: cust.id, companyId: co.id, assignedToMemberId: m.id, scheduledDate: new Date('2026-09-24T00:00:00.000Z') } as any)

  const gone = await call('DELETE', `/api/team/${m.id}`)
  check('the member is removed', gone.status === 200, gone)
  check('…and the reply says how much work it left unassigned', gone.json?.unassignedJobs === 1, gone.json)
  const orphans = await db.select().from(job).where(eq((job as any).assignedToMemberId, m.id))
  check('…and no job still points at the deleted member — the number described something that happened',
    orphans.length === 0, { stillPointing: orphans.length })
  const [still] = await db.select().from(job).where(eq(job.number, 'JOB-T26M2-1'))
  check('…while the job itself survives, unassigned', !!still, { job: still?.number })
}

console.log(`\nfs-t26: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
