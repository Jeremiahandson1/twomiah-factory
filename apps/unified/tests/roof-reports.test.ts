// Roofing's measurements, roof reports and instant estimator (server/crm/roof/reports; docs/UNIFIED_ROOF_PLAN.md step
// 3c), through the real server as the roof vertical. Google Solar, Stripe and the file store are stubbed: no test here
// reaches a live API (every outbound fetch is answered locally, and an unknown one is a 404).
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { writeTestGeoTiff } from '@twomiah/roof-core/src/v2/testTiff.ts'
import sharp from 'sharp'
import { bootTenant, seedOwner } from './harness.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = ''
let otherCompanyId = ''
const tokens: Record<string, string> = {}
const ids: Record<string, string> = {}
const PASS = 'Seat-pass-1'

const login = async (email: string, password: string) =>
  (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken as string
const as = (who: string) => (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tokens[who]}` } })
const json = async (r: Response) => { const text = await r.text(); let body: any = text; try { body = JSON.parse(text) } catch {} return { status: r.status, body } }

// ── The stubbed outside world ──
const realFetch = globalThis.fetch
const outbound: string[] = []
const placesAsked: any[] = []
const INSIGHTS = {
  name: 'buildings/1', center: { latitude: 41.08, longitude: -81.51 }, imageryDate: { year: 2025, month: 4, day: 2 },
  imageryQuality: 'HIGH', regionCode: 'US',
  solarPotential: {
    maxArrayPanelsCount: 10, maxArrayAreaMeters2: 50, maxSunshineHoursPerYear: 1400, carbonOffsetFactorKgPerMwh: 400,
    roofSegmentStats: [
      { pitchDegrees: 26.6, azimuthDegrees: 180, stats: { areaMeters2: 100, sunshineQuantiles: [], groundAreaMeters2: 90 },
        center: { latitude: 41.07995, longitude: -81.51 }, boundingBox: { sw: { latitude: 41.0799, longitude: -81.5101 }, ne: { latitude: 41.08, longitude: -81.5099 } }, planeHeightAtCenterMeters: 6 },
      { pitchDegrees: 26.6, azimuthDegrees: 0, stats: { areaMeters2: 100, sunshineQuantiles: [], groundAreaMeters2: 90 },
        center: { latitude: 41.08005, longitude: -81.51 }, boundingBox: { sw: { latitude: 41.08, longitude: -81.5101 }, ne: { latitude: 41.0801, longitude: -81.5099 } }, planeHeightAtCenterMeters: 6 },
    ],
    buildingStats: { areaMeters2: 200, sunshineQuantiles: [], groundAreaMeters2: 180 },
    wholeRoofStats: { areaMeters2: 200, sunshineQuantiles: [], groundAreaMeters2: 180 },
  },
}
// 2 × round(100 m² × 10.7639) = 2152 sq ft = 21.52 squares.
const SQUARES = 21.52

// The instant estimator measures from Google's data layers (height map + roof mask): a made-up 40 m × 40 m patch at
// 0.5 m a pixel with a 20 m × 16 m gable roof at 6/12 (ridge east–west) — in the middle, under the address pin, or
// (for an address with "Far" in it) pushed into a corner, so the pin is on the ground.
// On the slope: 320 m² × √(1 + 0.5²) = 357.8 m² = 3,851 sq ft = 38.5 squares.
const GABLE_SQUARES = 38.51
const TW = 80, TH = 80, TPX = 0.5
const layerTiffs: Record<string, Buffer> = {}
let AERIAL: Buffer
async function makeLayers(key: string, x0: number, y0: number) {
  const dsm = new Float32Array(TW * TH), mask = new Uint8Array(TW * TH)
  for (let y = 0; y < TH; y++) for (let x = 0; x < TW; x++) {
    const i = y * TW + x
    if (!(x >= x0 && x < x0 + 40 && y >= y0 && y < y0 + 32)) { dsm[i] = 300; continue }
    mask[i] = 1
    dsm[i] = 303 + (8 - Math.abs(y + 0.5 - (y0 + 16)) * TPX) * 0.5
  }
  const tiff = (values: Float32Array | Uint8Array) => writeTestGeoTiff(values, { width: TW, height: TH, pixelM: TPX, minEasting: 457000, maxNorthing: 4548000, epsg: 32617 })
  layerTiffs[`${key}-dsm`] = await tiff(dsm)
  layerTiffs[`${key}-mask`] = await tiff(mask)
}

// Stripe on Twomiah's own account (CrmServices.stripe), as the routes use it.
const stripeCalls: any[] = []
const sessions: Record<string, any> = {}
const fakeStripe = {
  checkout: {
    sessions: {
      create: async (params: any) => { stripeCalls.push(params); const id = `cs_test_${stripeCalls.length}`; sessions[id] = { id, url: `https://checkout.stripe.test/${id}`, ...params }; return sessions[id] },
      retrieve: async (id: string) => sessions[id],
    },
  },
}
const stored = new Map<string, Buffer>()
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000001e221bc330000000049454e44ae426082', 'hex')

const env: Record<string, string | undefined> = {}
const setEnv = (k: string, v: string | undefined) => { if (!(k in env)) env[k] = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v }

