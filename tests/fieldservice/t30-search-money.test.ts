// Field Service T30 HIGH, second half — "The search box also returns invoices with amounts."
//
// /api/invoices refuses a technician 403 (field has no invoices:read) and the Invoices page is correctly
// locked. Search was not: routes/search.ts asked only whether the MODULE was switched on for the tenant,
// which is a question about the company, and never whether this PERSON may read that kind of record. So a
// customer name typed into the search box came back with invoice rows carrying totals, and quote rows
// carrying totals, from behind a door the same user could not open.
//
// The test is per role AND per result type, because "staff sees no invoices" alone would pass on a fix
// that blinded the search box altogether. A technician has to keep finding the customer and the job —
// that is what they search for all day. The over-correction is the failure mode here.
import { Hono } from 'hono'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user, contact, job, quote, invoice, document, teamMember } from './db/schema.ts'
import { errorHandler } from './src/utils/errors.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => { if (ok) { passed++; console.log(`  ok   ${name}`) } else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) } }

await setupSchema()

const [co] = await db.insert(company).values({
  name: 'T30 Search Co', slug: 't30search', email: 't30search@test.local', settings: {},
  enabledFeatures: ['contacts', 'jobs', 'quotes', 'invoices', 'documents', 'projects', 'team'],
} as any).returning()

const mkUser = async (role: string, tag: string) => (await db.insert(user).values({ email: `${tag}-t30search@test.local`, passwordHash: 'x', firstName: tag, lastName: 'User', role, companyId: co.id } as any).returning())[0]
const owner = await mkUser('owner', 'owner')
const manager = await mkUser('manager', 'manager')
const staff = await mkUser('user', 'staff')       // stored as `user`, normalised to `field`

// One token — ZELPH — planted in every family, so a single query reaches all of them and a missing type
// can only mean it was filtered, never that the search simply did not match.
const [cust] = await db.insert(contact).values({ type: 'client', name: 'Zelph Holdings', email: 'zelph@test.local', companyId: co.id } as any).returning()
await db.insert(job).values({ number: 'JOB-ZELPH-1', title: 'Zelph annual service', status: 'scheduled', contactId: cust.id, companyId: co.id } as any)
await db.insert(quote).values({ number: 'Q-ZELPH-1', name: 'Zelph replacement quote', status: 'draft', contactId: cust.id, total: '8400.00', subtotal: '8400.00', companyId: co.id } as any)
await db.insert(invoice).values({ number: 'INV-ZELPH-1', status: 'sent', contactId: cust.id, total: '4250.00', subtotal: '4250.00', companyId: co.id } as any)
await db.insert(document).values({ name: 'Zelph site plan', filename: 'zelph.pdf', originalName: 'zelph.pdf', path: '/tmp/zelph.pdf', url: '/files/zelph.pdf', companyId: co.id } as any)
await db.insert(teamMember).values({ name: 'Zelph Contractor', email: 'zelphteam@test.local', companyId: co.id } as any)

const app = new Hono()
app.route('/api/search', (await import('./src/routes/search.ts')).default)
app.onError(errorHandler)

const as = (who: any) => async (path: string) => {
  const res = await app.request(path, { headers: { 'x-test-user': who.id, 'x-test-company': co.id, 'x-test-role': who.role } })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}
const typesOf = (rows: any) => (Array.isArray(rows) ? rows : rows?.results || []).map((r: any) => r.type)

console.log('\n── STAFF: finds the work, never the money ──')
{
  const call = as(staff)
  const r = await call('/api/search?q=ZELPH')
  check('search answers a technician at all', r.status === 200, { status: r.status, body: r.json })
  const t = typesOf(r.json)
  check('the customer is still findable', t.includes('contact'), { types: t })
  check('…and the service call is too', t.includes('job'), { types: t })
  check('NO invoice row — /api/invoices refuses this user 403', !t.includes('invoice'), { types: t })
  check('NO quote row — same reason', !t.includes('quote'), { types: t })
  check('the count matches the rows actually returned', r.json?.count === (r.json?.results || []).length, { count: r.json?.count, rows: (r.json?.results || []).length })
  const money = JSON.stringify(r.json?.results || [])
  check('and no total leaks in a description either', !money.includes('4,250') && !money.includes('8,400'), { body: money.slice(0, 200) })
}

console.log('\n── STAFF cannot ask for them by name either ──')
{
  const call = as(staff)
  const r = await call('/api/search?q=ZELPH&types=invoice,quote')
  check('?types= cannot be used to reach past the check', typesOf(r.json).length === 0, { types: typesOf(r.json) })
  const q = await call('/api/search/quick?q=ZELPH')
  check('quick search is filtered the same way', !typesOf(q.json).includes('invoice') && !typesOf(q.json).includes('quote'), { types: typesOf(q.json) })
  check('…and still returns the contact', typesOf(q.json).includes('contact'), { types: typesOf(q.json) })
  const team = await call('/api/search?q=ZELPH&types=team')
  check('team search is refused too — field has no team:read', typesOf(team.json).length === 0, { types: typesOf(team.json) })
}

console.log('\n── MANAGER: money is part of the job ──')
{
  const call = as(manager)
  const r = await call('/api/search?q=ZELPH')
  const t = typesOf(r.json)
  check('a manager sees invoices (invoices:read)', t.includes('invoice'), { types: t })
  check('…and quotes', t.includes('quote'), { types: t })
  check('…and the work', t.includes('job') && t.includes('contact'), { types: t })
}

console.log('\n── OWNER: unchanged ──')
{
  const call = as(owner)
  const r = await call('/api/search?q=ZELPH')
  const t = typesOf(r.json)
  check('an owner still sees every family', ['contact', 'job', 'quote', 'invoice', 'document'].every((x) => t.includes(x)), { types: t })
  const team = await call('/api/search?q=ZELPH&types=team')
  check('…including the team, which staff were refused', typesOf(team.json).includes('team'), { types: typesOf(team.json) })
}

console.log('\n── Recent, the empty-search panel ──')
{
  const r = await as(staff)('/api/search/recent')
  const t = typesOf(r.json)
  check('Recent answers a technician', r.status === 200, { status: r.status })
  check('…with the contact and the job they need', t.includes('contact') && t.includes('job'), { types: t })
  check('…and nothing they may not open', !t.includes('invoice') && !t.includes('quote'), { types: t })
}

console.log(`\nfs-t30-search-money: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
