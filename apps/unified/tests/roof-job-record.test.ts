// A roofing job's page (live test 2026-10-22, roofing P4.3 and P3.2): the Insurance card read the job row's own copies
// of the claim's facts, which nothing but the claim number was ever copied into — so a filed claim showed "—" for the
// carrier, the adjuster, the date of loss and the money. And the Notes card listed stage moves as raw codes
// ("Status changed: invoiced → collected"), each one again on the Timeline. The claim is now the one source of its facts
// on every job reply, and notes and the timeline are separate lists, the timeline in stage names.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = ''
const tokens: Record<string, string> = {}
const ids: Record<string, string> = {}

const login = async (email: string, password: string) =>
  (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken as string
const as = (who: string) => (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tokens[who]}` } })
const json = async (r: Response) => ({ status: r.status, body: await r.json() as any })

beforeAll(async () => {
  t = await bootTenant({ vertical: 'roofing' })
  const seeded = await seedOwner(t)
  companyId = seeded.company.id
  tokens.owner = await login('owner@test.example', seeded.password)
  await t.db.update(t.schema.company).set({ enabledFeatures: ['jobs', 'contacts', 'insurance_workflow'] } as any).where(eq(t.schema.company.id, companyId))
  const hash = await Bun.password.hash('Seat-pass-1', 'bcrypt')
  await t.db.insert(t.schema.user).values({ email: 'crew@test.example', passwordHash: hash, firstName: 'Cy', lastName: 'Crew', role: 'field', companyId } as any)
  tokens.crew = await login('crew@test.example', 'Seat-pass-1')
  const [casey] = await t.db.insert(t.schema.contact).values({ companyId, name: 'Casey Customer' } as any).returning()
  const job = await json(await as('owner')('/api/jobs', { method: 'POST', json: { contactId: casey.id, jobType: 'insurance', propertyAddress: '12 Pine St', city: 'Eau Claire', state: 'WI', zip: '54701' } }))
  ids.job = job.body.id
  const claim = await json(await as('owner')('/api/insurance/claims', { method: 'POST', json: {
    jobId: ids.job, claimNumber: 'CLM-TEST-0001', insuranceCompany: 'Test Mutual Insurance', adjusterName: 'Adam Adjuster',
    adjusterPhone: '715-555-0199', dateOfLoss: '2026-10-01', deductible: '1000',
  } }))
  expect(claim.status).toBe(201)
  ids.claim = claim.body.id
  // RCV and ACV are written on the claim page later, as the tester did.
  expect((await as('owner')(`/api/insurance/claims/${ids.claim}`, { method: 'PUT', json: { rcv: '18000', acv: '14000' } })).status).toBe(200)
}, 120_000)

describe('the claim\'s facts on its job', () => {
  test('the job page\'s job carries the claim\'s carrier, adjuster, date of loss and money', async () => {
    const r = await json(await as('owner')(`/api/jobs/${ids.job}`))
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({
      claimNumber: 'CLM-TEST-0001', insuranceCompany: 'Test Mutual Insurance', adjusterName: 'Adam Adjuster',
      adjusterPhone: '715-555-0199', deductible: '1000.00', rcv: '18000.00', acv: '14000.00',
    })
    expect(new Date(r.body.dateOfLoss).toISOString().slice(0, 10)).toBe('2026-10-01')
    // The job row itself still holds only the number: the reply reads the claim, nothing was copied.
    const [row] = await t.db.select().from(t.schema.job).where(eq(t.schema.job.id, ids.job))
    expect(row.insuranceCompany).toBeNull()
  })

  test('the jobs list and every write\'s reply carry them too, so a save on the page never blanks the card', async () => {
    const list = await json(await as('owner')('/api/jobs'))
    expect(list.body.data.find((j: any) => j.id === ids.job)).toMatchObject({ insuranceCompany: 'Test Mutual Insurance', adjusterName: 'Adam Adjuster' })
    const put = await json(await as('owner')(`/api/jobs/${ids.job}`, { method: 'PUT', json: { roofType: 'Asphalt' } }))
    expect(put.body).toMatchObject({ roofType: 'Asphalt', insuranceCompany: 'Test Mutual Insurance', rcv: '18000.00' })
  })

  test('an edit on the claim page shows on the job at once', async () => {
    expect((await as('owner')(`/api/insurance/claims/${ids.claim}`, { method: 'PUT', json: { adjusterName: 'Ada Adjuster' } })).status).toBe(200)
    expect((await json(await as('owner')(`/api/jobs/${ids.job}`))).body.adjusterName).toBe('Ada Adjuster')
  })

  test('a seat that may not see money still does not — the claim\'s figures are withheld like the job\'s', async () => {
    const r = await json(await as('crew')(`/api/jobs/${ids.job}`))
    expect(r.status).toBe(200)
    expect(r.body.insuranceCompany).toBe('Test Mutual Insurance')
    for (const k of ['deductible', 'rcv', 'acv']) expect(k in r.body).toBe(false)
  })
})

describe('notes and the timeline', () => {
  test('a stage move, a close and a reopen are on the timeline in stage names, and never in Notes', async () => {
    expect((await as('owner')(`/api/jobs/${ids.job}/notes`, { method: 'POST', json: { body: 'Gate code 4411' } })).status).toBe(201)
    await t.db.update(t.schema.job).set({ status: 'in_production' } as any).where(eq(t.schema.job.id, ids.job))
    expect((await json(await as('owner')(`/api/jobs/${ids.job}/advance`, { method: 'POST' }))).body.status).toBe('final_inspection')
    expect((await as('owner')(`/api/jobs/${ids.job}/close`, { method: 'POST', json: { status: 'cancelled', lostReason: 'carrier denied' } })).status).toBe(200)
    expect((await as('owner')(`/api/jobs/${ids.job}/reopen`, { method: 'POST', json: { status: 'signed' } })).status).toBe(200)

    const job = await json(await as('owner')(`/api/jobs/${ids.job}`))
    expect(job.body.notes.map((n: any) => n.body)).toEqual(['Gate code 4411'])

    const tl = await json(await as('owner')(`/api/jobs/${ids.job}/timeline`))
    const bodies = tl.body.data.map((e: any) => e.body)
    expect(bodies).toContain('Stage moved from In Production to Final Inspection')
    expect(bodies).toContain('Closed as Cancelled (was Final Inspection): carrier denied')
    expect(bodies).toContain('Reopened at Signed (was Cancelled: carrier denied)')
    expect(tl.body.data.map((e: any) => e.type).sort()).toEqual(['closed', 'reopened', 'status_change'])
    // No code anywhere a person reads, and the note people wrote is not repeated here.
    expect(bodies.join(' ')).not.toMatch(/[a-z]+_[a-z_]+|Status changed|Gate code/)
  })

  test('rows written before this change read the same way (the stored form did not change)', async () => {
    const [owner] = await t.db.select().from(t.schema.user).where(eq(t.schema.user.email, 'owner@test.example'))
    await t.db.insert(t.schema.jobNote).values({ companyId, jobId: ids.job, userId: owner.id, isInternal: true, body: 'Status changed: invoiced → collected' } as any)
    const tl = await json(await as('owner')(`/api/jobs/${ids.job}/timeline`))
    expect(tl.body.data.map((e: any) => e.body)).toContain('Stage moved from Invoiced to Collected')
    expect((await json(await as('owner')(`/api/jobs/${ids.job}`))).body.notes.map((n: any) => n.body)).toEqual(['Gate code 4411'])
  })

  test('a note someone types that looks like a stage move is still their note', async () => {
    expect((await as('owner')(`/api/jobs/${ids.job}/notes`, { method: 'POST', json: { body: 'Status changed: gutters → fascia' } })).status).toBe(201)
    const notes = (await json(await as('owner')(`/api/jobs/${ids.job}`))).body.notes.map((n: any) => n.body)
    expect(notes).toContain('Status changed: gutters → fascia')
  })
})