beforeAll(async () => {
  setEnv('GOOGLE_SOLAR_API_KEY', 'test-key')
  for (const k of ['GOOGLE_MAPS_API_KEY', 'NEARMAP_API_KEY', 'REPLICATE_API_TOKEN', 'FACTORY_URL']) setEnv(k, undefined)
  setEnv('FACTORY_SYNC_KEY', 'factory-key-test')
  setEnv('FRONTEND_URL', 'https://roof.test')
  AERIAL = await sharp({ create: { width: TW, height: TH, channels: 3, background: { r: 90, g: 110, b: 90 } } }).png().toBuffer()
  await makeLayers('near', 20, 24)
  await makeLayers('far', 0, 0)
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = String(input?.url ?? input)
    outbound.push(url)
    if (url.startsWith('https://maps.googleapis.com/maps/api/geocode/json')) {
      if (url.includes('Nowhere')) return new Response(JSON.stringify({ results: [] }), { status: 200 })
      // An address with "Far" in it is placed a touch north, so the data-layers stub can tell it apart.
      const lat = url.includes('Far') ? 41.09 : 41.08
      return new Response(JSON.stringify({ results: [{ geometry: { location: { lat, lng: -81.51 } }, formatted_address: '12 Pine St, Akron, OH 44301' }] }), { status: 200 })
    }
    if (url.startsWith('https://solar.googleapis.com/v1/dataLayers:get')) {
      const key = url.includes('41.09') ? 'far' : 'near'
      return new Response(JSON.stringify({
        imageryDate: { year: 2025, month: 4, day: 2 }, imageryQuality: 'HIGH',
        dsmUrl: `https://solar.googleapis.com/v1/geoTiff:get?id=${key}-dsm`, maskUrl: `https://solar.googleapis.com/v1/geoTiff:get?id=${key}-mask`, rgbUrl: 'https://solar.googleapis.com/v1/geoTiff:get?id=rgb',
      }), { status: 200 })
    }
    if (url.startsWith('https://solar.googleapis.com/v1/geoTiff:get') && url.includes('id=rgb')) return new Response(new Uint8Array(AERIAL), { status: 200 })
    if (url.startsWith('https://solar.googleapis.com/v1/geoTiff:get')) {
      const body = layerTiffs[new URL(url).searchParams.get('id') || '']
      return body ? new Response(new Uint8Array(body), { status: 200 }) : new Response('no such layer', { status: 404 })
    }
    if (url.startsWith('https://solar.googleapis.com/v1/buildingInsights:findClosest')) return new Response(JSON.stringify(INSIGHTS), { status: 200 })
    // Google Places (New): the estimator's address suggestions and the one picked (addressSuggest.ts).
    if (url === 'https://places.googleapis.com/v1/places:autocomplete') {
      const body = JSON.parse(String(init?.body || '{}'))
      placesAsked.push(body)
      if (String(body.input).includes('Nowhere')) return new Response('{}', { status: 200 })
      return new Response(JSON.stringify({ suggestions: [
        { placePrediction: { placeId: 'place-pine-12', text: { text: '12 Pine St, Akron, OH, USA' } } },
        { placePrediction: { placeId: 'place-pine-120', text: { text: '120 Pine St, Akron, OH, USA' } } },
      ] }), { status: 200 })
    }
    if (url.startsWith('https://places.googleapis.com/v1/places/place-pine-12?')) {
      placesAsked.push({ details: url })
      return new Response(JSON.stringify({ addressComponents: [
        { longText: '12', shortText: '12', types: ['street_number'] }, { longText: 'Pine Street', shortText: 'Pine St', types: ['route'] },
        { longText: 'Akron', shortText: 'Akron', types: ['locality', 'political'] }, { longText: 'Ohio', shortText: 'OH', types: ['administrative_area_level_1', 'political'] },
        { longText: '44301', shortText: '44301', types: ['postal_code'] },
      ] }), { status: 200 })
    }
    return new Response('not stubbed', { status: 404 })
  }) as any

  t = await bootTenant({ vertical: 'roofing' })
  const seeded = await seedOwner(t)
  companyId = seeded.company.id
  ids.owner = seeded.owner.id
  tokens.owner = await login('owner@test.example', seeded.password)
  await t.db.update(t.schema.company).set({
    enabledFeatures: ['contacts', 'jobs', 'measurement_reports', 'instant_estimator'], reportCredits: 2, reportPricePerReport: '13.47',
    estimatorEnabled: true, pricePerSquareLow: '400.00', pricePerSquareHigh: '600.00',
  } as any).where(eq(t.schema.company.id, companyId))
  const hash = await Bun.password.hash(PASS, 'bcrypt')
  for (const [key, role] of [['admin', 'admin'], ['manager', 'manager'], ['crew', 'field'], ['viewer', 'viewer']] as const) {
    const [u] = await t.db.insert(t.schema.user).values({ email: `${key}@test.example`, passwordHash: hash, firstName: key, lastName: 'Seat', role, companyId } as any).returning()
    ids[key] = u.id
    tokens[key] = await login(`${key}@test.example`, PASS)
  }
  const [home] = await t.db.insert(t.schema.contact).values({ companyId, name: 'Lee Marsh', address: '12 Pine St', city: 'Akron', state: 'OH', zip: '44301' } as any).returning()
  ids.home = home.id
  const [j] = await t.db.insert(t.schema.job).values({ companyId, contactId: home.id, title: '12 Pine St', number: 'ROOF-0001', address: '12 Pine St', city: 'Akron', state: 'OH', zip: '44301', jobType: 'retail' } as any).returning()
  ids.job = j.id
  // Another business's records, for scoping.
  const [other] = await t.db.insert(t.schema.company).values({ name: 'Other Roofing', slug: 'other-roofing' }).returning()
  otherCompanyId = other.id
  const [oc] = await t.db.insert(t.schema.contact).values({ companyId: other.id, name: 'Sam Elsewhere' } as any).returning()
  ids.otherContact = oc.id
  const [oj] = await t.db.insert(t.schema.job).values({ companyId: other.id, title: '1 Far Rd', number: 'ROOF-0001', address: '1 Far Rd' } as any).returning()
  ids.otherJob = oj.id
  const [om] = await t.db.insert(t.schema.measurementReport).values({ companyId: other.id, address: '1 Far Rd', city: 'X', state: 'OH', zip: '1', provider: 'google_solar', status: 'complete', cost: '9.00' } as any).returning()
  ids.otherMeasurement = om.id
  const [orr] = await t.db.insert(t.schema.roofReport).values({ companyId: other.id, address: '1 Far Rd', city: 'X', state: 'OH', zip: '1', lat: 1, lng: 1, totalAreaSqft: 1, totalSquares: 1, segmentCount: 0, imageryQuality: 'HIGH', segments: [], edges: [], measurements: {} } as any).returning()
  ids.otherReport = orr.id

  const crm: any = t.services.crm
  crm.stripe = fakeStripe
  crm.storage.put = async (key: string, body: Buffer) => { stored.set(key, Buffer.from(body)) }
  crm.storage.getObject = async (key: string) => { const b = stored.get(key); return b ? { body: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), contentType: 'image/png' } : null }
  t.services.features.forgetFeatures()
}, 120_000)

