// The draw-it-yourself roof report (server/crm/roof/reports/drawnReport.ts): the picture for an address, and a drawing
// measured and saved — through the real server as the roof vertical. Google is stubbed: no test here reaches a live API
// (every outbound fetch is answered locally, and an unknown one is a 404).
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

const realFetch = globalThis.fetch
const outbound: string[] = []
const stored = new Map<string, Buffer>()
const env: Record<string, string | undefined> = {}
const setEnv = (k: string, v: string | undefined) => { if (!(k in env)) env[k] = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v }

// ── A made-up house for the stubbed Google data layers: 40 m × 40 m of ground at 0.5 m a pixel, on UTM zone 17N, with
//    a 20 m × 16 m gable roof at 6/12 in the middle (ridge running east–west). ──
const W = 80, H = 80, PX = 0.5
const UTM = { minX: 457000, maxY: 4548000 }
const onRoof = (x: number, y: number) => x >= 20 && x < 60 && y >= 24 && y < 56
const tiff = (values: Float32Array | Uint8Array) => writeTestGeoTiff(values, { width: W, height: H, pixelM: PX, minEasting: UTM.minX, maxNorthing: UTM.maxY, epsg: 32617 })
let DSM: Buffer, MASK: Buffer, RGB: Buffer

beforeAll(async () => {
  const dsm = new Float32Array(W * H), mask = new Uint8Array(W * H)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x
    if (!onRoof(x, y)) { dsm[i] = 300; continue }
    mask[i] = 1
    // 8 m either side of the ridge (row 40), rising 0.5 per metre toward it.
    dsm[i] = 303 + (8 - Math.abs(y + 0.5 - 40) * PX) * 0.5
  }
  DSM = await tiff(dsm)
  MASK = await tiff(mask)
  RGB = await sharp({ create: { width: W, height: H, channels: 3, background: { r: 90, g: 110, b: 90 } } }).png().toBuffer()

  setEnv('GOOGLE_SOLAR_API_KEY', 'test-key')
  for (const k of ['GOOGLE_MAPS_API_KEY', 'NEARMAP_API_KEY', 'REPLICATE_API_TOKEN', 'FACTORY_URL']) setEnv(k, undefined)
  globalThis.fetch = (async (input: any) => {
    const url = String(input?.url ?? input)
    outbound.push(url)
    if (url.startsWith('https://maps.googleapis.com/maps/api/geocode/json')) {
      if (url.includes('Nowhere')) return new Response(JSON.stringify({ results: [] }), { status: 200 })
      return new Response(JSON.stringify({ results: [{ geometry: { location: { lat: 41.08, lng: -81.51 } }, formatted_address: '12 Pine St, Akron, OH 44301' }] }), { status: 200 })
    }
    if (url.startsWith('https://solar.googleapis.com/v1/dataLayers:get')) {
      return new Response(JSON.stringify({
        imageryDate: { year: 2025, month: 4, day: 2 }, imageryQuality: 'HIGH',
        dsmUrl: 'https://solar.googleapis.com/v1/geoTiff:get?id=dsm', maskUrl: 'https://solar.googleapis.com/v1/geoTiff:get?id=mask', rgbUrl: 'https://solar.googleapis.com/v1/geoTiff:get?id=rgb',
      }), { status: 200 })
    }
    if (url.startsWith('https://solar.googleapis.com/v1/geoTiff:get')) {
      const body = url.includes('id=dsm') ? DSM : url.includes('id=mask') ? MASK : RGB
      return new Response(new Uint8Array(body), { status: 200 })
    }
    return new Response('not stubbed', { status: 404 })
  }) as any

  t = await bootTenant({ vertical: 'roofing' })
  const seeded = await seedOwner(t)
  companyId = seeded.company.id
  tokens.owner = await login('owner@test.example', seeded.password)
  // Plenty of roof reports for the drawing tests; the test of the balance sets its own.
  await t.db.update(t.schema.company).set({ enabledFeatures: ['contacts', 'jobs', 'measurement_reports'], reportCredits: 50 } as any).where(eq(t.schema.company.id, companyId))
  const hash = await Bun.password.hash(PASS, 'bcrypt')
  for (const [key, role] of [['manager', 'manager'], ['crew', 'field']] as const) {
    await t.db.insert(t.schema.user).values({ email: `${key}@test.example`, passwordHash: hash, firstName: key, lastName: 'Seat', role, companyId } as any)
    tokens[key] = await login(`${key}@test.example`, PASS)
  }
  const [home] = await t.db.insert(t.schema.contact).values({ companyId, name: 'Lee Marsh', address: '12 Pine St', city: 'Akron', state: 'OH', zip: '44301' } as any).returning()
  ids.home = home.id
  const [other] = await t.db.insert(t.schema.company).values({ name: 'Other Roofing', slug: 'other-roofing' }).returning()
  otherCompanyId = other.id
  const [oc] = await t.db.insert(t.schema.contact).values({ companyId: other.id, name: 'Sam Elsewhere' } as any).returning()
  ids.otherContact = oc.id

  const crm: any = t.services.crm
  crm.storage.put = async (key: string, body: Buffer) => { stored.set(key, Buffer.from(body)) }
  crm.storage.getObject = async (key: string) => { const b = stored.get(key); return b ? { body: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), contentType: 'image/png' } : null }
  t.services.features.forgetFeatures()
}, 120_000)

