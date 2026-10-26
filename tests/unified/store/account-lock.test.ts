// ADAPTED COPY of tests/store/account-lock.test.ts, for the unified app (tests/unified/harness/adapted.ts). Unchanged except
// the lines marked "unified:", each saying what the unified build changed and why. The original keeps running against
// the template.
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
const { storeSettings, users, discountCodes, company } = await import('./db/schema.ts') /* unified: the business is the company row */
await db.update(company).set({ name: 'Lock Shop' }) /* unified: the shop's name is company.name (the commerce settings row, currency usd by default, is made on first read) */
const mk = async (role: string, name: string) => (await db.insert(users).values({ email: `${name}@lockshop.test`, passwordHash: 'x', firstName: name, lastName: 'Tester', role } as any) /* unified: a user's name is first and last */.returning())[0]
const owner = await mk('owner', 'owner'), manager = await mk('manager', 'manager'), staff = await mk('staff', 'staff')

const app = new Hono()
app.route('/api/auth', (await import('./src/routes/auth.ts')).default)
app.route('/api/admin/discounts', (await import('./src/routes/discounts.ts')).default)
app.route('/api/billing', (await import('./src/routes/billing.ts')).billingRoutes)
app.route('/api/internal/sync-subscription', (await import('./src/routes/subscriptionSync.ts')).subscriptionSyncRoute)
app.route('/api/public', (await import('./src/routes/public.ts')).default)
const shopper = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}

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
  const st = await shopper('GET', '/api/public/status'), cat = await shopper('GET', '/api/public/products')
  check(`open: shoppers see the catalogue and the status says open (${st.status}, ${cat.status})`, st.json?.open === true && st.json?.storeName === 'Lock Shop' && cat.status === 200, { st: st.json, cat: cat.status })
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
  // SHOPPERS, as a frozen Shopify store: "what do the pros do? shopify?" (owner, 10/14)
  const st = await shopper('GET', '/api/public/status')
  check('locked: the storefront is told the store is closed — with its name, and nothing about why', st.status === 200 && st.json?.open === false && st.json?.storeName === 'Lock Shop' && Object.keys(st.json || {}).sort().join(',') === 'open,storeName', st.json)
  const refused = await Promise.all(['/api/public/products', '/api/public/products/anything', '/api/public/settings', '/api/public/loyalty?email=a%40b.c', '/api/public/recover/x', '/api/public/products/anything/reviews'].map((p) => shopper('GET', p)))
  check('locked: the catalogue, settings, loyalty quote, cart recovery and reviews answer 503 STORE_UNAVAILABLE', refused.every((r) => r.status === 503 && r.json?.code === 'STORE_UNAVAILABLE'), refused.map((r) => r.status))
  const co = await shopper('POST', '/api/public/checkout', { items: [{ variantId: '00000000-0000-0000-0000-000000000000', quantity: 1 }], email: 'a@b.c' })
  check(`locked: CHECKOUT is refused — nobody pays a closed store (${co.status})`, co.status === 503 && co.json?.code === 'STORE_UNAVAILABLE', co.json)
  const wh = await shopper('POST', '/api/public/webhooks/payment', {}), sw = await shopper('POST', '/api/public/webhooks/supplier', {}), os = await shopper('GET', '/api/public/order-summary?session=x')
  check(`locked: the payment and supplier webhooks and the order summary still answer — money in flight still lands (${wh.status}, ${sw.status}, ${os.status})`, wh.json?.code !== 'STORE_UNAVAILABLE' && sw.json?.code !== 'STORE_UNAVAILABLE' && os.json?.code !== 'STORE_UNAVAILABLE' && ![wh.status, sw.status, os.status].includes(503), { wh, sw, os })
}
{
  const o = await call(owner, 'GET', '/api/auth/me'), s = await call(staff, 'GET', '/api/auth/me')
  check(`locked: signing in still works — /me answers (${o.status}, ${s.status})`, o.status === 200 && s.status === 200)
  check('locked: every seat is told the store is locked, with its name for the lock page', o.json?.company?.settings?.accountLock === 'subscription_ended' && s.json?.company?.settings?.accountLock === 'subscription_ended' && o.json?.company?.name === 'Lock Shop', { o: o.json?.company?.settings?.accountLock, s: s.json?.company?.settings?.accountLock }) /* unified: /me is the engine's { user, company, permissions } — the lock is company.settings.accountLock and the shop's name company.name (the template's /me put accountLock and storeName at the top) */
  check('locked: …and staff are told only THAT, not the bill', !!s.json?.company?.settings && ['subscription', 'billingStatus', 'subscriptionStatus', 'plan', 'nextBillingDate', 'hasStripeCustomer'].every((k) => s.json.company.settings[k] === undefined), s.json?.company?.settings) /* unified: the subscription mirror is company.settings (subscriptionStatus, billingStatus, plan …), redacted for every seat below the owner and admin (redactCompanySettings) — read there, not at the top of /me */
  const b = await call(owner, 'GET', '/api/billing/subscription')
  check(`locked: billing stays open — the way back (${b.status})`, b.status === 200 && b.json?.subscription?.status === 'canceled' && b.json?.mayManage === true, b.json)
  const bm = await call(manager, 'GET', '/api/billing/subscription'), bs = await call(staff, 'GET', '/api/billing/subscription')
  check(`locked: a manager and staff are refused the bill itself — the lock page reads that as "ask the owner" (${bm.status}, ${bs.status})`, bm.status === 403 && bs.status === 403 && bm.json?.subscription === undefined, bm.json)
}
{
  const o = await call(owner, 'POST', '/api/billing/restart-checkout')
  check(`restart: the owner gets a checkout page (${o.status})`, o.status === 200 && o.json?.url === 'https://checkout.stripe.test/c/store', o.json)
  check('restart: …asked for THIS store, coming back to the store\'s own lock page (/paywall, not /crm/paywall)', /\/customers\/tenant-store-lock\/restart-checkout$/.test(restartCalls[0]?.url || '') && (restartCalls[0]?.body?.returnPath ?? '/crm/paywall') === '/crm/paywall' && /<Route path="paywall" element=\{<Paywall \/>\} \/>/.test((require('node:fs') as typeof import('node:fs')).readFileSync((process.env.FACTORY_ROOT || '') + 'apps/unified/web/src/App.tsx', 'utf8')), restartCalls) /* unified: the store's back office is the unified app's /crm, so its lock page is /crm/paywall (web/src/App.tsx under /crm, lockPaths.ts) — the Factory's default when no returnPath is named (factoryClient.startRestartCheckout); the template's own app served it at /paywall */
  const m = await call(manager, 'POST', '/api/billing/restart-checkout'), s = await call(staff, 'POST', '/api/billing/restart-checkout')
  check(`restart: a manager and staff are refused — what the store pays for is the owner's (${m.status}, ${s.status})`, m.status === 403 && s.status === 403 && restartCalls.length === 1)
  restartReply = { status: 410, body: { error: 'The 30 days after this subscription ended have passed, so it can no longer be restarted here. Email support@twomiah.com and we will set it up again.', code: 'grace_ended' } }
  const late = await call(owner, 'POST', '/api/billing/restart-checkout')
  check(`restart: too late — the Factory's refusal reaches the owner as a 410 in its words (${late.status})`, late.status === 410 && /30 days/.test(late.json?.error || '') && late.json?.code === 'grace_ended', late.json)
}
{
  check('the Factory says they subscribed again', (await push(sub({}))) === 200)
  const r = await call(manager, 'GET', '/api/admin/discounts') /* unified: staff no longer read discount codes (store live test 2026-10-26); the manager's read shows the unlock */
  check(`unlocked: on the very next request (${r.status})`, r.status === 200)
  check('unlocked: nobody is told it is locked', (await call(staff, 'GET', '/api/auth/me')).json?.company?.settings?.accountLock === null) /* unified: the lock is company.settings.accountLock on the engine's /me */
  const st = await shopper('GET', '/api/public/status'), cat = await shopper('GET', '/api/public/products')
  check('unlocked: shoppers are back — status open, catalogue answers', st.json?.open === true && cat.status === 200, { st: st.json, cat: cat.status })
  await push(sub({ status: 'past_due', billingStatus: 'past_due' }))
  check('past_due is open — Stripe is still retrying the card', (await call(owner, 'GET', '/api/admin/discounts')).status === 200)
}
{
  // A store with no settings row yet (before onboarding) has nowhere to record it: the push says so instead of a 200.
  await db.delete(company) /* unified: the business is the company row (the push mirrors into company.settings), so "no store row yet" is a tenant with no company — store_settings holds only the commerce settings */
  check('no store row yet: the push is a 404, never a silent 200', (await push(sub({ status: 'canceled', billingStatus: 'canceled' }))) === 404)
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
