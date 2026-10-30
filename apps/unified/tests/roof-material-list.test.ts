// The roofer's material list (docs/parity/roof-material-list.md; roofing depth, gap 4), through the real server as the
// roofing vertical:
//   · squares × waste → bundles, starter, ridge cap, underlayment, ice and water, drip edge, nails and vents, with the
//     real coverage figures, every one of them an assumption the roofer can change;
//   · the squares come from the job, else from its measurement report, else the list says it needs them;
//   · the roofer edits the list and "creates a material order" from it: a plain material order on the job;
//   · the calculator is a not-ready feature: with it off the door is not there; a seat without inventory:create cannot
//     order, a Field seat that is not on the job cannot see it, and another company's job is out of reach.
// Nothing here reaches a supplier, the Factory or a real tenant.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { getFeaturesForTemplate } from '@twomiah/tenant-backend'
import { DEFAULT_ASSUMPTIONS, buildMaterialList } from '../server/crm/roof/materialList.ts'

type T = Awaited<ReturnType<typeof bootTenant>>
let t: T
let companyId = ''
let otherJobId = ''
const tokens: Record<string, string> = {}
const ids: Record<string, string> = {}
const PASS = 'Seat-pass-1'
const FEATURES = ['jobs', 'contacts', 'materials', 'roof_material_list']

