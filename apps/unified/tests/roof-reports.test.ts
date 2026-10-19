// Roofing's measurements, roof reports and instant estimator (server/crm/roof/reports; docs/UNIFIED_ROOF_PLAN.md step
// 3c), through the real server as the roof vertical. Google Solar, Stripe and the file store are stubbed: no test here
// reaches a live API (every outbound fetch is answered locally, and an unknown one is a 404).
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { eq } from 'drizzle-orm'
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
  for (const k of ['GOOGLE_MAPS_API_KEY', 'NEARMAP_API_KEY', 'REPLICATE_API_TOKEN', 'FACTORY_API_URL', 'FACTORY_SYNC_URL']) setEnv(k, undefined)
  setEnv('FACTORY_SYNC_KEY', 'factory-key-test')
  setEnv('FRONTEND_URL', 'https://roof.test')
  globalThis.fetch = (async (input: any) => {
    const url = String(input?.url ?? input)
    outbound.push(url)
    if (url.startsWith('https://maps.googleapis.com/maps/api/geocode/json')) {
      if (url.includes('Nowhere')) return new Response(JSON.stringify({ results: [] }), { status: 200 })
      return new Response(JSON.stringify({ results: [{ geometry: { location: { lat: 41.08, lng: -81.51 } }, formatted_address: '12 Pine St, Akron, OH 44301' }] }), { status: 200 })
    }
    if (url.startsWith('https://solar.googleapis.com/v1/buildingInsights:findClosest')) return new Response(JSON.stringify(INSIGHTS), { status: 200 })
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
    const bought = await json(await as('admin')('/api/measurements/credits/purchase', { method: 'POST', json: { quantity: 5 } }))
    expect(bought).toEqual({ status: 200, body: { credits: 8, message: '5 credits added' } })
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
      // Measurements are not behind it (the template's menu shows them always).
      expect((await as('owner')('/api/measurements')).status).toBe(200)
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
  test('answers publicly with the company\'s own prices, keeps the lead and the measurement, and spends no credit', async () => {
    const cfg = await json(await t.call('/api/estimator/config/test-builders'))
    expect(cfg.status).toBe(200)
    expect(cfg.body).toMatchObject({ slug: 'test-builders', estimatorEnabled: true, pricePerSquareLow: '400.00', pricePerSquareHigh: '600.00' })
    const before = await credits()
    const est = await json(await t.call('/api/estimator/estimate/test-builders', { method: 'POST', json: { address: '40 Oak Ave', city: 'Akron', state: 'OH', zip: '44301', name: 'Dana Reyes', email: ' Dana@Example.COM ' } }))
    expect(est.status).toBe(200)
    expect(est.body).toMatchObject({ totalSquares: SQUARES, estimateLow: Math.round(SQUARES * 400), estimateHigh: Math.round(SQUARES * 600), companyName: 'Test Builders' })
    const [lead] = await t.db.select().from(t.schema.contact).where(eq(t.schema.contact.email, 'dana@example.com'))
    expect(lead).toMatchObject({ companyId, name: 'Dana Reyes', source: 'instant_estimator', propertyType: 'residential', type: 'lead' })
    const kept = (await t.db.select().from(t.schema.measurementReport).where(eq(t.schema.measurementReport.address, '40 Oak Ave')))[0]
    expect(kept).toMatchObject({ companyId, cost: '0.00', status: 'complete' })
    expect((kept.rawData as any).contactId).toBe(lead.id)
    expect(await credits()).toBe(before)
    expect((await t.call('/api/estimator/estimate/test-builders', { method: 'POST', json: { address: 'Nowhere Lane', city: 'A', state: 'OH', zip: '1' } })).status).toBe(422)
    expect((await t.call('/api/estimator/estimate/test-builders', { method: 'POST', json: { address: '40 Oak Ave', city: 'A', state: 'OH', zip: '1', email: 'not-an-email' } })).status).toBe(400)
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
