// A cancelled company is LOCKED — by the server, for every role, the moment the Factory says so. (10/14)
//
//   Owner, after cancelling the test company from the Factory ("Ended. The CRM is locked"): "i dont seem to be locked out".
//
// The only lock was a browser check on an expired FREE-TRIAL date. A company that paid and then cancelled had no trial
// date, so nothing locked it — and nothing on the server ever refused anyone. Now (tenant-backend auth/accountLock.ts):
//   - the Factory's push marks the company; authenticate refuses every door but sign-in and billing with
//     402 ACCOUNT_LOCKED, on the very next request;
//   - every role is told, as settings.accountLock, so the browser sends everyone to the lock page;
//   - a new subscription unlocks it the same way.
// The Factory is answered here (fetch stubbed); nothing leaves the machine.
process.env.FACTORY_URL = 'https://factory.lock-test.local'
process.env.FACTORY_SYNC_KEY = 'lock-test-key'
process.env.TENANT_ID = 'tenant-lock-test'
import { Hono } from 'hono'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}

// What the Factory currently says. GET /api/billing/subscription asks it afresh, so the stub must agree with the push.
let factorySays: any = null
const sub = (o: Record<string, unknown>) => ({ plan: 'starter', planName: 'Starter', product: 'crm', monthlyAmount: 99, billingCycle: 'monthly', billingType: 'subscription', status: 'active', billingStatus: 'active', nextBillingDate: null, trialEndsAt: null, seats: 10, hasStripeCustomer: true, syncedAt: new Date().toISOString(), ...o })
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(input?.url ?? input)
  if (!url.startsWith(process.env.FACTORY_URL!)) return realFetch(input, init)
  const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } })
  if (url.endsWith('/subscription')) return json(factorySays)
  if (url.endsWith('/restart-checkout')) {
    restartCalls.push(url)
    return new Response(JSON.stringify(restartReply.body), { status: restartReply.status, headers: { 'content-type': 'application/json' } })
  }
  return json({})
}) as any
// What the Factory answers the restart: a checkout page, or its refusal.
const restartCalls: string[] = []
let restartReply: { status: number; body: any } = { status: 200, body: { url: 'https://checkout.stripe.test/c/restart' } }

const { setupSchema } = await import('./setup.ts')
await setupSchema()
const { db } = await import('./db/index.ts')
const { company, user, contact } = await import('./db/schema.ts')
const { count } = await import('drizzle-orm')
const [co] = await db.insert(company).values({ name: 'Lock Co', slug: 'lock-co', email: 'l@test.local', state: 'OH', settings: {}, enabledFeatures: ['contacts', 'team'] } as any).returning()
const mk = async (role: string, tag: string) => (await db.insert(user).values({
  email: `${tag}-lock@test.local`, passwordHash: 'x', firstName: tag, lastName: 'U', role, companyId: co.id, isActive: true,
} as any).returning())[0]
const owner = await mk('owner', 'owner'), admin = await mk('admin', 'admin'), field = await mk('field', 'field')

const app = new Hono()
app.route('/api/auth', (await import('./src/routes/auth.ts')).default)
app.route('/api/contacts', (await import('./src/routes/contacts.ts')).default)
app.route('/api/billing', (await import('./src/routes/billing.ts')).default)
const shared = await import('./src/shared/index.ts')
app.route('/api/internal/sync-subscription', shared.createSubscriptionSyncRoute({ db, companyTable: company, userTable: user, factoryApiClient: shared.createFactoryApiClient() } as any))

const call = async (who: any, method: string, path: string, body?: unknown) => {
  const res = await app.request(path, { method, headers: { 'content-type': 'application/json', 'x-test-user': who.id }, body: body === undefined ? undefined : JSON.stringify(body) })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}
const push = async (s: any) => {
  factorySays = s
  const res = await app.request('/api/internal/sync-subscription', { method: 'POST', headers: { 'content-type': 'application/json', 'X-Factory-Key': 'lock-test-key' }, body: JSON.stringify({ subscription: s }) })
  return res.status
}
const contacts = async () => Number((await db.select({ n: count() }).from(contact))[0].n)

