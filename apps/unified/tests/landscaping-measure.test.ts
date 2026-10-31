// Landscaping gap 4: measure a property from the satellite map. The map sends corners; the server measures each shape, keeps
// the property's lawn/bed/… columns equal to the sum of its shapes (cut-outs subtract), and Area Pricing's per-1,000-sq-ft price
// goes onto an open quote as a line. Each test fails without the change: there were no shapes and no "Add to quote".
import { describe, test, expect, beforeAll } from 'bun:test'
import { and, eq, inArray } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { polygonSqft } from '../server/data/siteShapes.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId: string
let ownerId: string
let owner: string
let field: string
let viewer: string
const as = (token: string, path: string, init: any = {}) => t.call(path, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } })
const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]

const login = async (email: string, password: string) =>
  (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken as string

/** A seat of the given role, signed in. */
async function seat(role: string) {
  const password = 'Correct-horse-1'
  await ins(t.schema.user, { companyId, email: `${role}@test.example`, firstName: role, lastName: 'Seat', role, passwordHash: await Bun.password.hash(password, 'bcrypt') })
  return login(`${role}@test.example`, password)
}

/** The next given weekday (0 = Sunday) after today, as YYYY-MM-DD — worked out here, not by the code under test. */
function nextWeekday(dow: number): string {
  const d = new Date()
  d.setUTCHours(0, 0, 0, 0)
  do { d.setUTCDate(d.getUTCDate() + 1) } while (d.getUTCDay() !== dow)
  return d.toISOString().slice(0, 10)
}
const addDays = (ymd: string, n: number) => new Date(Date.parse(ymd) + n * 86_400_000).toISOString().slice(0, 10)
const ymd = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null)

beforeAll(async () => {
  t = await bootTenant({ vertical: 'landscaping' })
  const s = await seedOwner(t)
  companyId = s.company.id; ownerId = s.owner.id
  await t.db.update(t.schema.company).set({ enabledFeatures: ['contacts', 'jobs', 'quotes', 'invoices', 'recurring_routes', 'area_pricing', 'snow_billing'] }).where(eq(t.schema.company.id, companyId))
  owner = await login('owner@test.example', s.password)
  field = await seat('field')
  viewer = await seat('viewer')
})

/** A Monday route with two stops (45 and 30 minutes, $40 and $55), led by the owner. */
async function mondayRoute(name = 'Monday A') {
  const ct = await (await as(owner, '/api/contacts', { method: 'POST', json: { name: `Customer of ${name}`, type: 'client' } })).json()
  const a = await (await as(owner, '/api/sites', { method: 'POST', json: { name: `${name} Elm`, contactId: ct.id, address: '1 Elm St', city: 'Eau Claire' } })).json()
  const b = await (await as(owner, '/api/sites', { method: 'POST', json: { name: `${name} Oak`, contactId: ct.id, address: '2 Oak St', city: 'Eau Claire' } })).json()
  const route = await (await as(owner, '/api/recurring-routes', { method: 'POST', json: { name, dayOfWeek: 1, startTime: '07:30', assignedToId: ownerId } })).json()
  const stopA = await (await as(owner, `/api/recurring-routes/${route.id}/stops`, { method: 'POST', json: { siteId: a.id, estimatedMinutes: 45, pricePerVisit: 40 } })).json()
  const stopB = await (await as(owner, `/api/recurring-routes/${route.id}/stops`, { method: 'POST', json: { siteId: b.id, estimatedMinutes: 30, pricePerVisit: 55 } })).json()
  return { ct, a, b, route, stopA, stopB }
}

const visitsOf = (stopIds: string[]) =>
  t.db.select().from(t.schema.job).where(and(eq(t.schema.job.companyId, companyId), inArray(t.schema.job.recurringRouteStopId, stopIds)))






/** A rectangle of corners, `wM` metres east-west and `hM` north-south, south-west corner at (lat, lng). */
const rect = (lat: number, lng: number, wM: number, hM: number): Array<[number, number]> => {
  const dLat = hM / 110_574, dLng = wM / (111_320 * Math.cos((lat * Math.PI) / 180))
  return [[lat, lng], [lat, lng + dLng], [lat + dLat, lng + dLng], [lat + dLat, lng]]
}
const flatSqft = (wM: number, hM: number) => wM * hM * 10.7639

async function property(name: string) {
  const ct = await (await as(owner, '/api/contacts', { method: 'POST', json: { name: `Owner of ${name}`, type: 'client' } })).json()
  const s = await (await as(owner, '/api/sites', { method: 'POST', json: { name, contactId: ct.id, address: '1 Elm St', city: 'Eau Claire' } })).json()
  return { ct, s }
}
const putShapes = (siteId: string, shapes: any[], token = owner) => as(token, `/api/area-pricing/sites/${siteId}/shapes`, { method: 'PUT', json: { shapes } })
const siteRow = async (id: string) => (await t.db.select().from(t.schema.site).where(eq(t.schema.site.id, id)))[0]

