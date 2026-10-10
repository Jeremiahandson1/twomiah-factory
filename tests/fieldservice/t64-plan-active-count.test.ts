// T64 Low — "The Plans card says '0 active' when there are 3." GET /api/agreements/plans now sends activeAgreements —
// the agreements on the plan whose status is active — which the card reads. A cancelled agreement does not count, and
// another plan's agreements do not leak into this one.
import { Hono } from 'hono'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}

const { setupSchema } = await import('./setup.ts')
await setupSchema()
const { db } = await import('./db/index.ts')
const { company, user, contact, agreementPlan, serviceAgreement } = await import('./db/schema.ts')

const [co] = await db.insert(company).values({ name: 'Plan Count HVAC', slug: 'plancount-t64', email: 'pc-t64@test.local', settings: {}, enabledFeatures: ['agreements'] } as any).returning()
const [owner] = await db.insert(user).values({ email: 'owner@pc-t64.local', passwordHash: 'x', firstName: 'O', lastName: 'U', role: 'owner', companyId: co.id, isActive: true } as any).returning()
const [client] = await db.insert(contact).values({ companyId: co.id, type: 'client', name: 'Harlow Dent', email: 'hd-t64@test.local' } as any).returning()
const mkPlan = async (name: string) => (await db.insert(agreementPlan).values({ companyId: co.id, name, price: '49.00', billingFrequency: 'monthly', visitsIncluded: 2, active: true } as any).returning())[0]
const gold = await mkPlan('Gold'), silver = await mkPlan('Silver')
let n = 0
const mkAgr = async (planId: string, status: string) => db.insert(serviceAgreement).values({
  companyId: co.id, contactId: client.id, planId, number: `AGR-T64-${++n}`, name: `Agreement ${n}`, status, renewalType: 'manual',
  startDate: new Date('2026-01-01'), endDate: new Date('2027-01-01'), billingFrequency: 'monthly', amount: '49.00',
} as any)
for (const s of ['active', 'active', 'active', 'cancelled']) await mkAgr(gold.id, s)
await mkAgr(silver.id, 'active')

const app = new Hono()
app.route('/api/agreements', (await import('./src/routes/agreements.ts')).default)
app.onError((await import('./src/utils/errors.ts')).errorHandler)
const res = await app.request('/api/agreements/plans', { headers: { 'x-test-user': owner.id } })
const body: any = await res.json().catch(() => null)
const plans: any[] = Array.isArray(body) ? body : body?.data || []
const g = plans.find((p) => p.id === gold.id), s = plans.find((p) => p.id === silver.id)
check('the plans list answers', res.status === 200 && plans.length === 2, { status: res.status, n: plans.length })
check('Gold reads 3 active — the cancelled one is not counted', g?.activeAgreements === 3, g)
check('Silver reads its own 1, not Gold\'s', s?.activeAgreements === 1, s)

console.log(`\nt64 plan active count: ${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
