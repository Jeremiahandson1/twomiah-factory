// Landscaping gap 5: storm mode for snow & ice (data/snowStorm.ts, crm/landscaping/snowStorm.ts). Fails without it: /api/snow/storms
// does not exist. The contracts' own pricing rules (snowBilling.ts) are asserted through the storm's visits, so a storm can never
// price a push differently from the Snow Billing page.
import { describe, test, expect, beforeAll } from 'bun:test'
import { and, eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId: string
let ownerId: string
let owner: string
let crew: string
let crewId: string
let other: string
let otherId: string
let viewer: string
const as = (token: string, path: string, init: any = {}) => t.call(path, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } })
const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
const post = (token: string, path: string, json: any = {}) => as(token, path, { method: 'POST', json })

const login = async (email: string, password: string) =>
  (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken as string

async function seat(role: string, email = `${role}@test.example`) {
  const password = 'Correct-horse-1'
  const u = await ins(t.schema.user, { companyId, email, firstName: role, lastName: 'Seat', role, passwordHash: await Bun.password.hash(password, 'bcrypt') })
  return { token: await login(email, password), id: u.id as string }
}

beforeAll(async () => {
  t = await bootTenant({ vertical: 'landscaping' })
  const s = await seedOwner(t)
  companyId = s.company.id; ownerId = s.owner.id
  await t.db.update(t.schema.company).set({ enabledFeatures: ['contacts', 'jobs', 'quotes', 'invoices', 'recurring_routes', 'area_pricing', 'snow_billing'] }).where(eq(t.schema.company.id, companyId))
  owner = await login('owner@test.example', s.password)
  const f = await seat('field'); crew = f.token; crewId = f.id
  const o = await seat('field', 'field2@test.example'); other = o.token; otherId = o.id
  viewer = (await seat('viewer')).token
})

/** A customer with a property and an active snow contract. */
async function lot(name: string, contract: Record<string, any> = { billingMode: 'per_push', perPushRate: 50, saltRate: 20 }, tags: string[] = []) {
  const ct = await (await post(owner, '/api/contacts', { name: `${name} Co`, type: 'client' })).json()
  if (tags.length) await t.db.update(t.schema.contact).set({ tags }).where(eq(t.schema.contact.id, ct.id))
  const site = await (await post(owner, '/api/sites', { name, contactId: ct.id, address: `1 ${name} St`, city: 'Eau Claire' })).json()
  const res = await post(owner, '/api/snow/contracts', { siteId: site.id, ...contract })
  expect(res.status).toBe(201)
  return { ct, site, contract: await res.json() }
}

const storm = async (name = 'Storm') => (await (await post(owner, '/api/snow/storms', { name })).json()).storm
const stopsOf = async (stormId: string, token = owner) => (await (await as(token, `/api/snow/storms/${stormId}`)).json()).stops as any[]

describe('start and dispatch', () => {
  test('a route is dispatched in its own stop order, one job per active contract; paused contracts and a second dispatch add nothing', async () => {
    const a = await lot('Route Elm'); const b = await lot('Route Oak'); const c = await lot('Route Pine')
    await t.db.update(t.schema.snowContract).set({ status: 'paused' }).where(eq(t.schema.snowContract.id, c.contract.id))
    const route = await (await post(owner, '/api/recurring-routes', { name: 'North plow', dayOfWeek: 1, assignedToId: crewId })).json()
    // Pine first, then Oak, then Elm — the drive order is the route's, not alphabetical.
    for (const x of [c, b, a]) await post(owner, `/api/recurring-routes/${route.id}/stops`, { siteId: x.site.id, estimatedMinutes: 20 })
    const s = await storm('Dec storm')
    expect(s.status).toBe('active')

    const res = await post(owner, `/api/snow/storms/${s.id}/dispatch`, { target: { routeId: route.id } })
    expect(res.status).toBe(201)
    expect((await res.json()).made).toBe(2)
    const stops = await stopsOf(s.id)
    expect(stops.map((x) => x.siteName)).toEqual(['Route Oak', 'Route Elm'])
    expect(stops.every((x) => x.assignedToId === crewId && x.status === 'open' && x.jobId)).toBe(true)
    const jobs = await t.db.select().from(t.schema.job).where(eq(t.schema.job.assignedToId, crewId))
    expect(jobs.filter((j: any) => String(j.title).startsWith('Snow & ice')).length).toBeGreaterThanOrEqual(2)

    const again = await (await post(owner, `/api/snow/storms/${s.id}/dispatch`, { target: { routeId: route.id } })).json()
    expect(again.made).toBe(0)
    expect(again.alreadyThere).toBe(2)
    expect((await stopsOf(s.id)).length).toBe(2)
  })

  test('a tag dispatches the contracts of customers carrying it; naming nothing is refused', async () => {
    const x = await lot('Tag Alder', undefined, ['Snow-North']); const y = await lot('Tag Birch', undefined, ['snow-south'])
    const s = await storm('Tag storm')
    const none = await post(owner, `/api/snow/storms/${s.id}/dispatch`, { target: {} })
    expect(none.status).toBe(400)
    const res = await post(owner, `/api/snow/storms/${s.id}/dispatch`, { target: { tag: 'snow-north' }, assignedToId: crewId })
    expect(res.status).toBe(201)
    const stops = await stopsOf(s.id)
    expect(stops.map((z) => z.siteName)).toEqual(['Tag Alder'])
    expect(stops[0].siteId).toBe(x.site.id)
    expect(y.site.id).not.toBe(stops[0].siteId)
  })

  test('a crew seat, a viewer and a seat without dispatch cannot start or dispatch a storm', async () => {
    for (const token of [crew, viewer]) {
      expect((await post(token, '/api/snow/storms', { name: 'Nope' })).status).toBe(403)
    }
    const s = await storm('Guarded')
    expect((await post(crew, `/api/snow/storms/${s.id}/dispatch`, { target: { all: true } })).status).toBe(403)
    expect((await post(crew, `/api/snow/storms/${s.id}/end`)).status).toBe(403)
    expect((await post(crew, `/api/snow/storms/${s.id}/bill`, { confirm: true })).status).toBe(403)
    expect((await post(viewer, `/api/snow/storms/${s.id}/bill`, { confirm: true })).status).toBe(403)
  })
})

describe('the crew logs the visit', () => {
  test('priced by the contract rules; money hidden from the crew; the job is done; a replay never bills twice; another crew is refused', async () => {
    const l = await lot('Crew Lot', { billingMode: 'per_push', perPushRate: 50, saltRate: 20, triggerDepthInches: 2 })
    const s = await storm('Log storm')
    await post(owner, `/api/snow/storms/${s.id}/dispatch`, { target: { contractIds: [l.contract.id] }, assignedToId: crewId })
    const [stop] = await stopsOf(s.id)

    // The crew sees its stop on "Today's route" and can read it, with no money on it.
    const mine = await (await as(crew, '/api/snow/storms/mine/stops')).json()
    expect(mine.data.some((x: any) => x.id === stop.id)).toBe(true)
    // Another crew's seat can neither start nor log it.
    expect((await post(other, `/api/snow/storms/stops/${stop.id}/log`, { pushes: 1 })).status).toBe(403)
    expect((await post(other, `/api/snow/storms/stops/${stop.id}/start`)).status).toBe(403)
    expect((await (await as(other, '/api/snow/storms/mine/stops')).json()).data.length).toBe(0)

    expect((await post(crew, `/api/snow/storms/stops/${stop.id}/start`)).status).toBe(200)
    const res = await post(crew, `/api/snow/storms/stops/${stop.id}/log`, { pushes: 2, snowfallInches: 3, saltApplied: true, notes: 'Drift at the gate' })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.event.pushes).toBe(2)
    expect(body.event.billableAmount).toBeUndefined() // the crew does not see what it bills
    // 2 pushes × $50 + $20 salt, exactly as the Snow Billing page prices it.
    const [row] = await t.db.select().from(t.schema.snowEvent).where(eq(t.schema.snowEvent.id, body.event.id))
    expect(Number(row.billableAmount)).toBe(120)
    expect(row.stormId).toBe(s.id)
    const [j] = await t.db.select().from(t.schema.job).where(eq(t.schema.job.id, stop.jobId))
    expect(j.status).toBe('completed')

    const replay = await post(crew, `/api/snow/storms/stops/${stop.id}/log`, { pushes: 2, snowfallInches: 3, saltApplied: true })
    expect(replay.status).toBe(200)
    expect((await replay.json()).alreadyLogged).toBe(true)
    expect((await t.db.select().from(t.schema.snowEvent).where(eq(t.schema.snowEvent.snowContractId, l.contract.id))).length).toBe(1)

    // The office sees the money on the same storm; the crew does not.
    const seen = (await stopsOf(s.id)).find((x) => x.id === stop.id)
    expect(Number(seen.event.billableAmount)).toBe(120)
    expect((await stopsOf(s.id, crew)).find((x) => x.id === stop.id).event.billableAmount).toBeUndefined()
  })

  test("the trigger depth still applies: a push below the contract's trigger is not charged, and a bad figure is refused", async () => {
    const l = await lot('Trigger Lot', { billingMode: 'per_push', perPushRate: 50, triggerDepthInches: 2 })
    const s = await storm('Trigger storm')
    await post(owner, `/api/snow/storms/${s.id}/dispatch`, { target: { contractIds: [l.contract.id] }, assignedToId: crewId })
    const [stop] = await stopsOf(s.id)
    expect((await post(crew, `/api/snow/storms/stops/${stop.id}/log`, { pushes: 'lots' })).status).toBe(400)
    const res = await post(crew, `/api/snow/storms/stops/${stop.id}/log`, { pushes: 1, snowfallInches: 1 })
    expect(res.status).toBe(201)
    const [row] = await t.db.select().from(t.schema.snowEvent).where(eq(t.schema.snowEvent.snowContractId, l.contract.id))
    expect(Number(row.billableAmount)).toBe(0)
  })
})

