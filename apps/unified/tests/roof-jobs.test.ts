// Roofing's jobs on the CRM's job table (server/crm/roof/jobs.ts; docs/UNIFIED_ROOF_PLAN.md decision 2), through the
// real server as the roof vertical: numbering, the renames, the pipeline and its notes, close and reopen, a job's money
// by permission, photos by their bytes, "my jobs" and unassigning, and the lists' reply shape.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = ''
const tokens: Record<string, string> = {}
const ids: Record<string, string> = {}
const PASS = 'Seat-pass-1'

const login = async (email: string, password: string) =>
  (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken as string
const as = (who: string) => (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tokens[who]}` } })
const json = async (r: Response) => ({ status: r.status, body: await r.json() as any })

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000001e221bc330000000049454e44ae426082', 'hex')

beforeAll(async () => {
  t = await bootTenant({ vertical: 'roofing' })
  const seeded = await seedOwner(t)
  companyId = seeded.company.id
  ids.owner = seeded.owner.id
  tokens.owner = await login('owner@test.example', seeded.password)
  await t.db.update(t.schema.company).set({ enabledFeatures: ['jobs', 'contacts', 'photo_capture'] } as any).where(eq(t.schema.company.id, companyId))
  const hash = await Bun.password.hash(PASS, 'bcrypt')
  for (const [key, role] of [['rep', 'field'], ['other', 'field'], ['book', 'viewer']] as const) {
    const [u] = await t.db.insert(t.schema.user).values({ email: `${key}@test.example`, passwordHash: hash, firstName: key, lastName: 'Seat', role, companyId } as any).returning()
    ids[key] = u.id
    tokens[key] = await login(`${key}@test.example`, PASS)
  }
  const [home] = await t.db.insert(t.schema.contact).values({ companyId, name: 'Lee Marsh', mobile: '715-555-0101' } as any).returning()
  ids.home = home.id
  const [other] = await t.db.insert(t.schema.company).values({ name: 'Other Roofing', slug: 'other-roofing' }).returning()
  const [stranger] = await t.db.insert(t.schema.contact).values({ companyId: other.id, name: 'Sam Elsewhere' } as any).returning()
  ids.stranger = stranger.id
}, 120_000)

const newJob = (extra: Record<string, unknown> = {}) => ({
  contactId: ids.home, jobType: 'insurance', propertyAddress: '12 Pine St', city: 'Akron', state: 'OH', zip: '44301',
  rcv: 18000, acv: 14000, deductible: 1000, approvedScope: 'Full tear-off, 30 squares', estimatedRevenue: 17500, totalSquares: 30, ...extra,
})

describe('roofing jobs', () => {
  test('a job is numbered ROOF-0001, ROOF-0002…; its address is its title; another company\'s contact is refused', async () => {
    const a = await json(await as('owner')('/api/jobs', { method: 'POST', json: newJob() }))
    const b = await json(await as('owner')('/api/jobs', { method: 'POST', json: newJob({ propertyAddress: '14 Pine St' }) }))
    expect([a.status, b.status]).toEqual([201, 201])
    expect(a.body).toMatchObject({ number: 'ROOF-0001', title: '12 Pine St', address: '12 Pine St', status: 'lead', priority: 'medium', estimatedValue: '17500.00', rcv: '18000.00', contact: { id: ids.home, name: 'Lee Marsh' } })
    expect(b.body.number).toBe('ROOF-0002')
    ids.job = a.body.id
    ids.job2 = b.body.id
    expect((await as('owner')('/api/jobs', { method: 'POST', json: newJob({ contactId: ids.stranger }) })).status).toBe(404)
    // A field seat holds no jobs:create (the shared matrix).
    expect((await as('rep')('/api/jobs', { method: 'POST', json: newJob() })).status).toBe(403)
  })

  test('numbers go only forwards: past ROOF-9999 is ROOF-10000, not a repeat (the template sorted the text)', async () => {
    await t.db.update(t.schema.job).set({ number: 'ROOF-9999' } as any).where(eq(t.schema.job.id, ids.job2))
    const r = await json(await as('owner')('/api/jobs', { method: 'POST', json: newJob({ propertyAddress: '16 Pine St' }) }))
    expect(r.body.number).toBe('ROOF-10000')
  })

  test('a job\'s money by permission: a crew seat sees none of it, the books seat the revenue and not the cost', async () => {
    await t.db.update(t.schema.job).set({ materialCost: '6000', laborCost: '4000', finalRevenue: '18000' } as any).where(eq(t.schema.job.id, ids.job))
    const money = ['estimatedValue', 'finalRevenue', 'deductible', 'rcv', 'acv', 'approvedScope', 'materialCost', 'laborCost']
    const shown = (row: any) => money.filter((f) => f in row)
    const owner = await json(await as('owner')(`/api/jobs/${ids.job}`))
    expect(shown(owner.body)).toEqual(money)
    const crew = await json(await as('rep')(`/api/jobs/${ids.job}`))
    expect(crew.status).toBe(200)
    expect(shown(crew.body)).toEqual([])
    expect(crew.body.totalSquares).toBe('30.00') // a roof's size is what the crew installs, not money
    const books = await json(await as('book')(`/api/jobs/${ids.job}`))
    expect(shown(books.body)).toEqual(['estimatedValue', 'finalRevenue', 'deductible', 'rcv', 'acv', 'approvedScope'])
    // The list the same — Reports built revenue by rep from it in the browser (T41).
    const list = await json(await as('rep')('/api/jobs'))
    expect(list.body.pagination).toMatchObject({ page: 1, total: 3 })
    expect(list.body.data.flatMap(shown)).toEqual([])
  })

  test('advance walks the pipeline and notes it; close needs a reason; a closed job reopens at a stage', async () => {
    const adv = await json(await as('rep')(`/api/jobs/${ids.job}/advance`, { method: 'POST' }))
    expect(adv).toMatchObject({ status: 200, body: { status: 'inspection_scheduled' } })
    expect((await as('rep')(`/api/jobs/${ids.job}/close`, { method: 'POST', json: { status: 'lost', lostReason: ' ' } })).status).toBe(400)
    const closed = await json(await as('rep')(`/api/jobs/${ids.job}/close`, { method: 'POST', json: { status: 'lost', lostReason: 'went with a competitor' } }))
    expect(closed.body).toMatchObject({ status: 'lost', lostReason: 'went with a competitor' })
    expect((await as('rep')(`/api/jobs/${ids.job}/close`, { method: 'POST', json: { status: 'cancelled', lostReason: 'x' } })).status).toBe(409)
    expect((await as('rep')(`/api/jobs/${ids.job}/reopen`, { method: 'POST', json: { status: 'lost' } })).status).toBe(400)
    const back = await json(await as('rep')(`/api/jobs/${ids.job}/reopen`, { method: 'POST', json: { status: 'inspected' } }))
    expect(back.body).toMatchObject({ status: 'inspected', lostReason: null, closedAt: null })
    const tl = await json(await as('owner')(`/api/jobs/${ids.job}/timeline`))
    expect(tl.body.pagination.total).toBe(3)
    // What happened, in stage names: the move, the close and the reopen (server/crm/roof/jobRecord.ts).
    expect(tl.body.data.map((e: any) => e.type).sort()).toEqual(['closed', 'reopened', 'status_change'])
  })

  test('a photo is an image by its bytes, with a type from the list; HTML sent as image/png is refused', async () => {
    const upload = (bytes: Buffer, type: string, photoType?: string) => {
      const form = new FormData()
      form.append('photo', new File([new Uint8Array(bytes)], 'p.png', { type }))
      if (photoType) form.append('photoType', photoType)
      return as('rep')(`/api/jobs/${ids.job}/photos`, { method: 'POST', body: form })
    }
    expect((await upload(Buffer.from('<html><script>alert(1)</script></html>'), 'image/png')).status).toBe(400)
    expect((await upload(PNG, 'image/png', 'banana')).status).toBe(400)
    const ok = await upload(PNG, 'image/png', 'damage')
    // A real image of an allowed type reaches the store — which a test has none of: refused in words, never sent out.
    expect(await json(ok)).toMatchObject({ status: 503, body: { code: 'storage_not_configured' } })
    const photos = await json(await as('rep')(`/api/jobs/${ids.job}/photos`))
    expect(photos.status).toBe(200)
    expect(photos.body).toHaveProperty('pagination')
  })

  test('"my jobs" are the ones I am the rep on; "Unassigned" takes the rep off', async () => {
    expect((await as('owner')(`/api/jobs/${ids.job}`, { method: 'PUT', json: { assignedSalesRepId: ids.rep } })).status).toBe(200)
    const mine = await json(await as('rep')('/api/jobs?mine=1'))
    expect(mine.body.data.map((j: any) => j.id)).toEqual([ids.job])
    expect((await json(await as('other')('/api/jobs?mine=1'))).body.data).toEqual([])
    expect((await as('owner')(`/api/jobs/${ids.job}`, { method: 'PUT', json: { assignedSalesRepId: '' } })).status).toBe(200)
    const [row] = await t.db.select().from(t.schema.job).where(eq(t.schema.job.id, ids.job))
    expect(row.assignedSalesRepId).toBeNull()
  })

  test('search finds a job by the homeowner\'s name; /types is the company\'s own, as a list', async () => {
    const found = await json(await as('owner')('/api/jobs?search=marsh'))
    expect(found.body.pagination.total).toBe(3)
    expect((await json(await as('owner')('/api/jobs?search=nobody'))).body.data).toEqual([])
    const types = await json(await as('owner')('/api/jobs/types'))
    expect(types.body).toEqual({ data: ['insurance'], pagination: { page: 1, limit: 1, total: 1, pages: 1 } })
  })

  test("an appointment from a form is that time on the company's clock; the date of loss is a calendar day", async () => {
    await t.db.update(t.schema.company).set({ timezone: 'America/Chicago' } as any).where(eq(t.schema.company.id, companyId))
    // A datetime-local box sends no zone: 10:00 in Chicago (CDT, UTC-5) is 15:00 UTC — it was stored as 10:00 UTC.
    const r = await json(await as('owner')(`/api/jobs/${ids.job}`, { method: 'PUT', json: { inspectionDate: '2026-10-21T10:00', installDate: '2026-11-03', dateOfLoss: '2026-10-10' } }))
    expect(r.status).toBe(200)
    expect(new Date(r.body.inspectionDate).toISOString()).toBe('2026-10-21T15:00:00.000Z')
    expect(new Date(r.body.installDate).toISOString()).toBe('2026-11-03T06:00:00.000Z') // the start of that day in Chicago (CST)
    expect(new Date(r.body.dateOfLoss).toISOString()).toBe('2026-10-10T00:00:00.000Z')
    // A value with its own zone is that instant; a day that isn't one is refused.
    const { onCompanyClock } = await import('../server/crm/roof/validation.ts')
    expect(onCompanyClock('2026-10-21T15:00:00Z', 'America/Chicago').value?.toISOString()).toBe('2026-10-21T15:00:00.000Z')
    expect(onCompanyClock('2026-02-30T10:00', 'America/Chicago').error).toMatch(/not a real calendar date/)
    expect(onCompanyClock('', 'America/Chicago')).toEqual({ value: null })
  })
})
