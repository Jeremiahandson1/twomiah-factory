// The material list from REAL edge lengths (docs/parity/roof-material-list.md #6), through the real server as the roofing
// vertical:
//   · a job's homeowner has a roof report at the job's address: the list reads its eave / rake / ridge / hip / valley feet
//     (the map editor's totals, or the drawn edges when the totals are missing, or the roofer's hand corrections)
//     instead of estimating them from the squares, and says where each length came from;
//   · another property's report, and a report that measured nothing, are never used;
//   · a length the roofer types beats the report's; with no squares on the job the report's squares are used;
//   · an EagleView / HOVER / GAF report keyed in from its PDF becomes the job's measurement and the list is worked from it.
// Nothing here reaches a provider, a supplier or a real tenant.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { lengthsFromRoofReport, listLengths, sameAddress } from '../server/crm/roof/reportLengths.ts'

type T = Awaited<ReturnType<typeof bootTenant>>
let t: T
let companyId = ''
let otherJobId = ''
const tokens: Record<string, string> = {}
const ids: Record<string, string> = {}
const PASS = 'Seat-pass-1'
const FEATURES = ['jobs', 'contacts', 'materials', 'roof_material_list', 'measurement_reports']

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
  ids.home = (await ins(t.schema.contact, { companyId, name: 'Lee Marsh', mobile: '715-555-0101', type: 'client' })).id
  ids.other = (await ins(t.schema.contact, { companyId, name: 'Pat Neighbour', mobile: '715-555-0102', type: 'client' })).id
  const [other] = await t.db.insert(t.schema.company).values({ name: 'Other Roofing', slug: 'other-roofing' } as any).returning()
  otherJobId = (await ins(t.schema.job, { companyId: other.id, title: '9 Elm', number: 'ROOF-0001', status: 'lead', totalSquares: '20' })).id
}, 120_000)

async function makeJob(extra: Record<string, unknown> = {}, contactId = ids.home) {
  const made = await call('owner', 'POST', '/api/jobs', { contactId, jobType: 'retail', propertyAddress: '12 Gable Ln', city: 'Akron', state: 'OH', zip: '44301', ...extra })
  expect(made.status).toBe(201)
  return made.body.id as string
}

/** A roof report as the editor leaves it: totals in `measurements`, the drawn lines in `edges`. */
const MEASURED = { totalAreaSqft: 3000, totalSquares: 30, ridgeLF: 50, valleyLF: 20, hipLF: 10, rakeLF: 100, eaveLF: 150 }
async function addReport(over: Record<string, unknown> = {}) {
  return ins(t.schema.roofReport, {
    companyId, contactId: ids.home, address: '12 Gable Ln', city: 'Akron', state: 'OH', zip: '44301', lat: 41.08, lng: -81.51,
    totalAreaSqft: 3000, totalSquares: 30, segmentCount: 4, imageryQuality: 'HIGH', segments: [], edges: [], measurements: MEASURED, ...over,
  })
}

describe('reading the lengths out of a report', () => {
  test('the editor\'s totals, or the drawn edges when the totals are not there; ridge and hip run together on the list', () => {
    expect(lengthsFromRoofReport(MEASURED)).toEqual({ eaveFt: 150, rakeFt: 100, ridgeFt: 50, hipFt: 10, valleyFt: 20 })
    expect(listLengths(lengthsFromRoofReport(MEASURED)!)).toEqual({ eaveFt: 150, rakeFt: 100, ridgeFt: 60, valleyFt: 20 })
    const edges = [{ type: 'eave', lengthFt: 40.2 }, { type: 'eave', lengthFt: 30 }, { type: 'rake', lengthFt: 25 }, { type: 'ridge', lengthFt: 18 }, { type: 'valley', lengthFt: 'x' }]
    expect(lengthsFromRoofReport({}, edges)).toEqual({ eaveFt: 70.2, rakeFt: 25, ridgeFt: 18, hipFt: 0, valleyFt: 0 })
  })
  test('a report that measured nothing gives no lengths; addresses compare the way a person would', () => {
    expect(lengthsFromRoofReport({ ridgeLF: 0, valleyLF: 0, hipLF: 0, rakeLF: 0, eaveLF: 0 }, [])).toBeNull()
    expect(lengthsFromRoofReport(null, null)).toBeNull()
    expect(sameAddress('12 Gable Ln.', '12  gable ln')).toBe(true)
    expect(sameAddress('12 Gable Ln', '14 Gable Ln')).toBe(false)
    expect(sameAddress('', '')).toBe(false)
  })
})