{
  check('open: a paying company reads its contacts', (await push(sub({}))) === 200 && (await call(owner, 'GET', '/api/contacts')).status === 200)
}
{
  // The Factory's cancel-now: billing_status canceled, status suspended → summary status 'canceled', no trial date.
  check('the Factory\'s push lands', (await push(sub({ status: 'canceled', billingStatus: 'canceled', nextBillingDate: null }))) === 200)
  const r = await call(owner, 'GET', '/api/contacts')
  check(`locked: the very next read is refused — 402 ACCOUNT_LOCKED, subscription_ended (${r.status})`, r.status === 402 && r.json?.code === 'ACCOUNT_LOCKED' && r.json?.lock === 'subscription_ended', r.json)
  check('locked: …and says so in words, not "Request failed"', /subscription has ended/.test(r.json?.error || ''), r.json)
  const before = await contacts()
  const w = await call(owner, 'POST', '/api/contacts', { name: 'After Cancel', type: 'lead' })
  check(`locked: a write is refused too, and nothing is written (${w.status})`, w.status === 402 && (await contacts()) === before, w.json)
  const f = await call(field, 'GET', '/api/contacts')
  check('locked: for every role — a field tech is refused the same', f.status === 402 && f.json?.code === 'ACCOUNT_LOCKED', f.json)
}
{
  const o = await call(owner, 'GET', '/api/auth/me'), f = await call(field, 'GET', '/api/auth/me')
  check(`locked: signing in still works — /me answers (${o.status}, ${f.status})`, o.status === 200 && f.status === 200)
  check('locked: the owner is told the company is locked', o.json?.company?.settings?.accountLock === 'subscription_ended', o.json?.company?.settings)
  check('locked: …and so is the field tech, who is NOT sent the subscription status itself', f.json?.company?.settings?.accountLock === 'subscription_ended' && f.json?.company?.settings?.subscriptionStatus === undefined, f.json?.company?.settings)
  const b = await call(owner, 'GET', '/api/billing/subscription')
  check(`locked: billing stays open — the way back (${b.status})`, b.status === 200 && b.json?.subscription?.status === 'canceled', b.json)
}
{
  // RESTART — "shouldnt they just be able to make a payment and restart it? why email?" (owner, 10/14)
  const o = await call(owner, 'POST', '/api/billing/restart-checkout')
  check(`restart: while locked, the owner gets a checkout page to pay and come back (${o.status})`, o.status === 200 && o.json?.url === 'https://checkout.stripe.test/c/restart' && restartCalls.length === 1, o.json)
  check('restart: …asked of the Factory for THIS company, with its sync key', /\/customers\/tenant-lock-test\/restart-checkout$/.test(restartCalls[0] || ''), restartCalls)
  const before = restartCalls.length
  const a = await call(admin, 'POST', '/api/billing/restart-checkout'), f = await call(field, 'POST', '/api/billing/restart-checkout')
  check(`restart: an admin and a field tech are refused — what the business pays for is the owner's (${a.status}, ${f.status})`, a.status === 403 && f.status === 403 && a.json?.code === 'owner_only' && restartCalls.length === before, { a: a.json, f: f.json })
  restartReply = { status: 410, body: { error: 'The 30 days after this subscription ended have passed, so it can no longer be restarted here. Email support@twomiah.com and we will set it up again.', code: 'grace_ended' } }
  const late = await call(owner, 'POST', '/api/billing/restart-checkout')
  check(`restart: too late — the Factory's refusal reaches the owner in its own words, as a 410 (${late.status})`, late.status === 410 && /30 days/.test(late.json?.error || '') && late.json?.code === 'grace_ended', late.json)
  restartReply = { status: 500, body: { error: 'Stripe is down' } }
  const down = await call(owner, 'POST', '/api/billing/restart-checkout')
  check(`restart: a Factory failure is a 502, never a 200 with no page (${down.status})`, down.status === 502 && down.json?.url === null, down.json)
  restartReply = { status: 200, body: { url: 'https://checkout.stripe.test/c/restart' } }
  const ms = await call(owner, 'GET', '/api/billing/subscription'), ma = await call(admin, 'GET', '/api/billing/subscription')
  check('restart: the lock page is told who may press Restart — the owner yes, an admin no', ms.json?.mayManage === true && ma.json?.mayManage === false, { owner: ms.json?.mayManage, admin: ma.json?.mayManage })
}
{
  check('the Factory says they subscribed again', (await push(sub({}))) === 200)
  const r = await call(owner, 'GET', '/api/contacts'), f = await call(field, 'GET', '/api/contacts')
  check(`unlocked: on the very next request, for everyone (${r.status}, ${f.status})`, r.status === 200 && f.status === 200)
  const me = await call(field, 'GET', '/api/auth/me')
  check('unlocked: nobody is told it is locked', me.json?.company?.settings?.accountLock === null, me.json?.company?.settings)
}
{
  await push(sub({ status: 'past_due', billingStatus: 'past_due' }))
  check('past_due is open — Stripe is still retrying the card', (await call(owner, 'GET', '/api/contacts')).status === 200)
  await push(sub({ status: 'trialing', billingStatus: null, trialEndsAt: new Date(Date.now() + 86400_000).toISOString() }))
  check('a trial with days left is open', (await call(owner, 'GET', '/api/contacts')).status === 200)
  await push(sub({ status: 'trialing', billingStatus: null, trialEndsAt: new Date(Date.now() - 60_000).toISOString() }))
  const t = await call(field, 'GET', '/api/contacts')
  check(`a trial whose date has passed is locked — trial_ended, even before the Factory says 'canceled' (${t.status})`, t.status === 402 && t.json?.lock === 'trial_ended', t.json)
  await push(sub({ status: 'canceled', billingStatus: 'trialing', trialEndsAt: new Date(Date.now() - 60_000).toISOString() }))
  check('an expired trial the Factory has closed reads trial_ended — it never had a subscription to end', (await call(owner, 'GET', '/api/contacts')).json?.lock === 'trial_ended')
  await push(sub({}))
}
{
  const { accountLockOf, isLockOpenPath } = shared
  check('rule: no status at all (provisioned by hand) is open — a tenant never guesses', accountLockOf({}) === null && accountLockOf(null) === null && accountLockOf('{}') === null)
  check('rule: a JSON-string settings blob is read too', accountLockOf(JSON.stringify({ subscriptionStatus: 'canceled', billingStatus: 'canceled' })) === 'subscription_ended')
  check('doors: sign-in, two-factor and billing stay open', ['/api/auth/me', '/api/auth/mfa-devices/devices', '/api/billing/subscription', '/api/billing', '/api/messaging-billing/status'].every(isLockOpenPath))
  check('doors: a look-alike prefix is NOT open', !isLockOpenPath('/api/authorizations') && !isLockOpenPath('/api/billings') && !isLockOpenPath('/api/contacts'))
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
