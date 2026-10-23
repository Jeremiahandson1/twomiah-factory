// Roofing's field group (server/crm/roof/field; docs/UNIFIED_ROOF_PLAN.md step 3), through the real server as the roof
// vertical: storms and their leads (a dismissed storm leaves the board — T58), converting a lead into a homeowner and a
// roofing job made as jobs.ts makes one, the service area that falls back to the company's own zip, the storm feed with
// a stub (never the network), storm radar, canvassing by seat (the field rung's own, the viewer reads the team's and
// writes none, "mine", scripts under marketing:update), crews, materials with their cost under margin:read, roofing's
// dashboard and what it withholds, and company scoping.
import { describe, test, expect, beforeAll } from 'bun:test'
import { Hono } from 'hono'
import { and, eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import logger from '../server/core/logger.ts'
import type { CrmDeps } from '../server/crm/deps.ts'
import { createRoofDashboardRoutes } from '../server/crm/roof/field/dashboard.ts'
import { createStormData, serviceAreaZips } from '../server/crm/roof/field/stormData.ts'
import { createStormRadar } from '../server/crm/roof/field/stormRadarService.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let d: CrmDeps
let companyId = ''
let otherId = ''
const tokens: Record<string, string> = {}
const ids: Record<string, string> = {}
const PASS = 'Seat-pass-1'
// crews: the Crews switch gates /api/crews (2026-10-22: it was ungated).
const FEATURES = ['jobs', 'contacts', 'dashboard', 'lead_inbox', 'storm_lead_gen', 'storm_radar_overlay', 'canvassing_tool', 'materials', 'crews']

const login = async (email: string, password: string) =>
  (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken as string
const as = (who: string) => (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tokens[who]}` } })
const json = async (r: Response) => ({ status: r.status, body: await r.json().catch(() => null) as any })
const call = async (who: string, method: string, p: string, body?: unknown) => json(await as(who)(p, { method, ...(body === undefined ? {} : { json: body }) }))

beforeAll(async () => {
  t = await bootTenant({ vertical: 'roofing' })
  const seeded = await seedOwner(t)
  companyId = seeded.company.id
  ids.owner = seeded.owner.id
  await t.db.update(t.schema.company).set({ enabledFeatures: FEATURES, zip: '44301' } as any).where(eq(t.schema.company.id, companyId))
  tokens.owner = await login('owner@test.example', seeded.password)
  const hash = await Bun.password.hash(PASS, 'bcrypt')
  for (const [key, role] of [['mgr', 'manager'], ['rep', 'field'], ['rep2', 'field'], ['view', 'viewer']] as const) {
    const [u] = await t.db.insert(t.schema.user).values({ email: `${key}@test.example`, passwordHash: hash, firstName: key, lastName: 'Seat', role, companyId } as any).returning()
    ids[key] = u.id
    tokens[key] = await login(`${key}@test.example`, PASS)
  }
  const [other] = await t.db.insert(t.schema.company).values({ name: 'Other Roofing', slug: 'other-roofing', zip: '90210' } as any).returning()
  otherId = other.id
  const s = t.services as any
  d = { db: t.db, audit: s.audit, logger, authenticate: s.authenticate, permissions: s.permissions, features: s.features, realtime: s.realtime, services: s.crm, settings: { roof: true } } as any
}, 120_000)

describe('storms', () => {
  test('a storm needs a zip and a real date; the board is { data, pagination }; a crew seat cannot enter one', async () => {
    expect((await call('mgr', 'POST', '/api/storms/events', {})).status).toBe(400)
    expect((await call('mgr', 'POST', '/api/storms/events', { affectedZipCodes: ['44301'], eventDate: 'not a date' })).status).toBe(400)
    expect((await call('rep', 'POST', '/api/storms/events', { affectedZipCodes: ['44301'] })).status).toBe(403)
    const keep = await call('mgr', 'POST', '/api/storms/events', { affectedZipCodes: ['44301'], eventType: 'hail', hailSizeInches: 1.75, eventDate: '2026-10-10T18:00:00Z' })
    const drop = await call('mgr', 'POST', '/api/storms/events', { affectedZipCodes: ['44302'], eventType: 'wind' })
    expect([keep.status, drop.status]).toEqual([201, 201])
    expect(keep.body).toMatchObject({ status: 'detected', source: 'manual', hailSizeInches: '1.75' })
    ids.storm = keep.body.id
    ids.dropStorm = drop.body.id
    const board = await call('rep', 'GET', '/api/storms/events')
    expect(board.status).toBe(200)
    expect(board.body.pagination).toMatchObject({ page: 1, total: 2 })
  })

  test('a dismissed storm leaves the board, and is still found when asked for (T58); another company\'s is out of reach', async () => {
    const [theirs] = await t.db.insert(t.schema.stormEvent).values({ companyId: otherId, eventDate: new Date(), eventType: 'hail', affectedZipCodes: ['90210'] } as any).returning()
    expect((await call('mgr', 'POST', `/api/storms/events/${ids.dropStorm}/dismiss`)).body.status).toBe('dismissed')
    const board = await call('mgr', 'GET', '/api/storms/events')
    expect(board.body.data.map((e: any) => e.id)).toEqual([ids.storm])
    expect((await call('mgr', 'GET', '/api/storms/events?status=dismissed')).body.data.map((e: any) => e.id)).toEqual([ids.dropStorm])
    expect((await call('mgr', 'GET', '/api/storms/events?includeDismissed=true')).body.pagination.total).toBe(2)
    expect((await call('mgr', 'POST', `/api/storms/events/${theirs.id}/dismiss`)).status).toBe(404)
    expect((await call('mgr', 'GET', `/api/storms/events/${theirs.id}`)).status).toBe(404)
  })

  test('leads are the company\'s own contacts in the storm\'s zips, less an address that already has a job', async () => {
    const mk = async (name: string, address: string, zip: string, co = companyId) =>
      (await t.db.insert(t.schema.contact).values({ companyId: co, name, address, zip, city: 'Akron', state: 'OH' } as any).returning())[0]
    ids.c1 = (await mk('Lee Marsh', '1 Elm St', '44301')).id
    ids.c2 = (await mk('Ada Byrne', '2 Elm St', '44301')).id
    await mk('Has Job', '3 Elm St', '44301')
    await mk('Elsewhere', '9 Oak St', '44999')
    await mk('Not Ours', '4 Elm St', '44301', otherId)
    await t.db.insert(t.schema.job).values({ companyId, number: 'ROOF-0100', title: '3 Elm St', address: '3 Elm St', zip: '44301', jobType: 'insurance', status: 'lead' } as any)
    const gen = await call('mgr', 'POST', `/api/storms/events/${ids.storm}/generate-leads`)
    expect(gen.body).toEqual({ leadCount: 2, existingCustomersFound: 3 })
    const leads = await call('rep', 'GET', `/api/storms/events/${ids.storm}/leads`)
    expect(leads.body.pagination).toMatchObject({ total: 2, pages: 1 })
    expect(leads.body.data.every((l: any) => l.isExistingCustomer === true)).toBe(true)
    ids.lead1 = leads.body.data.find((l: any) => l.address === '1 Elm St').id
    ids.lead2 = leads.body.data.find((l: any) => l.address === '2 Elm St').id
    // A second run leads nobody twice.
    expect((await call('mgr', 'POST', `/api/storms/events/${ids.storm}/generate-leads`)).body.leadCount).toBe(0)
    expect((await call('mgr', 'PUT', `/api/storms/leads/${ids.lead1}`, {})).status).toBe(400)
  })

  test('a converted lead is a homeowner with one name and a roofing job made as jobs.ts makes one; once', async () => {
    const r = await call('mgr', 'POST', `/api/storms/leads/${ids.lead1}/convert`, { name: '  Jane   Roe ', phone: '330-555-0101' })
    expect(r.status).toBe(200)
    const [homeowner] = await t.db.select().from(t.schema.contact).where(eq(t.schema.contact.id, r.body.contactId))
    expect(homeowner).toMatchObject({ name: 'Jane Roe', source: 'storm', propertyType: 'residential', address: '1 Elm St', zip: '44301', companyId })
    const [made] = await t.db.select().from(t.schema.job).where(eq(t.schema.job.id, r.body.jobId))
    // The company's highest ROOF number was 0100 (seeded above): the next is 0101 — numeric, only forwards.
    expect(made).toMatchObject({ number: 'ROOF-0101', title: '1 Elm St', address: '1 Elm St', jobType: 'insurance', status: 'lead', source: 'storm', priority: 'high', createdById: ids.mgr, contactId: homeowner.id })
    expect(made.notes).toContain('Storm lead — hail 1.75" hail on ')
    const [lead] = await t.db.select().from(t.schema.stormLead).where(eq(t.schema.stormLead.id, ids.lead1))
    expect(lead).toMatchObject({ status: 'converted', jobId: made.id, contactId: homeowner.id })
    expect((await call('mgr', 'POST', `/api/storms/leads/${ids.lead1}/convert`, { name: 'Again' })).status).toBe(400)
    // One word is the name as given — not "Jane Lead" (roofing's required last name filled with "Lead").
    expect((await call('rep', 'POST', `/api/storms/leads/${ids.lead2}/convert`, { name: 'Ada' })).status).toBe(403)
  })

  test('bulk convert names each homeowner "Storm Lead"; two at once convert once', async () => {
    const [ev] = await t.db.insert(t.schema.stormEvent).values({ companyId, eventDate: new Date('2026-10-11T00:00:00Z'), eventType: 'wind', affectedZipCodes: ['44301'] } as any).returning()
    const [a] = await t.db.insert(t.schema.stormLead).values({ companyId, stormEventId: ev.id, address: '7 Elm St', zip: '44301' } as any).returning()
    const [b] = await t.db.insert(t.schema.stormLead).values({ companyId, stormEventId: ev.id, address: '8 Elm St', zip: '44301' } as any).returning()
    const both = await Promise.all([
      call('mgr', 'POST', '/api/storms/leads/bulk-convert', { leadIds: [a.id, b.id] }),
      call('mgr', 'POST', '/api/storms/leads/bulk-convert', { leadIds: [a.id, b.id] }),
    ])
    expect(both[0].body.converted + both[1].body.converted).toBe(2)
    const jobs = await t.db.select().from(t.schema.job).where(and(eq(t.schema.job.companyId, companyId), eq(t.schema.job.source, 'storm')))
    expect(jobs.map((j: any) => j.number).sort()).toEqual(['ROOF-0101', 'ROOF-0102', 'ROOF-0103'])
    const names = await t.db.select({ name: t.schema.contact.name }).from(t.schema.contact).where(and(eq(t.schema.contact.companyId, companyId), eq(t.schema.contact.source, 'storm')))
    expect(names.map((n: any) => n.name).sort()).toEqual(['Jane Roe', 'Storm Lead', 'Storm Lead'])
    expect((await call('mgr', 'POST', '/api/storms/leads/bulk-dismiss', { leadIds: [ids.lead2, 'nope'] })).body).toEqual({ dismissed: 1 })
  })

  test('the service area is the company\'s own zip until one is set; an emptied list stays empty', async () => {
    expect((await call('rep', 'GET', '/api/storms/service-area')).body).toMatchObject({ zipCodes: ['44301'], autoGenerate: false })
    expect((await call('rep', 'PUT', '/api/storms/service-area', { zipCodes: [] })).status).toBe(403)
    expect((await call('mgr', 'PUT', '/api/storms/service-area', { zipCodes: [] })).body).toEqual({ success: true })
    expect((await call('rep', 'GET', '/api/storms/service-area')).body.zipCodes).toEqual([])
    await call('mgr', 'PUT', '/api/storms/service-area', { zipCodes: ['44301', '44302'], autoGenerate: true })
    expect((await call('rep', 'GET', '/api/storms/service-area')).body).toMatchObject({ zipCodes: ['44301', '44302'], autoGenerate: true })
    expect(serviceAreaZips({ zip: ' 53703 ', settings: {} })).toEqual(['53703'])
    expect(serviceAreaZips({ zip: null, settings: {} })).toEqual([])
  })

  test('the daily storm check reads the feed through what it is handed (a stub here), for companies with storm_lead_gen, by their own zip when none is set', async () => {
    const asked: string[] = []
    const stub = (async (url: any) => { asked.push(String(url)); return new Response('type,mag,loc\nHail,1.25,Akron\n', { status: 200 }) }) as any
    const [fresh] = await t.db.insert(t.schema.company).values({ name: 'Fresh Roofing', slug: 'fresh-roofing', zip: '53703', enabledFeatures: ['storm_lead_gen'] } as any).returning()
    await createStormData(d, { fetch: stub }).runDailyStormCheck()
    // Ours (44301, 44302, set above, auto-generate on) and the fresh company (its own zip); the other company has no storm_lead_gen.
    expect(asked.length).toBe(2)
    const [freshEvent] = await t.db.select().from(t.schema.stormEvent).where(eq(t.schema.stormEvent.companyId, fresh.id))
    expect(freshEvent).toMatchObject({ source: 'noaa', eventType: 'hail', affectedZipCodes: ['53703'], hailSizeInches: '1.25' })
    expect((await t.db.select().from(t.schema.stormEvent).where(eq(t.schema.stormEvent.companyId, otherId))).length).toBe(1) // only the one seeded above
  })
})

describe('storm radar', () => {
  test('unconfigured: the status says so and a sync is the rulebook\'s 503 with a code, the detail kept to the log', async () => {
    const st = await call('rep', 'GET', '/api/storm-radar/status')
    expect(st.body).toMatchObject({ provider: 'noaa', configured: false })
    expect((await call('rep', 'POST', '/api/storm-radar/sync', {})).status).toBe(403)
    const sync = await call('mgr', 'POST', '/api/storm-radar/sync', {})
    expect(sync).toEqual({ status: 503, body: { error: 'Storm Radar is not connected yet. Add it in Settings › Integrations.', code: 'not_configured' } })
  })

  test('a provider\'s events are kept once each, and an event\'s contacts are matched once each', async () => {
    const event = { providerEventId: 'evt-1', eventType: 'hail' as const, lat: 41.08, lng: -81.51, zip: '44301', startedAt: new Date('2026-10-12T20:00:00Z'), rawPayload: {} }
    const radar = createStormRadar(d, { fetchers: { noaa: async () => [event] }, env: { NOAA_API_BASE: 'stub' } })
    expect(radar.isConfigured()).toBe(true)
    expect(await radar.syncStormEvents(companyId)).toMatchObject({ fetchedCount: 1, insertedCount: 1 })
    expect(await radar.syncStormEvents(companyId)).toMatchObject({ fetchedCount: 1, insertedCount: 0 })
    const events = await call('rep', 'GET', '/api/storm-radar/events')
    expect(events.body.pagination.total).toBe(1)
    const id = events.body.data[0].id
    const first = await call('mgr', 'POST', `/api/storm-radar/events/${id}/match`)
    const again = await call('mgr', 'POST', `/api/storm-radar/events/${id}/match`)
    expect(first.body).toEqual({ success: true, matchedCount: again.body.matchedCount })
    const matches = await call('rep', 'GET', '/api/storm-radar/matches')
    expect(matches.body.pagination.total).toBe(first.body.matchedCount) // not twice
    expect(first.body.matchedCount).toBeGreaterThan(0)
    const m = matches.body.data[0].id
    expect((await call('mgr', 'POST', `/api/storm-radar/matches/${m}/status`, { status: 'banana' })).status).toBe(400)
    const contacted = await call('mgr', 'POST', `/api/storm-radar/matches/${m}/status`, { status: 'contacted', notes: 'left a message' })
    expect(contacted.body).toMatchObject({ status: 'contacted', notes: 'left a message' })
    expect(contacted.body.contactedAt).toBeTruthy()
    expect((await call('mgr', 'POST', `/api/storm-radar/matches/${m}/status`, { notes: 'called back' })).body).toMatchObject({ status: 'contacted', notes: 'called back' })
    expect((await call('mgr', 'POST', '/api/storm-radar/events/nope/match')).status).toBe(404)
  })
})

describe('canvassing', () => {
  test('a field seat logs its own session; a door that wants an inspection becomes a homeowner and a roofing job', async () => {
    const s = await call('rep', 'POST', '/api/canvassing/sessions', { name: 'Elm St sweep', weatherEvent: 'Oct 10 hail', centerLat: 41.08 })
    expect(s.status).toBe(201)
    ids.session = s.body.id
    expect((await call('rep', 'POST', `/api/canvassing/sessions/${ids.session}/stops`, { outcome: 'banana', address: '1 Oak' })).status).toBe(400)
    expect((await call('rep', 'POST', `/api/canvassing/sessions/${ids.session}/stops`, { outcome: 'no_answer', followUpDate: 'soon' })).status).toBe(400)
    const door = await call('rep', 'POST', `/api/canvassing/sessions/${ids.session}/stops`, {
      outcome: 'appointment_set', homeownerName: ' Ray  Fox ', phone: '(330) 555-0199', address: '20 Oak St', city: 'Akron', state: 'OH', zip: '44301',
      notes: 'Dented gutters', appointmentDate: '2026-10-21T15:00:00Z', lat: 41.081, lng: -81.512,
    })
    expect(door.status).toBe(201)
    expect(door.body.jobId).toBeTruthy()
    const [homeowner] = await t.db.select().from(t.schema.contact).where(eq(t.schema.contact.id, door.body.contactId))
    expect(homeowner).toMatchObject({ name: 'Ray Fox', source: 'canvassing', phone: '(330) 555-0199' })
    const [made] = await t.db.select().from(t.schema.job).where(eq(t.schema.job.id, door.body.jobId))
    expect(made).toMatchObject({ number: 'ROOF-0104', title: '20 Oak St', address: '20 Oak St', priority: 'high', source: 'canvassing', createdById: ids.rep, notes: 'Canvassing lead — Oct 10 hail — Elm St sweep\nDented gutters' })
    expect(new Date(made.inspectionDate as any).toISOString()).toBe('2026-10-21T15:00:00.000Z')
    ids.stop = door.body.id
    const [sess] = await t.db.select().from(t.schema.canvassingSession).where(eq(t.schema.canvassingSession.id, ids.session))
    expect(sess).toMatchObject({ totalDoors: 1, answeredDoors: 1, leadsCreated: 1 })
    // An edited door's outcome is one of the outcomes too.
    expect((await call('rep', 'PUT', `/api/canvassing/stops/${ids.stop}`, { outcome: 'banana' })).status).toBe(400)
    expect((await call('rep', 'PUT', `/api/canvassing/stops/${ids.stop}`, {})).status).toBe(400)
    expect((await call('rep', 'PUT', `/api/canvassing/stops/${ids.stop}`, { notes: 'came back later' })).body.notes).toBe('came back later')
    // A door with no answer counts as a door and nothing else; ending the session recounts from its doors.
    const quiet = await call('rep', 'POST', `/api/canvassing/sessions/${ids.session}/stops`, { outcome: 'no_answer', address: '22 Oak St' })
    expect([quiet.status, quiet.body.jobId, quiet.body.contactId]).toEqual([201, null, null])
    const ended = await call('rep', 'POST', `/api/canvassing/sessions/${ids.session}/end`, {})
    expect(ended.body).toMatchObject({ status: 'completed', totalDoors: 2, answeredDoors: 1, leadsCreated: 1 })
    await t.db.update(t.schema.canvassingSession).set({ status: 'active' } as any).where(eq(t.schema.canvassingSession.id, ids.session))
  })

  test('another canvasser\'s session is not theirs to know about; "mine" is one\'s own; the team sees everyone\'s', async () => {
    const own2 = await call('rep2', 'POST', '/api/canvassing/sessions', { name: 'Maple Ave' })
    ids.session2 = own2.body.id
    for (const [m, p, b] of [
      ['GET', `/api/canvassing/sessions/${ids.session}`], ['GET', `/api/canvassing/sessions/${ids.session}/stops`], ['GET', `/api/canvassing/sessions/${ids.session}/map`],
      ['PUT', `/api/canvassing/sessions/${ids.session}`, { name: 'x' }], ['POST', `/api/canvassing/sessions/${ids.session}/stops`, { outcome: 'no_answer' }],
      ['POST', `/api/canvassing/sessions/${ids.session}/end`, {}], ['PUT', `/api/canvassing/stops/${ids.stop}`, { notes: 'not mine' }],
    ] as const) expect([m, p, (await call('rep2', m, p, b)).status]).toEqual([m, p, 404])
    // Unfiltered, a field seat still gets only its own.
    expect((await call('rep2', 'GET', '/api/canvassing/sessions')).body.data.map((s: any) => s.id)).toEqual([ids.session2])
    const team = await call('mgr', 'GET', '/api/canvassing/sessions')
    expect(team.body.pagination.total).toBe(2)
    const ownerOwn = await call('owner', 'POST', '/api/canvassing/sessions', { name: "Owner's" })
    expect((await call('owner', 'GET', '/api/canvassing/sessions?mine=1')).body.data.map((s: any) => s.id)).toEqual([ownerOwn.body.id])
    expect((await call('mgr', 'PUT', `/api/canvassing/sessions/${ids.session}`, { name: 'Elm St (reviewed)' })).status).toBe(200)
    const map = await call('mgr', 'GET', `/api/canvassing/sessions/${ids.session}/map`)
    expect(map.body.data[0]).toMatchObject({ id: ids.stop, outcome: 'appointment_set', lat: '41.0810000' })
  })

  test('the viewer reads the team\'s canvassing and writes none of it', async () => {
    const list = await call('view', 'GET', '/api/canvassing/sessions')
    expect(list.body.pagination.total).toBe(3)
    expect((await call('view', 'GET', '/api/canvassing/sessions?mine=1')).body.data).toEqual([])
    for (const p of [`/api/canvassing/sessions/${ids.session}`, `/api/canvassing/sessions/${ids.session}/stops`, `/api/canvassing/sessions/${ids.session}/map`]) {
      expect([p, (await call('view', 'GET', p)).status]).toEqual([p, 200])
    }
    for (const [m, p, b] of [
      ['POST', '/api/canvassing/sessions', { name: 'v' }], ['PUT', `/api/canvassing/sessions/${ids.session}`, { name: 'v' }],
      ['POST', `/api/canvassing/sessions/${ids.session}/stops`, { outcome: 'no_answer' }], ['POST', `/api/canvassing/sessions/${ids.session}/end`, {}],
      ['PUT', `/api/canvassing/stops/${ids.stop}`, { outcome: 'not_interested' }], ['POST', '/api/canvassing/scripts', { name: 'v', steps: [{ title: 'a' }] }],
    ] as const) expect([m, p, [403, 404].includes((await call('view', m, p, b)).status)]).toEqual([m, p, true])
    const [after] = await t.db.select().from(t.schema.canvassingSession).where(eq(t.schema.canvassingSession.id, ids.session))
    expect(after).toMatchObject({ name: 'Elm St (reviewed)', status: 'active', totalDoors: 2 })
    // A canvasser the owner lets read the team (canvassing:read by name) reads another rep's session, and still writes only its own.
    await t.db.update(t.schema.user).set({ extraPermissions: ['canvassing:read'] } as any).where(eq(t.schema.user.id, ids.rep2))
    ;(t.services as any).permissions.invalidateExtraPermissions(ids.rep2)
    expect((await call('rep2', 'GET', `/api/canvassing/sessions/${ids.session}`)).status).toBe(200)
    expect((await call('rep2', 'GET', '/api/canvassing/sessions')).body.pagination.total).toBe(3)
    for (const [m, p, b] of [
      ['PUT', `/api/canvassing/sessions/${ids.session}`, { name: 'lead' }], ['POST', `/api/canvassing/sessions/${ids.session}/stops`, { outcome: 'no_answer' }],
      ['POST', `/api/canvassing/sessions/${ids.session}/end`, {}], ['PUT', `/api/canvassing/stops/${ids.stop}`, { notes: 'lead' }],
    ] as const) expect([m, p, (await call('rep2', m, p, b)).status]).toEqual([m, p, 404])
  })

  test('the scripts are read by every seat and written under marketing:update; the default one stays', async () => {
    const read = await call('rep', 'GET', '/api/canvassing/scripts')
    expect(read.status).toBe(200)
    expect(read.body).toHaveProperty('pagination')
    expect((await call('rep', 'POST', '/api/canvassing/scripts', { name: 'Mine', steps: [{ title: 'Hi', body: 'Hello' }] })).status).toBe(403)
    expect((await call('mgr', 'POST', '/api/canvassing/scripts', { name: 'Blank', steps: [{ title: ' ', body: '' }] })).status).toBe(400)
    const made = await call('mgr', 'POST', '/api/canvassing/scripts', { name: ' House pitch ', steps: [{ title: 'Opener', body: 'Hello', tips: '' }, { title: '', body: '' }] })
    expect(made.body).toMatchObject({ name: 'House pitch', isDefault: false, steps: [{ title: 'Opener', body: 'Hello', tips: '' }] })
    expect((await call('mgr', 'POST', '/api/canvassing/scripts', {})).status).toBe(400)
    expect((await call('mgr', 'POST', '/api/canvassing/scripts', { name: '   ', steps: [{ title: 'Opener', body: 'Hello' }] })).status).toBe(400)
    // Renaming alone keeps the steps; an edit cannot empty them. (T60)
    expect((await call('mgr', 'PUT', `/api/canvassing/scripts/${made.body.id}`, { name: 'House pitch v2' })).body).toMatchObject({ name: 'House pitch v2', steps: [{ title: 'Opener' }] })
    expect((await call('mgr', 'PUT', `/api/canvassing/scripts/${made.body.id}`, { steps: [] })).status).toBe(400)
    expect((await call('mgr', 'DELETE', `/api/canvassing/scripts/${made.body.id}`)).body).toEqual({ success: true })
    const [dflt] = await t.db.insert(t.schema.canvassingScript).values({ companyId, name: 'Default', isDefault: true, steps: [] } as any).returning()
    expect((await call('mgr', 'DELETE', `/api/canvassing/scripts/${dflt.id}`)).status).toBe(400)
  })
})

describe('crews', () => {
  test('every seat reads the crews (Reports names its rows by them); a crew\'s jobs carry the CRM\'s number and address', async () => {
    expect((await call('rep', 'POST', '/api/crews', { name: 'North', foremanName: 'Ray', foremanPhone: '608-555-0190', size: 4 })).status).toBe(403)
    expect((await call('mgr', 'POST', '/api/crews', { name: 'North', foremanName: 'Ray', foremanPhone: 'abcdefghij', size: 4 })).status).toBe(400)
    const made = await call('mgr', 'POST', '/api/crews', { name: 'North', foremanName: 'Ray', foremanPhone: '608-555-0190', size: 4 })
    expect(made.status).toBe(201)
    ids.crew = made.body.id
    await t.db.update(t.schema.job).set({ assignedCrewId: ids.crew } as any).where(eq(t.schema.job.number, 'ROOF-0101'))
    const listed = await call('rep', 'GET', '/api/crews')
    expect(listed.body.pagination.total).toBe(1)
    const one = await call('rep', 'GET', `/api/crews/${ids.crew}`)
    expect(one.body.activeJobs).toEqual([expect.objectContaining({ number: 'ROOF-0101', address: '1 Elm St' })])
    expect(one.body.activeJobs[0]).not.toHaveProperty('jobNumber')
    // A finished or closed job is not active work for the crew (the template listed every job it ever had).
    const [assigned] = await t.db.select().from(t.schema.job).where(eq(t.schema.job.number, 'ROOF-0101'))
    for (const status of ['collected', 'cancelled']) {
      await t.db.update(t.schema.job).set({ status } as any).where(eq(t.schema.job.id, assigned.id))
      expect((await call('rep', 'GET', `/api/crews/${ids.crew}`)).body.activeJobs).toEqual([])
    }
    await t.db.update(t.schema.job).set({ status: assigned.status } as any).where(eq(t.schema.job.id, assigned.id))
    const [theirs] = await t.db.insert(t.schema.crew).values({ companyId: otherId, name: 'Theirs', foremanName: 'X', foremanPhone: '6085550000', size: 2 } as any).returning()
    expect((await call('mgr', 'GET', `/api/crews/${theirs.id}`)).status).toBe(404)
    expect((await call('mgr', 'PUT', `/api/crews/${theirs.id}`, { size: 3 })).status).toBe(404)
    expect((await call('mgr', 'DELETE', `/api/crews/${theirs.id}`)).status).toBe(404)
    expect((await call('mgr', 'PUT', `/api/crews/${ids.crew}`, { size: 5 })).body.size).toBe(5)
  })
})

describe('materials', () => {
  test('lines in either spelling are normalised and the order is worth its lines; its cost is margin:read\'s', async () => {
    const jobId = (await t.db.select().from(t.schema.job).where(eq(t.schema.job.number, 'ROOF-0101')))[0].id
    const [theirJob] = await t.db.insert(t.schema.job).values({ companyId: otherId, number: 'ROOF-0001', title: 'x', jobType: 'insurance' } as any).returning()
    const order = { jobId, supplier: 'ABC Supply', lineItems: [{ description: 'Shingles', quantity: 30, unitCost: 100 }, { description: 'Nails', qty: 2, unit: 'box', unitPrice: 12.5 }], totalCost: 1 }
    expect((await call('rep', 'POST', '/api/materials', order)).status).toBe(403)
    expect((await call('mgr', 'POST', '/api/materials', { ...order, jobId: theirJob.id })).status).toBe(404)
    expect((await call('mgr', 'POST', '/api/materials', { ...order, orderStatus: 'banana' })).status).toBe(400)
    const made = await call('mgr', 'POST', '/api/materials', { ...order, deliveryDate: '2026-10-25' })
    expect(made.status).toBe(201)
    expect(made.body).toMatchObject({ totalCost: '3025.00', orderStatus: 'not_ordered', lineItems: [
      { description: 'Shingles', qty: 30, unit: 'ea', unitPrice: 100, total: 3000 }, { description: 'Nails', qty: 2, unit: 'box', unitPrice: 12.5, total: 25 },
    ] })
    ids.material = made.body.id
    const mgrList = await call('mgr', 'GET', '/api/materials')
    expect(mgrList.body.data[0]).toMatchObject({ totalCost: '3025.00', jobNumber: 'ROOF-0101', status: 'not_ordered' })
    expect(mgrList.body).not.toHaveProperty('moneyWithheld')
    for (const who of ['rep', 'view']) {
      const l = await call(who, 'GET', '/api/materials')
      expect(l.body.data[0]).not.toHaveProperty('totalCost')
      expect(l.body.data[0].lineItems[0]).toEqual({ description: 'Shingles', qty: 30, unit: 'ea' })
      const o = await call(who, 'GET', `/api/materials/${ids.material}`)
      expect(o.body).not.toHaveProperty('totalCost')
      expect(o.body.lineItems[1]).toEqual({ description: 'Nails', qty: 2, unit: 'box' })
    }
    expect((await call('owner', 'GET', `/api/materials/${ids.material}`)).body.totalCost).toBe('3025.00')
  })

  test('an edit recomputes the total from its lines, never the client\'s; \'\' clears a date; another company\'s order is out of reach', async () => {
    const ed = await call('mgr', 'PUT', `/api/materials/${ids.material}`, { lineItems: [{ description: 'Ridge cap', qty: 3, unitPrice: 50 }], totalCost: 9, deliveryDate: '' })
    expect(ed.status).toBe(200)
    expect(ed.body).toMatchObject({ totalCost: '150.00', deliveryDate: null })
    expect((await call('mgr', 'PUT', `/api/materials/${ids.material}`, { orderDate: 'tomorrow-ish' })).status).toBe(400)
    const [theirs] = await t.db.insert(t.schema.material).values({ companyId: otherId, jobId: (await t.db.select().from(t.schema.job).where(eq(t.schema.job.companyId, otherId)))[0].id, supplier: 'X', lineItems: [] } as any).returning()
    expect((await call('mgr', 'GET', `/api/materials/${theirs.id}`)).status).toBe(404)
    expect((await call('mgr', 'DELETE', `/api/materials/${theirs.id}`)).status).toBe(404)
    expect((await call('mgr', 'GET', '/api/materials')).body.pagination.total).toBe(1)
    expect((await as('mgr')(`/api/materials/${ids.material}`, { method: 'DELETE' })).status).toBe(204)
  })

  test('the gate: materials off, the module answers no', async () => {
    await t.db.update(t.schema.company).set({ enabledFeatures: FEATURES.filter((f) => f !== 'materials') } as any).where(eq(t.schema.company.id, companyId))
    ;(t.services as any).features.forgetFeatures(companyId)
    expect((await call('mgr', 'GET', '/api/materials')).status).toBe(403)
    expect((await call('mgr', 'GET', '/api/crews')).status).toBe(200) // its own switch, still on
    await t.db.update(t.schema.company).set({ enabledFeatures: FEATURES } as any).where(eq(t.schema.company.id, companyId))
    ;(t.services as any).features.forgetFeatures(companyId)
  })
})

describe('roofing\'s dashboard', () => {
  test('counts what a roofing job has, on the company\'s day; the money and the leads only for who may see them', async () => {
    const [co] = await t.db.insert(t.schema.company).values({ name: 'Dash Roofing', slug: 'dash-roofing', enabledFeatures: ['lead_inbox'] } as any).returning()
    const hash = await Bun.password.hash(PASS, 'bcrypt')
    const seat = async (key: string, role: string) => {
      const [u] = await t.db.insert(t.schema.user).values({ email: `${key}@dash.example`, passwordHash: hash, firstName: key, lastName: 'D', role, companyId: co.id } as any).returning()
      return u
    }
    const people = { owner: await seat('downer', 'owner'), crew: await seat('dcrew', 'field'), books: await seat('dbooks', 'viewer') }
    const [ct] = await t.db.insert(t.schema.contact).values({ companyId: co.id, name: 'Hank Homeowner' } as any).returning()
    const now = new Date(), lastWeek = new Date(Date.now() - 7 * 864e5)
    const base = { companyId: co.id, contactId: ct.id, jobType: 'replacement', title: '1 Shingle Ln', address: '1 Shingle Ln' }
    await t.db.insert(t.schema.job).values([
      { ...base, number: 'ROOF-0001', status: 'inspection_scheduled', inspectionDate: now },
      { ...base, number: 'ROOF-0002', status: 'in_production', installDate: now },
      { ...base, number: 'ROOF-0003', status: 'proposal_sent', inspectionDate: lastWeek },
      { ...base, number: 'ROOF-0004', status: 'collected', installDate: lastWeek },
      { ...base, number: 'ROOF-0005', status: 'lost', lostReason: 'price' },
      { ...base, number: 'ROOF-0006', status: 'cancelled', lostReason: 'sold the house' },
    ] as any)
    await t.db.insert(t.schema.quote).values(['draft', 'sent', 'approved'].map((status, i) => ({ companyId: co.id, contactId: ct.id, number: `Q-${i}`, name: 'Roof', status, total: '1000' })) as any)
    await t.db.insert(t.schema.invoice).values([
      { status: 'sent', total: '1000', amountPaid: '0' },
      { status: 'partial', total: '1000', amountPaid: '400' },
      { status: 'paid', total: '1000', amountPaid: '1000' },
      { status: 'draft', total: '1000', amountPaid: '0' },
      { status: 'void', total: '1000', amountPaid: '0' },
    ].map((v, i) => ({ ...v, companyId: co.id, contactId: ct.id, number: `I-${i}` })) as any)
    await t.db.insert(t.schema.lead).values({ companyId: co.id, sourcePlatform: 'phone', homeownerName: 'Caller', status: 'new' } as any)
    // Another company's rows are not counted.
    await t.db.insert(t.schema.job).values({ companyId: otherId, number: 'ROOF-0009', title: 'x', jobType: 'insurance', status: 'lead', inspectionDate: now } as any)

    const app = new Hono().use('/api/dashboard/*', d.authenticate).route('/api/dashboard', createRoofDashboardRoutes(d))
    const tokenOf = async (u: any) => login(u.email, PASS)
    const stats = async (u: any) => json(await app.request('/api/dashboard/stats', { headers: { Authorization: `Bearer ${await tokenOf(u)}` } }))

    const owner = await stats(people.owner)
    expect(owner.status).toBe(200)
    expect(owner.body).toEqual({
      contacts: 1, newLeads: 1,
      jobs: { open: 3, inProduction: 1, inspectionsToday: 1, installsToday: 1 },
      quotes: { pending: 2 },
      invoices: { outstanding: 2, outstandingValue: 1600 },
    })
    const crew = await stats(people.crew)
    expect(crew.body.jobs.open).toBe(3)
    expect(crew.body).not.toHaveProperty('invoices') // absent, not $0 (T42)
    expect(crew.body.newLeads).toBe(1) // the field rung holds contacts:read
    const books = await stats(people.books)
    expect(books.body.invoices).toEqual({ outstanding: 2, outstandingValue: 1600 }) // the read-only seat reads the books
  })
})
