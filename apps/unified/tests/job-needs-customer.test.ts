// A new job is for a customer (brief item 4). The server refuses a job with nobody to schedule, bill or text, in words, per
// trade that turns it on; a job saved without a customer stays readable and editable; clearing a job's customer is refused.
// Roofing already asked for its homeowner (server/crm/roof/jobs.ts `needed('contactId')`); the dealership is left as it was.
import { describe, test, expect } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'

async function boot(vertical: string) {
  const t = await bootTenant({ vertical })
  const s = await seedOwner(t)
  await t.db.update(t.schema.company).set({ enabledFeatures: ['contacts', 'jobs', 'projects', 'quotes', 'invoices'] } as any).where(eq(t.schema.company.id, s.company.id))
  const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
  const login = async (email: string, password: string) => (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken
  const as = (tok: string) => (p: string, i: any = {}) => t.call(p, { ...i, headers: { ...(i.headers || {}), Authorization: `Bearer ${tok}` } })
  const owner = as(await login('owner@test.example', s.password))
  const seat = async (role: string) => {
    await ins(t.schema.user, { companyId: s.company.id, email: `${role}@test.example`, firstName: role, lastName: 'Seat', role, passwordHash: await Bun.password.hash('Correct-horse-1', 'bcrypt') })
    return as(await login(`${role}@test.example`, 'Correct-horse-1'))
  }
  const customer = (name = 'Casey Customer') => ins(t.schema.contact, { companyId: s.company.id, type: 'client', name })
  return { t, ins, owner, seat, companyId: s.company.id as string, customer }
}

// the trade's own word for its customer, as vocabulary says it (all four say "customer")
const TRADES = [['contractor', 'job'], ['basic', 'job'], ['fieldservice', 'job'], ['landscaping', 'job']] as const

for (const [vertical, word] of TRADES) {
  describe(`${vertical}: a new ${word} needs a customer`, () => {
    test('refused in words with no customer; made with one', async () => {
      const { owner, customer } = await boot(vertical)
      const refused = await owner('/api/jobs', { method: 'POST', json: { title: 'Fix the gutter' } })
      expect(refused.status).toBe(400)
      const body = await refused.json()
      expect(body.code).toBe('customer_required')
      expect(body.error).toBe(`Pick the customer this ${word} is for — it can't be scheduled, billed or texted without one.`)
      expect(body.fields.contactId).toBe(body.error)
      // an empty string from the form's "Select..." is the same as none
      expect((await owner('/api/jobs', { method: 'POST', json: { title: 'Fix the gutter', contactId: '' } })).status).toBe(400)
      expect((await (await owner('/api/jobs')).json()).data).toHaveLength(0)

      const c = await customer()
      const made = await owner('/api/jobs', { method: 'POST', json: { title: 'Fix the gutter', contactId: c.id } })
      expect(made.status).toBe(201)
    }, 90_000)

    test('a job saved without a customer is still edited; clearing a customer is refused', async () => {
      const { owner, ins, companyId, customer, t } = await boot(vertical)
      const old = await ins(t.schema.job, { companyId, number: 'JOB-00001', title: 'Old job, no customer' })
      // it still reads, and an unrelated edit goes through (the form posts back the empty customer it never had)
      expect((await owner(`/api/jobs/${old.id}`)).status).toBe(200)
      const edited = await owner(`/api/jobs/${old.id}`, { method: 'PUT', json: { title: 'Old job, renamed', contactId: null } })
      expect(edited.status).toBe(200)
      expect((await edited.json()).title ?? (await (await owner(`/api/jobs/${old.id}`)).json()).title).toBe('Old job, renamed')
      // giving it a customer later works
      const c = await customer()
      expect((await owner(`/api/jobs/${old.id}`, { method: 'PUT', json: { contactId: c.id } })).status).toBe(200)
      // …and then it may not be emptied again
      for (const clear of ['', null]) {
        const r = await owner(`/api/jobs/${old.id}`, { method: 'PUT', json: { contactId: clear } })
        expect(r.status).toBe(400)
        expect((await r.json()).code).toBe('customer_required')
      }
      const after = await (await owner(`/api/jobs/${old.id}`)).json()
      expect((after.data ?? after).contactId).toBe(c.id)
    }, 90_000)

    test('a seat without jobs:create is still refused by the server', async () => {
      const { seat, customer } = await boot(vertical)
      const field = await seat('field')
      const c = await customer()
      expect((await field('/api/jobs', { method: 'POST', json: { title: 'Sneaky', contactId: c.id } })).status).toBe(403)
    }, 90_000)
  })
}

describe('the other trades', () => {
  test('a project that has a customer is enough for a job on it (contractor)', async () => {
    const { owner, customer, ins, companyId, t } = await boot('contractor')
    const c = await customer('Pat Owner')
    const project = await ins(t.schema.project, { companyId, number: 'PRJ-00001', name: 'Kitchen', contactId: c.id })
    const made = await owner('/api/jobs', { method: 'POST', json: { title: 'Demo day', projectId: project.id } })
    expect(made.status).toBe(201)
    // a project with nobody on it does not count
    const bare = await ins(t.schema.project, { companyId, number: 'PRJ-00002', name: 'Shed' })
    const refused = await owner('/api/jobs', { method: 'POST', json: { title: 'Pour slab', projectId: bare.id } })
    expect(refused.status).toBe(400)
    expect((await refused.json()).code).toBe('customer_required')
  }, 90_000)

  test('repeating jobs are refused the same way, before any visit is made (fieldservice)', async () => {
    const { owner, t } = await boot('fieldservice')
    const r = await owner('/api/jobs', { method: 'POST', json: { title: 'Weekly check', scheduledDate: '2026-11-02', repeat: { every: 'week', times: 3 } } })
    expect(r.status).toBe(400)
    expect((await (await t.db.select().from(t.schema.job)).length)).toBe(0)
  }, 90_000)

  test('roofing already asks for its homeowner; the dealership has not been changed', async () => {
    const roof = await boot('roofing')
    const refused = await roof.owner('/api/jobs', { method: 'POST', json: { title: 'Re-roof' } })
    expect(refused.status).toBe(400)
    expect(JSON.stringify(await refused.json())).toContain('homeowner')

    const rv = await boot('rv')
    const made = await rv.owner('/api/jobs', { method: 'POST', json: { title: 'Winterise' } })
    expect(made.status).toBe(201)
  }, 90_000)
})
