// crm-roof — who reads the company's connected accounts. (Contractor admin pass, 10/12)
//
// The roof has its own company route, so the shared route's rule had to be carried here: the owner gets the row; an
// admin the plan but not the `integrations` bag (the Stripe account customers pay into, the QuickBooks realm); below
// company:update, no commercial terms at all. The PUT that hands the row back asks the same question.
import { Hono } from 'hono'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 400)) }
}

const { setupSchema } = await import('./setup.ts')
await setupSchema()
const { db } = await import('./db/index.ts')
const { company, user } = await import('./db/schema.ts')

const [co] = await db.insert(company).values({
  name: 'Accounts Roofing', slug: 'accounts-roof', email: 'ar@test.local', state: 'WI',
  enabledFeatures: ['contacts', 'jobs', 'dashboard'], settings: { plan: 'fleet', monthlyAmount: 99 },
  integrations: { stripeAccountId: 'acct_ROOF1012', quickbooksRealmId: '9130350000001012' },
} as any).returning()
const mk = async (role: string) => (await db.insert(user).values({ email: `${role}-ar@test.local`, passwordHash: 'x', firstName: role, lastName: 'R', role, companyId: co.id, isActive: true } as any).returning())[0]
const owner = await mk('owner'), admin = await mk('admin'), manager = await mk('manager')

const app = new Hono()
app.route('/api/company', (await import('./src/routes/company.ts')).default)
app.onError((err: any, c: any) => c.json({ error: err?.message || 'Internal error' }, err?.status || 500))
const call = (u: any) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, { method, headers: { 'content-type': 'application/json', 'x-test-user': u.id, 'x-test-company': co.id, 'x-test-role': u.role }, body: body === undefined ? undefined : JSON.stringify(body) })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j, text: t }
}
const ACCOUNTS = /acct_ROOF1012|9130350000001012/

const o = await call(owner)('GET', '/api/company')
check('the owner reads the row, connected accounts and plan included', o.status === 200 && 'integrations' in o.json && o.json?.settings?.plan === 'fleet' && ACCOUNTS.test(o.text), Object.keys(o.json || {}).length)
const a = await call(admin)('GET', '/api/company')
check('an admin reads the plan but not the connected accounts', a.status === 200 && a.json?.settings?.plan === 'fleet' && !('integrations' in a.json) && !ACCOUNTS.test(a.text), Object.keys(a.json || {}).filter((k) => /integr|subscr/.test(k)))
const m = await call(manager)('GET', '/api/company')
check('a manager reads neither', m.status === 200 && !m.json?.settings?.plan && !('integrations' in m.json) && !ACCOUNTS.test(m.text))

const base = (((await db.select({ f: company.enabledFeatures }).from(company))[0]?.f) || []) as string[]
const saved = await call(admin)('PUT', '/api/company/features', { features: base })
check('an admin\'s features save does not hand back what the read withholds', saved.status === 200 && !ACCOUNTS.test(saved.text), saved.status)
const ownSaved = await call(owner)('PUT', '/api/company/features', { features: base })
check('…while the owner\'s still returns the row whole', ownSaved.status === 200 && ACCOUNTS.test(ownSaved.text), ownSaved.status)

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