afterAll(() => {
  globalThis.fetch = realFetch
  for (const [k, v] of Object.entries(env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
})

const waitForStatus = async (id: string, want: string) => {
  for (let i = 0; i < 100; i++) {
    const [row] = await t.db.select().from(t.schema.measurementReport).where(eq(t.schema.measurementReport.id, id))
    if (row?.status === want) return row
    await new Promise((r) => setTimeout(r, 20))
  }
  throw new Error(`measurement ${id} never reached ${want}`)
}
const credits = async () => (await t.db.select({ n: t.schema.company.reportCredits }).from(t.schema.company).where(eq(t.schema.company.id, companyId)))[0].n

describe('measurements', () => {
  test('ordering spends a credit and measures the roof (provider stubbed); the job gets its squares; none left is a 402', async () => {
    const a = await json(await as('manager')('/api/measurements/order', { method: 'POST', json: { address: '12 Pine St', city: 'Akron', state: 'OH', zip: '44301', jobId: ids.job } }))
    expect(a.status).toBe(201)
    expect(a.body).toMatchObject({ status: 'processing', provider: 'google_solar', jobId: ids.job, cost: '13.47' })
    ids.measurement = a.body.id
    expect(await credits()).toBe(1)
    const done = await waitForStatus(a.body.id, 'complete')
    expect(Number(done.totalSquares)).toBe(SQUARES)
    const [j] = await t.db.select().from(t.schema.job).where(eq(t.schema.job.id, ids.job))
    expect([j.measurementReportId, Number(j.totalSquares)]).toEqual([a.body.id, SQUARES])

    const b = await json(await as('owner')('/api/measurements/order', { method: 'POST', json: { address: 'Nowhere Lane', city: 'Akron', state: 'OH', zip: '44301' } }))
    expect(b.status).toBe(201)
    expect(await credits()).toBe(0)
    // An address the geocoder cannot place ends as a failed report, which can be regenerated.
    await waitForStatus(b.body.id, 'failed')
    const regen = await json(await as('owner')(`/api/measurements/${b.body.id}/regenerate`, { method: 'POST' }))
    expect(regen).toEqual({ status: 200, body: { success: true, message: 'Regeneration started' } })
    await waitForStatus(b.body.id, 'failed')

    const none = await json(await as('owner')('/api/measurements/order', { method: 'POST', json: { address: '12 Pine St', city: 'Akron', state: 'OH', zip: '44301' } }))
    expect(none).toEqual({ status: 402, body: { error: 'No measurement credits remaining. Purchase more in Settings.', code: 'no_credits' } })
    expect(await credits()).toBe(0)
  })

  test('two orders racing for the last credit: one is taken, the balance never goes below zero', async () => {
    await t.db.update(t.schema.company).set({ reportCredits: 1 } as any).where(eq(t.schema.company.id, companyId))
    const order = () => as('owner')('/api/measurements/order', { method: 'POST', json: { address: '12 Pine St', city: 'Akron', state: 'OH', zip: '44301' } })
    const statuses = (await Promise.all([order(), order()])).map((r) => r.status).sort()
    expect(statuses).toEqual([201, 402])
    expect(await credits()).toBe(0)
  })

  test('a job of another company is refused on an order (and no credit is spent)', async () => {
    await t.db.update(t.schema.company).set({ reportCredits: 3 } as any).where(eq(t.schema.company.id, companyId))
    const r = await as('owner')('/api/measurements/order', { method: 'POST', json: { address: '12 Pine St', city: 'Akron', state: 'OH', zip: '44301', jobId: ids.otherJob } })
    expect(r.status).toBe(404)
    expect(await credits()).toBe(3)
    const bad = await json(await as('owner')('/api/measurements/order', { method: 'POST', json: { address: '', city: 'Akron' } }))
    expect(bad.status).toBe(400)
    expect(bad.body.code).toBe('validation_failed')
    expect(Object.keys(bad.body.fields).sort()).toEqual(['address', 'state', 'zip'])
  })

  test('what a report cost is margin:read: the crew and the viewer read squares, not cost; the manager reads both', async () => {
    for (const who of ['crew', 'viewer']) {
      for (const p of ['/api/measurements', `/api/measurements/${ids.measurement}`, `/api/measurements/job/${ids.job}`, '/api/measurements/credits/info']) {
        const r = await as(who)(p)
        const text = await r.text()
        expect(r.status).toBe(200)
        expect(text).not.toContain('13.47')
      }
    }
    const crewOne = await json(await as('crew')(`/api/measurements/${ids.measurement}`))
    expect(Number(crewOne.body.totalSquares)).toBe(SQUARES)
    expect('cost' in crewOne.body).toBe(false)
    expect((await json(await as('viewer')('/api/measurements/credits/info'))).body).toEqual({ credits: 3 })
    expect((await json(await as('manager')(`/api/measurements/${ids.measurement}`))).body.cost).toBe('13.47')
    expect((await json(await as('manager')('/api/measurements/credits/info'))).body).toEqual({ credits: 3, pricePerReport: '13.47' })
  })

  test('the list is { data, pagination } and only this company\'s; another company\'s report is a 404', async () => {
    const l = await json(await as('owner')('/api/measurements?limit=2'))
    expect(l.body.pagination).toEqual({ page: 1, limit: 2, total: 3, pages: 2 })
    expect(l.body.data.every((m: any) => m.companyId === companyId)).toBe(true)
    expect((await as('owner')(`/api/measurements/${ids.otherMeasurement}`)).status).toBe(404)
    expect((await as('owner')(`/api/measurements/${ids.otherMeasurement}/manual`, { method: 'POST', json: { totalSquares: 9 } })).status).toBe(404)
  })

  test('squares by hand file on the report and its job; credits are bought by measurements:purchase only', async () => {
    const m = await json(await as('manager')(`/api/measurements/${ids.measurement}/manual`, { method: 'POST', json: { totalSquares: 30 } }))
    expect(m).toEqual({ status: 200, body: { success: true, message: 'Manual measurements saved' } })
    const [j] = await t.db.select().from(t.schema.job).where(eq(t.schema.job.id, ids.job))
    expect(Number(j.totalSquares)).toBe(30)
    expect((await as('crew')(`/api/measurements/${ids.measurement}/manual`, { method: 'POST', json: { totalSquares: 30 } })).status).toBe(403)
    expect((await as('manager')('/api/measurements/credits/purchase', { method: 'POST', json: { quantity: 5 } })).status).toBe(403)
    // The free top-up is closed: roof reports are bought in packs (roof-drawn-report.test.ts), and nothing is added here.
    const before = (await json(await as('admin')('/api/measurements/credits/info'))).body.credits
    const bought = await json(await as('admin')('/api/measurements/credits/purchase', { method: 'POST', json: { quantity: 5 } }))
    expect(bought).toEqual({ status: 410, body: { error: 'Roof reports are bought in packs on the Roof Reports page.' } })
    expect((await json(await as('admin')('/api/measurements/credits/info'))).body.credits).toBe(before)
  })

  test('without a session every measurements path is refused', async () => {
    for (const p of ['/api/measurements', `/api/measurements/${ids.measurement}`, '/api/measurements/credits/info']) expect((await t.call(p)).status).toBe(401)
    expect((await t.call('/api/measurements/order', { method: 'POST', json: {} })).status).toBe(401)
  })
})

describe('roof reports', () => {
  test('a professional report is charged $9.99 on Stripe and made once, after Stripe says it is paid', async () => {
    const start = await json(await as('owner')('/api/roof-reports/purchase', { method: 'POST', json: { address: '12 Pine St', city: 'Akron', state: 'OH', zip: '44301', contactId: ids.home, mode: 'auto' } }))
    expect(start.status).toBe(200)
    expect(start.body.checkoutUrl).toMatch(/^https:\/\/checkout\.stripe\.test\//)
    const call = stripeCalls.at(-1)
    expect(call.line_items[0].price_data.unit_amount).toBe(999)
    expect(call.metadata).toMatchObject({ type: 'roof_report', companyId, contactId: ids.home, address: '12 Pine St' })
    // Back to the CRM's own page, where /confirm-purchase runs (the template sent the roofer to /roof-reports: Not Found).
    expect(call.success_url).toBe('https://roof.test/crm/roof-reports?purchased=true&session_id={CHECKOUT_SESSION_ID}')
    // Credits are measurements': a report does not spend one.
    const before = await credits()

    sessions[start.body.sessionId].payment_status = 'unpaid'
    expect((await json(await as('owner')('/api/roof-reports/confirm-purchase', { method: 'POST', json: { sessionId: start.body.sessionId } }))).status).toBe(402)
    Object.assign(sessions[start.body.sessionId], { payment_status: 'paid', payment_intent: 'pi_test_1', amount_total: 999 })
    const made = await json(await as('owner')('/api/roof-reports/confirm-purchase', { method: 'POST', json: { sessionId: start.body.sessionId } }))
    expect(made.status).toBe(201)
    expect(made.body.pendingReview).toBe(true)
    expect(made.body.report).toMatchObject({ status: 'pending_review', amountCharged: '9.99', stripePaymentIntentId: 'pi_test_1', contactId: ids.home, totalSquares: expect.any(Number) })
    ids.report = made.body.report.id
    const again = await json(await as('owner')('/api/roof-reports/confirm-purchase', { method: 'POST', json: { sessionId: start.body.sessionId } }))
    expect(again.body).toEqual({ report: { id: ids.report }, alreadyGenerated: true })
    expect(await credits()).toBe(before)

    // A session another company paid for is not this company's report.
    sessions.cs_other = { id: 'cs_other', payment_status: 'paid', payment_intent: 'pi_other', metadata: { companyId: otherCompanyId } }
    expect((await as('owner')('/api/roof-reports/confirm-purchase', { method: 'POST', json: { sessionId: 'cs_other' } })).status).toBe(403)
    // Another company's contact is refused on a purchase.
    expect((await as('owner')('/api/roof-reports/purchase', { method: 'POST', json: { address: '1', city: 'A', state: 'OH', zip: '1', contactId: ids.otherContact, mode: 'auto' } })).status).toBe(404)
  })

  test('the paid report needs roof-reports:purchase; the free hand-drawn one roof-reports:create (a manager may)', async () => {
    const mgrPaid = await json(await as('manager')('/api/roof-reports/purchase', { method: 'POST', json: { mode: 'auto' } }))
    expect(mgrPaid.status).toBe(403)
    expect(mgrPaid.body.required).toBe('roof-reports:purchase')
    const crewFree = await json(await as('crew')('/api/roof-reports/purchase', { method: 'POST', json: { mode: 'manual' } }))
    expect([crewFree.status, crewFree.body.required]).toEqual([403, 'roof-reports:create'])
    expect((await as('owner')('/api/roof-reports/purchase', { method: 'POST', json: { mode: 'auto' } })).status).toBe(400)
    expect((await as('manager')('/api/roof-reports/confirm-purchase', { method: 'POST', json: { sessionId: 'x' } })).status).toBe(403)
  })

  test('a hand-drawn report: free preview, then saved at $0.00 with only imagery the server stored for this company', async () => {
    const pv = await json(await as('manager')('/api/roof-reports/purchase', { method: 'POST', json: { address: '12 Pine St', city: 'Akron', state: 'OH', zip: '44301', mode: 'manual' } }))
    expect(pv.status).toBe(200)
    expect(pv.body.free).toBe(true)
    const preview = structuredClone(pv.body.preview)
    expect([preview.mode, preview.edges, preview.totalSquares]).toEqual(['manual', [], SQUARES])
    // A client that names a file on the server, or another company's image, gets no image saved.
    const evil = { ...preview, aerialImagePath: '/etc/passwd', roofMaskPath: `roof-imagery/${otherCompanyId}/x.png`, stripePaymentIntentId: 'pi_forged' }
    const edges = [{ type: 'eave', startLat: 41.08, startLng: -81.51, endLat: 41.0801, endLng: -81.51, lengthFt: 36 }]
    const fin = await json(await as('manager')('/api/roof-reports/finalize', { method: 'POST', json: { preview: evil, edges } }))
    expect(fin.status).toBe(201)
    const [row] = await t.db.select().from(t.schema.roofReport).where(eq(t.schema.roofReport.id, fin.body.report.id))
    expect([row.aerialImagePath, row.roofMaskPath, row.stripePaymentIntentId, row.amountCharged]).toEqual([null, null, null, '0.00'])
    ids.drawn = row.id
    // …and a public read of it serves no file.
    expect((await t.call(`/api/roof-reports/${row.id}/aerial.png`)).status).toBe(404)
  })

  test('the shared link answers without a session; everything else refuses without one', async () => {
    const key = `roof-imagery/${companyId}/shared-aerial.png`
    stored.set(key, PNG)
    await t.db.update(t.schema.roofReport).set({ aerialImagePath: key } as any).where(eq(t.schema.roofReport.id, ids.report))
    const img = await t.call(`/api/roof-reports/${ids.report}/aerial.png`)
    expect([img.status, img.headers.get('content-type')]).toEqual([200, 'image/png'])
    expect(Buffer.from(await img.arrayBuffer()).equals(PNG)).toBe(true)
    const html = await t.call(`/api/roof-reports/${ids.report}/html`)
    expect(html.status).toBe(200)
    expect(html.headers.get('content-type')).toContain('text/html')
    // The page is drawn over Google Static Maps at the roof's zoom (packages/roof-core's renderer, as the template's was).
    const page = await html.text()
    expect(page).toContain('12 Pine St, Akron, OH 44301')
    expect(page).toContain('21.52')
    expect((await t.call('/api/roof-reports/no-such-report/html')).status).toBe(404)
    // The "PDF" is the print-ready page (no headless browser in a tenant's server).
    const pdf = await as('owner')(`/api/roof-reports/${ids.report}/pdf`)
    expect([pdf.status, pdf.headers.get('content-type')]).toEqual([200, 'text/html; charset=utf-8'])
    expect(await pdf.text()).toContain('12 Pine St, Akron, OH 44301')

    for (const p of ['/api/roof-reports', `/api/roof-reports/${ids.report}`, `/api/roof-reports/${ids.report}/pdf`, `/api/roof-reports/${ids.report}/dsm-grid`, '/api/roof-reports/preview-aerial/x.png']) {
      expect([p, (await t.call(p)).status]).toEqual([p, 401])
    }
    for (const [m, p] of [['POST', '/api/roof-reports/purchase'], ['POST', '/api/roof-reports/finalize'], ['POST', '/api/roof-reports/confirm-purchase'], ['DELETE', `/api/roof-reports/${ids.report}`], ['PATCH', `/api/roof-reports/${ids.report}/edges`], ['POST', '/api/roof-reports/sam-segment']] as const) {
      expect([p, (await t.call(p, { method: m, json: {} })).status]).toEqual([p, 401])
    }
  })

  test('Roof Reports switched off: the signed-in paths refuse, the shared link still opens', async () => {
    await t.db.update(t.schema.company).set({ enabledFeatures: ['contacts', 'jobs', 'instant_estimator'] } as any).where(eq(t.schema.company.id, companyId))
    t.services.features.forgetFeatures()
    try {
      const off = await json(await as('owner')('/api/roof-reports'))
      expect([off.status, off.body.code]).toEqual([403, 'FEATURE_NOT_ENABLED'])
      expect((await t.call(`/api/roof-reports/${ids.report}/html`)).status).toBe(200)
      expect((await t.call(`/api/roof-reports/${ids.report}/aerial.png`)).status).toBe(200)
      // Measurements are behind it too (owner, 2026-10-19 — the template left them open; not-ready-features.test.ts).
      expect((await as('owner')('/api/measurements')).status).toBe(403)
    } finally {
      await t.db.update(t.schema.company).set({ enabledFeatures: ['contacts', 'jobs', 'measurement_reports', 'instant_estimator'] } as any).where(eq(t.schema.company.id, companyId))
      t.services.features.forgetFeatures()
    }
  })

  test('what a report was charged is margin:read; the list carries no money; another company\'s report is a 404', async () => {
    expect((await json(await as('owner')(`/api/roof-reports/${ids.report}`))).body.amountCharged).toBe('9.99')
    const v = await json(await as('viewer')(`/api/roof-reports/${ids.report}`))
    expect(v.status).toBe(200)
    expect('amountCharged' in v.body).toBe(false)
    const l = await json(await as('owner')('/api/roof-reports'))
    expect(l.body.pagination).toEqual({ page: 1, limit: 20, total: 2, pages: 1 })
    expect(l.body.data.map((r: any) => r.id).sort()).toEqual([ids.report, ids.drawn].sort())
    expect(l.body.data.every((r: any) => !('amountCharged' in r))).toBe(true)
    expect((await json(await as('owner')(`/api/roof-reports?contactId=${ids.home}`))).body.data.map((r: any) => r.id)).toEqual([ids.report])
    expect((await as('owner')(`/api/roof-reports/${ids.otherReport}`)).status).toBe(404)
    expect((await as('owner')(`/api/roof-reports/${ids.otherReport}`, { method: 'DELETE' })).status).toBe(404)
  })

  test('edges are corrected and reverted; delete needs roof-reports:delete', async () => {
    const edges = [{ type: 'ridge', startLat: 1, startLng: 1, endLat: 2, endLng: 2, lengthFt: 10 }]
    expect((await json(await as('manager')(`/api/roof-reports/${ids.report}/edges`, { method: 'PATCH', json: { edges } }))).body).toEqual({ success: true })
    let [row] = await t.db.select().from(t.schema.roofReport).where(eq(t.schema.roofReport.id, ids.report))
    expect([row.userEdited, row.edges]).toEqual([true, edges])
    expect((await json(await as('manager')(`/api/roof-reports/${ids.report}/revert`, { method: 'POST' }))).body).toEqual({ success: true });
    [row] = await t.db.select().from(t.schema.roofReport).where(eq(t.schema.roofReport.id, ids.report))
    expect(row.userEdited).toBe(false)
    expect((await as('manager')(`/api/roof-reports/${ids.report}/revert`, { method: 'POST' })).status).toBe(400)
    expect((await as('crew')(`/api/roof-reports/${ids.drawn}`, { method: 'DELETE' })).status).toBe(403)
    expect((await json(await as('manager')(`/api/roof-reports/${ids.drawn}`, { method: 'DELETE' }))).body).toEqual({ success: true })
  })

  test('SAM 2 without its token is a 503, not a 500', async () => {
    const r = await json(await as('manager')('/api/roof-reports/sam-segment', { method: 'POST', json: { centerLat: 41.08, centerLng: -81.51 } }))
    expect(r.status).toBe(503)
  })

  test('the Factory reads and approves a report with its key, and nothing without it', async () => {
    expect((await t.call(`/api/internal/roof-reports/${ids.report}`)).status).toBe(401)
    const key = { 'X-Factory-Key': 'factory-key-test' }
    const pending = await json(await t.call('/api/internal/roof-reports/pending', { headers: key }))
    expect(pending.body.data.map((r: any) => r.id)).toEqual([ids.report])
    expect((await json(await t.call(`/api/internal/roof-reports/${ids.report}`, { headers: key }))).body.id).toBe(ids.report)
    const ok = await json(await t.call(`/api/internal/roof-reports/${ids.report}/approve`, { method: 'POST', headers: key, json: {} }))
    expect(ok.body).toEqual({ success: true })
    const [row] = await t.db.select().from(t.schema.roofReport).where(eq(t.schema.roofReport.id, ids.report))
    expect(row.status).toBe('completed')
  })
})

describe('instant estimator', () => {
  const visitor = { address: '40 Oak Ave', city: 'Akron', state: 'OH', zip: '44301', name: 'Dana Reyes', email: ' Dana@Example.COM ' }
  const estimate = (body: any) => t.call('/api/estimator/estimate/test-builders', { method: 'POST', json: body })
  const setCredits = (n: number) => t.db.update(t.schema.company).set({ reportCredits: n } as any).where(eq(t.schema.company.id, companyId))
  const sent: Array<{ to: string; template: string; data: any }> = []

  beforeAll(async () => {
    await setCredits(50)
    const email: any = t.services.email
    const real = email.send.bind(email)
    email.send = async (to: string, template: string, data: any, o?: any) => { sent.push({ to, template, data }); return real(to, template, data, o) }
  })

  test('measures the roof under the pin from the height map, prices it at the company\'s own prices, keeps the lead and the measurement, and uses one roof report', async () => {
    const cfg = await json(await t.call('/api/estimator/config/test-builders'))
    expect(cfg.status).toBe(200)
    expect(cfg.body).toMatchObject({ slug: 'test-builders', estimatorEnabled: true, pricePerSquareLow: '400.00', pricePerSquareHigh: '600.00' })
    const before = await credits()
    const sent = outbound.length
    const est = await json(await estimate(visitor))
    expect(est.status).toBe(200)
    expect(est.body).toMatchObject({ quoted: true, companyName: 'Test Builders', imageryQuality: 'HIGH' })
    // Within 3% of the made-up roof's true size, and priced from exactly the squares it reports.
    expect(Math.abs(est.body.totalSquares - GABLE_SQUARES) / GABLE_SQUARES).toBeLessThan(0.03)
    expect([est.body.estimateLow, est.body.estimateHigh]).toEqual([Math.round(est.body.totalSquares * 400), Math.round(est.body.totalSquares * 600)])
    // It asked Google for the data layers, never for the ready-made building summary.
    const asked = outbound.slice(sent)
    expect(asked.some((u) => u.includes('dataLayers:get'))).toBe(true)
    expect(asked.some((u) => u.includes('buildingInsights'))).toBe(false)
    const [lead] = await t.db.select().from(t.schema.contact).where(eq(t.schema.contact.email, 'dana@example.com'))
    expect(lead).toMatchObject({ companyId, name: 'Dana Reyes', source: 'instant_estimator', propertyType: 'residential', type: 'lead' })
    const kept = (await t.db.select().from(t.schema.measurementReport).where(eq(t.schema.measurementReport.address, '40 Oak Ave')))[0]
    expect(kept).toMatchObject({ companyId, cost: '0.00', status: 'complete', imageryDate: '2025-04-02' })
    expect(Number(kept.totalSquares)).toBe(est.body.totalSquares)
    expect(kept.rawData as any).toMatchObject({ contactId: lead.id, quoted: true, estimateLow: est.body.estimateLow })
    // One roof report from the balance: this is the call that costs.
    expect(await credits()).toBe(before - 1)
    // The balance is not something a visitor is told.
    expect(cfg.body.reportCredits).toBeUndefined()

    // The same house asked again (by the same person, typed a little differently): the kept measurement answers at
    // today's prices — Google is not asked or paid again — and the person stays the one contact they are.
    const again = outbound.length
    const second = await json(await estimate({ ...visitor, address: ' 40 oak ave ' }))
    expect(second.body).toMatchObject({ quoted: true, totalSquares: est.body.totalSquares, estimateLow: est.body.estimateLow, estimateHigh: est.body.estimateHigh })
    expect(outbound.length).toBe(again)
    expect((await t.db.select().from(t.schema.contact).where(eq(t.schema.contact.email, 'dana@example.com'))).length).toBe(1)
    expect((await t.db.select().from(t.schema.measurementReport).where(eq(t.schema.measurementReport.address, '40 Oak Ave'))).length).toBe(1)
    expect(await credits()).toBe(before - 1)
  })

  test('with no roof reports left the estimator is off the website; a visitor whose page was already open is told the business will follow up, and is kept as a lead', async () => {
    await setCredits(0)
    try {
      // Exactly what the widget gets when the roofer has switched it off — so it shows nothing.
      expect(await json(await t.call('/api/estimator/config/test-builders'))).toEqual({ status: 403, body: { error: 'Estimator not enabled' } })
      const sentBefore = outbound.length
      const est = await json(await estimate({ address: '77 Elm St', city: 'Akron', state: 'OH', zip: '44301', name: 'Late Visitor', phone: '330-555-0177' }))
      expect(est).toMatchObject({ status: 200, body: { quoted: false } })
      // Google's paid data was never asked for, and nothing went below zero.
      expect(outbound.slice(sentBefore).some((u) => u.includes('dataLayers:get'))).toBe(false)
      expect(await credits()).toBe(0)
      expect((await t.db.select().from(t.schema.contact).where(eq(t.schema.contact.name, 'Late Visitor'))).length).toBe(1)
      // A house already measured still answers: it costs nothing.
      expect((await json(await estimate(visitor))).body.quoted).toBe(true)
    } finally { await setCredits(50) }
    expect((await t.call('/api/estimator/config/test-builders')).status).toBe(200)
  })

  test('the owners and admins are emailed when the balance reaches 10, and again at none — once each', async () => {
    const lows = () => sent.filter((m) => m.template === 'roofReportsLow')
    const house = (n: number) => ({ address: `${n} Birch Rd`, city: 'Akron', state: 'OH', zip: '44301', name: `Birch ${n}`, phone: `330-555-02${n}` })
    await t.db.delete(t.schema.reminderLog).where(eq(t.schema.reminderLog.kind, 'roof_reports_low'))
    try {
      await setCredits(12)
      sent.length = 0
      await estimate(house(10))   // 11 left: nothing yet
      expect(lows()).toEqual([])
      await estimate(house(11))   // 10 left
      expect(lows().map((m) => [m.to, m.data.left, m.data.estimatorOn]).sort()).toEqual([['admin@test.example', 10, true], ['owner@test.example', 10, true]])
      await estimate(house(12))   // 9 left: not again
      expect(lows().length).toBe(2)
      await setCredits(1)
      await estimate(house(13))   // none left
      expect(lows().slice(2).map((m) => [m.to, m.data.left]).sort()).toEqual([['admin@test.example', 0], ['owner@test.example', 0]])
      expect((await t.call('/api/estimator/config/test-builders')).status).toBe(403)
    } finally { await setCredits(50) }
  })

  test('a roofer with the estimator but not Roof Reports still sees and buys the same balance', async () => {
    await t.db.update(t.schema.company).set({ enabledFeatures: ['contacts', 'jobs', 'instant_estimator'] } as any).where(eq(t.schema.company.id, companyId))
    t.services.features.forgetFeatures()
    try {
      const bal = await json(await as('owner')('/api/roof-reports/credits'))
      expect(bal).toMatchObject({ status: 200, body: { credits: 50, pack: { roofs: 100, priceCents: 1500 }, lowAt: 10 } })
      const checkout = await json(await as('owner')('/api/roof-reports/credits/checkout', { method: 'POST', json: { from: 'estimator' } }))
      expect(checkout.status).toBe(200)
      expect(stripeCalls.at(-1).success_url).toBe('https://roof.test/crm/estimator?pack_session={CHECKOUT_SESSION_ID}')
      // The rest of Roof Reports stays shut.
      expect((await as('owner')('/api/roof-reports')).status).toBe(403)
    } finally {
      await t.db.update(t.schema.company).set({ enabledFeatures: ['contacts', 'jobs', 'measurement_reports', 'instant_estimator'] } as any).where(eq(t.schema.company.id, companyId))
      t.services.features.forgetFeatures()
    }
  })

  test('a roof it cannot trust is not priced as it stands, and the lead is still kept', async () => {
    const est = await json(await estimate({ ...visitor, address: '9 Far Field Rd', name: 'Pat Away', email: 'pat@example.com' }))
    expect(est.status).toBe(200)
    // Not priced as it stands — and, with roofs in the picture, the visitor is asked to point theirs out (next test but one).
    expect(est.body).toMatchObject({ quoted: false, canPick: true, companyName: 'Test Builders' })
    expect(est.body.message).toContain('Tap your roof')
    expect(est.body.estimateLow).toBeUndefined()
    expect(est.body.totalSquares).toBeUndefined()
    const [lead] = await t.db.select().from(t.schema.contact).where(eq(t.schema.contact.email, 'pat@example.com'))
    expect(lead).toMatchObject({ companyId, name: 'Pat Away', source: 'instant_estimator' })
    const kept = (await t.db.select().from(t.schema.measurementReport).where(eq(t.schema.measurementReport.address, '9 Far Field Rd')))[0]
    expect(kept).toMatchObject({ status: 'failed', totalSquares: null, cost: '0.00' })
    expect(kept.rawData as any).toMatchObject({ quoted: false, grade: 'red', contactId: lead.id, estimateLow: null })
    expect((kept.rawData as any).reasons[0]).toContain('not on a roof')
  })

  test('asks for a name and a phone number or an email before any price; an address Google cannot place is a 422 and keeps nothing', async () => {
    const sent = outbound.length
    const noName = await json(await estimate({ ...visitor, name: ' ' }))
    expect([noName.status, Object.keys(noName.body.fields)]).toEqual([400, ['name']])
    const noWay = await json(await estimate({ address: '40 Oak Ave', city: 'Akron', state: 'OH', zip: '44301', name: 'No Way' }))
    expect([noWay.status, noWay.body.fields]).toEqual([400, { phone: 'A phone number or an email is needed' }])
    expect((await estimate({ ...visitor, zip: '1', email: 'not-an-email' })).status).toBe(400)
    // Nothing was asked of Google for any of them.
    expect(outbound.length).toBe(sent)
    expect((await estimate({ address: 'Nowhere Lane', city: 'A', state: 'OH', zip: '44301', name: 'Lost Soul', phone: '330-555-0100' })).status).toBe(422)
    expect(await t.db.select().from(t.schema.contact).where(eq(t.schema.contact.name, 'Lost Soul'))).toEqual([])
    // A phone number alone is enough.
    expect((await json(await estimate({ address: '41 Oak Ave', city: 'Akron', state: 'OH', zip: '44301', name: 'Phone Only', phone: '330-555-0101' }))).body.quoted).toBe(true)
  })

  test('the visitor sees their roof outlined on the picture and can correct it: the estimate is worked out again, at no cost', async () => {
    const before = await credits()
    const est = await json(await estimate({ address: '5 Outline Way', city: 'Akron', state: 'OH', zip: '44301', name: 'Olive Line', email: 'olive@example.com' }))
    expect(est.body).toMatchObject({ quoted: true, picture: { width: TW, height: TH, metresPerPixel: TPX } })
    expect(est.body.picture.image.startsWith('data:image/jpeg;base64,')).toBe(true)
    // The made-up gable is a plain rectangle, 40 × 32 pixels, the measured roof.
    const mine = est.body.picture.outlines.filter((o: any) => o.chosen)
    expect(mine.length).toBe(1)
    const xs = mine[0].points.map((q: number[]) => q[0]), ys = mine[0].points.map((q: number[]) => q[1])
    expect([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]).toEqual([20, 60, 24, 56])
    // The outline as it stands gives the squares that were measured (within 2%)…
    const adjust = (outline: unknown, id = est.body.estimateId) => t.call('/api/estimator/adjust/test-builders', { method: 'POST', json: { estimateId: id, outline } })
    const sentBefore = outbound.length
    const same = await json(await adjust(mine[0].points))
    expect(same.status).toBe(200)
    expect(Math.abs(same.body.totalSquares - est.body.totalSquares) / est.body.totalSquares).toBeLessThan(0.02)
    // …and half the roof gives half of it, priced from exactly those squares.
    const half = await json(await adjust([[20, 24], [40, 24], [40, 56], [20, 56]]))
    expect(half.body).toMatchObject({ quoted: true, adjusted: true })
    expect(Math.abs(half.body.totalSquares - est.body.totalSquares / 2) / est.body.totalSquares).toBeLessThan(0.02)
    expect(half.body.estimateLow).toBe(Math.round(half.body.totalSquares * 400))
    // Google was not asked again, and no roof report was used.
    expect(outbound.length).toBe(sentBefore)
    expect(await credits()).toBe(before - 1)
    // The record carries what the homeowner showed beside what was measured, and the new lead's note says so.
    const [kept] = await t.db.select().from(t.schema.measurementReport).where(eq(t.schema.measurementReport.id, est.body.estimateId))
    expect(Number(kept.totalSquares)).toBe(half.body.totalSquares)
    expect(kept.rawData as any).toMatchObject({ adjustments: 2, measuredSquares: est.body.totalSquares, adjusted: { squares: half.body.totalSquares } })
    const [lead] = await t.db.select().from(t.schema.contact).where(eq(t.schema.contact.email, 'olive@example.com'))
    expect(lead.notes).toContain('Instant estimate on the website')
    expect(lead.notes).toContain('corrected the roof outline')
    // Refused: a speck, a shape off the picture, not a shape, somebody else's or no estimate.
    expect((await json(await adjust([[30, 30], [32, 30], [32, 32]]))).body.error).toContain('too small')
    expect((await adjust([[-5, 0], [40, 0], [40, 40]])).status).toBe(400)
    expect((await adjust('nonsense')).status).toBe(400)
    expect((await adjust(mine[0].points, ids.otherMeasurement)).status).toBe(404)
    expect((await adjust(mine[0].points, 'nope')).status).toBe(404)
  })

  test('a roof it could not vouch for (the pin is not on it) can be pointed out by the visitor, and is then priced', async () => {
    const est = await json(await estimate({ address: '12 Far Corner Rd', city: 'Akron', state: 'OH', zip: '44301', name: 'Pin Off', email: 'pinoff@example.com' }))
    expect(est.body).toMatchObject({ quoted: false, canPick: true })
    expect(est.body.message).toContain('Tap your roof')
    expect(est.body.estimateLow).toBeUndefined()
    const roof = est.body.picture.outlines[0].points
    const fixed = await json(await t.call('/api/estimator/adjust/test-builders', { method: 'POST', json: { estimateId: est.body.estimateId, outline: roof } }))
    expect(fixed.body).toMatchObject({ quoted: true, adjusted: true })
    expect(Math.abs(fixed.body.totalSquares - GABLE_SQUARES) / GABLE_SQUARES).toBeLessThan(0.03)
    const [kept] = await t.db.select().from(t.schema.measurementReport).where(eq(t.schema.measurementReport.id, est.body.estimateId))
    expect(kept).toMatchObject({ status: 'complete' })
    expect(kept.rawData as any).toMatchObject({ quoted: true, grade: 'red' })
  })

  test('the business\'s own roof options: a price for each, financing beside it when connected, and the one the visitor wants is kept', async () => {
    const base = { estimatorEnabled: true, pricePerSquareLow: '400.00', pricePerSquareHigh: '600.00', estimatorHeadline: 'Free roof estimate', estimatorDisclaimer: 'Estimate only.' }
    const options = [
      { name: 'Architectural shingles', description: '30-year warranty', pricePerSquareLow: '450', pricePerSquareHigh: '650', imageUrl: 'https://example.com/shingle.jpg' },
      { name: 'Standing seam metal', pricePerSquareLow: '900', pricePerSquareHigh: '1400.50' },
    ]
    // Refused by name: a high under its low, a picture that is not https, more than six.
    const bad = await json(await as('owner')('/api/settings/estimator', { method: 'PUT', json: { ...base, options: [{ name: 'Upside down', pricePerSquareLow: '500', pricePerSquareHigh: '400' }] } }))
    expect([bad.status, Object.keys(bad.body.fields)]).toEqual([400, ['options.0.pricePerSquareHigh']])
    expect((await as('owner')('/api/settings/estimator', { method: 'PUT', json: { ...base, options: [{ ...options[0], imageUrl: 'javascript:alert(1)' }] } })).status).toBe(400)
    expect((await as('owner')('/api/settings/estimator', { method: 'PUT', json: { ...base, options: Array.from({ length: 7 }, (_, i) => ({ ...options[1], name: `Option ${i}` })) } })).status).toBe(400)
    expect((await as('owner')('/api/settings/estimator', { method: 'PUT', json: { ...base, options } })).status).toBe(200)
    try {
      const saved = (await json(await as('owner')('/api/company'))).body.settings.estimator.options
      expect(saved.map((o: any) => [o.name, o.pricePerSquareLow, o.pricePerSquareHigh, o.imageUrl])).toEqual([['Architectural shingles', '450', '650', 'https://example.com/shingle.jpg'], ['Standing seam metal', '900', '1400.50', null]])
      // Saving the five old boxes alone leaves the options as they are.
      expect((await as('owner')('/api/settings/estimator', { method: 'PUT', json: base })).status).toBe(200)
      const est = await json(await estimate({ address: '8 Option Ct', city: 'Akron', state: 'OH', zip: '44301', name: 'Opal Choice', email: 'opal@example.com' }))
      const sq = est.body.totalSquares
      expect(est.body.options.map((o: any) => [o.name, o.estimateLow, o.estimateHigh])).toEqual([
        ['Architectural shingles', Math.round(sq * 450), Math.round(sq * 650)], ['Standing seam metal', Math.round(sq * 900), Math.round(sq * 1400.5)],
      ])
      expect(est.body.options[0]).toMatchObject({ id: saved[0].id, description: '30-year warranty', imageUrl: 'https://example.com/shingle.jpg' })
      // No lender connected: no monthly figure.
      expect(est.body.options[0].financing).toBeUndefined()
      // "I'm interested in this one".
      const choose = (optionId: string) => t.call('/api/estimator/choose/test-builders', { method: 'POST', json: { estimateId: est.body.estimateId, optionId } })
      expect(await json(await choose(saved[1].id))).toEqual({ status: 200, body: { success: true } })
      expect((await choose('not-an-option')).status).toBe(400)
      const [kept] = await t.db.select().from(t.schema.measurementReport).where(eq(t.schema.measurementReport.id, est.body.estimateId))
      expect((kept.rawData as any).chosenOption).toMatchObject({ id: saved[1].id, name: 'Standing seam metal' })
      const [lead] = await t.db.select().from(t.schema.contact).where(eq(t.schema.contact.email, 'opal@example.com'))
      expect(lead.notes).toContain('Interested in: Standing seam metal.')

      // With the lender connected and financing on, each option carries the "as low as" figure and the disclosure.
      const [co] = await t.db.select().from(t.schema.company).where(eq(t.schema.company.id, companyId))
      await t.db.update(t.schema.company).set({
        enabledFeatures: [...(co.enabledFeatures as string[]), 'consumer_financing'],
        integrations: { ...(co.integrations as any), financing: { wisetack: { merchantId: 'merchant-123', prequalUrl: 'https://wisetack.us/#/abc/prequalify', connectedAt: '2026-11-01' } } },
      } as any).where(eq(t.schema.company.id, companyId))
      t.services.features.forgetFeatures()
      try {
        const again = await json(await estimate({ address: '8 option ct', city: 'Akron', state: 'OH', zip: '44301', name: 'Opal Choice', email: 'opal@example.com' }))
        expect(again.body.options[0].financing).toMatchObject({ lender: 'Wisetack', termMonths: 24 })
        expect(again.body.options[0].financing.asLowAs).toBeGreaterThan(0)
        expect(again.body.financingDisclosure).toContain('subject to credit approval')
      } finally {
        await t.db.update(t.schema.company).set({ enabledFeatures: co.enabledFeatures, integrations: co.integrations } as any).where(eq(t.schema.company.id, companyId))
        t.services.features.forgetFeatures()
      }
    } finally {
      expect((await as('owner')('/api/settings/estimator', { method: 'PUT', json: { ...base, options: [] } })).status).toBe(200)
    }
    // With no options, the one range from the two prices, as before.
    const plain = await json(await estimate({ address: '8 Option Ct', city: 'Akron', state: 'OH', zip: '44301', name: 'Opal Choice', email: 'opal@example.com' }))
    expect(plain.body.options.map((o: any) => [o.name, o.estimateLow])).toEqual([['Roof replacement', plain.body.estimateLow]])
  })

  test('the service area: an address outside it is told so — not measured, no roof report used, no lead', async () => {
    const base = { estimatorEnabled: true, pricePerSquareLow: '400.00', pricePerSquareHigh: '600.00', estimatorHeadline: 'Free roof estimate', estimatorDisclaimer: 'Estimate only.' }
    const put = (extra: any) => as('owner')('/api/settings/estimator', { method: 'PUT', json: { ...base, ...extra } })
    // The area needs a centre: the business's own address.
    await t.db.update(t.schema.company).set({ address: null, city: null, state: null, zip: null } as any).where(eq(t.schema.company.id, companyId))
    const noAddress = await json(await put({ serviceRadiusMiles: 25 }))
    expect([noAddress.status, noAddress.body.error]).toEqual([400, 'Add your business address under Company settings first, so the service area has a centre.'])
    await t.db.update(t.schema.company).set({ address: '1 Shop St', city: 'Akron', state: 'OH', zip: '44301' } as any).where(eq(t.schema.company.id, companyId))
    expect((await put({ serviceRadiusMiles: 0 })).status).toBe(400)
    // The stub places the shop at 41.08, −81.51; an address with "Far" in it is 0.01° north — about 0.7 miles away.
    expect((await put({ serviceRadiusMiles: 1 })).status).toBe(200)
    try {
      expect((await json(await as('owner')('/api/company'))).body.settings.estimator).toMatchObject({ serviceRadiusMiles: 1, base: { lat: 41.08, lng: -81.51 } })
      expect((await json(await estimate({ address: '3 Far Lane', city: 'Akron', state: 'OH', zip: '44301', name: 'Near Enough', email: 'near@example.com' }))).body.outOfArea).toBeUndefined()
      // Shrink the area to nothing a "Far" address is inside: the same stub, a centre moved 30 miles south.
      const [co] = await t.db.select().from(t.schema.company).where(eq(t.schema.company.id, companyId))
      await t.db.update(t.schema.company).set({ settings: { ...(co.settings as any), estimator: { ...(co.settings as any).estimator, base: { lat: 40.64, lng: -81.51 } } } } as any).where(eq(t.schema.company.id, companyId))
      const before = await credits(), sentBefore = outbound.length
      const out = await json(await estimate({ address: '99 Outside Rd', city: 'Akron', state: 'OH', zip: '44301', name: 'Too Far', email: 'toofar@example.com' }))
      expect(out).toMatchObject({ status: 200, body: { quoted: false, outOfArea: true } })
      expect(out.body.message).toContain('outside the area we serve')
      expect(outbound.slice(sentBefore).some((u) => u.includes('dataLayers:get'))).toBe(false)
      expect(await credits()).toBe(before)
      expect(await t.db.select().from(t.schema.contact).where(eq(t.schema.contact.email, 'toofar@example.com'))).toEqual([])
    } finally {
      // Empty = anywhere again.
      expect((await put({ serviceRadiusMiles: null })).status).toBe(200)
    }
    expect((await json(await as('owner')('/api/company'))).body.settings.estimator).toMatchObject({ serviceRadiusMiles: null, base: null })
    expect((await json(await estimate({ address: '99 Outside Rd', city: 'Akron', state: 'OH', zip: '44301', name: 'Too Far', email: 'toofar@example.com' }))).body.quoted).toBe(true)
  })

  // Live test 11/11: the estimator's street box suggested nothing. As the visitor types, the business's server asks Google
  // for addresses (one session token for the typing, ended by the pick), and the one picked fills in the city, state, zip.
  test('suggests addresses as they are typed, and the one picked fills in the street, city, state and zip', async () => {
    placesAsked.length = 0
    const S = 'sess-abc12345'
    const found = await json(await t.call(`/api/estimator/addresses/test-builders?q=${encodeURIComponent('12 Pine')}&s=${S}`))
    expect(found.status).toBe(200)
    expect(found.body.suggestions).toEqual([{ id: 'place-pine-12', text: '12 Pine St, Akron, OH, USA' }, { id: 'place-pine-120', text: '120 Pine St, Akron, OH, USA' }])
    expect(placesAsked[0]).toMatchObject({ input: '12 Pine', sessionToken: S, includedRegionCodes: ['us'] })
    const picked = await json(await t.call(`/api/estimator/address/test-builders?id=place-pine-12&s=${S}`))
    expect(picked).toEqual({ status: 200, body: { address: '12 Pine Street', city: 'Akron', state: 'OH', zip: '44301' } })
    // The pick ends the typing's session: the same token, and only the Essentials field asked for.
    expect(placesAsked[1].details).toContain(`sessionToken=${S}`)
    // Too little typed asks Google nothing; nothing found is an empty list; a missing token or a made-up id is refused.
    const before = placesAsked.length
    expect((await json(await t.call(`/api/estimator/addresses/test-builders?q=12&s=${S}`))).body).toEqual({ suggestions: [] })
    expect(placesAsked.length).toBe(before)
    expect((await json(await t.call(`/api/estimator/addresses/test-builders?q=Nowhere&s=${S}`))).body).toEqual({ suggestions: [] })
    expect((await t.call('/api/estimator/addresses/test-builders?q=12+Pine')).status).toBe(400)
    expect((await t.call(`/api/estimator/address/test-builders?id=${encodeURIComponent('../x')}&s=${S}`)).status).toBe(400)
    expect((await t.call(`/api/estimator/address/test-builders?id=place-unknown-1&s=${S}`)).status).toBe(404)
    // Another business's slug that has no estimator, and an estimator switched off: no look-ups for them.
    expect((await t.call(`/api/estimator/addresses/other-roofing?q=12+Pine&s=${S}`)).status).toBe(403)
    await t.db.update(t.schema.company).set({ estimatorEnabled: false } as any).where(eq(t.schema.company.id, companyId))
    try {
      expect((await t.call(`/api/estimator/addresses/test-builders?q=12+Pine&s=${S}`)).status).toBe(403)
    } finally {
      await t.db.update(t.schema.company).set({ estimatorEnabled: true } as any).where(eq(t.schema.company.id, companyId))
    }
  })

  test('refuses when the company has turned it off (403), and is not there with the feature off (404)', async () => {
    await t.db.update(t.schema.company).set({ estimatorEnabled: false } as any).where(eq(t.schema.company.id, companyId))
    expect((await json(await t.call('/api/estimator/config/test-builders'))).body).toEqual({ error: 'Estimator not enabled' })
    expect((await t.call('/api/estimator/estimate/test-builders', { method: 'POST', json: { address: '40 Oak Ave', city: 'Akron', state: 'OH', zip: '44301' } })).status).toBe(403)
    await t.db.update(t.schema.company).set({ estimatorEnabled: true, enabledFeatures: ['contacts', 'jobs', 'measurement_reports'] } as any).where(eq(t.schema.company.id, companyId))
    t.services.features.forgetFeatures()
    try {
      expect((await t.call('/api/estimator/config/test-builders')).status).toBe(404)
    } finally {
      await t.db.update(t.schema.company).set({ enabledFeatures: ['contacts', 'jobs', 'measurement_reports', 'instant_estimator'] } as any).where(eq(t.schema.company.id, companyId))
      t.services.features.forgetFeatures()
    }
  })

  test('its settings are the owner\'s and admins\' (company:update), with prices that are money', async () => {
    const body = { estimatorEnabled: true, pricePerSquareLow: '425.50', pricePerSquareHigh: '610', estimatorHeadline: 'Free roof estimate', estimatorDisclaimer: 'Estimate only.' }
    expect((await as('manager')('/api/settings/estimator', { method: 'PUT', json: body })).status).toBe(403)
    expect((await t.call('/api/settings/estimator', { method: 'PUT', json: body })).status).toBe(401)
    const ok = await json(await as('admin')('/api/settings/estimator', { method: 'PUT', json: body }))
    expect(ok).toEqual({ status: 200, body: { success: true, message: 'Saved' } })
    const [co] = await t.db.select().from(t.schema.company).where(eq(t.schema.company.id, companyId))
    expect([co.pricePerSquareLow, co.pricePerSquareHigh, co.estimatorHeadline]).toEqual(['425.50', '610.00', 'Free roof estimate'])
    const bad = await json(await as('owner')('/api/settings/estimator', { method: 'PUT', json: { ...body, pricePerSquareLow: 'abc' } }))
    expect([bad.status, Object.keys(bad.body.fields)]).toEqual([400, ['pricePerSquareLow']])
    // The CRM's own company record carries the estimator settings back to the screen.
    expect((await json(await as('owner')('/api/company'))).body).toMatchObject({ slug: 'test-builders', estimatorHeadline: 'Free roof estimate' })
  })
})
