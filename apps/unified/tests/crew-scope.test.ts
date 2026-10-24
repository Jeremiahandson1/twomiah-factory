// Crew scope across every job trade (2026-10-24), through the real server and the real login. Landscaping's field seat
// read only its own work first (landscaping-retest-1024.test.ts); now contractor, field service, roofing and basic do
// too, and a login can be put on a crew — a roster crew (Team page, /api/team/:id/logins) or a roofing crew (Crews page,
// /api/crews/:id/logins) — and then reads that crew's jobs as its own: list, page, today, the phone's day and the
// customers on them. Managers and up keep the whole business; RV's field seat (the sales floor) keeps it too.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'

type Tenant = Awaited<ReturnType<typeof bootTenant>>
const PASSWORD = 'Crew-scope-1024'

async function setUp(vertical: string, features: string[]) {
  const t = await bootTenant({ vertical })
  const s = await seedOwner(t)
  const co = s.company.id
  await t.db.update(t.schema.company).set({ timezone: 'America/Chicago', enabledFeatures: features } as any).where(eq(t.schema.company.id, co))
  const tokens: Record<string, string> = {}
  const ids: Record<string, string> = { owner: s.owner.id }
  tokens.owner = ((await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json()) as any).accessToken
  for (const [key, role] of Object.entries({ crew: 'field', other: 'field', manager: 'manager', viewer: 'viewer' })) {
    const email = `${key}@test.example`
    const [u] = await t.db.insert(t.schema.user).values({ email, passwordHash: await Bun.password.hash(PASSWORD, 'bcrypt'), firstName: key, lastName: 'Tester', role, companyId: co } as any).returning()
    ids[key] = u.id
    tokens[key] = ((await (await t.call('/api/auth/login', { method: 'POST', json: { email, password: PASSWORD } })).json()) as any).accessToken
  }
  const as = async (who: string, path: string, method = 'GET', json?: unknown) => {
    const r = await t.call(path, { method, json, headers: { Authorization: `Bearer ${tokens[who]}` } })
    const text = await r.text()
    let body: any = text
    try { body = JSON.parse(text) } catch { /* not JSON */ }
    return { status: r.status, body }
  }
  const contact = async (name: string) => (await t.db.insert(t.schema.contact).values({ companyId: co, name, type: 'client' } as any).returning())[0]
  const job = async (n: number, title: string, status: string, extra: Record<string, unknown>) =>
    (await t.db.insert(t.schema.job).values({ companyId: co, number: `JOB-0000${n}`, title, status, scheduledDate: new Date(), ...extra } as any).returning())[0]
  return { t, co, ids, as, contact, job }
}

const ids = (r: any) => (r.body.data || []).map((x: any) => x.id).sort()

describe('contractor: a crew login reads its own jobs and its roster crew\'s', () => {
  let x: Awaited<ReturnType<typeof setUp>>
  let own: any, crewJob: any, other: any, member: any, cOwn: any, cCrew: any, cOther: any
  beforeAll(async () => {
    x = await setUp('contractor', ['contacts', 'jobs', 'team', 'tech_mobile_view', 'dashboard'])
    cOwn = await x.contact('Ada Own'); cCrew = await x.contact('Cora Crewjob'); cOther = await x.contact('Otto Other')
    ;[member] = await x.t.db.insert(x.t.schema.teamMember).values({ companyId: x.co, name: 'Framing Crew B', active: true } as any).returning()
    own = await x.job(1, 'Own deck', 'scheduled', { contactId: cOwn.id, assignedToId: x.ids.crew })
    crewJob = await x.job(2, 'Crew B framing', 'scheduled', { contactId: cCrew.id, assignedToMemberId: member.id })
    other = await x.job(3, 'Other roof', 'scheduled', { contactId: cOther.id, assignedToId: x.ids.other })
  }, 120_000)

  test('before the link: only its own job and customer', async () => {
    expect(ids(await x.as('crew', '/api/jobs'))).toEqual([own.id])
    expect(ids(await x.as('crew', '/api/contacts'))).toEqual([cOwn.id])
    expect((await x.as('crew', `/api/jobs/${crewJob.id}`)).status).toBe(404)
  })
  test('linking a login to a roster crew is the roster editor\'s (team:update), on the server', async () => {
    expect((await x.as('crew', `/api/team/${member.id}/logins`, 'PUT', { userIds: [x.ids.crew] })).status).toBe(403)
    expect((await x.as('manager', `/api/team/${member.id}/logins`, 'PUT', { userIds: [x.ids.crew] })).status).toBe(403)
    expect((await x.as('owner', `/api/team/${member.id}/logins`, 'PUT', { userIds: [x.ids.viewer] })).status).toBe(400)
    const r = await x.as('owner', `/api/team/${member.id}/logins`, 'PUT', { userIds: [x.ids.crew] })
    expect(r.status).toBe(200)
    expect(r.body.logins.map((l: any) => l.id)).toEqual([x.ids.crew])
    const read = await x.as('owner', '/api/team/logins')
    expect(read.body.data).toEqual([{ teamMemberId: member.id, logins: [{ id: x.ids.crew, name: 'crew Tester' }] }])
  })
  test('after the link: the crew\'s job and customer too — list, page, today, the phone — never the other job', async () => {
    expect(ids(await x.as('crew', '/api/jobs'))).toEqual([own.id, crewJob.id].sort())
    expect((await x.as('crew', `/api/jobs/${crewJob.id}`)).status).toBe(200)
    expect((await x.as('crew', `/api/jobs/${other.id}`)).status).toBe(404)
    expect((await x.as('crew', `/api/jobs/${other.id}`, 'PUT', { title: 'Taken' })).status).toBe(404)
    expect(ids(await x.as('crew', '/api/contacts'))).toEqual([cOwn.id, cCrew.id].sort())
    expect((await x.as('crew', `/api/contacts/${cOther.id}`)).status).toBe(404)
    const today = await x.as('crew', '/api/jobs/today')
    expect(today.status).toBe(200)
    expect(JSON.stringify(today.body)).not.toContain(other.id)
    const mine = await x.as('crew', '/api/tech/my-jobs')
    expect(mine.status).toBe(200)
    expect(JSON.stringify(mine.body)).toContain(crewJob.id)
    expect(JSON.stringify(mine.body)).not.toContain(other.id)
    // the other field login is on no crew: its own job only
    expect(ids(await x.as('other', '/api/jobs'))).toEqual([other.id])
  })
  test('the owner, a manager and the viewer still read every job', async () => {
    for (const who of ['owner', 'manager', 'viewer']) expect((await x.as(who, '/api/jobs')).body.data.length).toBe(3)
  })
})

