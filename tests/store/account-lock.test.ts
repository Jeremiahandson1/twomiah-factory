// crm-store — a cancelled store is LOCKED, for every seat, and its owner restarts it by paying. (10/14)
//
// The ten CRMs were locked on 10/14 (tests/crm/account-lock). The store was not: it had no subscription sync at all, so the
// Factory's "cancelled" push landed on a 404 and a store whose subscription ended kept every door. It has no company row,
// so it mirrors the Factory's summary into store_settings.subscription and runs the SAME shared rule
// (packages/tenant-backend/src/auth/accountLock.ts). The Factory is answered here (fetch stubbed); nothing leaves the machine.
process.env.FACTORY_URL = 'https://factory.store-lock.local'
process.env.FACTORY_SYNC_KEY = 'store-lock-key'
process.env.TENANT_ID = 'tenant-store-lock'
import { Hono } from 'hono'
import { count } from 'drizzle-orm'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}

let factorySays: any = null
const restartCalls: { url: string; body: any }[] = []
let restartReply: { status: number; body: any } = { status: 200, body: { url: 'https://checkout.stripe.test/c/store' } }
const sub = (o: Record<string, unknown>) => ({ plan: 'store', planName: 'Store', status: 'active', billingStatus: 'active', trialEndsAt: null, nextBillingDate: null, hasStripeCustomer: true, syncedAt: new Date().toISOString(), ...o })
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(input?.url ?? input)
  if (!url.startsWith(process.env.FACTORY_URL!)) return realFetch(input, init)
  const reply = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } })
  if (url.endsWith('/subscription')) return reply(factorySays)
  if (url.endsWith('/restart-checkout')) { restartCalls.push({ url, body: init?.body ? JSON.parse(init.body) : null }); return reply(restartReply.body, restartReply.status) }
  return reply({})
}) as any

const { setupSchema } = await import('./setup.ts')
await setupSchema()
const { db } = await import('./db/index.ts')
const { storeSettings, users, discountCodes } = await import('./db/schema.ts')
await db.insert(storeSettings).values({ companyName: 'Lock Shop', currency: 'usd' } as any)
const mk = async (role: string, name: string) => (await db.insert(users).values({ email: `${name}@lockshop.test`, passwordHash: 'x', name, role } as any).returning())[0]
const owner = await mk('owner', 'owner'), manager = await mk('manager', 'manager'), staff = await mk('staff', 'staff')

const app = new Hono()
app.route('/api/auth', (await import('./src/routes/auth.ts')).default)
app.route('/api/admin/discounts', (await import('./src/routes/discounts.ts')).default)
app.route('/api/billing', (await import('./src/routes/billing.ts')).billingRoutes)
app.route('/api/internal/sync-subscription', (await import('./src/routes/subscriptionSync.ts')).subscriptionSyncRoute)

const call = async (who: any, method: string, path: string, body?: unknown) => {
  const res = await app.request(path, { method, headers: { 'content-type': 'application/json', 'x-test-user': who.id }, body: body === undefined ? undefined : JSON.stringify(body) })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}
const push = async (s: any, key = 'store-lock-key') => {
  factorySays = s
  return (await app.request('/api/internal/sync-subscription', { method: 'POST', headers: { 'content-type': 'application/json', 'X-Factory-Key': key }, body: JSON.stringify({ subscription: s }) })).status
}
const codes = async () => Number((await db.select({ n: count() }).from(discountCodes))[0].n)

