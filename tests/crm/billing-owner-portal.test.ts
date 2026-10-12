// Billing: an admin READS the plan; only the owner CHANGES it. (Owner's decision, 10/12, after the Contractor admin pass:
// "admin can see the company's billing details … which is right?")
//
// As Shopify draws it: anyone with access sees the plan; only the store owner changes the plan, pauses it or changes
// the payment method. Here Settings → Billing stays owner and admin (an admin adds the team, so needs the seat count),
// and the one door that changes money — POST /api/billing/portal-link, the Stripe portal where the plan is changed or
// cancelled and the card replaced — asks billing:manage, which only the owner holds. It fails CLOSED: a template that
// does not say who may manage billing lets nobody into the portal.
//
// The Factory is answered here (fetch stubbed); nothing leaves the machine.
process.env.FACTORY_URL = 'https://factory.billing-test.local'
process.env.FACTORY_SYNC_KEY = 'billing-test-key'
process.env.TENANT_ID = 'tenant-billing-test'
import { Hono } from 'hono'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}

const portalCalls: string[] = []
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(input?.url ?? input)
  if (!url.startsWith(process.env.FACTORY_URL!)) return realFetch(input, init)
  const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } })
  if (url.endsWith('/billing-portal-link')) { portalCalls.push(url); return json({ url: 'https://billing.stripe.test/session/abc' }) }
  if (url.endsWith('/subscription')) return json({ plan: 'starter', planName: 'Starter', product: 'crm', monthlyAmount: 99, billingCycle: 'monthly', billingType: 'subscription', status: 'active', billingStatus: 'paid', nextBillingDate: null, trialEndsAt: null, seats: 10, hasStripeCustomer: true, syncedAt: new Date().toISOString() })
  return json({})
}) as any

const { setupSchema } = await import('./setup.ts')
await setupSchema()
const { db } = await import('./db/index.ts')
const { company, user } = await import('./db/schema.ts')
const [co] = await db.insert(company).values({ name: 'Billing Co', slug: 'billing-co', email: 'b@test.local', state: 'OH', settings: {}, enabledFeatures: ['team'] } as any).returning()
const mk = async (role: string, tag: string) => (await db.insert(user).values({
  email: `${tag}-bill@test.local`, passwordHash: 'x', firstName: tag, lastName: 'U', role, companyId: co.id, isActive: true,
} as any).returning())[0]
const owner = await mk('owner', 'owner'), admin = await mk('admin', 'admin'), manager = await mk('manager', 'manager')

const app = new Hono()
app.route('/api/billing', (await import('./src/routes/billing.ts')).default)
const as = (who: any) => async (method: string, path: string) => {
  const res = await app.request(path, { method, headers: { 'content-type': 'application/json', 'x-test-user': who.id } })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}
const O = as(owner), A = as(admin), M = as(manager)

{
  const o = await O('GET', '/api/billing/subscription'), a = await A('GET', '/api/billing/subscription'), m = await M('GET', '/api/billing/subscription')
  check(`read: the owner and an admin both see the plan and seats (${o.status}, ${a.status})`, o.status === 200 && a.status === 200 && a.json?.subscription?.planName === 'Starter' && a.json?.seatLimit === 10, a.json)
  check('read: …a manager does not', m.status === 403, m.json)
  check('read: the reply says who may manage it — the owner yes, the admin no', o.json?.mayManage === true && a.json?.mayManage === false, { owner: o.json?.mayManage, admin: a.json?.mayManage })
}
{
  const before = portalCalls.length
  const a = await A('POST', '/api/billing/portal-link')
  check(`portal: an admin is refused the Stripe portal (403 owner_only — ${a.status})`, a.status === 403 && a.json?.code === 'owner_only' && a.json?.required === 'billing:manage', a.json)
  check('portal: …and the Factory was never asked for a link', portalCalls.length === before, portalCalls)
  const m = await M('POST', '/api/billing/portal-link')
  check(`portal: a manager neither (${m.status})`, m.status === 403 && portalCalls.length === before)
  const o = await O('POST', '/api/billing/portal-link')
  check('portal: the owner gets the link', o.status === 200 && o.json?.url === 'https://billing.stripe.test/session/abc' && portalCalls.length === before + 1, o.json)
}
{
  // Fails closed: the shared routes with nobody named as able to manage billing let nobody in — the owner included.
  const { createBillingRoutes, createFactoryApiClient } = await import('./src/shared/index.ts')
  const bare = new Hono()
  bare.use('*', async (c, next) => { c.set('user', { userId: owner.id, role: 'owner', companyId: co.id }); await next() })
  bare.route('/', createBillingRoutes({ db, companyTable: company, userTable: user, factoryApiClient: createFactoryApiClient() } as any))
  const r = await bare.request('/portal-link', { method: 'POST' })
  const s = await bare.request('/subscription')
  check('fails closed: with no canManage given, even the owner is refused the portal, and the screen is told no', r.status === 403 && (await s.json() as any)?.mayManage === false)
}
{
  // Every template that mounts billing names its manager — the same billing:manage, with the per-user grants.
  const ROOT = (process.env.FACTORY_ROOT || '').replace(/\/?$/, '/')
  const fs = await import('node:fs')
  const templates = ['crm', 'crm-basic', 'crm-dispensary', 'crm-fieldservice', 'crm-landscaping', 'crm-restaurant', 'crm-roof', 'crm-rv', 'crm-salon', 'crm-vet']
  const missing = templates.filter((t) => !/canManage: async \(c: any\) => \{ const u = c\.get\('user'\); return !!u && hasPermission\(u\.role, 'billing:manage', await getExtraPermissions\(u\.userId\)\) \}/.test(fs.readFileSync(`${ROOT}templates/${t}/backend/src/routes/billing.ts`, 'utf8')))
  check(`wiring: all ${templates.length} billing routes hand the shared routes billing:manage`, missing.length === 0, missing)
  const page = fs.readFileSync(`${ROOT}packages/tenant-ui/src/settings/BillingPage.tsx`, 'utf8').replace(/\r\n/g, '\n')
  check('screen: "Manage billing" is drawn only for mayManage, and the admin is told who changes it', /\{mayManage \? \(\n\s*<button onClick=\{openPortal\}/.test(page) && /Changing the plan, the card on file or cancelling is done by the account owner\./.test(page) && /const mayManage = data\?\.mayManage === true/.test(page))
  const perms = fs.readFileSync(`${ROOT}packages/tenant-backend/src/auth/permissions.ts`, 'utf8')
  check('matrix: no role but the owner holds billing:manage (no billing:* or billing:manage in any list)', !/'billing:(\*|manage)'/.test(perms))
}

globalThis.fetch = realFetch
console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