describe('the area of a shape', () => {
  test('matches a flat measurement within a percent, whichever way it is drawn', () => {
    const r = rect(44.8, -91.5, 30, 30)
    expect(Math.abs(polygonSqft(r) / flatSqft(30, 30) - 1)).toBeLessThan(0.01)
    expect(polygonSqft([...r].reverse())).toBe(polygonSqft(r))
    expect(polygonSqft(r.slice(0, 2))).toBe(0)
  })
})

describe('shapes on a property', () => {
  test('the server measures them; a cut-out subtracts; the property columns hold the sums; the screen\'s own number is ignored', async () => {
    const { s } = await property('Shapes A')
    const lawn = rect(44.8, -91.5, 40, 30), hole = rect(44.8001, -91.4999, 10, 10), beds = rect(44.8003, -91.5, 12, 8)
    const res = await putShapes(s.id, [
      { areaType: 'lawnSqft', path: lawn, areaSqft: 1 },
      { areaType: 'lawnSqft', mode: 'cut', path: hole, label: 'Garden' },
      { areaType: 'bedSqft', path: beds.map(([lat, lng]) => ({ lat, lng })) },
    ])
    expect(res.status).toBe(200)
    const out = await res.json()
    expect(out.shapes.length).toBe(3)
    const row = await siteRow(s.id)
    // Corners are kept to 7 decimals (a centimetre), so the saved area can differ from the raw one by a square foot or two.
    const lawnArea = out.shapes.find((x: any) => x.areaType === 'lawnSqft' && x.mode === 'add').areaSqft, holeArea = out.shapes.find((x: any) => x.mode === 'cut').areaSqft
    expect(Math.abs(lawnArea - polygonSqft(lawn))).toBeLessThanOrEqual(2)
    expect(row.lawnSqft).toBe(lawnArea - holeArea)
    expect(Math.abs(row.lawnSqft! / (flatSqft(40, 30) - flatSqft(10, 10)) - 1)).toBeLessThan(0.02)
    expect(Math.abs(row.bedSqft! - polygonSqft(beds))).toBeLessThanOrEqual(2)
    expect(row.measurementSource).toBe('aerial')
    expect(row.measuredAt).toBeTruthy()
    const read = await (await as(viewer, `/api/area-pricing/sites/${s.id}/shapes`)).json()
    expect(read.data.length).toBe(3)
  })

  test('saving again replaces the set: a type no longer drawn goes blank, a type never drawn keeps what was typed', async () => {
    const { s } = await property('Shapes B')
    await as(owner, `/api/area-pricing/sites/${s.id}/measurements`, { method: 'PUT', json: { hardscapeSqft: 800 } })
    await putShapes(s.id, [{ areaType: 'lawnSqft', path: rect(44.8, -91.5, 20, 20) }, { areaType: 'bedSqft', path: rect(44.801, -91.5, 5, 5) }])
    expect((await siteRow(s.id)).bedSqft).toBeGreaterThan(0)
    await putShapes(s.id, [{ areaType: 'lawnSqft', path: rect(44.8, -91.5, 20, 25) }])
    const row = await siteRow(s.id)
    expect(row.bedSqft).toBeNull()
    expect(row.hardscapeSqft).toBe(800)
    expect(Math.abs(row.lawnSqft! - polygonSqft(rect(44.8, -91.5, 20, 25)))).toBeLessThanOrEqual(2)
    expect((await t.db.select().from(t.schema.siteShape).where(eq(t.schema.siteShape.siteId, s.id))).length).toBe(1)
    // Clearing the map clears what it measured.
    await putShapes(s.id, [])
    expect((await siteRow(s.id)).lawnSqft).toBeNull()
  })

  test('refused in words, and nothing saved: too few corners, an unknown area type, a corner off the planet; a seat that may not edit properties; a property that is not ours', async () => {
    const { s } = await property('Shapes C')
    const two = await putShapes(s.id, [{ areaType: 'lawnSqft', path: [[44.8, -91.5], [44.81, -91.5]] }])
    expect(two.status).toBe(400)
    expect((await two.json()).error).toContain('three corners')
    expect((await putShapes(s.id, [{ areaType: 'roof', path: rect(44.8, -91.5, 5, 5) }])).status).toBe(400)
    expect((await putShapes(s.id, [{ areaType: 'lawnSqft', path: [[95, -91.5], [44.8, -91.5], [44.8, -91.4]] }])).status).toBe(400)
    expect((await t.db.select().from(t.schema.siteShape).where(eq(t.schema.siteShape.siteId, s.id))).length).toBe(0)
    expect((await putShapes(s.id, [{ areaType: 'lawnSqft', path: rect(44.8, -91.5, 5, 5) }], viewer)).status).toBe(403)
    expect((await putShapes('not-a-site', [])).status).toBe(404)
  })
})

