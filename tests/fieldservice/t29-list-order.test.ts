// Field Service L4 — what the Service Calls list opens on.
//
// Three attempts, each defensible on its own and each wrong:
//   ascending         opened on JOB-00001, the oldest finished work           (T28 L4)
//   descending        opened on UNSCHEDULED calls — Postgres sorts NULLs first on DESC
//   descending dated  opened on calls booked in 2027, still not today's work  (T29)
//
// "Newest" was never the goal; NEXT was. Every one of those orders can be argued for in the abstract,
// which is why this is pinned by behaviour: today leads, the future follows in order, the past comes
// back most-recent-first, and undated work trails.
import { Hono } from 'hono'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user, contact, job } from './db/schema.ts'
import { errorHandler } from './src/utils/errors.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => { if (ok) { passed++; console.log(`  ok   ${name}`) } else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) } }

await setupSchema()

const [co] = await db.insert(company).values({ name: 'T29 Order', slug: 't29order', email: 't29order@test.local', settings: { timezone: 'UTC' }, enabledFeatures: ['jobs', 'contacts'] } as any).returning()
const [owner] = await db.insert(user).values({ email: 'owner-t29order@test.local', passwordHash: 'x', firstName: 'Ada', lastName: 'Owner', role: 'owner', companyId: co.id } as any).returning()
const [cust] = await db.insert(contact).values({ type: 'client', name: 'T29 Customer', email: 'cust-t29order@test.local', companyId: co.id } as any).returning()

const app = new Hono()
app.route('/api/jobs', (await import('./src/routes/jobs.ts')).default)
app.onError(errorHandler)
const call = async (path: string) => {
  const res = await app.request(path, { headers: { 'content-type': 'application/json', 'x-test-user': owner.id, 'x-test-company': co.id, 'x-test-role': 'owner' } })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}

const dayOffset = (n: number) => {
  const d = new Date(); d.setUTCHours(0, 0, 0, 0)
  return new Date(d.getTime() + n * 86400000)
}
// Deliberately inserted out of order, so a pass cannot come from insertion order.
const PLAN: Array<[string, number | null]> = [
  ['FAR-FUTURE', 600],   // the 2027 test calls that broke attempt three
  ['LONG-AGO', -400],
  ['UNDATED', null],
  ['TOMORROW', 1],
  ['YESTERDAY', -1],
  ['TODAY', 0],
  ['NEXT-WEEK', 7],
]
let n = 0
for (const [tag, off] of PLAN) {
  await db.insert(job).values({
    number: `JOB-T29O-${++n}`, title: tag, status: 'scheduled', contactId: cust.id, companyId: co.id,
    scheduledDate: off === null ? null : dayOffset(off),
  } as any)
}

const res = await call('/api/jobs?limit=50')
check('the list answers', res.status === 200, res)
const titles: string[] = (res.json?.data || []).map((j: any) => j.title)
console.log('  order: ' + titles.join(' → '))

const at = (t: string) => titles.indexOf(t)

console.log('\n── today leads, and the future reads forward ──')
check('TODAY is first', titles[0] === 'TODAY', { got: titles[0] })
check('…then TOMORROW', at('TOMORROW') === 1, { titles })
check('…then NEXT-WEEK', at('NEXT-WEEK') === 2, { titles })
check('…then the far-future call, last of the upcoming', at('FAR-FUTURE') === 3, { titles })

console.log('\n── then the past, most recent first ──')
check('YESTERDAY comes after every upcoming call', at('YESTERDAY') > at('FAR-FUTURE'), { titles })
check('…and before the one from over a year ago', at('YESTERDAY') < at('LONG-AGO'), { titles })

console.log('\n── and undated work trails ──')
check('UNDATED is last', titles[titles.length - 1] === 'UNDATED', { got: titles[titles.length - 1], titles })

console.log('\n── a requested date range still reads forwards, unchanged ──')
{
  const from = dayOffset(-2).toISOString(), to = dayOffset(8).toISOString()
  const r = await call(`/api/jobs?startDate=${from}&endDate=${to}&limit=50`)
  const t2: string[] = (r.json?.data || []).map((j: any) => j.title)
  check('the week view is ascending', t2.join(',') === ['YESTERDAY', 'TODAY', 'TOMORROW', 'NEXT-WEEK'].join(','), { got: t2 })
}

console.log(`\nfs-t29-list-order: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
