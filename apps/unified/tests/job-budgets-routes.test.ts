// Project budgets under Job Costing, the server half: the route is its own (not ready) feature `job_budgets` and still
// needs reports:read. Its own file: job-budgets.test.ts installs a DOM as globals, and the in-memory database then fails to boot.
import { describe, test, expect } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'

const json = async (r: Response) => (await r.json()) as any

describe('the server', () => {
  async function boot(features: string[]) {
    const t = await bootTenant({ vertical: 'contractor' })
    const s = await seedOwner(t)
    await t.db.update(t.schema.company).set({ enabledFeatures: features } as any).where(eq(t.schema.company.id, s.company.id))
    const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
    const login = async (email: string, password: string) => (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken
    const as = (tok: string) => (p: string, i: any = {}) => t.call(p, { ...i, headers: { ...(i.headers || {}), Authorization: `Bearer ${tok}` } })
    const owner = as(await login('owner@test.example', s.password))
    await ins(t.schema.user, { companyId: s.company.id, email: 'field@test.example', firstName: 'Field', lastName: 'Seat', role: 'field', passwordHash: await Bun.password.hash('Correct-horse-1', 'bcrypt') })
    const field = as(await login('field@test.example', 'Correct-horse-1'))
    const customer = await ins(t.schema.contact, { companyId: s.company.id, type: 'client', name: 'Ann Able' })
    const project = await ins(t.schema.project, { companyId: s.company.id, number: 'PRJ-00001', name: 'Kitchen remodel', contactId: customer.id })
    await ins(t.schema.projectBudgetLine, { companyId: s.company.id, projectId: project.id, costCode: '06-Framing', estimatedCost: '820', estimatedPrice: '1080', uncostedLines: 0 })
    return { owner, field, project }
  }

  test('off: the budget route is not there; on: the owner reads it; on: a seat without reports:read is refused', async () => {
    const off = await boot(['projects', 'job_costing'])
    expect((await off.owner(`/api/job-costing/budget/${off.project.id}`)).status).toBe(404)
    const on = await boot(['projects', 'job_costing', 'job_budgets'])
    const r = await on.owner(`/api/job-costing/budget/${on.project.id}`)
    expect(r.status).toBe(200)
    expect((await json(r)).lines.map((l: any) => [l.costCode, l.estimatedCost])).toEqual([['06-Framing', 820]])
    expect((await on.field(`/api/job-costing/budget/${on.project.id}`)).status).toBe(403)
  }, 120_000)
})
