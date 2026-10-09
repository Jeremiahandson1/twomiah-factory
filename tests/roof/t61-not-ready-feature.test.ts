// The roof report is not ready, so an owner cannot switch it on — and is told so in plain words. (Owner, 2026-10-09)
//
//   "we cant use the roof report yet, it shouldnt be enabled"
//
// PUT /api/company/features is the owner's Settings › Features save. A not-ready (hidden) feature is refused
// with its real name and "isn't ready yet"; an id that is simply not a feature keeps the "unknown" answer.
import { Hono } from 'hono'
import { eq } from 'drizzle-orm'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 400)) }
}

const { setupSchema } = await import('./setup.ts')
await setupSchema()
const { db } = await import('./db/index.ts')
const { company, user } = await import('./db/schema.ts')

const [co] = await db.insert(company).values({ name: 'Ready Roofing', slug: 'ready-roof-t61', email: 'rr61@test.local', state: 'WI', settings: {}, enabledFeatures: ['contacts', 'jobs', 'quotes', 'invoices', 'scheduling', 'dashboard'] } as any).returning()
const [owner] = await db.insert(user).values({ email: 'owner-rr61@test.local', passwordHash: 'x', firstName: 'O', lastName: 'R', role: 'owner', companyId: co.id, isActive: true } as any).returning()

const app = new Hono()
app.route('/api/company', (await import('./src/routes/company.ts')).default)
app.onError((err: any, c: any) => c.json({ error: err?.message || 'Internal error' }, err?.status || 500))
const put = async (features: string[]) => {
  const res = await app.request('/api/company/features', { method: 'PUT', headers: { 'content-type': 'application/json', 'x-test-user': owner.id, 'x-test-company': co.id, 'x-test-role': 'owner' }, body: JSON.stringify({ features }) })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}
const enabled = async () => ((await db.select({ f: company.enabledFeatures }).from(company).where(eq(company.id, co.id)))[0]?.f || []) as string[]

const base = await enabled()
const roofReport = await put([...base, 'measurement_reports'])
check('the roof report cannot be switched on by the owner', roofReport.status === 400, roofReport)
check('…and the answer names it and says why', roofReport.json?.code === 'feature_not_ready' && roofReport.json?.error === "Measurement Reports isn't ready yet, so it can't be switched on.", roofReport.json)
check('…and nothing was saved', !(await enabled()).includes('measurement_reports'))

const typo = await put([...base, 'not_a_feature'])
check('an id that is not a feature keeps the "unknown" answer', typo.status === 400 && /Unknown feature ids for this product: not_a_feature/.test(typo.json?.error || ''), typo.json)

const ok = await put([...base, 'crews'])
check('a ready roofing module still switches on', ok.status === 200 && (await enabled()).includes('crews'), ok)

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
