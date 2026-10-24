// The field-service scheduling upgrade of 2026-10-24 (Jobber / Housecall Pro / ServiceTitan), through the real server
// and the real login, on a landscaping tenant (its crew seat reads only its own jobs):
//   1. several people per job — job_assignee beside the lead (assignedToId), every one of them on the list and the job;
//   2. the double-booking check covers every person on a job, helpers included;
//   3. travel time: too short a gap is a WARNING with "book anyway" (recorded in the audit log), an overlap stays a refusal;
//   4. "own jobs" includes the jobs a person is on: the list, the job, its customer, the technician's day;
//   5. everyone on a job is told on their phone;
//   6. one person's day in the best order (/api/day-route), re-timed only when asked (/api/jobs/retime), both gated.
import { describe, test, expect, beforeAll } from 'bun:test'
import { and, eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'

type Tenant = Awaited<ReturnType<typeof bootTenant>>
const PASSWORD = 'Crew-1024-pass'
const DAY = '2026-11-03'
// Downtown Chicago, and a point about 25 km north: well over ten minutes' drive.
const LOOP = { lat: 41.8781, lng: -87.6298 }, NORTH = { lat: 42.1, lng: -87.7 }

let t: Tenant
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
const job = (fields: Record<string, unknown>) => as('owner', '/api/jobs', 'POST', { scheduledDate: DAY, estimatedHours: 1, ...fields })
const assigneeIds = (j: any) => (j.assignees || []).map((a: any) => a.id)
let customer = ''

beforeAll(async () => {
  // GOOGLE_MAPS_API_KEY is blanked by the harness (noLiveKeys.ts): the optimiser uses its straight-line fallback.
  t = await bootTenant({ vertical: 'landscaping' })
  const s = await seedOwner(t)
  co = s.company.id
  await t.db.update(t.schema.company).set({ timezone: 'America/Chicago', enabledFeatures: ['contacts', 'jobs', 'dispatch_board', 'tech_mobile_view'] } as any).where(eq(t.schema.company.id, co))
  tokens.owner = ((await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json()) as any).accessToken
  ids.owner = s.owner.id
  for (const [key, role] of Object.entries({ ann: 'field', ben: 'field', cal: 'field', viewer: 'viewer' })) {
    const email = `${key}@test.example`
    const [u] = await t.db.insert(t.schema.user).values({ email, passwordHash: await Bun.password.hash(PASSWORD, 'bcrypt'), firstName: key, lastName: 'Crew', role, companyId: co } as any).returning()
    ids[key] = u.id
    tokens[key] = ((await (await t.call('/api/auth/login', { method: 'POST', json: { email, password: PASSWORD } })).json()) as any).accessToken
  }
  const [m] = await t.db.insert(t.schema.teamMember).values({ companyId: co, name: 'Dee Roster', active: true } as any).returning()
  ids.dee = m.id
  const [c] = await t.db.insert(t.schema.contact).values({ companyId: co, name: 'Helen Helpercustomer', type: 'client' } as any).returning()
  customer = c.id
  for (const who of ['ann', 'ben']) expect((await as(who, '/api/push/expo-token', 'POST', { token: `ExponentPushToken[${who}-phone]`, platform: 'ios' })).status).toBe(201)
  await t.services.phoneRules.scanJobs()
}, 120_000)

let crewJob = '', near = '', far = ''
describe('1. several people per job', () => {
  test('a lead and two others (a login and a roster member): all on the job, lead first', async () => {
    const r = await job({ title: 'Spring cleanup', scheduledTime: '08:00', assignedToId: ids.ann, otherAssigneeIds: [ids.ben, ids.dee, ids.ann], contactId: customer })
    expect(r.status).toBe(201)
    crewJob = r.body.id
    expect(r.body.assignedToId).toBe(ids.ann)
    expect(assigneeIds(r.body)).toEqual([ids.ann, ids.ben, ids.dee])
    expect(r.body.assignees[0].lead).toBe(true)
    const one = await as('owner', `/api/jobs/${crewJob}`)
    expect(assigneeIds(one.body)).toEqual([ids.ann, ids.ben, ids.dee])
  })
  test('someone not on the team is refused, in words', async () => {
    const r = await as('owner', `/api/jobs/${crewJob}`, 'PUT', { otherAssigneeIds: ['nobody-here'] })
    expect(r.status).toBe(400)
    expect(r.body.error).toContain('not on your team')
  })
  test('the lead taken off: the first of the others leads', async () => {
    const r = await as('owner', `/api/jobs/${crewJob}`, 'PUT', { assignedToId: '' })
    expect(r.status).toBe(200)
    expect(assigneeIds(r.body)).toEqual([ids.ben, ids.dee])
    expect(r.body.assignedToId).toBe(ids.ben)
    // …and put back as they were.
    const back = await as('owner', `/api/jobs/${crewJob}`, 'PUT', { assignedToId: ids.ann, otherAssigneeIds: [ids.ben, ids.dee] })
    expect(back.body.error).toBeUndefined()
    expect(assigneeIds(back.body)).toEqual([ids.ann, ids.ben, ids.dee])
  })
  test('the list carries everyone; ?assignedToId= finds a helper\'s job', async () => {
    const r = await as('owner', `/api/jobs?assignedToId=${ids.dee}`)
    expect(r.body.data.map((j: any) => j.id)).toContain(crewJob)
    expect(assigneeIds(r.body.data.find((j: any) => j.id === crewJob))).toEqual([ids.ann, ids.ben, ids.dee])
  })
})

describe('2. double-booking covers everyone on the job', () => {
  test('a helper booked 08:00–09:00 cannot lead a job at 08:30', async () => {
    const r = await job({ title: 'Overlap as lead', scheduledTime: '08:30', assignedToId: ids.ben })
    expect(r.status).toBe(409)
    expect(r.body.error).toContain('already booked')
  })
  test('nor be put on one as a helper — the message names them', async () => {
    const r = await job({ title: 'Overlap as helper', scheduledTime: '08:30', assignedToId: ids.cal, otherAssigneeIds: [ids.dee] })
    expect(r.status).toBe(409)
    expect(r.body.error).toContain('Dee Roster is already booked')
  })
})

describe('3. travel time is a warning, an overlap a refusal', () => {

  test('back to back at a different address: warned, not refused; "book anyway" saves it and is recorded', async () => {
    await t.db.update(t.schema.job).set({ address: '1 Loop St', lat: LOOP.lat, lng: LOOP.lng } as any).where(eq(t.schema.job.id, crewJob))
    const warned = await job({ title: 'Next door?', scheduledTime: '09:00', assignedToId: ids.ann, address: '9 North Rd' })
    expect(warned.status).toBe(409)
    expect(warned.body.code).toBe('travel_time')
    expect(warned.body.canBookAnyway).toBe(true)
    expect(warned.body.error).toContain('ann Crew has 0 min')
    const booked = await job({ title: 'Next door?', scheduledTime: '09:00', assignedToId: ids.ann, address: '9 North Rd', bookAnyway: true })
    expect(booked.status).toBe(201)
    near = booked.body.id
    const rows = await t.db.select().from(t.schema.auditLog).where(and(eq(t.schema.auditLog.companyId, co), eq(t.schema.auditLog.action, 'book_anyway')))
    expect(rows.map((r: any) => r.entityId)).toContain(near)
  })
  test('both on the map: the drive is measured — 10 min is not enough for ~25 km', async () => {
    // The 09:00–10:00 job is downtown; the far one, 25 km north, is tried at 10:10.
    await t.db.update(t.schema.job).set({ lat: LOOP.lat, lng: LOOP.lng } as any).where(eq(t.schema.job.id, near))
    const [j] = await t.db.insert(t.schema.job).values({ companyId: co, number: 'JOB-09001', title: 'Far', status: 'scheduled', scheduledDate: new Date(`${DAY}T00:00:00Z`), scheduledTime: '13:00', estimatedHours: '1', address: 'Far Rd', lat: NORTH.lat, lng: NORTH.lng } as any).returning()
    far = j.id
    const r = await as('owner', `/api/jobs/${far}`, 'PUT', { assignedToId: ids.ann, scheduledTime: '10:10' })
    expect(r.status).toBe(409)
    expect(r.body.code).toBe('travel_time')
    expect(r.body.error).toContain('the drive is about')
    // An hour later there is time to get there.
    const ok = await as('owner', `/api/jobs/${far}`, 'PUT', { assignedToId: ids.ann, scheduledTime: '11:00' })
    expect(ok.status).toBe(200)
  })
  test('an outright overlap is refused even with "book anyway"', async () => {
    const r = await as('owner', `/api/jobs/${far}`, 'PUT', { scheduledTime: '09:30', bookAnyway: true })
    expect(r.status).toBe(409)
    expect(r.body.code).toBeUndefined()
    expect(r.body.error).toContain('already booked')
  })
  test('a status change on a job booked past a warning is not warned again', async () => {
    const r = await as('ann', `/api/jobs/${near}`, 'PUT', { status: 'in_progress' })
    expect(r.status).toBe(200)
  })
  test('a moved address leaves its old map point behind', async () => {
    const r = await as('owner', `/api/jobs/${far}`, 'PUT', { address: 'Elsewhere Ave' })
    expect(r.status).toBe(200)
    expect(r.body.lat).toBeNull()
    await t.db.update(t.schema.job).set({ address: 'Far Rd', lat: NORTH.lat, lng: NORTH.lng } as any).where(eq(t.schema.job.id, far))
  })
})

describe('4. a crew seat\'s own jobs include the ones it helps on', () => {
  test('ben (a helper, no jobs:read-all) lists, opens and reads the customer of the job he is on', async () => {
    const list = await as('ben', '/api/jobs')
    expect(list.body.data.map((j: any) => j.id)).toEqual([crewJob])
    expect((await as('ben', `/api/jobs/${crewJob}`)).status).toBe(200)
    expect((await as('ben', `/api/jobs/${near}`)).status).toBe(404)
    expect((await as('ben', `/api/contacts/${customer}`)).status).toBe(200)
  })
  test('the technician\'s day lists it too', async () => {
    const r = await as('ben', '/api/tech/my-jobs')
    expect(r.status).toBe(200)
    expect(JSON.stringify(r.body)).toContain(crewJob)
  })
})

describe('5. everyone on the job is told', () => {
  test('a new helper gets "assigned"; everyone gets "rescheduled"', async () => {
    t.pushed.length = 0
    await t.services.phoneRules.scanJobs()
    t.pushed.length = 0
    const [j] = await t.db.insert(t.schema.job).values({ companyId: co, number: 'JOB-09002', title: 'Tell us', status: 'scheduled', scheduledDate: new Date('2026-11-04T00:00:00Z'), scheduledTime: '08:00', assignedToId: ids.ann } as any).returning()
    await t.services.phoneRules.scanJobs()
    expect(t.pushed.map((m: any) => m.to)).toEqual(['ExponentPushToken[ann-phone]'])
    t.pushed.length = 0
    expect((await as('owner', `/api/jobs/${j.id}`, 'PUT', { otherAssigneeIds: [ids.ben] })).status).toBe(200)
    await t.services.phoneRules.scanJobs()
    expect(t.pushed.map((m: any) => `${m.to}:${m.title}`)).toEqual(['ExponentPushToken[ben-phone]:New job assigned to you'])
    t.pushed.length = 0
    expect((await as('owner', `/api/jobs/${j.id}`, 'PUT', { scheduledTime: '10:00' })).status).toBe(200)
    await t.services.phoneRules.scanJobs()
    expect(t.pushed.map((m: any) => `${m.to}:${m.title}`).sort()).toEqual(['ExponentPushToken[ann-phone]:Your job was rescheduled', 'ExponentPushToken[ben-phone]:Your job was rescheduled'])
  })
})

describe('6. one person\'s day, in the best order', () => {
  test('ann\'s day: her stops reordered, a directions link, new times proposed — nothing changed yet', async () => {
    const [unmapped] = await t.db.insert(t.schema.job).values({ companyId: co, number: 'JOB-09004', title: 'Not on the map', status: 'scheduled', scheduledDate: new Date(`${DAY}T00:00:00Z`), scheduledTime: '16:00', address: 'Somewhere', assignedToId: ids.ann } as any).returning()
    const before = await t.db.select().from(t.schema.job).where(eq(t.schema.job.id, far))
    const r = await as('owner', `/api/day-route?date=${DAY}&userId=${ids.ann}`)
    expect(r.status).toBe(200)
    expect(r.body.order).toContain(crewJob)
    expect(r.body.order).toContain(far)
    expect(r.body.googleMapsUrl).toContain('https://www.google.com/maps/dir/')
    expect(r.body.proposed.length).toBe(r.body.order.length)
    expect(r.body.unplaced.map((u: any) => u.id)).toEqual([unmapped.id])
    const after = await t.db.select().from(t.schema.job).where(eq(t.schema.job.id, far))
    expect(after[0].scheduledTime).toBe(before[0].scheduledTime)
  })
  test('a crew seat routes only its own day; a viewer cannot re-time', async () => {
    expect((await as('ben', `/api/day-route?date=${DAY}&userId=${ids.ann}`)).status).toBe(403)
    expect((await as('ben', `/api/day-route?date=${DAY}`)).status).toBe(200)
    expect((await as('viewer', '/api/jobs/retime', 'POST', { times: [{ id: far, scheduledTime: '12:00' }] })).status).toBe(403)
  })
  test('re-timing saves every new time together', async () => {
    const r = await as('owner', '/api/jobs/retime', 'POST', { times: [{ id: far, scheduledTime: '12:00' }, { id: crewJob, scheduledTime: '07:00' }] })
    expect(r.status).toBe(200)
    const rows = await t.db.select().from(t.schema.job).where(eq(t.schema.job.companyId, co))
    expect(rows.find((j: any) => j.id === far)!.scheduledTime).toBe('12:00')
    expect(rows.find((j: any) => j.id === crewJob)!.scheduledTime).toBe('07:00')
  })
  test('…and refuses all of them when one lands on a helper\'s other work', async () => {
    const [other] = await t.db.insert(t.schema.job).values({ companyId: co, number: 'JOB-09003', title: 'Dee elsewhere', status: 'scheduled', scheduledDate: new Date(`${DAY}T00:00:00Z`), scheduledTime: '15:00', estimatedHours: '1', assignedToMemberId: ids.dee } as any).returning()
    const r = await as('owner', '/api/jobs/retime', 'POST', { times: [{ id: far, scheduledTime: '13:00' }, { id: crewJob, scheduledTime: '15:00' }] })
    expect(r.status).toBe(409)
    expect(r.body.error).toContain('Dee Roster')
    const rows = await t.db.select().from(t.schema.job).where(eq(t.schema.job.companyId, co))
    expect(rows.find((j: any) => j.id === far)!.scheduledTime).toBe('12:00')
    expect(other.id).toBeTruthy()
  })
})
