// Parity tier 2 #6 (11/10): skill matching — ServiceTitan's technician skills and the job types that need them. Through the real
// server as field service:
//   · Settings › Skills sets each person's skills (a login's or a roster member's) and each kind of job's needs; a tech reads but
//     does not change them; a kind listed twice is refused in words;
//   · a job given to people who, together, lack a skill its kind needs is a warning the office can book past; a crew that covers
//     it between them books; a kind that needs nothing, or a job with no type, is never warned;
//   · moving a job onto someone without the skill warns too;
//   · Find a time offers only people who have every skill the kind needs;
//   · switched off, none of it: no warning, and the page's calls are closed.
import { test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { cleanSkills, missingSkills, jobTypeSkills } from '../server/data/skills.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = '', hank = '', tia = '', gus = '', ivy = ''
const tok: Record<string, string> = {}
const call = (who: string, p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tok[who]}` } })
const json = async (r: Response) => ({ status: r.status, body: await r.json() as any })
const login = async (email: string, password: string) => (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json() as any)
const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
const FEATURES = ['jobs', 'contacts', 'quotes', 'invoices', 'team', 'dashboard', 'tech_availability', 'skill_matching']
const setFeatures = async (list: string[]) => {
  await t.db.update(t.schema.company).set({ enabledFeatures: list } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
}

beforeAll(async () => {
  t = await bootTenant({ vertical: 'fieldservice' })
  const s = await seedOwner(t)
  companyId = s.company.id
  await t.db.update(t.schema.company).set({ timezone: 'America/Chicago' } as any).where(eq(t.schema.company.id, companyId))
  await setFeatures(FEATURES)
  tok.owner = (await login('owner@test.example', s.password)).accessToken
  const made = async (email: string, firstName: string) => {
    const r = await json(await call('owner', '/api/company/users', { method: 'POST', json: { email, firstName, lastName: 'Tech', role: 'field', password: 'Long-enough-pass-1' } }))
    return r.body.id ?? r.body.user?.id
  }
  tia = await made('tia@heating.example', 'Tia')
  gus = await made('gus@heating.example', 'Gus')
  tok.tech = (await login('tia@heating.example', 'Long-enough-pass-1')).accessToken
  ivy = (await ins(t.schema.teamMember, { companyId, name: 'Ivy Installer', active: true })).id
  hank = (await ins(t.schema.contact, { companyId, name: 'Hank Homeowner', type: 'client' })).id
}, 120_000)

test('the rule: skills match without regard to case or spacing, and a crew counts together', () => {
  expect(cleanSkills([' Gas ', 'gas', '', 'Install  work', 7])).toEqual(['Gas', 'Install work', '7'])
  expect(missingSkills(['Gas', 'Install'], [['gas'], []])).toEqual(['Install'])
  expect(missingSkills(['Gas', 'Install'], [['gas'], ['INSTALL']])).toEqual([])
  expect(jobTypeSkills({ skillMatching: { jobTypes: { 'Furnace install': ['Gas', 'Install'], Empty: [] } } })).toEqual({ 'Furnace install': ['Gas', 'Install'] })
})

test("Settings › Skills: set people's and job kinds' skills; a tech reads but does not change them", async () => {
  const kinds = await json(await call('owner', '/api/skills/job-types', { method: 'PUT', json: { jobTypes: [{ jobType: 'Furnace install', skills: ['Gas', 'Install'] }, { jobType: 'Tune-up', skills: [] }] } }))
  expect(kinds.status).toBe(200)
  expect(kinds.body.jobTypes).toEqual([{ jobType: 'Furnace install', skills: ['Gas', 'Install'] }])
  const twice = await json(await call('owner', '/api/skills/job-types', { method: 'PUT', json: { jobTypes: [{ jobType: 'Repair', skills: ['Gas'] }, { jobType: 'repair', skills: ['Electric'] }] } }))
  expect([twice.status, twice.body.error]).toEqual([400, '"repair" is listed twice. Put all its skills on one line.'])

  expect((await json(await call('owner', `/api/skills/people/${tia}`, { method: 'PUT', json: { skills: ['Gas', 'gas'] } }))).body.skills).toEqual(['Gas'])
  expect((await json(await call('owner', `/api/skills/people/${ivy}`, { method: 'PUT', json: { skills: ['Install'] } }))).body.skills).toEqual(['Install'])
  expect((await call('owner', '/api/skills/people/nobody', { method: 'PUT', json: { skills: ['Gas'] } })).status).toBe(404)
  expect((await call('tech', `/api/skills/people/${tia}`, { method: 'PUT', json: { skills: ['Everything'] } })).status).toBe(403)

  const page = await json(await call('tech', '/api/skills'))
  expect(page.status).toBe(200)
  const by = Object.fromEntries(page.body.people.map((p: any) => [p.name, p.skills]))
  expect(by['Tia Tech']).toEqual(['Gas'])
  expect(by['Gus Tech']).toEqual([])
  expect(by['Ivy Installer']).toEqual(['Install'])
  expect(page.body.skills).toEqual(['Gas', 'Install'])
})

test('a job given to people without a skill its kind needs warns, and can be booked anyway; a crew that covers it books', async () => {
  const body = { title: 'New furnace', contactId: hank, jobType: 'Furnace install', scheduledDate: '2026-12-01', scheduledTime: '09:00', assignedToId: tia }
  const r = await json(await call('owner', '/api/jobs', { method: 'POST', json: body }))
  expect([r.status, r.body.code, r.body.canBookAnyway]).toEqual([409, 'unavailable', true])
  expect(r.body.error).toBe('The person on this job is missing a skill this kind of job needs (Furnace install): Install. Book anyway, or pick someone who has it.')
  expect((await call('owner', '/api/jobs', { method: 'POST', json: { ...body, bookAnyway: true } })).status).toBe(201)
  // Tia (Gas) with Ivy (Install) on the crew: covered between them.
  expect((await call('owner', '/api/jobs', { method: 'POST', json: { ...body, scheduledDate: '2026-12-02', otherAssigneeIds: [ivy] } })).status).toBe(201)
  // Nobody has either: both named.
  const none = await json(await call('owner', '/api/jobs', { method: 'POST', json: { ...body, scheduledDate: '2026-12-03', assignedToId: gus } }))
  expect(none.body.error).toContain('missing skills this kind of job needs (Furnace install): Gas, Install.')
  // A kind that needs nothing, a job with no type, or nobody on it: no warning.
  expect((await call('owner', '/api/jobs', { method: 'POST', json: { ...body, scheduledDate: '2026-12-04', assignedToId: gus, jobType: 'Tune-up' } })).status).toBe(201)
  expect((await call('owner', '/api/jobs', { method: 'POST', json: { ...body, scheduledDate: '2026-12-05', assignedToId: gus, jobType: undefined } })).status).toBe(201)
  expect((await call('owner', '/api/jobs', { method: 'POST', json: { ...body, scheduledDate: '2026-12-06', assignedToId: undefined } })).status).toBe(201)
})

test('moving a job onto someone without the skill warns', async () => {
  const made = await json(await call('owner', '/api/jobs', { method: 'POST', json: { title: 'Install', contactId: hank, jobType: 'Furnace install', scheduledDate: '2026-12-08', scheduledTime: '09:00', assignedToId: tia, otherAssigneeIds: [ivy] } }))
  expect(made.status).toBe(201)
  const moved = await json(await call('owner', `/api/jobs/${made.body.id}`, { method: 'PUT', json: { assignedToId: gus, otherAssigneeIds: [] } }))
  expect([moved.status, moved.body.code]).toEqual([409, 'unavailable'])
  expect(moved.body.error).toContain('Gas, Install')
})

test('Find a time offers only people with every skill the kind of job needs', async () => {
  // Business hours so everyone has time to offer.
  const week = Object.fromEntries(['monday', 'tuesday', 'wednesday', 'thursday', 'friday'].map((d) => [d, { open: '08:00', close: '17:00' }]))
  const [co] = await (t.db as any).select({ settings: t.schema.company.settings }).from(t.schema.company).where(eq(t.schema.company.id, companyId))
  await t.db.update(t.schema.company).set({ settings: { ...(co.settings || {}), businessHours: week } } as any).where(eq(t.schema.company.id, companyId))
  await call('owner', `/api/skills/people/${gus}`, { method: 'PUT', json: { skills: ['Install', 'Gas'] } })
  const found = await json(await call('owner', '/api/availability/find?from=2026-12-14&days=1&duration=60&jobType=furnace%20install'))
  expect(found.status).toBe(200)
  expect(found.body.skillsNeeded).toEqual(['Gas', 'Install'])
  expect(found.body.people.map((p: any) => p.name)).toEqual(['Gus Tech'])
  const all = await json(await call('owner', '/api/availability/find?from=2026-12-14&days=1&duration=60'))
  expect(all.body.skillsNeeded).toBeUndefined()
  expect(all.body.people.length).toBeGreaterThan(1)
})

test('switched off: no warning, and the page is closed', async () => {
  await setFeatures(FEATURES.filter((f) => f !== 'skill_matching'))
  try {
    expect((await call('owner', '/api/jobs', { method: 'POST', json: { title: 'Off', contactId: hank, jobType: 'Furnace install', scheduledDate: '2026-12-09', scheduledTime: '09:00', assignedToId: tia } })).status).toBe(201)
    expect([403, 404]).toContain((await call('owner', '/api/skills')).status)
    const found = await json(await call('owner', '/api/availability/find?from=2026-12-14&days=1&duration=60&jobType=Furnace%20install'))
    expect(found.body.skillsNeeded).toBeUndefined()
  } finally { await setFeatures(FEATURES) }
})