afterAll(() => {
  globalThis.fetch = realFetch
  for (const [k, v] of Object.entries(env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
})

// ── A gable roof drawn by hand: 12 m × 8 m on the ground, ridge down the middle of the long way. ──
const GEO = { lat: 41.08, lng: -81.51 }
const M_LAT = 1 / 111_319.5
const M_LNG = 1 / (111_319.5 * Math.cos((GEO.lat * Math.PI) / 180))
const at = (east: number, north: number) => ({ lat: GEO.lat + north * M_LAT, lng: GEO.lng + east * M_LNG })
const line = (type: string, a: { lat: number; lng: number }, b: { lat: number; lng: number }) => ({ type, startLat: a.lat, startLng: a.lng, endLat: b.lat, endLng: b.lng })
const SW = at(-6, -4), SE = at(6, -4), NE = at(6, 4), NW = at(-6, 4), RW = at(-6, 0), RE = at(6, 0)
const GABLE = [
  line('eave', SW, SE), line('rake', SE, RE), line('rake', RE, NE), line('eave', NE, NW), line('rake', NW, RW), line('rake', RW, SW),
  line('ridge', RW, RE),
]
const FT = 3.28084, SQFT = 10.7639
const base = { address: '12 Pine St', city: 'Akron', state: 'OH', zip: '44301', geo: GEO, quality: 'HIGH', imageryDate: '2025-04-02' }
const finalize = (who: string, body: any) => as(who)('/api/roof-reports/finalize-drawn', { method: 'POST', json: body })

describe('the draw-it-yourself report', () => {
  test('the picture for an address: one data-layers call, the picture placed on the earth, the roof\'s slope under it', async () => {
    outbound.length = 0
    const r = await json(await as('manager')('/api/roof-reports/draw-backdrop', { method: 'POST', json: { address: '12 Pine St', city: 'Akron', state: 'OH', zip: '44301', contactId: ids.home } }))
    expect(r.status).toBe(200)
    expect(outbound.filter((u) => u.includes('dataLayers:get')).length).toBe(1)
    expect(outbound.some((u) => u.includes('buildingInsights'))).toBe(false)
    expect([r.body.quality, r.body.imageryDate, r.body.contactId, r.body.geo]).toEqual(['HIGH', '2025-04-02', ids.home, GEO])
    expect(r.body.aerialImage.startsWith('data:image/jpeg;base64,')).toBe(true)
    // The stored picture is this company's, and it was really stored.
    expect(r.body.aerialImagePath.startsWith(`roof-imagery/${companyId}/`)).toBe(true)
    expect(stored.has(r.body.aerialImagePath)).toBe(true)
    ids.aerial = r.body.aerialImagePath
    // 40 m of ground each way, its four corners in Ohio (UTM 17N converted), top edge north of the bottom edge.
    const b = r.body.backdrop
    expect([Math.round(b.widthM), Math.round(b.heightM)]).toEqual([40, 40])
    expect(b.corners.length).toBe(4)
    for (const c of b.corners) { expect(c.lat).toBeGreaterThan(41); expect(c.lat).toBeLessThan(41.2); expect(c.lng).toBeGreaterThan(-81.6); expect(c.lng).toBeLessThan(-81.4) }
    expect(b.corners[0].lat).toBeGreaterThan(b.corners[3].lat)
    expect(b.corners[1].lng).toBeGreaterThan(b.corners[0].lng)
    // The slope map reads 6/12 on the south face of the made-up roof (a cell well inside it), falling to the south.
    const grid = Buffer.from(b.pitchGrid.data, 'base64')
    const cell = (col: number, row: number) => ({ east: grid.readInt8((row * b.pitchGrid.cols + col) * 2) / 50, north: grid.readInt8((row * b.pitchGrid.cols + col) * 2 + 1) / 50 })
    expect([b.pitchGrid.cols, b.pitchGrid.rows]).toEqual([80, 80])
    const south = cell(40, 48)
    expect(Math.abs(south.east)).toBeLessThan(0.05)
    expect(south.north).toBeCloseTo(0.5, 1)
    // Off the roof there is nothing to read.
    expect(grid.readInt8(0)).toBe(-128)
  })

  test('an address that cannot be found is said so; a seat that may not draw is refused; nobody signed in is 401', async () => {
    const lost = await json(await as('manager')('/api/roof-reports/draw-backdrop', { method: 'POST', json: { address: 'Nowhere Lane', city: 'Akron', state: 'OH', zip: '44301' } }))
    expect(lost).toEqual({ status: 404, body: { error: 'That address was not found. Check it and try again.' } })
    expect((await as('manager')('/api/roof-reports/draw-backdrop', { method: 'POST', json: { address: '12 Pine St' } })).status).toBe(400)
    expect((await as('manager')('/api/roof-reports/draw-backdrop', { method: 'POST', json: { address: '1', city: 'A', state: 'OH', zip: '1', contactId: ids.otherContact } })).status).toBe(404)
    for (const p of ['/api/roof-reports/draw-backdrop', '/api/roof-reports/finalize-drawn']) {
      const crew = await json(await as('crew')(p, { method: 'POST', json: {} }))
      expect([p, crew.status, crew.body.required]).toEqual([p, 403, 'roof-reports:create'])
      expect([p, (await t.call(p, { method: 'POST', json: {} })).status]).toEqual([p, 401])
    }
  })

  test('a drawn gable roof is measured by the server: area on the slope, rakes at their real length, 10% waste, $0.00', async () => {
    // Figures a browser might send are not the report's: only the lines and pitches are read.
    const r = await json(await finalize('manager', { ...base, contactId: ids.home, aerialImagePath: ids.aerial, lines: GABLE, defaultPitchOver12: 6, measurements: { totalSquares: 999 }, totalSquares: 999, amountCharged: '50.00' }))
    expect(r.status).toBe(201)
    const [row] = await t.db.select().from(t.schema.roofReport).where(eq(t.schema.roofReport.id, r.body.report.id))
    const m: any = row.measurements
    const factor = Math.sqrt(1 + 0.5 * 0.5)
    expect(row.segmentCount).toBe(2)
    expect(Number(row.totalAreaSqft)).toBeCloseTo(96 * SQFT * factor, -1)
    expect(Number(row.totalSquares)).toBeCloseTo((96 * SQFT * factor) / 100, 1)
    expect(m.source).toBe('drawn')
    expect(m.ridgeLF).toBeCloseTo(12 * FT, 0)
    expect(m.eaveLF).toBeCloseTo(24 * FT, 0)
    expect(m.rakeLF).toBeCloseTo(16 * factor * FT, 0)      // four rakes of 4 m on the ground, longer on the slope
    expect([m.hipLF, m.valleyLF, m.flashLF, m.stepFlashLF]).toEqual([0, 0, 0, 0])
    expect(m.wasteFactor).toBe(10)
    expect(m.squaresWithWaste).toBeCloseTo(Number(row.totalSquares) * 1.1, 1)
    expect(m.iceWaterShieldSqft).toBe(Math.round(m.eaveLF * 6))
    expect(m.warnings).toEqual([])
    expect([row.amountCharged, row.contactId, row.aerialImagePath, row.imageryQuality, row.imageryDate, row.stripePaymentIntentId]).toEqual(['0.00', ids.home, ids.aerial, 'HIGH', '2025-04-02', null])
    const segs: any[] = row.segments as any
    expect(segs.map((s) => s.pitch)).toEqual(['6/12', '6/12'])
    expect(segs.every((s) => Array.isArray(s.polygon) && s.polygon.length === 4 && s.pitchFrom === 'default')).toBe(true)
    const edges: any[] = row.edges as any
    expect(edges.length).toBe(GABLE.length)
    const rake = edges.find((e) => e.type === 'rake')
    expect(rake.lengthFt).toBeGreaterThan(rake.flatFt)
    // The saved report opens like any other, for this company.
    const got = await json(await as('manager')(`/api/roof-reports/${row.id}`))
    expect([got.status, got.body.totalSquares]).toEqual([200, row.totalSquares])
  })

  test('a section with its own pitch is measured at that pitch; waste may be set', async () => {
    // The north section at 12/12 (pinned by a point inside it), the south at the whole-roof 6/12; 15% waste.
    const north = at(0, 2)
    const r = await json(await finalize('owner', { ...base, lines: GABLE, defaultPitchOver12: 6, facePitches: [{ ...north, pitchOver12: 12 }], wastePct: 15 }))
    expect(r.status).toBe(201)
    const [row] = await t.db.select().from(t.schema.roofReport).where(eq(t.schema.roofReport.id, r.body.report.id))
    const want = 48 * SQFT * Math.sqrt(1.25) + 48 * SQFT * Math.SQRT2
    expect(Number(row.totalAreaSqft)).toBeCloseTo(want, -1)
    const segs: any[] = row.segments as any
    expect(segs.map((s) => `${s.pitch} ${s.pitchFrom}`).sort()).toEqual(['12/12 face', '6/12 default'])
    const m: any = row.measurements
    expect(m.wasteFactor).toBe(15)
    expect(m.squaresWithWaste).toBeCloseTo(Number(row.totalSquares) * 1.15, 1)
    // The two rakes on the steep side are longer than the two on the shallow side.
    expect(m.rakeLF).toBeCloseTo((8 * Math.sqrt(1.25) + 8 * Math.SQRT2) * FT, 0)
    // No picture named: none saved.
    expect(row.aerialImagePath).toBeNull()
  })

  test('step flashing is measured up the slope, a section keeps the way it faces, and the print page lists both', async () => {
    // A wall line run from the middle of the ridge down to the middle of the south eave: 4 m on the ground, up a 6/12.
    const lines = [...GABLE, line('stepflash', at(0, 0), at(0, -4))]
    const r = await json(await finalize('manager', { ...base, lines, defaultPitchOver12: 6, faceFacings: [{ ...at(0, 2), azimuthDeg: 0 }, { ...at(-3, -2), azimuthDeg: 180 }] }))
    expect(r.status).toBe(201)
    const [row] = await t.db.select().from(t.schema.roofReport).where(eq(t.schema.roofReport.id, r.body.report.id))
    const m: any = row.measurements
    expect(m.stepFlashLF).toBeCloseTo(4 * Math.sqrt(1.25) * FT, 0)
    expect(m.flashLF).toBe(0)
    // The line splits the south side in two; the area is unchanged.
    expect(row.segmentCount).toBe(3)
    expect(Number(row.totalAreaSqft)).toBeCloseTo(96 * SQFT * Math.sqrt(1.25), -1)
    const facing = (row.segments as any[]).map((s) => s.azimuthDegrees).sort((a, b) => (a ?? 999) - (b ?? 999))
    expect(facing).toEqual([0, 180, null])
    const page = await (await as('manager')(`/api/roof-reports/${row.id}/pdf`)).text()
    expect(page).toContain('Step flashing')
    // A section that faces somewhere says where, in degrees and on the compass; one that was not read shows a dash.
    expect(page).toContain('<td>180&deg;</td>')
    expect(page).toContain('<td>S</td>')
    expect(page).toContain('<td>&mdash;</td>')
    expect(page).toContain('drawn by hand')
    expect(page).not.toContain('undefined')

    // The materials list, by hand: 12 m × 8 m on the ground at 6/12 is 1,155 sq ft = 11.55 squares.
    const list = (await json(await as('manager')(`/api/roof-reports/${row.id}/materials?pipeBoots=3&boxVents=4&ridgeVentFt=10`))).body
    const qty = Object.fromEntries(list.lines.map((l: any) => [l.code, l.qty]))
    expect(list.settings).toEqual({ wastePercent: 10, bundleSqFt: 33.3, pipeBoots: 3, boxVents: 4, ridgeVentFt: 10, iceWaterEaveRows: 2, iceWaterValleyRows: 1 })
    expect(qty.shingles).toBe(39) // 11.55 × 3 bundles + 10% = 38.1
    expect(qty['ice-water']).toBe(3) // two rows × 78.7 ft of eave × 3 ft = 472 sq ft + 10% = 520 ÷ 200
    expect(qty['step-flashing']).toBe(35) // 14.7 ft ÷ 5-5/8 in a course + 10% = 34.4
    expect(qty['pipe-boots']).toBe(3)
    // Vents are what the roofer entered, never worked out: 4 box vents, and 10 ft of ridge vent in 4 ft pieces.
    expect(qty['box-vents']).toBe(4)
    expect(qty['ridge-vent']).toBe(3)
    expect(qty['valley-metal']).toBeUndefined() // no valley was drawn
    expect(qty['wall-flashing']).toBeUndefined()
    expect(list.estimated).toEqual([]) // every length was measured, none guessed from the squares
    expect(list.lines.map((l: any) => l.code)).toEqual(['shingles', 'starter', 'ridge-cap', 'underlayment', 'ice-water', 'drip-edge', 'step-flashing', 'pipe-boots', 'box-vents', 'ridge-vent', 'nails'])
    // A shingle whose bundle covers less than a true third of a square takes more bundles: 1,155 sq ft + 10% ÷ 30 = 42.4.
    const small = (await json(await as('manager')(`/api/roof-reports/${row.id}/materials?bundleSqFt=30`))).body
    expect([small.settings.bundleSqFt, small.lines.find((l: any) => l.code === 'shingles').qty]).toEqual([30, 43])
    // One row at the eaves instead of two, and no pipe boots counted.
    const lean = (await json(await as('manager')(`/api/roof-reports/${row.id}/materials?iceWaterEaveRows=1&wastePercent=abc`))).body
    expect(lean.lines.find((l: any) => l.code === 'ice-water').qty).toBe(2)
    expect(lean.lines.some((l: any) => ['pipe-boots', 'box-vents', 'ridge-vent', 'vents'].includes(l.code))).toBe(false)
    expect(lean.settings.wastePercent).toBe(10) // a waste that is not a number is ignored
    // The print page carries the same list.
    const printed = await (await as('manager')(`/api/roof-reports/${row.id}/pdf?pipeBoots=3`)).text()
    expect(printed).toContain('Materials List (10% waste included)')
    expect(printed).toContain('<td>Pipe boots</td><td><strong>3</strong> each</td>')
    expect(printed).toContain('<td>Shingles</td><td><strong>39</strong> bundles</td>')
    // Another company's report gives no list.
    expect((await as('manager')('/api/roof-reports/not-a-report/materials')).status).toBe(404)
    const bad =await json(await finalize('manager', { ...base, lines, defaultPitchOver12: 6, faceFacings: [{ ...at(0, 2), azimuthDeg: 720 }] }))
    expect([bad.status, bad.body.error]).toEqual([400, 'The section directions could not be read. Draw the roof again.'])
  })

  test('a drawing that cannot be a report is refused with a sentence, and nothing is saved', async () => {
    const count = async () => (await t.db.select().from(t.schema.roofReport).where(eq(t.schema.roofReport.companyId, companyId))).length
    const before = await count()
    const cases: Array<[any, number, string]> = [
      [{ ...base, lines: [], defaultPitchOver12: 6 }, 400, 'Draw at least one line before creating the report.'],
      // An outline left open closes no section, so there is no area.
      [{ ...base, lines: GABLE.slice(0, 3), defaultPitchOver12: 6 }, 400, 'The lines do not close into any roof section yet, so there is no area to report. Finish the outline so every section is closed.'],
      [{ ...base, lines: [{ ...GABLE[0], type: 'gutter' }], defaultPitchOver12: 6 }, 400, 'One of the lines has no type. Pick eave, rake, ridge, hip, valley or flashing for each line.'],
      [{ ...base, lines: [{ ...GABLE[0], endLat: 'north' }], defaultPitchOver12: 6 }, 400, 'One of the lines is missing a point. Redraw it.'],
      [{ ...base, lines: GABLE, defaultPitchOver12: 40 }, 400, 'Enter the roof\'s pitch as a rise over 12 between 0 and 24.'],
      [{ ...base, lines: GABLE, defaultPitchOver12: 6, facePitches: [{ lat: 41.08, lng: -81.51, pitchOver12: -2 }] }, 400, 'A section\'s pitch must be a rise over 12 between 0 and 24.'],
      [{ ...base, lines: GABLE, defaultPitchOver12: 6, wastePct: 80 }, 400, 'Waste must be between 0 and 50 percent.'],
      [{ ...base, geo: { lat: 'x', lng: 0 }, lines: GABLE, defaultPitchOver12: 6 }, 400, 'The report has no location. Start the drawing again from the address.'],
      [{ ...base, address: '', lines: GABLE, defaultPitchOver12: 6 }, 400, 'Address, city, state, and zip are required'],
      [{ ...base, contactId: ids.otherContact, lines: GABLE, defaultPitchOver12: 6 }, 404, 'Contact not found'],
    ]
    for (const [body, status, error] of cases) {
      const r = await json(await finalize('manager', body))
      expect([r.status, r.body.error]).toEqual([status, error])
    }
    expect(await count()).toBe(before)
  })

  test('a picture that is not this company\'s is not saved with the report', async () => {
    for (const path of ['/etc/passwd', `roof-imagery/${otherCompanyId}/x.png`]) {
      const r = await json(await finalize('manager', { ...base, lines: GABLE, defaultPitchOver12: 6, aerialImagePath: path }))
      expect(r.status).toBe(201)
      const [row] = await t.db.select().from(t.schema.roofReport).where(eq(t.schema.roofReport.id, r.body.report.id))
      expect(row.aerialImagePath).toBeNull()
    }
  })

  test('a house and a detached garage on one report: each building has its own total, and they add up', async () => {
    // The 12 m × 8 m gable, and 14 m east of it a 6 m × 4 m garage with one roof plane, both at 6/12.
    const g = [at(20, 0), at(26, 0), at(26, 4), at(20, 4)]
    const garage = [line('eave', g[0], g[1]), line('rake', g[1], g[2]), line('eave', g[2], g[3]), line('rake', g[3], g[0])]
    const one = await json(await finalize('manager', { ...base, lines: GABLE, defaultPitchOver12: 6 }))
    expect((one.body.report.measurements as any).buildings).toBeUndefined() // one building: nothing to break down
    const r = await json(await finalize('manager', { ...base, lines: [...GABLE, ...garage], defaultPitchOver12: 6, buildingNames: [{ ...at(23, 2), name: ' Garage ' }] }))
    expect(r.status).toBe(201)
    const m: any = r.body.report.measurements
    // House 96 m² and garage 24 m² on the ground, × √1.25 up the slope: 1,155 and 289 sq ft.
    expect(m.buildings.map((b: any) => [b.name, b.sections, b.areaSqft, b.squares, b.squaresWithWaste])).toEqual([
      ['Building 1', 2, 1155, 11.55, 12.71], ['Garage', 1, 289, 2.89, 3.18],
    ])
    expect(m.totalAreaSqft).toBe(1444)
    expect(m.buildings[0].eaveLF + m.buildings[1].eaveLF).toBeCloseTo(m.eaveLF, 1)
    expect(m.buildings[1].eaveLF).toBeCloseTo(12 * FT, 0)
    expect(m.buildings[1].ridgeLF).toBe(0)
    expect((r.body.report.segments as any[]).map((s) => s.name)).toEqual(['Building 1, section 1', 'Building 1, section 2', 'Garage, section 3'])
    const page = await (await as('manager')(`/api/roof-reports/${r.body.report.id}/pdf`)).text()
    expect(page).toContain('<td>Garage</td><td>289</td><td>2.89</td><td>3.18</td>')
    expect(page).toContain('Measurement Summary (all buildings together)')
    const long = await json(await finalize('manager', { ...base, lines: GABLE, defaultPitchOver12: 6, buildingNames: [{ ...at(0, 2), name: 'x'.repeat(41) }] }))
    expect([long.status, long.body.error]).toEqual([400, 'A building\'s name can be up to 40 characters.'])
  })

  test('a roof report is spent when the picture loads, given back when none came, and bought in packs of 100 for $15', async () => {
    const setLeft = (n: number) => t.db.update(t.schema.company).set({ reportCredits: n } as any).where(eq(t.schema.company.id, companyId))
    const left = async () => (await json(await as('manager')('/api/roof-reports/credits'))).body
    const pine = { address: '12 Pine St', city: 'Akron', state: 'OH', zip: '44301' }
    const draw = (body: any) => as('manager')('/api/roof-reports/draw-backdrop', { method: 'POST', json: body })
    await setLeft(1)
    expect(await left()).toEqual({ credits: 1, pack: { roofs: 100, priceCents: 1500 }, lowAt: 10 })
    // The last one loads a picture; the next address is refused BEFORE Google is asked for anything.
    const first = await json(await draw(pine))
    expect([first.status, first.body.creditsLeft]).toEqual([200, 0])
    outbound.length = 0
    const none = await json(await draw(pine))
    expect(none).toEqual({ status: 402, body: { error: 'You have no roof reports left. Buy a pack to draw another roof.', code: 'no_credits' } })
    expect(outbound).toEqual([])
    // An address that gives no picture costs nothing.
    await setLeft(1)
    expect((await draw({ ...pine, address: 'Nowhere Lane' })).status).toBe(404)
    expect((await left()).credits).toBe(1)
    // Saving a drawing spends nothing more.
    expect((await finalize('manager', { ...base, lines: GABLE, defaultPitchOver12: 6 })).status).toBe(201)
    expect((await left()).credits).toBe(1)

    // Buying a pack: only a seat that may buy, and only with card payments set up.
    const crm: any = t.services.crm
    const had = crm.stripe
    const checkout = (who: string) => as(who)('/api/roof-reports/credits/checkout', { method: 'POST', json: {} })
    const confirm = (who: string, sessionId: string) => as(who)('/api/roof-reports/credits/confirm', { method: 'POST', json: { sessionId } })
    expect((await checkout('crew')).status).toBe(403)
    crm.stripe = null
    expect((await json(await checkout('owner')))).toEqual({ status: 503, body: { error: 'Card payments for roof reports are not set up on this account. Contact Twomiah support.' } })
    const sessions: Record<string, any> = {}
    const asked: any[] = []
    crm.stripe = { checkout: { sessions: {
      create: async (p: any) => { asked.push(p); const id = `cs_pack_${asked.length}`; sessions[id] = { id, url: `https://checkout.stripe.test/${id}`, payment_status: 'unpaid', ...p }; return sessions[id] },
      retrieve: async (id: string) => { if (!sessions[id]) throw new Error('No such checkout.session'); return sessions[id] },
    } } }
    try {
      const start = await json(await checkout('owner'))
      expect(start.body.checkoutUrl).toBe('https://checkout.stripe.test/cs_pack_1')
      expect(asked[0].line_items[0].price_data).toMatchObject({ currency: 'usd', unit_amount: 1500, product_data: { name: '100 roof reports' } })
      expect(asked[0].metadata).toEqual({ type: 'roof_report_pack', companyId, roofs: '100' })
      expect(asked[0].success_url).toContain('/crm/roof-reports?pack_session={CHECKOUT_SESSION_ID}')
      // Not paid yet: nothing is added.
      expect((await confirm('owner', 'cs_pack_1')).status).toBe(402)
      expect((await left()).credits).toBe(1)
      // Paid: 100 are added, once, however often the browser comes back.
      sessions.cs_pack_1.payment_status = 'paid'; sessions.cs_pack_1.amount_total = 1500
      expect((await json(await confirm('owner', 'cs_pack_1'))).body).toEqual({ credits: 101, added: 100 })
      const again = await Promise.all([confirm('owner', 'cs_pack_1'), confirm('owner', 'cs_pack_1')])
      for (const r of again) expect((await json(r)).body).toEqual({ credits: 101, added: 0 })
      expect((await left()).credits).toBe(101)
      const bought = await t.db.select().from(t.schema.auditLog).where(eq(t.schema.auditLog.entity, 'roof_report_pack'))
      expect(bought.map((b: any) => [b.companyId, b.entityId, b.entityName])).toEqual([[companyId, 'cs_pack_1', '100 roof reports bought for $15.00']])
      // Another company's payment, a payment for something else, and one Stripe has never heard of add nothing.
      sessions.cs_other = { id: 'cs_other', payment_status: 'paid', amount_total: 1500, metadata: { type: 'roof_report_pack', companyId: otherCompanyId, roofs: '100' } }
      sessions.cs_report = { id: 'cs_report', payment_status: 'paid', amount_total: 999, metadata: { type: 'roof_report', companyId } }
      expect([(await confirm('owner', 'cs_other')).status, (await confirm('owner', 'cs_report')).status, (await confirm('owner', 'cs_never')).status, (await confirm('crew', 'cs_pack_1')).status]).toEqual([403, 404, 404, 403])
      expect((await left()).credits).toBe(101)
    } finally {
      crm.stripe = had
      await setLeft(50)
    }
  })

  test('Roof Reports switched off: neither step answers', async () => {
    await t.db.update(t.schema.company).set({ enabledFeatures: ['contacts', 'jobs'] } as any).where(eq(t.schema.company.id, companyId))
    t.services.features.forgetFeatures()
    try {
      const a = await as('owner')('/api/roof-reports/draw-backdrop', { method: 'POST', json: { address: '12 Pine St', city: 'Akron', state: 'OH', zip: '44301' } })
      const b = await finalize('owner', { ...base, lines: GABLE, defaultPitchOver12: 6 })
      expect([a.status, b.status]).toEqual([403, 403])
    } finally {
      await t.db.update(t.schema.company).set({ enabledFeatures: ['contacts', 'jobs', 'measurement_reports'] } as any).where(eq(t.schema.company.id, companyId))
      t.services.features.forgetFeatures()
    }
  })
})