describe('the list for a job reads its roof report', () => {
  test('the report\'s feet size the list; nothing is estimated, and the list says where each length came from', async () => {
    const jobId = await makeJob({ totalSquares: 30 })
    const report = await addReport()
    const r = await call('mgr', 'GET', `/api/material-list/jobs/${jobId}`)
    expect(r.status).toBe(200)
    expect(r.body.lengths).toEqual({ eaveFt: 150, rakeFt: 100, ridgeFt: 60, valleyFt: 20 })
    expect(r.body.estimated).toEqual([])
    expect(r.body.warnings.join(' ')).not.toContain('Estimated')
    expect(r.body.lengthSources).toEqual({ eaveFt: 'roof_report', rakeFt: 'roof_report', ridgeFt: 'roof_report', valleyFt: 'roof_report' })
    expect(r.body.lengthsReport).toMatchObject({ id: report.id, kind: 'roof_report' })
    // The same figures as typing 150 / 100 / 60 / 20 by hand (roof-material-list.test.ts).
    expect(Object.fromEntries(r.body.lines.map((x: any) => [x.code, x.qty]))).toEqual({
      shingles: 99, starter: 3, 'ridge-cap': 3, underlayment: 4, 'ice-water': 3, 'drip-edge': 28, nails: 2, vents: 26,
    })
    ids.jobWithReport = jobId; ids.report = report.id
  })

  test('the roofer\'s hand corrections in the map editor are what the list reads', async () => {
    const edited = { ...MEASURED, eaveLF: 200, ridgeLF: 80 }
    const patched = await call('mgr', 'PATCH', `/api/roof-reports/${ids.report}/edges`, { edges: [{ type: 'eave', lengthFt: 200 }], measurements: edited })
    expect(patched.status).toBe(200)
    const r = await call('mgr', 'GET', `/api/material-list/jobs/${ids.jobWithReport}`)
    expect(r.body.lengths).toEqual({ eaveFt: 200, rakeFt: 100, ridgeFt: 90, valleyFt: 20 })
    expect(r.body.lengthsReport.label).toContain('corrected by hand')
  })

  test('a length typed on the roof beats the report\'s; the rest still come from the report', async () => {
    const r = await call('mgr', 'GET', `/api/material-list/jobs/${ids.jobWithReport}?eaveFt=120`)
    expect(r.body.lengths.eaveFt).toBe(120)
    expect(r.body.lengthSources).toMatchObject({ eaveFt: 'typed', rakeFt: 'roof_report', ridgeFt: 'roof_report' })
    const none = await call('mgr', 'GET', `/api/material-list/jobs/${ids.jobWithReport}?lengthsFrom=none`)
    expect(none.body.estimated).toEqual(['eaveFt', 'rakeFt', 'ridgeFt'])
    expect(none.body.lengthsReport).toBeNull()
  })

  test('another property\'s report, another homeowner\'s, and a report that measured nothing are never used', async () => {
    const jobId = await makeJob({ totalSquares: 25, propertyAddress: '77 Maple Ct' })
    await addReport({ address: '12 Gable Ln' }) // the same homeowner, a different house
    await addReport({ contactId: ids.other, address: '77 Maple Ct' }) // the same house, a different homeowner's report
    await addReport({ address: '77 Maple Ct', measurements: { eaveLF: 0, rakeLF: 0, ridgeLF: 0, hipLF: 0, valleyLF: 0 }, edges: [] })
    const r = await call('mgr', 'GET', `/api/material-list/jobs/${jobId}`)
    expect(r.body.reportChoices).toEqual([])
    expect(r.body.estimated).toEqual(['eaveFt', 'rakeFt', 'ridgeFt'])
    expect(r.body.lengthSources.eaveFt).toBe('estimated')
  })

  test('with no squares on the job the report\'s squares are used; a report that is not the job\'s cannot be asked for', async () => {
    const jobId = await makeJob({ propertyAddress: '5 Birch Rd' })
    const rep = await addReport({ address: '5 Birch Rd', totalSquares: 28 })
    const r = await call('mgr', 'GET', `/api/material-list/jobs/${jobId}`)
    expect([r.body.squares, r.body.squaresSource]).toEqual([28, 'roof_report'])
    expect(r.body.lengthsReport.id).toBe(rep.id)
    expect((await call('mgr', 'GET', `/api/material-list/jobs/${jobId}?reportId=${ids.report}`)).status).toBe(404)
  })
})