describe('Area Pricing from the measured area, and onto a quote', () => {
  async function rate(serviceType: string, ratePer1000Sqft: number, minCharge: number) {
    const r = await as(owner, '/api/area-pricing/rates', { method: 'POST', json: { serviceType, areaField: 'lawnSqft', ratePer1000Sqft, minCharge } })
    expect(r.status).toBeLessThan(300)
  }

  test('per-1,000-sq-ft pricing and the minimum are unchanged; an unmeasured property says so', async () => {
    await rate('mowing', 5, 40)
    const big = await property('Price big'), small = await property('Price small'), none = await property('Price none')
    await putShapes(big.s.id, [{ areaType: 'lawnSqft', path: rect(44.8, -91.5, 30, 30) }])
    await putShapes(small.s.id, [{ areaType: 'lawnSqft', path: rect(44.8, -91.5, 10, 10) }])
    const a = await (await as(owner, `/api/area-pricing/quote?siteId=${big.s.id}&serviceType=mowing`)).json()
    const sq = (await siteRow(big.s.id)).lawnSqft!
    expect(a.areaSqft).toBe(sq)
    expect(a.price).toBe(Math.round((sq / 1000) * 5 * 100) / 100)
    expect(a.minChargeApplied).toBe(false)
    const b = await (await as(owner, `/api/area-pricing/quote?siteId=${small.s.id}&serviceType=mowing`)).json()
    expect(b.price).toBe(40)
    expect(b.minChargeApplied).toBe(true)
    const c = await as(owner, `/api/area-pricing/quote?siteId=${none.s.id}&serviceType=mowing`)
    expect(c.status).toBe(422)
    expect((await c.json()).code).toBe('NEEDS_MEASUREMENT')
  })

  test('"Add to quote": the rate card\'s price becomes a line, the totals follow; as an option it is offered, not counted; a closed quote refuses', async () => {
    await rate('mowing', 5, 40)
    const { ct, s } = await property('Quote me')
    await putShapes(s.id, [{ areaType: 'lawnSqft', path: rect(44.8, -91.5, 30, 30) }])
    const price = (await (await as(owner, `/api/area-pricing/quote?siteId=${s.id}&serviceType=mowing`)).json()).price as number
    const made = await as(owner, '/api/quotes', { method: 'POST', json: { name: 'Spring work', contactId: ct.id, lineItems: [{ description: 'Cleanup', quantity: 1, unitPrice: 100 }] } })
    expect(made.status).toBeLessThan(300)
    const q = await made.json()
    const add = await as(owner, '/api/area-pricing/quote/add', { method: 'POST', json: { quoteId: q.id, siteId: s.id, serviceType: 'mowing' } })
    expect(add.status).toBe(201)
    const after = await (await add.json())
    expect(after.line.unitPrice).toBe(String(price))
    expect(Number(after.quote.subtotal)).toBeCloseTo(100 + price, 2)
    const opt = await as(owner, '/api/area-pricing/quote/add', { method: 'POST', json: { quoteId: q.id, siteId: s.id, serviceType: 'mowing', optional: true } })
    expect(opt.status).toBe(201)
    const o = await opt.json()
    expect(o.line.optional).toBe(true)
    expect(o.line.selected).toBe(false)
    expect(Number(o.quote.subtotal)).toBeCloseTo(100 + price, 2)
    const lines = await t.db.select().from(t.schema.quoteLineItem).where(eq(t.schema.quoteLineItem.quoteId, q.id))
    expect(lines.length).toBe(3)

    await t.db.update(t.schema.quote).set({ status: 'approved' }).where(eq(t.schema.quote.id, q.id))
    expect((await as(owner, '/api/area-pricing/quote/add', { method: 'POST', json: { quoteId: q.id, siteId: s.id, serviceType: 'mowing' } })).status).toBe(409)
    expect((await as(viewer, '/api/area-pricing/quote/add', { method: 'POST', json: { quoteId: q.id, siteId: s.id, serviceType: 'mowing' } })).status).toBe(403)
    expect((await as(owner, '/api/area-pricing/quote/add', { method: 'POST', json: { quoteId: 'nope', siteId: s.id, serviceType: 'mowing' } })).status).toBe(404)
    const bare = await property('Quote bare')
    const q2 = await (await as(owner, '/api/quotes', { method: 'POST', json: { name: 'Bare', contactId: bare.ct.id, lineItems: [{ description: 'x', quantity: 1, unitPrice: 1 }] } })).json()
    const unmeasured = await as(owner, '/api/area-pricing/quote/add', { method: 'POST', json: { quoteId: q2.id, siteId: bare.s.id, serviceType: 'mowing' } })
    expect(unmeasured.status).toBe(422)
  })
})
