// Where a material list can start (docs/parity/roof-material-list.md #12), through the real server as the roofing vertical:
//   · from the job's signed quote: its material lines (and only the ones the customer is paying for), no prices, other jobs'
//     and other companies' quotes never; the order made from them says so.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'

type T = Awaited<ReturnType<typeof bootTenant>>
let t: T
let companyId = ''
let otherCompanyId = ''
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

beforeAll(async () => {
  t = await bootTenant({ vertical: 'roofing' })
  const seeded = await seedOwner(t)
  companyId = seeded.company.id
  await t.db.update(t.schema.company).set({ enabledFeatures: FEATURES } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
  tokens.owner = await login('owner@test.example', seeded.password)
  const hash = await Bun.password.hash(PASS, 'bcrypt')
  for (const [key, role] of [['mgr', 'manager'], ['rep', 'field'], ['view', 'viewer']] as const) {
    ids[key] = (await ins(t.schema.user, { email: `${key}@test.example`, passwordHash: hash, firstName: key, lastName: 'Seat', role, companyId })).id
    tokens[key] = await login(`${key}@test.example`, PASS)
  }
  ids.home = (await ins(t.schema.contact, { companyId, name: 'Lee Marsh', mobile: '715-555-0101', type: 'client' })).id
  const [other] = await t.db.insert(t.schema.company).values({ name: 'Other Roofing', slug: 'other-roofing' } as any).returning()
  otherCompanyId = other.id
  otherJobId = (await ins(t.schema.job, { companyId: other.id, title: '9 Elm', number: 'ROOF-0001', status: 'lead' })).id
}, 120_000)

async function makeJob(extra: Record<string, unknown> = {}) {
  const made = await call('owner', 'POST', '/api/jobs', { contactId: ids.home, jobType: 'retail', propertyAddress: '12 Gable Ln', city: 'Akron', state: 'OH', zip: '44301', ...extra })
  expect(made.status).toBe(201)
  return made.body.id as string
}
const makeQuote = (jobId: string, number: string, over: Record<string, unknown> = {}, co = companyId) =>
  ins(t.schema.quote, { companyId: co, jobId, number, name: `Roof ${number}`, status: 'approved', approvedAt: new Date('2026-10-20T15:00:00Z'), ...over })
const addLine = (quoteId: string, description: string, type: string | null, quantity: string, over: Record<string, unknown> = {}) =>
  ins(t.schema.quoteLineItem, { quoteId, description, type, quantity, unitPrice: '50', total: '500', unitCost: '30', sortOrder: 0, ...over })

describe('a list from the signed quote', () => {
  test('its material lines come across — no prices, no labour, no line the customer is not paying for', async () => {
    const jobId = await makeJob()
    const q = await makeQuote(jobId, 'Q-0012', { signedAt: new Date('2026-10-20T15:00:00Z'), signedBy: 'Lee Marsh' })
    await addLine(q.id, 'GAF Timberline HDZ shingles', 'material', '99', { sortOrder: 1, section: 'Roofing' })
    await addLine(q.id, 'Pipe boots', 'part', '4', { sortOrder: 2 })
    await addLine(q.id, 'Tear-off and install labour', 'labor', '30', { sortOrder: 3 })
    await addLine(q.id, 'Skylight flashing kit (upgrade not taken)', 'material', '1', { sortOrder: 4, optional: true, selected: false })
    await addLine(q.id, 'Ridge vent (upgrade taken)', 'material', '2.5', { sortOrder: 5, optional: true, selected: true })
    await addLine(q.id, 'Delivery', null, '1', { sortOrder: 6 })
    const r = await call('mgr', 'GET', `/api/material-list/jobs/${jobId}/quote-lines`)
    expect(r.status).toBe(200)
    expect(r.body.quotes).toHaveLength(1)
    const got = r.body.quotes[0]
    expect(got).toMatchObject({ id: q.id, number: 'Q-0012', signed: true, signedBy: 'Lee Marsh' })
    expect(got.lines.map((l: any) => [l.description, l.qty, l.unit])).toEqual([
      ['GAF Timberline HDZ shingles', 99, 'ea'], ['Pipe boots', 4, 'ea'], ['Ridge vent (upgrade taken)', 2.5, 'ea'],
    ])
    expect(got.lines[0].basis).toBe('Quote Q-0012, material line 1 (Roofing)')
    expect(JSON.stringify(r.body)).not.toMatch(/unitPrice|unitCost|"total"|"50"|"30"/)
    ids.quoteJob = jobId
  })

  test('only approved quotes of THIS job count — a draft, another job\'s and another company\'s do not; an unsigned approval says so', async () => {
    const jobId = await makeJob({ propertyAddress: '14 Gable Ln' })
    const draft = await makeQuote(jobId, 'Q-0020', { status: 'draft', approvedAt: null })
    await addLine(draft.id, 'Draft shingles', 'material', '10')
    const elsewhere = await makeQuote(await makeJob({ propertyAddress: '16 Gable Ln' }), 'Q-0021')
    await addLine(elsewhere.id, 'Other job shingles', 'material', '10')
    const foreign = await makeQuote(otherJobId, 'Q-0022', {}, otherCompanyId)
    await addLine(foreign.id, 'Foreign shingles', 'material', '10')
    expect((await call('mgr', 'GET', `/api/material-list/jobs/${jobId}/quote-lines`)).body.quotes).toEqual([])
    const approved = await makeQuote(jobId, 'Q-0023') // approved by the office, not signed by the customer
    await addLine(approved.id, 'Shingles', 'material', '12')
    const r = await call('mgr', 'GET', `/api/material-list/jobs/${jobId}/quote-lines`)
    expect(r.body.quotes.map((x: any) => [x.number, x.signed])).toEqual([['Q-0023', false]])
    expect((await call('owner', 'GET', `/api/material-list/jobs/${otherJobId}/quote-lines`)).status).toBe(404)
  })

  test('a Field seat reaches it only for its own jobs; the order made from it keeps the quote\'s lines and says where they came from', async () => {
    expect((await call('rep', 'GET', `/api/material-list/jobs/${ids.quoteJob}/quote-lines`)).status).toBe(404)
    const lines = (await call('mgr', 'GET', `/api/material-list/jobs/${ids.quoteJob}/quote-lines`)).body.quotes[0].lines
    const made = await call('mgr', 'POST', `/api/material-list/jobs/${ids.quoteJob}/order`, { supplier: 'ABC Supply', lines, sourceNote: 'Material list from signed quote Q-0012.' })
    expect(made.status).toBe(201)
    expect(made.body.notes).toBe('Material list from signed quote Q-0012.')
    expect((made.body.lineItems as any[]).map((l) => l.description)).toContain('Pipe boots')
  })
})