describe('roofing: a Field login on a crew reads that crew\'s jobs — list, page and the pipeline\'s doors', () => {
  let x: Awaited<ReturnType<typeof setUp>>
  let crewA: any, own: any, crewJob: any, other: any
  beforeAll(async () => {
    x = await setUp('roofing', ['contacts', 'jobs', 'crews', 'team', 'dashboard'])
    ;[crewA] = await x.t.db.insert(x.t.schema.crew).values({ companyId: x.co, name: 'Crew A', foremanName: 'Al', foremanPhone: '5555550100', size: 3 } as any).returning()
    own = await x.job(1, 'Rep job', 'lead', { assignedSalesRepId: x.ids.crew })
    crewJob = await x.job(2, 'Crew A tear-off', 'lead', { assignedCrewId: crewA.id })
    other = await x.job(3, 'Not theirs', 'lead', { assignedSalesRepId: x.ids.other })
  }, 120_000)

  test('a crew\'s logins are set by crews:update only, and read back on the crew', async () => {
    expect((await x.as('crew', `/api/crews/${crewA.id}/logins`, 'PUT', { userIds: [x.ids.crew] })).status).toBe(403)
    expect(ids(await x.as('crew', '/api/jobs'))).toEqual([own.id])
    const r = await x.as('manager', `/api/crews/${crewA.id}/logins`, 'PUT', { userIds: [x.ids.crew] })
    expect(r.status).toBe(200)
    const list = await x.as('manager', '/api/crews')
    expect(list.body.data[0].logins.map((l: any) => l.id)).toEqual([x.ids.crew])
  })
  test('the Field login: its own and its crew\'s jobs; another job is not there', async () => {
    expect(ids(await x.as('crew', '/api/jobs'))).toEqual([own.id, crewJob.id].sort())
    expect((await x.as('crew', `/api/jobs/${crewJob.id}`)).status).toBe(200)
    expect((await x.as('crew', `/api/jobs/${other.id}`)).status).toBe(404)
    expect((await x.as('crew', `/api/jobs/${other.id}/advance`, 'POST')).status).toBe(404)
    expect((await x.as('crew', `/api/jobs/${other.id}/timeline`)).status).toBe(404)
    expect((await x.as('crew', '/api/jobs/types')).status).toBe(200)
    expect(ids(await x.as('crew', '/api/jobs?search=Not'))).toEqual([])
    expect(ids(await x.as('other', '/api/jobs'))).toEqual([other.id])
  })
  test('a manager reads every roofing job', async () => {
    expect((await x.as('manager', '/api/jobs')).body.data.length).toBe(3)
  })
})

describe('every job trade withholds read-all from its field seat; RV\'s sales floor keeps it', () => {
  for (const vertical of ['fieldservice', 'basic', 'landscaping']) {
    test(`${vertical}: the field seat reads its own job only`, async () => {
      const x = await setUp(vertical, ['contacts', 'jobs', 'team'])
      const mine = await x.job(1, 'Mine', 'scheduled', { assignedToId: x.ids.crew })
      await x.job(2, 'Theirs', 'scheduled', { assignedToId: x.ids.other })
      expect(ids(await x.as('crew', '/api/jobs'))).toEqual([mine.id])
      expect((await x.as('manager', '/api/jobs')).body.data.length).toBe(2)
    }, 60_000)
  }
  test('rv: the field seat reads every job', async () => {
    const x = await setUp('rv', ['contacts', 'jobs'])
    await x.job(1, 'Mine', 'scheduled', { assignedToId: x.ids.crew })
    await x.job(2, 'Theirs', 'scheduled', { assignedToId: x.ids.other })
    expect((await x.as('crew', '/api/jobs')).body.data.length).toBe(2)
  }, 60_000)
})
