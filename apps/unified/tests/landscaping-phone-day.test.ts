// Landscaping gap 7: the phone's "Today's route" and "Log snow visit" (apps/mobile/src/trades/landscaping.ts). The specs are data, so the
// very requests the phone makes are the ones run here, against a real landscaping tenant: the crew's list answers with only its own
// work in stop order, Start / Finish / note / snow Start / Log do what they say, a replayed log never bills twice, and a seat without
// the permission is refused by the server. Fails without the change: the specs do not exist (the import throws).
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { LANDSCAPING } from '../../mobile/src/trades/landscaping.ts'
import { specFor, SPECS } from '../../mobile/src/trades/specs.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId: string
let owner: string
let crew: string
let crewId: string
let other: string
const as = (token: string, path: string, init: any = {}) => t.call(path, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } })
const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
const post = (token: string, path: string, json: any = {}) => as(token, path, { method: 'POST', json })
const login = async (email: string, password: string) => (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken as string
async function seat(email: string, role = 'field') {
  const password = 'Correct-horse-1'
  const u = await ins(t.schema.user, { companyId, email, firstName: email.split('@')[0], lastName: 'Seat', role, passwordHash: await Bun.password.hash(password, 'bcrypt') })
  return { token: await login(email, password), id: u.id as string }
}
const FEATURES = ['contacts', 'jobs', 'quotes', 'invoices', 'recurring_routes', 'snow_billing', 'visit_reports']
const spec = (id: string) => LANDSCAPING.find((s) => s.id === id)!
/** The request an action makes for this row, sent as this seat. */
const act = (token: string, specId: string, actionId: string, d: any, values: Record<string, string> = {}) => {
  const req = spec(specId).detail!.actions!.find((a) => a.id === actionId)!.request(d, values)
  return as(token, req.path, { method: req.method, ...(req.body !== undefined ? { json: req.body } : {}) })
}
const listOf = async (token: string, specId: string) => {
  const s = spec(specId)
  const r = await as(token, s.list.path)
  expect(r.status).toBe(200)
  return s.pick!(await r.json()) as any[]
}

beforeAll(async () => {
  t = await bootTenant({ vertical: 'landscaping' })
  const s = await seedOwner(t)
  companyId = s.company.id
  await t.db.update(t.schema.company).set({ enabledFeatures: FEATURES }).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
  owner = await login('owner@test.example', s.password)
  const a = await seat('crew@test.example'); crew = a.token; crewId = a.id
  other = (await seat('crew2@test.example')).token
})

describe("Today's route", () => {
  test("a crew seat's list holds only its own visits, in stop order, and Start then Finish run the Schedule's own routes", async () => {
    const ct = await ins(t.schema.contact, { companyId, name: 'Route Customer', type: 'client', phone: '+17155550111' })
    const mk = (n: string, time: string, who: string | null) => ins(t.schema.job, { companyId, number: `PH-${n}`, title: `Mow ${n}`, status: 'scheduled', contactId: ct.id, assignedToId: who, scheduledDate: new Date(), scheduledTime: time, address: `${n} Elm St` })
    const third = await mk('3', '09:00', crewId); const first = await mk('1', '07:00', crewId); const second = await mk('2', '08:00', crewId)
    const theirs = await mk('9', '07:30', null)

    const rows = await listOf(crew, 'landscaping-route')
    const ours = rows.filter((r) => String(r.number).startsWith('PH-'))
    expect(ours.map((r) => r.id)).toEqual([first.id, second.id, third.id])
    expect(ours.some((r) => r.id === theirs.id)).toBe(false)
    const shown = spec('landscaping-route').rows(ours[0], {})
    expect(shown.title).toBe('Route Customer')
    expect(shown.meta).toBe('7:00 AM')

    expect((await act(crew, 'landscaping-route', 'start', first)).status).toBe(200)
    const [started] = (await listOf(crew, 'landscaping-route')).filter((r) => r.id === first.id)
    expect(started.status).toBe('in_progress')
    expect((await act(crew, 'landscaping-route', 'done', started)).status).toBe(200)
    const [done] = (await listOf(crew, 'landscaping-route')).filter((r) => r.id === first.id)
    expect(done.status).toBe('completed')
    // The other crew cannot start this crew's visit.
    expect([403, 404]).toContain((await act(other, 'landscaping-route', 'start', second)).status)
  })

  test('the note for the customer is the crew\'s own on its own visit; another crew is refused; with the feature off the server says no', async () => {
    const ct = await ins(t.schema.contact, { companyId, name: 'Note Customer', type: 'client' })
    const j = await ins(t.schema.job, { companyId, number: 'PH-N', title: 'Mow N', status: 'in_progress', contactId: ct.id, assignedToId: crewId, scheduledDate: new Date(), scheduledTime: '10:00' })
    expect((await act(crew, 'landscaping-route', 'note', j, { note: 'Edged and blew the walks.' })).status).toBe(200)
    expect((await act(other, 'landscaping-route', 'note', j, { note: 'hi' })).status).toBe(403)
    const mine = await (await as(crew, `/api/visit-reports/job/${j.id}`)).json()
    expect(mine.note).toBe('Edged and blew the walks.')
    await t.db.update(t.schema.company).set({ enabledFeatures: FEATURES.filter((f) => f !== 'visit_reports') }).where(eq(t.schema.company.id, companyId))
    t.services.features.forgetFeatures()
    try { expect((await act(crew, 'landscaping-route', 'note', j, { note: 'again' })).status).toBe(403) }
    finally { await t.db.update(t.schema.company).set({ enabledFeatures: FEATURES }).where(eq(t.schema.company.id, companyId)); t.services.features.forgetFeatures() }
  })
})

describe('Log snow visit', () => {
  test("the crew's stops are listed, Start stamps the clock, Log prices by the contract and a replay never bills twice; Skip is the office's", async () => {
    const ct = await (await post(owner, '/api/contacts', { name: 'Lot Co', type: 'client' })).json()
    const site = await (await post(owner, '/api/sites', { name: 'Lot', contactId: ct.id, address: '1 Lot St', city: 'Eau Claire' })).json()
    const c = await post(owner, '/api/snow/contracts', { siteId: site.id, billingMode: 'per_push', perPushRate: 50, saltRate: 20 })
    expect(c.status).toBe(201)
    const storm = (await (await post(owner, '/api/snow/storms', { name: 'Phone storm', target: { all: true }, assignedToId: crewId })).json()).storm
    expect(storm.id).toBeTruthy()

    const stops = await listOf(crew, 'landscaping-snow')
    const stop = stops.find((s) => s.siteName === 'Lot')!
    expect(stop).toBeTruthy()
    expect(spec('landscaping-snow').rows(stop, {}).title).toBe('Lot')
    expect(stops.every((s) => s.assignedToId === crewId)).toBe(true)
    expect((await listOf(other, 'landscaping-snow')).length).toBe(0)

    expect((await act(crew, 'landscaping-snow', 'start', stop)).status).toBe(200)
    const log = await act(crew, 'landscaping-snow', 'log', stop, { pushes: '2', snowfall: '4', salt: 'yes', notes: 'Heavy and wet.' })
    expect(log.status).toBe(201)
    const body = await log.json()
    expect(body.stop.status).toBe('done')
    expect(Number(body.event.pushes)).toBe(2)
    expect(body.event.saltApplied).toBe(true)
    expect(body.event.billableAmount).toBeUndefined() // a crew seat is not shown the money
    // A request replayed after a dropped signal returns the same visit.
    const again = await act(crew, 'landscaping-snow', 'log', stop, { pushes: '2', snowfall: '4', salt: 'yes' })
    expect(again.status).toBe(200)
    expect((await again.json()).alreadyLogged).toBe(true)
    const events = await t.db.select().from(t.schema.snowEvent).where(eq(t.schema.snowEvent.siteId, site.id))
    expect(events.length).toBe(1)
    expect(Number(events[0].billableAmount)).toBe(2 * 50 + 20)

    expect((await act(crew, 'landscaping-snow', 'skip', { ...stop, status: 'open' })).status).toBe(403)
  })

  test('with Snow & Ice switched off the stops list is refused', async () => {
    await t.db.update(t.schema.company).set({ enabledFeatures: FEATURES.filter((f) => f !== 'snow_billing') }).where(eq(t.schema.company.id, companyId))
    t.services.features.forgetFeatures()
    try { expect((await as(crew, spec('landscaping-snow').list.path)).status).toBe(403) }
    finally { await t.db.update(t.schema.company).set({ enabledFeatures: FEATURES }).where(eq(t.schema.company.id, companyId)); t.services.features.forgetFeatures() }
  })
})

describe('the specs', () => {
  test('both are registered, name their permission and feature, and the money actions are the office\'s', () => {
    for (const id of ['landscaping-route', 'landscaping-snow']) {
      const s = specFor(id)!
      expect(SPECS).toContain(s)
      expect(s.any.length).toBeGreaterThan(0)
      expect(s.feature).toBeTruthy()
    }
    expect(spec('landscaping-snow').detail!.actions!.find((a) => a.id === 'skip')!.any).toEqual(['jobs:dispatch'])
  })
})
