// Landscaping parity rows 22–25 and 30 — snow, finished (snowBilling.ts, snowStorm.ts, data/snowStorm.ts, data/snowForecast.ts),
// behind snow_tools (not ready):
//   · 22 depth-band pricing (Aspire): a rate table of depth bands per contract, looked up per visit;
//   · 23 a price override before billing, with a reason, audited (Aspire);
//   · 24 required before/after photos before a stop is logged (Service Autopilot); salt by quantity at a price per unit;
//   · 25 time-and-materials salt marked up (Aspire T&M); a storm-wide customer text; each stop's time scaled by the snowfall (LMN);
//   · 30 a storm proposed from the forecast for the contracts its snow reaches, started on its own only where the owner turned it on.
// Fails without the change: none of these existed.
import { describe, test, expect, beforeAll } from 'bun:test'
import { and, eq } from 'drizzle-orm'
import sharp from 'sharp'
import { bootTenant, seedOwner } from './harness.ts'
import { computeSnowEventCharge, depthBandsError, bandFor, readDepthBands } from '../server/crm/landscaping/snowBilling.ts'
import { expectedMinutes } from '../server/data/snowStorm.ts'
import { autoStartFromForecast, snowProposals } from '../server/data/snowForecast.ts'
import { FEATURE_REGISTRY } from '../../../packages/tenant-backend/src/featureRegistry.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId: string
let owner: string
let crew: string
let crewId: string
const as = (token: string, path: string, init: any = {}) => t.call(path, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } })
const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
const post = (token: string, path: string, json: any = {}) => as(token, path, { method: 'POST', json })
const put = (token: string, path: string, json: any = {}) => as(token, path, { method: 'PUT', json })
const login = async (email: string, password: string) => (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken as string
const BASE = ['contacts', 'jobs', 'quotes', 'invoices', 'recurring_routes', 'snow_billing', 'photo_capture']
const features = async (extra: string[]) => {
  await t.db.update(t.schema.company).set({ enabledFeatures: [...BASE, ...extra] } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
}
const BANDS = [{ from: 1, to: 4, amount: 60 }, { from: 4, to: 8, amount: 95 }, { from: 8, to: null, amount: 150 }]

beforeAll(async () => {
  t = await bootTenant({ vertical: 'landscaping' })
  const s = await seedOwner(t)
  companyId = s.company.id
  await t.db.update(t.schema.company).set({ address: '1 Main St', city: 'Eau Claire', state: 'WI', zip: '54701' } as any).where(eq(t.schema.company.id, companyId))
  await features(['snow_tools'])
  owner = await login('owner@test.example', s.password)
  const password = 'Correct-horse-1'
  const u = await ins(t.schema.user, { companyId, email: 'crew@test.example', firstName: 'Cam', lastName: 'Crew', role: 'field', passwordHash: await Bun.password.hash(password, 'bcrypt') })
  crewId = u.id; crew = await login('crew@test.example', password)
  // The photo store stands in for R2 (as the visit-report test does).
  Object.assign((t.services as any).crm.storage, { storageConfigured: () => true, put: async (k: string, b: Buffer, ty: string) => { await t.store.put(k, b, ty) }, getObject: async (k: string) => t.store.getObject(k), deleteFile: async (k: string) => { await t.store.remove(k) } })
})

let phoneN = 100
async function lot(name: string, contract: Record<string, any>) {
  const ct = await (await post(owner, '/api/contacts', { name: `${name} Co`, type: 'client', phone: `+1715555${String(phoneN++).padStart(4, '0')}` })).json()
  const site = await (await post(owner, '/api/sites', { name, contactId: ct.id, address: `1 ${name} St`, city: 'Eau Claire' })).json()
  const res = await post(owner, '/api/snow/contracts', { siteId: site.id, ...contract })
  const body = await res.json()
  return { ct, site, res, contract: res.status === 201 ? body : null }
}
async function stormFor(contractIds: string[], extra: any = {}) {
  const r = await (await post(owner, '/api/snow/storms', { name: 'Storm', ...extra, target: { contractIds }, assignedToId: crewId })).json()
  const stops = (await (await as(owner, `/api/snow/storms/${r.storm.id}`)).json()).stops as any[]
  return { storm: r.storm, stops }
}

describe('row 22: depth bands', () => {
  test('the pure rules: a band is found from its lower edge; tables that overlap or leave a gap open are refused', () => {
    expect(bandFor(readDepthBands(BANDS), 3.9)?.amount).toBe(60)
    expect(bandFor(readDepthBands(BANDS), 4)?.amount).toBe(95)
    expect(bandFor(readDepthBands(BANDS), 20)?.amount).toBe(150)
    expect(bandFor(readDepthBands(BANDS), 0.5)).toBeNull()
    expect(depthBandsError([{ from: 1, to: 5, amount: 1 }, { from: 4, to: 8, amount: 2 }])).toMatch(/overlap/)
    expect(depthBandsError([{ from: 1, to: null, amount: 1 }, { from: 4, to: 8, amount: 2 }])).toMatch(/last band/)
    expect(depthBandsError([])).toMatch(/at least one/)
    expect(computeSnowEventCharge({ billingMode: 'depth_band', depthBands: BANDS, perPushRate: 0, perEventRate: 0, perInchRate: 0, seasonalRate: 0, saltRate: 25, triggerDepthInches: 1 } as any, { pushes: 1, snowfallInches: 6, saltApplied: true })).toBe(120)
  })

  test('a depth-band contract prices each storm visit by its band; off, the mode is refused', async () => {
    const a = await lot('Band Lot', { billingMode: 'depth_band', depthBands: BANDS, triggerDepthInches: 1 })
    expect(a.res.status).toBe(201)
    const { stops } = await stormFor([a.contract.id])
    const logged = await (await post(crew, `/api/snow/storms/stops/${stops[0].id}/log`, { pushes: 2, snowfallInches: 9 })).json()
    const [ev] = await t.db.select().from(t.schema.snowEvent).where(eq(t.schema.snowEvent.id, logged.event.id))
    expect(Number(ev.billableAmount)).toBe(150)
    await features([])
    try { expect((await lot('Band Off', { billingMode: 'depth_band', depthBands: BANDS })).res.status).toBe(403) } finally { await features(['snow_tools']) }
  })
})

describe('row 23: the price before billing', () => {
  test('the office changes a visit’s amount with a reason; the contract’s figure is kept; a billed visit cannot change', async () => {
    const a = await lot('Override Lot', { billingMode: 'per_push', perPushRate: 50 })
    const { storm, stops } = await stormFor([a.contract.id])
    const logged = await (await post(crew, `/api/snow/storms/stops/${stops[0].id}/log`, { pushes: 2, snowfallInches: 5 })).json()
    expect((await put(owner, `/api/snow/events/${logged.event.id}/price`, { amount: 80 })).status).toBe(400)
    expect((await put(crew, `/api/snow/events/${logged.event.id}/price`, { amount: 80, reason: 'x' })).status).toBe(403)
    const r = await (await put(owner, `/api/snow/events/${logged.event.id}/price`, { amount: 80, reason: 'Second push was a quick clean-up' })).json()
    expect([Number(r.billableAmount), Number(r.computedAmount), r.overrideReason]).toEqual([80, 100, 'Second push was a quick clean-up'])
    const billed = await (await post(owner, `/api/snow/storms/${storm.id}/bill`, { confirm: true })).json()
    expect(billed.total).toBe(80)
    expect((await put(owner, `/api/snow/events/${logged.event.id}/price`, { amount: 90, reason: 'later' })).status).toBe(409)
  })
})

describe('row 24: required photos, salt by quantity', () => {
  test('a contract that requires photos is logged only once the stop has a before and an after photo', async () => {
    const a = await lot('Photo Lot', { billingMode: 'per_push', perPushRate: 50, requirePhotos: true })
    const { stops } = await stormFor([a.contract.id])
    const refused = await post(crew, `/api/snow/storms/stops/${stops[0].id}/log`, { pushes: 1, snowfallInches: 3 })
    expect(refused.status).toBe(409)
    expect((await refused.json()).error).toMatch(/before photo and an after photo/)
    const jpg = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#fff' } }).jpeg().toBuffer()
    for (const kind of ['before', 'after']) {
      const fd = new FormData(); fd.set('photo', new File([jpg], 'p.jpg', { type: 'image/jpeg' })); fd.set('kind', kind)
      expect((await as(crew, `/api/jobs/${stops[0].jobId}/photos`, { method: 'POST', body: fd })).status).toBe(201)
    }
    expect((await post(crew, `/api/snow/storms/stops/${stops[0].id}/log`, { pushes: 1, snowfallInches: 3 })).status).toBe(201)
  })

  test('salt is logged by amount and billed per unit; with no unit price the flat salt rate stands', async () => {
    const a = await lot('Salt Lot', { billingMode: 'per_push', perPushRate: 50, saltRate: 20, saltUnit: 'tons', saltPerUnitRate: 120 })
    const { stops } = await stormFor([a.contract.id])
    const logged = await (await post(crew, `/api/snow/storms/stops/${stops[0].id}/log`, { pushes: 1, snowfallInches: 3, saltQuantity: 1.5 })).json()
    const [ev] = await t.db.select().from(t.schema.snowEvent).where(eq(t.schema.snowEvent.id, logged.event.id))
    expect([Number(ev.saltQuantity), ev.saltApplied, Number(ev.billableAmount)]).toEqual([1.5, true, 50 + 180])
    expect(computeSnowEventCharge({ billingMode: 'per_push', perPushRate: 50, perEventRate: 0, perInchRate: 0, seasonalRate: 0, saltRate: 20 } as any, { pushes: 1, snowfallInches: 3, saltApplied: false, saltQuantity: 2 })).toBe(70)
  })
})

describe('row 25: T&M markup, the storm text, time by snowfall', () => {
  test('time and materials marks our salt cost up; the stop’s expected time grows with the snowfall', async () => {
    expect(computeSnowEventCharge({ billingMode: 'hourly', hourlyRate: 90, perPushRate: 0, perEventRate: 0, perInchRate: 0, seasonalRate: 0, saltRate: 0, saltUnitCost: 80, materialMarkupPct: 25 } as any, { pushes: 0, snowfallInches: 3, saltApplied: true, hours: 2, saltQuantity: 2 })).toBe(180 + 200)
    expect(expectedMinutes({ baseMinutes: 30, minutesPerInch: '5' }, 6)).toBe(60)
    expect(expectedMinutes({ baseMinutes: null }, 6)).toBeNull()
    const a = await lot('Time Lot', { billingMode: 'per_push', perPushRate: 50, baseMinutes: 30, minutesPerInch: 5 })
    const { stops } = await stormFor([a.contract.id], { expectedInches: 6 })
    const [j] = await t.db.select().from(t.schema.job).where(eq(t.schema.job.id, stops[0].jobId))
    expect(Number(j.estimatedHours)).toBe(1)
  })

  test('the storm text: previewed, then queued for each customer on the storm', async () => {
    const a = await lot('Text Lot', { billingMode: 'per_push', perPushRate: 50 })
    const { storm } = await stormFor([a.contract.id])
    const preview = await (await post(owner, `/api/snow/storms/${storm.id}/notify`, {})).json()
    expect(preview).toMatchObject({ dryRun: true, willText: 1, queued: 0 })
    expect(preview.preview[0].body).toContain('Text Lot is on today’s route'.replace('’', "'"))
    const sent = await (await post(owner, `/api/snow/storms/${storm.id}/notify`, { dryRun: false })).json()
    expect(sent.queued).toBe(1)
    const texts = await t.db.select().from(t.schema.scheduledText).where(eq(t.schema.scheduledText.contactId, a.ct.id))
    expect(texts.length).toBe(1)
  })
})

describe('row 30: a storm from the forecast', () => {
  const forecaster = (snow: number) => (async (_p: any, tz: string, days: number) => {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
    return { days: Array.from({ length: days }, (_, i) => ({ date: new Date(Date.parse(`${today}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10), summary: 'Snow', precipChance: 90, rainInches: 0, snowInches: i === 0 ? snow : 0, wet: true })) }
  }) as any
  const tzToday = async () => {
    const { companyTimeZone, storeDayRange } = await import('@twomiah/tenant-backend')
    const tz = await companyTimeZone(t.db, companyId)
    return { tz, today: storeDayRange(tz).date }
  }

  test('a day whose snow reaches a contract’s trigger proposes a storm for those contracts', async () => {
    await t.db.update(t.schema.snowContract).set({ status: 'ended' }).where(eq(t.schema.snowContract.companyId, companyId))
    const low = await lot('Low Trigger', { billingMode: 'per_push', perPushRate: 50, triggerDepthInches: 2 })
    await lot('High Trigger', { billingMode: 'per_push', perPushRate: 50, triggerDepthInches: 6 })
    const { tz } = await tzToday()
    await t.db.insert(t.schema.job).values({ companyId, number: 'PT-1', title: 'Point', status: 'completed', lat: 44.81, lng: -91.5, scheduledDate: new Date() } as any)
    const p: any = await snowProposals(t.db, companyId, tz, forecaster(3))
    expect(p.days[0]).toMatchObject({ snowInches: 3, contracts: 1, contractIds: [low.contract.id] })
  })

  test('it starts on its own only where turned on, once, for the contracts its snow reaches', async () => {
    const { tz, today } = await tzToday()
    expect((await autoStartFromForecast(t.db, companyId, tz, today, forecaster(3))).why).toBe('off')
    expect((await put(crew, '/api/snow/storms/settings', { autoStart: true })).status).toBe(403)
    expect((await put(owner, '/api/snow/storms/settings', { autoStart: true })).status).toBe(200)
    await t.db.update(t.schema.snowStorm).set({ status: 'ended' }).where(eq(t.schema.snowStorm.companyId, companyId))
    const out: any = await autoStartFromForecast(t.db, companyId, tz, today, forecaster(3))
    expect(out.started.source).toBe('forecast')
    expect(Number(out.started.expectedInches)).toBe(3)
    expect(out.made).toBe(1)
    expect((await autoStartFromForecast(t.db, companyId, tz, today, forecaster(3))).why).toBe('a storm is going')
  })

  test('the switch: not ready; off, the forecast and the settings are refused', async () => {
    expect(FEATURE_REGISTRY.find((f) => f.id === 'snow_tools')).toMatchObject({ hidden: true, templates: ['crm-landscaping'] })
    await features([])
    try {
      expect((await as(owner, '/api/snow/storms/forecast')).status).toBe(403)
      expect((await as(owner, '/api/snow/storms/settings')).status).toBe(403)
    } finally { await features(['snow_tools']) }
  })
})