const login = async (email: string, password: string) =>
  (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken as string
const as = (who: string) => (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tokens[who]}` } })
const json = async (r: Response) => ({ status: r.status, body: await r.json().catch(() => null) as any })
const call = async (who: string, method: string, p: string, body?: unknown) => json(await as(who)(p, { method, ...(body === undefined ? {} : { json: body }) }))
const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
const qty = (lines: any[], code: string) => lines.find((l) => l.code === code)?.qty

beforeAll(async () => {
  t = await bootTenant({ vertical: 'roofing' })
  const seeded = await seedOwner(t)
  companyId = seeded.company.id
  await t.db.update(t.schema.company).set({ enabledFeatures: FEATURES } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
  tokens.owner = await login('owner@test.example', seeded.password)
  const hash = await Bun.password.hash(PASS, 'bcrypt')
  for (const [key, role] of [['mgr', 'manager'], ['rep', 'field'], ['view', 'viewer']] as const) {
    const u = await ins(t.schema.user, { email: `${key}@test.example`, passwordHash: hash, firstName: key, lastName: 'Seat', role, companyId })
    ids[key] = u.id
    tokens[key] = await login(`${key}@test.example`, PASS)
  }
  const home = await ins(t.schema.contact, { companyId, name: 'Lee Marsh', mobile: '715-555-0101', type: 'client' })
  ids.home = home.id
  const [other] = await t.db.insert(t.schema.company).values({ name: 'Other Roofing', slug: 'other-roofing' } as any).returning()
  otherJobId = (await ins(t.schema.job, { companyId: other.id, title: '9 Elm', number: 'ROOF-0001', status: 'lead', totalSquares: '20' })).id
}, 120_000)

/** A roofing job made the way the screen makes one. */
async function makeJob(extra: Record<string, unknown> = {}) {
  const made = await call('owner', 'POST', '/api/jobs', { contactId: ids.home, jobType: 'retail', propertyAddress: '12 Gable Ln', city: 'Akron', state: 'OH', zip: '44301', ...extra })
  expect(made.status).toBe(201)
  return made.body.id as string
}

describe('the arithmetic', () => {
  test('30 squares at 10% waste with measured lengths: the coverage figures roofers order by', () => {
    const l = buildMaterialList(30, { eaveFt: 150, rakeFt: 100, ridgeFt: 60, valleyFt: 20 })
    expect(l.estimated).toEqual([])
    expect(l.orderedSquares).toBe(33)
    // 30 × 3 bundles × 1.10 = 99; 250 ft ÷ 120 ft a bundle; 60 ft ÷ 25 ft a bundle; 33 sq ÷ 10 sq a roll;
    // (150 + 20) ft × 3 ft ÷ 200 sq ft a roll; 250 ft ÷ 10 ft a piece; 30 × 320 nails ÷ 7,200 a box.
    expect(Object.fromEntries(l.lines.map((x) => [x.code, x.qty]))).toEqual({
      shingles: 99, starter: 3, 'ridge-cap': 3, underlayment: 4, 'ice-water': 3, 'drip-edge': 28, nails: 2, vents: 26,
    })
    expect(l.lines.find((x) => x.code === 'shingles')!.basis).toContain('3 bundles')
  })

  test('the waste and every other assumption can be changed, and nonsense is ignored', () => {
    expect(qty(buildMaterialList(30, {}, { wastePercent: 15 }).lines, 'shingles')).toBe(104)
    expect(qty(buildMaterialList(30, {}, { wastePercent: 0 }).lines, 'shingles')).toBe(90)
    expect(qty(buildMaterialList(30, {}, { bundlesPerSquare: 4 }).lines, 'shingles')).toBe(132)
    expect(buildMaterialList(30, {}, { wastePercent: 'lots', bundlesPerSquare: -3, nope: 5 }).assumptions).toEqual(DEFAULT_ASSUMPTIONS)
    expect(buildMaterialList(30, {}, { ventType: 'none' }).lines.some((x) => x.code === 'vents')).toBe(false)
    expect(buildMaterialList(30, { ridgeFt: 60 }, { ventType: 'ridge' }).warnings.join(' ')).toContain('ridge vent')
  })

  test('lengths left out are estimated from the squares and the list says so; no squares, no list', () => {
    const l = buildMaterialList(25)
    expect(l.estimated).toEqual(['eaveFt', 'rakeFt', 'ridgeFt'])
    expect(l.warnings.join(' ')).toContain('Estimated')
    const none = buildMaterialList(0)
    expect([none.lines.length, none.warnings.length]).toEqual([0, 1])
  })
})

describe('the list for a job', () => {
  test('the squares entered on the job are used; the waste is the roofer\'s to change', async () => {
    const jobId = await makeJob({ totalSquares: 30 })
    const r = await call('mgr', 'GET', `/api/material-list/jobs/${jobId}?eaveFt=150&rakeFt=100&ridgeFt=60&valleyFt=20`)
    expect(r.status).toBe(200)
    expect([r.body.squares, r.body.squaresSource, r.body.address]).toEqual([30, 'job', '12 Gable Ln'])
    expect(qty(r.body.lines, 'shingles')).toBe(99)
    const more = await call('mgr', 'GET', `/api/material-list/jobs/${jobId}?wastePercent=15&eaveFt=150&rakeFt=100&ridgeFt=60`)
    expect(qty(more.body.lines, 'shingles')).toBe(104)
    ids.job = jobId
  })

  test('with no squares on the job its measurement report\'s are used; with neither the list asks for them', async () => {
    const jobId = await makeJob()
    const bare = await call('mgr', 'GET', `/api/material-list/jobs/${jobId}`)
    expect([bare.body.lines.length, bare.body.squaresSource]).toEqual([0, null])
    expect(bare.body.warnings[0]).toContain('squares')
    await ins(t.schema.measurementReport, { companyId, jobId, address: '12 Gable Ln', city: 'Akron', state: 'OH', zip: '44301', provider: 'manual', status: 'completed', totalSquares: '24.50' })
    const fromReport = await call('mgr', 'GET', `/api/material-list/jobs/${jobId}`)
    expect([fromReport.body.squares, fromReport.body.squaresSource]).toEqual([24.5, 'measurement'])
    expect(qty(fromReport.body.lines, 'shingles')).toBe(81) // 24.5 × 3 × 1.10 = 80.85
    // Squares typed on the roof win over both.
    const typed = await call('mgr', 'GET', `/api/material-list/jobs/${jobId}?squares=10`)
    expect([typed.body.squares, typed.body.squaresSource]).toEqual([10, 'typed'])
  })

  test('the calculator alone: squares in, list out, nothing stored', async () => {
    const r = await call('view', 'POST', '/api/material-list/calculate', { squares: 20, assumptions: { wastePercent: 12 } })
    expect(r.status).toBe(200)
    expect(qty(r.body.lines, 'shingles')).toBe(68) // 20 × 3 × 1.12 = 67.2
    expect((await call('view', 'POST', '/api/material-list/calculate', { squares: 'many' })).status).toBe(400)
    const assumptions = await call('view', 'GET', '/api/material-list/assumptions')
    expect(assumptions.body.defaults.bundlesPerSquare).toBe(3)
  })
})

describe('create material order from the list', () => {
  test('the edited list becomes a material order on the job, shown with the job\'s others', async () => {
    const list = await call('mgr', 'GET', `/api/material-list/jobs/${ids.job}?eaveFt=150&rakeFt=100&ridgeFt=60&valleyFt=20`)
    // The roofer takes the vents off, ups the nails and adds a line of their own.
    const lines = list.body.lines.filter((l: any) => l.code !== 'vents').map((l: any) => (l.code === 'nails' ? { ...l, qty: 3 } : l))
    lines.push({ description: 'Pipe boots', qty: 4, unit: 'each' })
    const made = await call('mgr', 'POST', `/api/material-list/jobs/${ids.job}/order`, { supplier: 'ABC Supply', lines, squares: 30, wastePercent: 10 })
    expect(made.status).toBe(201)
    expect(made.body).toMatchObject({ jobId: ids.job, supplier: 'ABC Supply', orderStatus: 'not_ordered', deliveryAddress: '12 Gable Ln, Akron, OH, 44301' })
    expect(made.body.notes).toContain('30 squares with 10% waste')
    const stored = (await t.db.select().from(t.schema.material).where(eq(t.schema.material.id, made.body.id)))[0]
    const items = stored.lineItems as any[]
    expect(items.find((l) => l.code === 'shingles')).toMatchObject({ qty: 99, unit: 'bundle' })
    expect(items.find((l) => l.code === 'nails').qty).toBe(3)
    expect(items.find((l) => l.description === 'Pipe boots').qty).toBe(4)
    expect(items.some((l) => l.code === 'vents')).toBe(false)
    const onJob = await call('mgr', 'GET', `/api/materials?jobId=${ids.job}`)
    expect(onJob.body.data.map((o: any) => o.id)).toContain(made.body.id)
  })

  test('an empty list, a zero quantity or no supplier is refused', async () => {
    const url = `/api/material-list/jobs/${ids.job}/order`
    expect((await call('mgr', 'POST', url, { supplier: 'ABC Supply', lines: [] })).status).toBe(400)
    expect((await call('mgr', 'POST', url, { supplier: 'ABC Supply', lines: [{ description: 'Shingles', qty: 0 }] })).status).toBe(400)
    expect((await call('mgr', 'POST', url, { supplier: '', lines: [{ description: 'Shingles', qty: 5 }] })).status).toBe(400)
  })
})

describe('who may, and what is not there', () => {
  test('a seat without inventory:create cannot order; one that cannot see the job cannot read its list', async () => {
    const order = { supplier: 'ABC Supply', lines: [{ description: 'Shingles', qty: 5, unit: 'bundle' }] }
    expect((await call('view', 'POST', `/api/material-list/jobs/${ids.job}/order`, order)).status).toBe(403)
    expect((await call('rep', 'POST', `/api/material-list/jobs/${ids.job}/order`, order)).status).toBe(403)
    // The Field seat is on no crew and is not the rep: the job is not one of its own.
    expect((await call('rep', 'GET', `/api/material-list/jobs/${ids.job}`)).status).toBe(404)
    // …and another company's job is nobody's here.
    expect((await call('owner', 'GET', `/api/material-list/jobs/${otherJobId}`)).status).toBe(404)
    expect((await call('owner', 'POST', `/api/material-list/jobs/${otherJobId}/order`, order)).status).toBe(404)
    expect((await t.db.select().from(t.schema.material)).filter((m: any) => m.jobId === otherJobId)).toEqual([])
  })

  test('the calculator is not ready: the feature is hidden, and with it off the door is not there', async () => {
    const def = getFeaturesForTemplate('crm-roof').find((f: any) => f.id === 'roof_material_list') as any
    expect(def?.hidden).toBe(true)
    await t.db.update(t.schema.company).set({ enabledFeatures: ['jobs', 'contacts', 'materials'] } as any).where(eq(t.schema.company.id, companyId))
    t.services.features.forgetFeatures()
    expect((await call('owner', 'GET', `/api/material-list/jobs/${ids.job}`)).status).toBeGreaterThanOrEqual(400)
    await t.db.update(t.schema.company).set({ enabledFeatures: ['jobs', 'contacts', 'roof_material_list'] } as any).where(eq(t.schema.company.id, companyId))
    t.services.features.forgetFeatures()
    // Materials off: there is nowhere for the order to live.
    const r = await call('owner', 'POST', `/api/material-list/jobs/${ids.job}/order`, { supplier: 'ABC', lines: [{ description: 'Shingles', qty: 5 }] })
    expect([r.status, r.body.code]).toEqual([403, 'feature_disabled'])
  })
})