describe('hourly mode', () => {
  test('an hourly contract is billed by the hours — typed, or from the crew\'s Start — and refuses a visit with no hours', async () => {
    const l = await lot('Hourly Lot', { billingMode: 'hourly', hourlyRate: 80 })
    // The existing contract rules ask for the rate the mode bills by.
    const bad = await post(owner, '/api/snow/contracts', { siteId: l.site.id, billingMode: 'hourly' })
    expect(bad.status).toBe(400)

    const s = await storm('Hourly storm')
    await post(owner, `/api/snow/storms/${s.id}/dispatch`, { target: { contractIds: [l.contract.id] }, assignedToId: crewId })
    const [stop] = await stopsOf(s.id)
    // No Start and no hours: nothing to bill by.
    expect((await post(crew, `/api/snow/storms/stops/${stop.id}/log`, { pushes: 1 })).status).toBe(400)
    // Start, then pretend the crew has been there an hour and a half.
    await post(crew, `/api/snow/storms/stops/${stop.id}/start`)
    await t.db.update(t.schema.snowStormStop).set({ startedAt: new Date(Date.now() - 90 * 60_000) }).where(eq(t.schema.snowStormStop.id, stop.id))
    const res = await post(crew, `/api/snow/storms/stops/${stop.id}/log`, {})
    expect(res.status).toBe(201)
    const [row] = await t.db.select().from(t.schema.snowEvent).where(eq(t.schema.snowEvent.snowContractId, l.contract.id))
    expect(Number(row.hours)).toBeGreaterThanOrEqual(1.5)
    expect(Number(row.hours)).toBeLessThan(1.6)
    expect(Number(row.billableAmount)).toBeCloseTo(Number(row.hours) * 80, 2)

    // Typed hours win over the clock, and the same event can be logged straight on the Snow Billing page.
    const direct = await post(owner, '/api/snow/events', { snowContractId: l.contract.id, hours: 2.5 })
    expect(direct.status).toBe(201)
    expect(Number((await direct.json()).billableAmount)).toBe(200)
    const none = await post(owner, '/api/snow/events', { snowContractId: l.contract.id })
    expect(none.status).toBe(400)
  })
})

