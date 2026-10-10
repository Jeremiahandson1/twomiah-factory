// T63 — owner (2026-10-09): "add my jobs, staff see all jobs". And what it uncovered: the roof screens spoke
// salesRepId / crewId to an API whose fields are assignedSalesRepId / assignedCrewId, so assigning a rep never saved,
// clearing one was impossible, and the Jobs filters returned every job. Asserted through the real router.
import { Hono } from 'hono'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}

const { setupSchema } = await import('./setup.ts')
await setupSchema()
const { db } = await import('./db/index.ts')
const { company, user, contact, job, crew } = await import('./db/schema.ts')

const [co] = await db.insert(company).values({ name: 'Ridge & Rake', slug: 'rake-t63', email: 'rake-t63@test.local', settings: {}, enabledFeatures: [] } as any).returning()
const mk = async (role: string, tag: string) => (await db.insert(user).values({ email: `${tag}@rake-t63.local`, passwordHash: 'x', firstName: tag, lastName: 'U', role, companyId: co.id, isActive: true } as any).returning())[0]
const owner = await mk('owner', 'owner'), rep = await mk('field', 'rep'), other = await mk('field', 'other')
const [home] = await db.insert(contact).values({ companyId: co.id, firstName: 'Lee', lastName: 'Marsh', email: 'lee-t63@test.local' } as any).returning()
const [squad] = await db.insert(crew).values({ companyId: co.id, name: 'Alpha Crew', foremanName: 'Dee', foremanPhone: '330-555-0163', size: 4 } as any).returning()
const mkJob = async (n: string) => (await db.insert(job).values({ companyId: co.id, contactId: home.id, jobNumber: n, jobType: 'retail', source: 'referral', propertyAddress: `${n} Pine St`, city: 'Akron', state: 'OH', zip: '44301' } as any).returning())[0]
const j1 = await mkJob('RF-T63-A'), j2 = await mkJob('RF-T63-B'), j3 = await mkJob('RF-T63-C')

const app = new Hono()
app.route('/api/jobs', (await import('./src/routes/jobs.ts')).default)
app.onError((await import('./src/utils/errors.ts')).errorHandler)
const as = (who: any) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, { method, headers: { 'content-type': 'application/json', 'x-test-user': who.id }, body: body === undefined ? undefined : JSON.stringify(body) })
  const t = await res.text(); let js: any = t; try { js = JSON.parse(t) } catch {}
  return { status: res.status, json: js }
}
const ids = (r: any) => (r.json?.data || []).map((x: any) => x.jobNumber).sort()

// the picker, with the job's own field names
const a1 = await as(owner)('PUT', `/api/jobs/${j1.id}`, { assignedSalesRepId: rep.id })
const a2 = await as(owner)('PUT', `/api/jobs/${j2.id}`, { assignedSalesRepId: other.id, assignedCrewId: squad.id })
check('assigning a sales rep saves', a1.status === 200 && (await as(owner)('GET', `/api/jobs/${j1.id}`)).json?.job?.assignedSalesRepId === rep.id || a1.json?.assignedSalesRepId === rep.id, a1)
check('…and a crew', a2.status === 200, a2)

const mine = await as(rep)('GET', '/api/jobs?mine=1')
check('"My jobs": the rep sees exactly the job they are the sales rep on', mine.status === 200 && JSON.stringify(ids(mine)) === JSON.stringify(['RF-T63-A']), ids(mine))
const all = await as(rep)('GET', '/api/jobs')
check('…and without it, every job (staff see all jobs — owner\'s decision)', all.status === 200 && JSON.stringify(ids(all)) === JSON.stringify(['RF-T63-A', 'RF-T63-B', 'RF-T63-C']), ids(all))
const byRep = await as(owner)('GET', `/api/jobs?assignedSalesRepId=${other.id}`)
check('the rep filter filters', JSON.stringify(ids(byRep)) === JSON.stringify(['RF-T63-B']), ids(byRep))
const byCrew = await as(owner)('GET', `/api/jobs?assignedCrewId=${squad.id}`)
check('the crew filter filters', JSON.stringify(ids(byCrew)) === JSON.stringify(['RF-T63-B']), ids(byCrew))

const cleared = await as(owner)('PUT', `/api/jobs/${j1.id}`, { assignedSalesRepId: '' })
const [row1] = await db.select().from(job).where((await import('drizzle-orm')).eq(job.id, j1.id))
check('"Unassigned" clears the rep (it could never be taken off before)', cleared.status === 200 && row1.assignedSalesRepId === null, { status: cleared.status, rep: row1.assignedSalesRepId })
const mineAfter = await as(rep)('GET', '/api/jobs?mine=1')
check('…and "My jobs" is then empty for that rep', mineAfter.status === 200 && ids(mineAfter).length === 0, ids(mineAfter))

console.log(`\nt63 my jobs: ${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
