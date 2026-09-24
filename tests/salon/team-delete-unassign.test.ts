// Contractor T26 L2 — deleting a roster member silently unassigned their jobs: the column is ON DELETE SET
// NULL, so JOB-00053 came back with assignedToId null and nothing was said before or after. Real Postgres
// (PGlite), the real team route.
import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user, contact, job, teamMember } from './db/schema.ts'
import { errorHandler } from './src/utils/errors.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => { if (ok) { passed++; console.log(`  ok   ${name}`) } else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) } }

await setupSchema()
const [co] = await db.insert(company).values({ name: 'T26 Team', slug: 't26team', email: 't26t@test.local', settings: {}, enabledFeatures: ['jobs', 'team', 'contacts'] } as any).returning()
const [owner] = await db.insert(user).values({ email: 't26t@test.local', passwordHash: 'x', firstName: 'Ada', lastName: 'Owner', role: 'owner', companyId: co.id } as any).returning()
const [cust] = await db.insert(contact).values({ type: 'client', name: 'T26 Customer', email: 'c26t@test.local', companyId: co.id } as any).returning()

const app = new Hono()
app.route('/api/team', (await import('./src/routes/team.ts')).default)
app.onError(errorHandler)
const H = { 'x-test-user': owner.id, 'x-test-company': co.id, 'x-test-role': 'owner', 'content-type': 'application/json' }
const call = async (method: string, path: string, body?: any) => {
  const res = await app.request(`/api/team${path}`, { method, headers: H, ...(body ? { body: JSON.stringify(body) } : {}) })
  const text = await res.text(); let json: any = text; try { json = JSON.parse(text) } catch {}
  return { status: res.status, json }
}
// Only contractor, field service and landscaping let roster crew hold work — the other four have no
// job.assigned_to_member_id at all. Where the column is absent the counts are always zero, and the point of
// running this there is that the roster page still loads rather than 500ing on a column that does not exist.
const HOLDS_WORK = !!(job as any).assignedToMemberId
let n = 0
const crewWithJobs = async (name: string, jobs: number) => {
  const [m] = await db.insert(teamMember).values({ name, role: 'field', active: true, companyId: co.id } as any).returning()
  for (let i = 0; HOLDS_WORK && i < jobs; i++) {
    await db.insert(job).values({ number: `JOB-T26L2-${++n}`, title: `${name} job ${i + 1}`, status: 'scheduled', contactId: cust.id, companyId: co.id, assignedToMemberId: m.id, scheduledDate: new Date('2026-09-24T00:00:00.000Z') } as any)
  }
  return m
}
const rowFor = (list: any, id: string) => (list?.json?.data || []).find((r: any) => r.id === id)

// ── the list says what each person is holding, so the warning can come BEFORE the click ─────────────────────────
{
  const busy = await crewWithJobs('T26 Busy Crew', 3)
  const idle = await crewWithJobs('T26 Idle Crew', 0)
  const list = await call('GET', '')
  check('the roster still lists its members', list.status === 200 && !!rowFor(list, busy.id), list.status)
  check('T26 L2: a member carries the work that would be left unassigned', rowFor(list, busy.id)?.assignedJobs === (HOLDS_WORK ? 3 : 0), rowFor(list, busy.id))
  check('…and someone holding nothing says zero, not nothing', rowFor(list, idle.id)?.assignedJobs === 0, rowFor(list, idle.id))
  const loginRow = (list.json?.data || []).find((r: any) => r._source === 'user')
  check('a login account is left alone — it is read-only on this page', loginRow === undefined || loginRow.assignedJobs === undefined, loginRow)
}

// ── the delete says what it did ─────────────────────────────────────────────────────────────────────────────────
{
  const leaving = await crewWithJobs('T26 Leaving', 2)
  const res = await call('DELETE', `/${leaving.id}`)
  check('the member is removed', res.status === 200, res)
  check('T26 L2: …and the response says how much work it left unassigned', res.json?.unassignedJobs === (HOLDS_WORK ? 2 : 0), res.json)
  const rows = HOLDS_WORK ? await db.select().from(job).where(eq(job.assignedToMemberId, leaving.id)) : []
  check('the jobs really are unassigned now', rows.length === 0, rows.length)
  const stillThere = await db.select().from(job).where(eq(job.companyId, co.id))
  check('…and the jobs themselves are still there, not deleted with the person', !HOLDS_WORK || stillThere.length > 0, stillThere.length)
}

// ── someone holding nothing reports nothing ─────────────────────────────────────────────────────────────────────
{
  const idle = await crewWithJobs('T26 Quiet Leaver', 0)
  const res = await call('DELETE', `/${idle.id}`)
  check('removing someone with no work says so plainly', res.status === 200 && res.json?.unassignedJobs === 0, res.json)
}

// ── the counts stay inside the company ──────────────────────────────────────────────────────────────────────────
{
  const [other] = await db.insert(company).values({ name: 'Other Co', slug: 'other26', email: 'o26@test.local', settings: {}, enabledFeatures: ['jobs', 'team'] } as any).returning()
  const [theirCrew] = await db.insert(teamMember).values({ name: 'Their Crew', active: true, companyId: other.id } as any).returning()
  if (HOLDS_WORK) await db.insert(job).values({ number: 'JOB-OTHER-L2', title: 'Theirs', status: 'scheduled', companyId: other.id, assignedToMemberId: theirCrew.id, scheduledDate: new Date('2026-09-24T00:00:00.000Z') } as any)
  const gone = await call('DELETE', `/${theirCrew.id}`)
  check("another company's member cannot be removed from here", gone.status === 404, gone.status)
  const theirs = HOLDS_WORK ? await db.select().from(job).where(eq(job.assignedToMemberId, theirCrew.id)) : [null]
  check('…and their work is untouched', theirs.length === 1, theirs.length)
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
