// A roofing tenant for the commission / job-P&L tests (roof-commissions-*.test.ts, roof-job-pl.test.ts): the real server as the
// roofing vertical, an owner, a rep, an estimator, a manager and a read-only seat, a homeowner, and the little helpers every one of
// those tests uses — make a job, send and pay an invoice, read a job's commissions. Nothing here reaches Stripe or a real tenant.
import { and, eq } from 'drizzle-orm'
import { expect } from 'bun:test'
import { bootTenant, seedOwner } from './harness.ts'

export type RoofTenant = Awaited<ReturnType<typeof bootTenant>>
export const PASS = 'Seat-pass-1'
export const ROOF_FEATURES = ['jobs', 'contacts', 'invoices', 'commission_tracking', 'job_costing', 'materials', 'crews', 'insurance_workflow', 'time_tracking', 'roof_work_orders']

export async function bootRoofKit(seats: Array<readonly [string, string, string]> = []) {
  const t = await bootTenant({ vertical: 'roofing' })
  const seeded = await seedOwner(t)
  const companyId = seeded.company.id
  const tokens: Record<string, string> = {}
  const ids: Record<string, string> = {}
  const login = async (email: string, password: string) =>
    (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken as string
  tokens.owner = await login('owner@test.example', seeded.password)
  ids.owner = seeded.owner.id
  const setFeatures = async (features: string[]) => {
    await t.db.update(t.schema.company).set({ enabledFeatures: features } as any).where(eq(t.schema.company.id, companyId))
    t.services.features.forgetFeatures()
  }
  await setFeatures(ROOF_FEATURES)
  const hash = await Bun.password.hash(PASS, 'bcrypt')
  // key, role, first name — Rita sells roofs (a field seat, as roofing runs its reps), Mo is a manager, Val is the read-only office seat.
  for (const [key, role, first] of [['rep', 'field', 'Rita'], ['manager', 'manager', 'Mo'], ['viewer', 'viewer', 'Val'], ...seats] as const) {
    const [u] = await t.db.insert(t.schema.user).values({ email: `${key}@test.example`, passwordHash: hash, firstName: first, lastName: 'Seat', role, companyId } as any).returning()
    ids[key] = u.id
    tokens[key] = await login(`${key}@test.example`, PASS)
  }
  const [home] = await t.db.insert(t.schema.contact).values({ companyId, name: 'Lee Marsh', email: 'lee@home.example', mobile: '715-555-0101', type: 'client' } as any).returning()
  ids.home = home.id

  const as = (who: string) => (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tokens[who]}` } })
  const json = async (r: Response) => ({ status: r.status, body: await r.json() as any })
  const settled = async (jobId: string, want: string) => {
    for (let i = 0; i < 40; i++) {
      const [row] = await t.db.select().from(t.schema.job).where(eq(t.schema.job.id, jobId))
      if (row.status === want) return want
      await new Promise((r) => setTimeout(r, 50))
    }
    return (await t.db.select().from(t.schema.job).where(eq(t.schema.job.id, jobId)))[0].status as string
  }
  const commissionsOf = async (jobId: string) =>
    (await t.db.select().from(t.schema.commission).where(and(eq(t.schema.commission.companyId, companyId), eq(t.schema.commission.jobId, jobId)))) as any[]
  /** A commission follows the payment after the reply, so wait for it rather than read at once. */
  const commissionsAfter = async (jobId: string, count: number) => {
    for (let i = 0; i < 40; i++) { if ((await commissionsOf(jobId)).length >= count) break; await new Promise((r) => setTimeout(r, 50)) }
    return commissionsOf(jobId)
  }
  const quiet = async (ms = 250) => new Promise((r) => setTimeout(r, ms))
  async function jobAt(status: string, address: string, extra: Record<string, unknown> = {}) {
    const made = await json(await as('owner')('/api/jobs', { method: 'POST', json: {
      contactId: ids.home, jobType: 'insurance', propertyAddress: address, city: 'Akron', state: 'OH', zip: '44301',
      estimatedRevenue: 12000, totalSquares: 30, ...extra,
    } }))
    expect([address, made.status]).toEqual([address, 201])
    await t.db.update(t.schema.job).set({ status } as any).where(eq(t.schema.job.id, made.body.id))
    return made.body.id as string
  }
  /** An invoice on the job for `price` before tax, sent. */
  async function sentInvoice(jobId: string, price: number) {
    const inv = await json(await as('owner')('/api/invoices', { method: 'POST', json: { contactId: ids.home, jobId, lineItems: [{ description: 'Roof replacement', quantity: 1, unitPrice: price }] } }))
    expect(inv.status).toBe(201)
    expect((await as('owner')(`/api/invoices/${inv.body.id}/send`, { method: 'POST' })).status).toBe(200)
    return inv.body as { id: string; number: string }
  }
  const pay = async (invoiceId: string, amount: number) =>
    expect((await as('owner')(`/api/invoices/${invoiceId}/payments`, { method: 'POST', json: { amount, method: 'check' } })).status).toBe(201)
  const order = (jobId: string, orderStatus: string, supplier: string, lines: Array<[string, number, number]>) =>
    as('owner')('/api/materials', { method: 'POST', json: { jobId, supplier, orderStatus, lineItems: lines.map(([description, qty, unitPrice]) => ({ description, qty, unit: 'ea', unitPrice })) } })
  /** A plan, made through the API as the owner. */
  const plan = async (body: Record<string, unknown>) => json(await as('owner')('/api/commissions/plans', { method: 'POST', json: body }))
  /** Retire every plan, so one test's plans never pay in the next. */
  const retireAllPlans = async () => {
    await t.db.update(t.schema.commissionPlan).set({ isActive: false } as any).where(eq(t.schema.commissionPlan.companyId, companyId))
  }
  return { t, companyId, tokens, ids, as, json, login, setFeatures, settled, commissionsOf, commissionsAfter, quiet, jobAt, sentInvoice, pay, order, plan, retireAllPlans }
}