describe('an EagleView, HOVER or GAF report keyed in', () => {
  const report = { provider: 'eagleview', reportNumber: '4471', squares: 31.5, eaveFt: 160, rakeFt: 90, ridgeFt: 40, hipFt: 30, valleyFt: 25 }
  test('it becomes the job\'s measurement, fills the squares the job lacks, and the list is worked from it', async () => {
    const jobId = await makeJob({ propertyAddress: '8 Cedar St' })
    const made = await call('mgr', 'POST', `/api/material-list/jobs/${jobId}/provider-report`, report)
    expect(made.status).toBe(201)
    expect(made.body.label).toBe('EagleView report 4471')
    const stored = (await t.db.select().from(t.schema.measurementReport).where(eq(t.schema.measurementReport.id, made.body.id)))[0] as any
    expect(stored).toMatchObject({ jobId, provider: 'eagleview', externalProvider: 'eagleview', externalOrderId: '4471', status: 'complete', totalSquares: '31.50' })
    const jobRow = (await t.db.select().from(t.schema.job).where(eq(t.schema.job.id, jobId)))[0] as any
    expect([jobRow.measurementReportId, jobRow.totalSquares]).toEqual([made.body.id, '31.50'])
    const list = await call('mgr', 'GET', `/api/material-list/jobs/${jobId}`)
    expect(list.body.lengths).toEqual({ eaveFt: 160, rakeFt: 90, ridgeFt: 70, valleyFt: 25 })
    expect(list.body.lengthSources.eaveFt).toBe('provider_report')
    expect(list.body.lengthsReport).toMatchObject({ kind: 'provider_report', provider: 'eagleview', label: 'EagleView report 4471' })
    expect(list.body.estimated).toEqual([])
    ids.keyedJob = jobId
  })

  test('squares the roofer entered on the job are kept; the newest report is the one the job points at', async () => {
    const jobId = await makeJob({ propertyAddress: '9 Cedar St', totalSquares: 40 })
    await call('mgr', 'POST', `/api/material-list/jobs/${jobId}/provider-report`, report)
    const hover = await call('mgr', 'POST', `/api/material-list/jobs/${jobId}/provider-report`, { ...report, provider: 'hover', reportNumber: undefined, eaveFt: 99 })
    expect(hover.body.label).toBe('HOVER report')
    const jobRow = (await t.db.select().from(t.schema.job).where(eq(t.schema.job.id, jobId)))[0] as any
    expect(jobRow.totalSquares).toBe('40.00')
    const list = await call('mgr', 'GET', `/api/material-list/jobs/${jobId}`)
    expect(list.body.reportChoices.map((c: any) => c.provider)).toEqual(['hover', 'eagleview'])
    expect(list.body.lengths.eaveFt).toBe(99)
    // Asking for the older one by id.
    const older = list.body.reportChoices[1].id
    expect((await call('mgr', 'GET', `/api/material-list/jobs/${jobId}?reportId=${older}`)).body.lengths.eaveFt).toBe(160)
  })

  test('squares and at least one length are required; a seat that may not measure, or cannot see the job, cannot key one in', async () => {
    const url = `/api/material-list/jobs/${ids.keyedJob}/provider-report`
    expect((await call('mgr', 'POST', url, { ...report, squares: 0 })).status).toBe(400)
    const empty = await call('mgr', 'POST', url, { provider: 'gaf', squares: 20 })
    expect([empty.status, Object.keys(empty.body.fields || {})]).toEqual([400, ['eaveFt']])
    expect((await call('mgr', 'POST', url, { ...report, provider: 'roofsnap' })).status).toBe(400)
    expect((await call('view', 'POST', url, report)).status).toBe(403)
    expect((await call('rep', 'POST', url, report)).status).toBe(403)
    expect((await call('owner', 'POST', `/api/material-list/jobs/${otherJobId}/provider-report`, report)).status).toBe(404)
    expect((await t.db.select().from(t.schema.measurementReport)).filter((m: any) => m.jobId === otherJobId)).toEqual([])
  })
})