describe('log for everyone, then bill the storm', () => {
  test('one set of figures logs every open stop; stops that cannot take them are listed; the storm bills one draft per contract, storm visits only, once', async () => {
    const a = await lot('Bill Alpha', { billingMode: 'per_push', perPushRate: 40 })
    const b = await lot('Bill Beta', { billingMode: 'per_event', perEventRate: 90 })
    const h = await lot('Bill Hourly', { billingMode: 'hourly', hourlyRate: 60 })
    const sea = await lot('Bill Seasonal', { billingMode: 'seasonal', seasonalRate: 900 })
    // Alpha has an older, unbilled visit from before this storm: it must stay out of the storm's invoice.
    const older = await post(owner, '/api/snow/events', { snowContractId: a.contract.id, pushes: 1, servicedAt: '2026-01-05' })
    expect(older.status).toBe(201)

    const s = await storm('Bill storm')
    await post(owner, `/api/snow/storms/${s.id}/dispatch`, { target: { contractIds: [a.contract.id, b.contract.id, h.contract.id, sea.contract.id] }, assignedToId: crewId })
    const res = await post(owner, `/api/snow/storms/${s.id}/log-all`, { pushes: 2, snowfallInches: 4 })
    expect(res.status).toBe(200)
    const out = await res.json()
    expect(out.logged.length).toBe(3)
    expect(out.failed.length).toBe(1)
    expect(out.failed[0].siteName).toBe('Bill Hourly')

    // A seat that cannot read invoices cannot see the figures, and the crew cannot run a log-for-all at all.
    expect((await post(crew, `/api/snow/storms/${s.id}/log-all`, { pushes: 1 })).status).toBe(403)

    const preview = await (await post(owner, `/api/snow/storms/${s.id}/bill`, {})).json()
    expect(preview.confirmed).toBe(false)
    expect(preview.invoices).toBe(2)
    expect(preview.total).toBe(80 + 90)
    expect(preview.lines.find((x: any) => x.siteName === 'Bill Seasonal').skip).toMatch(/seasonal/i)
    expect((await t.db.select().from(t.schema.invoice).where(eq(t.schema.invoice.companyId, companyId))).length).toBe(0)

    const run = await post(owner, `/api/snow/storms/${s.id}/bill`, { confirm: true })
    expect(run.status).toBe(201)
    const done = await run.json()
    expect(done.invoices).toBe(2)
    const invoices = await t.db.select().from(t.schema.invoice).where(eq(t.schema.invoice.companyId, companyId))
    expect(invoices.length).toBe(2)
    expect(invoices.every((i: any) => i.status === 'draft')).toBe(true)
    // Alpha's older visit is still unbilled.
    const [old] = await t.db.select().from(t.schema.snowEvent).where(and(eq(t.schema.snowEvent.snowContractId, a.contract.id), eq(t.schema.snowEvent.pushes, 1)))
    expect(old.invoiceId).toBeNull()

    // Billing again finds nothing.
    const second = await (await post(owner, `/api/snow/storms/${s.id}/bill`, { confirm: true })).json()
    expect(second.invoices).toBe(0)
    expect((await t.db.select().from(t.schema.invoice).where(eq(t.schema.invoice.companyId, companyId))).length).toBe(2)
  })

  test('ending a storm skips what was never served and cancels those jobs; logging after it ends is refused', async () => {
    const a = await lot('End Alpha'); const b = await lot('End Beta')
    const s = await storm('End storm')
    await post(owner, `/api/snow/storms/${s.id}/dispatch`, { target: { contractIds: [a.contract.id, b.contract.id] }, assignedToId: crewId })
    const stops = await stopsOf(s.id)
    expect((await post(crew, `/api/snow/storms/stops/${stops[0].id}/log`, { pushes: 1 })).status).toBe(201)
    const res = await post(owner, `/api/snow/storms/${s.id}/end`)
    expect(res.status).toBe(200)
    expect((await res.json()).skipped).toBe(1)
    const after = await stopsOf(s.id)
    expect(after.map((x) => x.status).sort()).toEqual(['done', 'skipped'])
    const [j] = await t.db.select().from(t.schema.job).where(eq(t.schema.job.id, stops[1].jobId))
    expect(j.status).toBe('cancelled')
    expect((await post(crew, `/api/snow/storms/stops/${stops[1].id}/log`, { pushes: 1 })).status).toBe(409)
  })
})
