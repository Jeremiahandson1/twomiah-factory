// THE MERGED OWN-JOBS RULE (batch 4, 2026-10-24): fix-s put a login on a crew (crew_login), fix-t put several people on
// a job (job_assignee). A field login's own jobs are those where it is the lead, any assignee, the roofing sales rep, or
// a member of the job's crew — one function (tenant-backend jobs/onJob.ts), asked by every door either branch narrowed.
// The cases neither branch's own tests reach: a crew that is an ASSIGNEE (not the lead), a login that is the sales rep,
// and both halves read through each door — the list, the page, /today, the phone's day, the customers, a person's lane
// and a day's route.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'

const PASSWORD = 'Own-jobs-1024'
let t: Awaited<ReturnType<typeof bootTenant>>
let co = ''
const tokens: Record<string, string> = {}
const ids: Record<string, string> = {}
const as = async (who: string, path: string, method = 'GET', json?: unknown) => {
  const r = await t.call(path, { method, json, headers: { Authorization: `Bearer ${tokens[who]}` } })
  const text = await r.text()
  let body: any = text
  try { body = JSON.parse(text) } catch { /* not JSON */ }
  return { status: r.status, body }
}
const listed = (r: any) => (r.body.data || r.body || []).map((x: any) => x.id).sort()
const jobs: Record<string, string> = {}
const contacts: Record<string, string> = {}

beforeAll(async () => {
  t = await bootTenant({ vertical: 'landscaping' })
  const s = await seedOwner(t)
  co = s.company.id
  // UTC, so "today" is the test's own clock day for /today and the day route.
  await t.db.update(t.schema.company).set({ timezone: 'UTC', enabledFeatures: ['contacts', 'jobs', 'team', 'tech_mobile_view', 'dispatch_board'] } as any).where(eq(t.schema.company.id, co))
  tokens.owner = ((await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json()) as any).accessToken
  for (const key of ['crew', 'lead']) {
    const email = `${key}@test.example`
    const [u] = await t.db.insert(t.schema.user).values({ email, passwordHash: await Bun.password.hash(PASSWORD, 'bcrypt'), firstName: key, lastName: 'Tester', role: 'field', companyId: co } as any).returning()
    ids[key] = u.id
    tokens[key] = ((await (await t.call('/api/auth/login', { method: 'POST', json: { email, password: PASSWORD } })).json()) as any).accessToken
  }
  const [m] = await t.db.insert(t.schema.teamMember).values({ companyId: co, name: 'Mow Crew C', active: true } as any).returning()
  ids.crewC = m.id
  for (const name of ['assignee', 'crewHelper', 'rep', 'other']) contacts[name] = (await t.db.insert(t.schema.contact).values({ companyId: co, name: `Cust ${name}`, type: 'client' } as any).returning())[0].id
  const today = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`)
  const add = async (key: string, n: number, extra: Record<string, unknown>) => {
    jobs[key] = (await t.db.insert(t.schema.job).values({ companyId: co, number: `JOB-0700${n}`, title: key, status: 'scheduled', scheduledDate: today, contactId: contacts[key], lat: 41.88 + n / 100, lng: -87.63, ...extra } as any).returning())[0].id
  }
  await add('assignee', 1, { assignedToId: ids.lead })       // crew is one of the others on it
  await add('crewHelper', 2, { assignedToId: ids.lead })     // crew's roster crew is one of the others on it
  await add('rep', 3, { assignedSalesRepId: ids.crew })      // crew sold it
  await add('other', 4, { assignedToId: ids.lead })          // nothing to do with crew
  await t.db.insert(t.schema.jobAssignee).values([
    { companyId: co, jobId: jobs.assignee, userId: ids.crew, position: 1 },
    { companyId: co, jobId: jobs.crewHelper, memberId: ids.crewC, position: 1 },
  ] as any)
  await t.db.insert(t.schema.crewLogin).values({ companyId: co, userId: ids.crew, teamMemberId: ids.crewC } as any)
}, 120_000)

const MINE = () => [jobs.assignee, jobs.crewHelper, jobs.rep].sort()

describe('a field login reads the jobs it is an assignee on, its crew is an assignee on, and it sold — never the rest', () => {
  test('the list and each job page', async () => {
    expect(listed(await as('crew', '/api/jobs'))).toEqual(MINE())
    for (const k of ['assignee', 'crewHelper', 'rep']) expect((await as('crew', `/api/jobs/${jobs[k]}`)).status).toBe(200)
    expect((await as('crew', `/api/jobs/${jobs.other}`)).status).toBe(404)
  })
  test('/today and the phone\'s day', async () => {
    expect(listed(await as('crew', '/api/jobs/today'))).toEqual(MINE())
    const phone = await as('crew', '/api/tech/my-jobs')
    expect(phone.status).toBe(200)
    expect(listed(phone)).toEqual(MINE())
  })
  test('the customers on those jobs', async () => {
    expect(listed(await as('crew', '/api/contacts'))).toEqual([contacts.assignee, contacts.crewHelper, contacts.rep].sort())
  })
  test('the office reading the person\'s lane (?assignedToId=) and their day route sees the same jobs', async () => {
    expect(listed(await as('owner', `/api/jobs?assignedToId=${ids.crew}`))).toEqual(MINE())
    const day = await as('owner', `/api/day-route?date=${new Date().toISOString().slice(0, 10)}&userId=${ids.crew}`)
    expect(day.status).toBe(200)
    expect([...day.body.order].sort()).toEqual(MINE())
  })
  test('the other field login (the lead) reads its own three, not the one crew sold', async () => {
    expect(listed(await as('lead', '/api/jobs'))).toEqual([jobs.assignee, jobs.crewHelper, jobs.other].sort())
  })
})