{
  check('the Factory\'s push needs its key', (await push(sub({}), 'wrong')) === 401)
  check('open: a paying store reads its discount codes', (await push(sub({}))) === 200 && (await call(owner, 'GET', '/api/admin/discounts')).status === 200)
}
{
  check('the Factory says the subscription ended — and the push now lands (it was a 404)', (await push(sub({ status: 'canceled', billingStatus: 'canceled' }))) === 200)
  const r = await call(owner, 'GET', '/api/admin/discounts')
  check(`locked: the very next request is refused — 402 ACCOUNT_LOCKED, subscription_ended (${r.status})`, r.status === 402 && r.json?.code === 'ACCOUNT_LOCKED' && r.json?.lock === 'subscription_ended', r.json)
  const before = await codes()
  const w = await call(manager, 'POST', '/api/admin/discounts', { code: 'LOCKED10', type: 'percent', value: 10 })
  check(`locked: a write is refused too, and nothing is written (${w.status})`, w.status === 402 && (await codes()) === before, w.json)
  const s = await call(staff, 'GET', '/api/admin/discounts')
  check('locked: for every seat — staff refused the same', s.status === 402 && s.json?.code === 'ACCOUNT_LOCKED', s.json)
}
{
  const o = await call(owner, 'GET', '/api/auth/me'), s = await call(staff, 'GET', '/api/auth/me')
  check(`locked: signing in still works — /me answers (${o.status}, ${s.status})`, o.status === 200 && s.status === 200)
  check('locked: every seat is told the store is locked, with its name for the lock page', o.json?.accountLock === 'subscription_ended' && s.json?.accountLock === 'subscription_ended' && o.json?.storeName === 'Lock Shop', { o: o.json?.accountLock, s: s.json?.accountLock })
  check('locked: …and staff are told only THAT, not the bill', s.json?.subscription === undefined && s.json?.billingStatus === undefined)
  const b = await call(owner, 'GET', '/api/billing/subscription')
  check(`locked: billing stays open — the way back (${b.status})`, b.status === 200 && b.json?.subscription?.status === 'canceled' && b.json?.mayManage === true, b.json)
  const bm = await call(manager, 'GET', '/api/billing/subscription'), bs = await call(staff, 'GET', '/api/billing/subscription')
  check(`locked: a manager and staff are refused the bill itself — the lock page reads that as "ask the owner" (${bm.status}, ${bs.status})`, bm.status === 403 && bs.status === 403 && bm.json?.subscription === undefined, bm.json)
}
{
  const o = await call(owner, 'POST', '/api/billing/restart-checkout')
  check(`restart: the owner gets a checkout page (${o.status})`, o.status === 200 && o.json?.url === 'https://checkout.stripe.test/c/store', o.json)
  check('restart: …asked for THIS store, coming back to the store\'s own lock page (/paywall, not /crm/paywall)', /\/customers\/tenant-store-lock\/restart-checkout$/.test(restartCalls[0]?.url || '') && restartCalls[0]?.body?.returnPath === '/paywall', restartCalls)
  const m = await call(manager, 'POST', '/api/billing/restart-checkout'), s = await call(staff, 'POST', '/api/billing/restart-checkout')
  check(`restart: a manager and staff are refused — what the store pays for is the owner's (${m.status}, ${s.status})`, m.status === 403 && s.status === 403 && restartCalls.length === 1)
  restartReply = { status: 410, body: { error: 'The 30 days after this subscription ended have passed, so it can no longer be restarted here. Email support@twomiah.com and we will set it up again.', code: 'grace_ended' } }
  const late = await call(owner, 'POST', '/api/billing/restart-checkout')
  check(`restart: too late — the Factory's refusal reaches the owner as a 410 in its words (${late.status})`, late.status === 410 && /30 days/.test(late.json?.error || '') && late.json?.code === 'grace_ended', late.json)
}
{
  check('the Factory says they subscribed again', (await push(sub({}))) === 200)
  const r = await call(staff, 'GET', '/api/admin/discounts')
  check(`unlocked: on the very next request (${r.status})`, r.status === 200)
  check('unlocked: nobody is told it is locked', (await call(staff, 'GET', '/api/auth/me')).json?.accountLock === null)
  await push(sub({ status: 'past_due', billingStatus: 'past_due' }))
  check('past_due is open — Stripe is still retrying the card', (await call(owner, 'GET', '/api/admin/discounts')).status === 200)
}
{
  // A store with no settings row yet (before onboarding) has nowhere to record it: the push says so instead of a 200.
  await db.delete(storeSettings)
  check('no store row yet: the push is a 404, never a silent 200', (await push(sub({ status: 'canceled', billingStatus: 'canceled' }))) === 404)
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
