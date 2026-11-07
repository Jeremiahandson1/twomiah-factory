// The new-job form (roofing live test 11/07): picking Hank left the address blank, and an insurance job's carrier, claim number and
// adjuster could only be typed on the claim page afterwards. The form now fills the homeowner's address (the contact list carries it)
// and, for an insurance job, sends the claim's facts with the job, which keeps them (crm/roof/jobs.ts jobSchema, jobRecord.ts).
import { test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let token = '', contactId = ''
const as = (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } })
const json = async (r: Response) => ({ status: r.status, body: await r.json() as any })

beforeAll(async () => {
  t = await bootTenant({ vertical: 'roofing' })
  const s = await seedOwner(t)
  await t.db.update(t.schema.company).set({ enabledFeatures: ['jobs', 'contacts'] } as any).where(eq(t.schema.company.id, s.company.id))
  t.services.features.forgetFeatures()
  token = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json() as any).accessToken
  contactId = ((await t.db.insert(t.schema.contact).values({ companyId: s.company.id, name: 'Hank Homeowner', type: 'client', address: '1200 Main St', city: 'Eau Claire', state: 'WI', zip: '54701' } as any).returning()) as any[])[0].id
}, 120_000)

test('the contact list the form picks from carries the homeowner\'s address', async () => {
  const list = await json(await as('/api/contacts?limit=200'))
  const hank = (list.body.data ?? list.body).find((c: any) => c.id === contactId)
  expect([hank.address, hank.city, hank.state, hank.zip]).toEqual(['1200 Main St', 'Eau Claire', 'WI', '54701'])
})

test('an insurance job is made with its carrier, claim number and adjuster, and reads them back', async () => {
  const made = await json(await as('/api/jobs', { method: 'POST', json: {
    contactId, jobType: 'insurance', propertyAddress: '1200 Main St', city: 'Eau Claire', state: 'WI', zip: '54701',
    insuranceCompany: 'State Farm', claimNumber: 'CLM-2026-0771', adjusterName: 'Pat Adjuster', adjusterPhone: '715-555-0199', dateOfLoss: '2026-10-30',
  } }))
  expect(made.status).toBe(201)
  const read = await json(await as(`/api/jobs/${made.body.id}`))
  expect([read.body.insuranceCompany, read.body.claimNumber, read.body.adjusterName]).toEqual(['State Farm', 'CLM-2026-0771', 'Pat Adjuster'])
})
