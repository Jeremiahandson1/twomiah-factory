// A cancelled home care agency is LOCKED — by the server, for every role, the moment the Factory says so. (Run 3, 10/16)
//
//   Tester: "In the Factory, Cancel now set Payment Status to Canceled and said 'Ended. The CRM is locked.' About 12
//   minutes later a brand-new owner sign-in showed the full CRM with real data and no lock or Restart screen."
//
// The 10/14 lock (shared auth/accountLock.ts) was built for ten CRMs; home care was parked and left out. Its backend had
// no /api/internal/sync-subscription, so the Factory's push answered 404, and its authenticate never asked. Now:
//   - the push lands and marks the agency; authenticate refuses every door but sign-in and the subscription's own three
//     doors with 402 ACCOUNT_LOCKED — including /api/billing's CLIENT INVOICING, which a prefix-wide door had kept open;
//   - sign-in and /me tell every role (company.settings.accountLock), so the screen shows the lock page;
//   - the owner restarts by paying (POST /api/billing/restart-checkout); an admin or caregiver is refused;
//   - a new subscription unlocks it on the next request.
// The Factory is answered here (fetch stubbed); nothing leaves the machine.
process.env.FACTORY_URL = 'https://factory.hc-lock-test.local'
process.env.FACTORY_SYNC_KEY = 'hc-lock-test-key'
process.env.TENANT_ID = 'tenant-hc-lock-test'
import { Hono } from 'hono'
import { readFileSync } from 'node:fs'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}

let factorySays: any = null
const sub = (o: Record<string, unknown>) => ({ plan: 'starter10', planName: 'Starter', product: 'crm', monthlyAmount: 99, billingCycle: 'monthly', billingType: 'subscription', status: 'active', billingStatus: 'active', nextBillingDate: null, trialEndsAt: null, seats: 10, hasStripeCustomer: true, syncedAt: new Date().toISOString(), ...o })
const restartCalls: string[] = []
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(input?.url ?? input)
  if (!url.startsWith(process.env.FACTORY_URL!)) return realFetch(input, init)
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } })
  if (url.endsWith('/subscription')) return json(factorySays)
  if (url.endsWith('/restart-checkout')) { restartCalls.push(url); return json({ url: 'https://checkout.stripe.test/c/hc-restart' }) }
  return json({})
}) as any

const { setupSchema } = await import('./setup.ts')
await setupSchema()
const { db } = await import('./db/index.ts')
const { agencies, users, clients } = await import('./db/schema.ts')
const { count } = await import('drizzle-orm')
const [ag] = await db.insert(agencies).values({ name: 'Lock Care', slug: 'lock-care', state: 'WI', settings: {} } as any).returning()
const mk = async (role: string, tag: string) => (await db.insert(users).values({
  email: `${tag}-hclock@test.local`, passwordHash: 'x', firstName: tag, lastName: 'U', role, isActive: true,
} as any).returning())[0]
const owner = await mk('owner', 'owner'), admin = await mk('admin', 'admin'), cg = await mk('caregiver', 'carol')
await db.insert(clients).values({ firstName: 'Pat', lastName: 'Example' } as any)

const app = new Hono()
app.route('/api/auth', (await import('./src/routes/auth.ts')).default)
app.route('/api/clients', (await import('./src/routes/clients.ts')).default)
app.route('/api/billing', (await import('./src/routes/billing.ts')).default)
const shared = await import('./src/shared/index.ts')
// Mounted exactly as src/index.ts mounts it (asserted from the source below).
app.route('/api/internal/sync-subscription', shared.createSubscriptionSyncRoute({ db, companyTable: agencies, userTable: users, factoryApiClient: shared.createFactoryApiClient() } as any))

const call = async (who: any, method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json', 'x-test-user': who.id, 'x-test-role': who.role, 'x-test-company': ag.id },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}
const push = async (s: any, key = 'hc-lock-test-key') => {
  factorySays = s
  const res = await app.request('/api/internal/sync-subscription', { method: 'POST', headers: { 'content-type': 'application/json', 'X-Factory-Key': key }, body: JSON.stringify({ subscription: s }) })
  return res.status
}
const clientCount = async () => Number((await db.select({ n: count() }).from(clients))[0].n)

// ── the wiring the suite cannot mount: src/index.ts and the real authenticate
{
  const root = process.env.FACTORY_ROOT || '../../'
  const index = readFileSync(root + 'templates/crm-homecare/backend/src/index.ts', 'utf8')
  check('index.ts mounts the Factory\'s push at /api/internal/sync-subscription (it answered 404)', /app\.route\('\/api\/internal\/sync-subscription', createSubscriptionSyncRoute\(subscriptionDeps\)\)/.test(index))
  check('…with the agencies row as the company', /const subscriptionDeps = \{ db, companyTable: agencies, userTable: users,/.test(index))
  check('…and pulls the summary at boot, so a push missed while asleep still locks', /refreshSubscriptionFromFactory\(subscriptionDeps\)/.test(index))
  const auth = readFileSync(root + 'templates/crm-homecare/backend/src/middleware/auth.ts', 'utf8').replace(/\r\n/g, '\n')
  check('the real authenticate asks the lock and RETURNS its refusal before next()', /const locked = await refuseWhileLocked\(c, db, agencies\)\n\s*if \(locked\) return locked\n\s*await next\(\)/.test(auth))

  // ── the screen: ONE lock page, on the server's answer, for every role
  const fe = root + 'templates/crm-homecare/frontend/src/'
  const appTsx = readFileSync(fe + 'App.tsx', 'utf8')
  check('App.tsx mounts the lock page where the Factory\'s restart checkout returns (/crm/paywall)', /<Route path="\/crm\/paywall"\s+element=\{<AuthProvider><PaywallPage \/><\/AuthProvider>\} \/>/.test(appTsx))
  check('…and both doors into the CRM (ProtectedRoute and MainApp) send a locked agency there', (appTsx.match(/if \(isAccountLocked\(company\)\) return <Navigate to=\{LOCK_PAGE\} replace \/>;/g) || []).length === 2)
  const page = readFileSync(fe + 'pages/PaywallPage.tsx', 'utf8')
  check('the lock page is the shared PaywallScreen, given the API client (the owner restarts by paying)', /<PaywallScreen\b[^>]*homePath="\/"[^>]*request=\{/.test(page))
  check('…and an agency that is not locked is sent from the lock page back into the CRM', /if \(!isAccountLocked\(company\)\) return <Navigate to="\/" replace \/>;/.test(page))
  const dash = readFileSync(fe + 'components/AdminDashboard.tsx', 'utf8')
  check('the admin dashboard no longer keeps a second, trial-only lock of its own', !/import PaywallPage|<PaywallPage|isTrialExpired\(/.test(dash))
  const banner = readFileSync(fe + 'components/trial/TrialBanner.tsx', 'utf8')
  check('the trial banner reads the shared trial date — no "createdAt + 30 days" guess on a paid agency', /trialEndDate\(/.test(banner) && !/company\.createdAt/.test(banner))
  const ctx = readFileSync(fe + 'contexts/AuthContext.tsx', 'utf8')
  check('a locked agency\'s 402 on /api/company becomes the lock page, not a sign-out', /err\?\.status === 402 && err\?\.data\?\.code === 'ACCOUNT_LOCKED'/.test(ctx) && /if \(summary\?\.settings\?\.accountLock\) return summary;/.test(ctx))
}

{
  check('a push with the wrong key is refused', (await push(sub({}), 'wrong')) === 401)
  check('open: a paying agency reads its clients', (await push(sub({}))) === 200 && (await call(owner, 'GET', '/api/clients')).status === 200)
}
{
  // The Factory's cancel-now: billing_status canceled, status suspended → summary status 'canceled'.
  check('the Factory\'s push lands', (await push(sub({ status: 'canceled', billingStatus: 'canceled' }))) === 200)
  const r = await call(owner, 'GET', '/api/clients')
  check(`locked: the owner's very next read is refused — 402 ACCOUNT_LOCKED, subscription_ended (${r.status})`, r.status === 402 && r.json?.code === 'ACCOUNT_LOCKED' && r.json?.lock === 'subscription_ended', r.json)
  check('locked: …in words, not "Request failed"', /subscription has ended/.test(r.json?.error || ''), r.json)
  const before = await clientCount()
  const w = await call(admin, 'POST', '/api/clients', { firstName: 'After', lastName: 'Cancel' })
  check(`locked: a write is refused and nothing is written (${w.status})`, w.status === 402 && (await clientCount()) === before, w.json)
  const c = await call(cg, 'GET', '/api/clients')
  check('locked: for every role — a caregiver is refused the same', c.status === 402 && c.json?.code === 'ACCOUNT_LOCKED', c.json)
  const inv = await call(owner, 'GET', '/api/billing/invoices')
  check(`locked: home care's CLIENT invoicing under /api/billing is locked too — only the subscription doors stay open (${inv.status})`, inv.status === 402 && inv.json?.code === 'ACCOUNT_LOCKED', inv.json)
  const pay = await call(owner, 'POST', '/api/billing/invoice-payments', { invoiceId: 'x', amount: 1 })
  check(`locked: …and recording a payment (${pay.status})`, pay.status === 402, pay.json)
}
{
  const o = await call(owner, 'GET', '/api/auth/me'), c = await call(cg, 'GET', '/api/auth/me')
  check(`locked: signing in still works — /me answers (${o.status}, ${c.status})`, o.status === 200 && c.status === 200)
  check('locked: the owner is told the agency is locked', o.json?.company?.settings?.accountLock === 'subscription_ended', o.json?.company)
  check('locked: …and so is the caregiver, who is sent nothing else from settings', c.json?.company?.settings?.accountLock === 'subscription_ended' && Object.keys(c.json?.company?.settings || {}).every((k) => k === 'accountLock' || k === 'account_lock'), c.json?.company?.settings)
  const b = await call(owner, 'GET', '/api/billing/subscription')
  check(`locked: the subscription door stays open — the way back (${b.status})`, b.status === 200 && b.json?.subscription?.status === 'canceled', b.json)
  check('…and counts the agency\'s seats from users, which has no company column', b.json?.seatsUsed === 3, b.json)
}
{
  const o = await call(owner, 'POST', '/api/billing/restart-checkout')
  check(`restart: while locked, the OWNER gets a checkout to pay and come back (${o.status})`, o.status === 200 && o.json?.url === 'https://checkout.stripe.test/c/hc-restart' && restartCalls.length === 1, o.json)
  check('restart: …asked of the Factory for THIS tenant', /\/customers\/tenant-hc-lock-test\/restart-checkout$/.test(restartCalls[0] || ''), restartCalls)
  const before = restartCalls.length
  const a = await call(admin, 'POST', '/api/billing/restart-checkout'), c = await call(cg, 'POST', '/api/billing/restart-checkout')
  check(`restart: an admin is refused (owner_only) and a caregiver never reaches billing (${a.status}, ${c.status})`, a.status === 403 && a.json?.code === 'owner_only' && c.status === 403 && restartCalls.length === before, { a: a.json, c: c.json })
  const ms = await call(owner, 'GET', '/api/billing/subscription'), ma = await call(admin, 'GET', '/api/billing/subscription')
  check('restart: the lock page is told who may press Restart — the owner yes, an admin no', ms.json?.mayManage === true && ma.json?.mayManage === false, { owner: ms.json?.mayManage, admin: ma.json?.mayManage })
}
{
  check('the Factory says they subscribed again', (await push(sub({}))) === 200)
  const r = await call(owner, 'GET', '/api/clients'), c = await call(cg, 'GET', '/api/clients')
  check(`unlocked: on the very next request, for everyone (${r.status}, ${c.status})`, r.status === 200 && c.status === 200)
  const me = await call(cg, 'GET', '/api/auth/me')
  check('unlocked: nobody is told it is locked', me.json?.company?.settings?.accountLock === null, me.json?.company?.settings)
  check('unlocked: client invoicing answers again', (await call(owner, 'GET', '/api/billing/invoices')).status === 200)
}
{
  await push(sub({ status: 'trialing', billingStatus: null, trialEndsAt: new Date(Date.now() - 60_000).toISOString() }))
  const t = await call(cg, 'GET', '/api/clients')
  check(`a trial whose date has passed is locked — trial_ended (${t.status})`, t.status === 402 && t.json?.lock === 'trial_ended', t.json)
  await push(sub({ status: 'past_due', billingStatus: 'past_due' }))
  check('past_due is open — Stripe is still retrying the card', (await call(owner, 'GET', '/api/clients')).status === 200)
}

console.log(`\nhomecare-account-lock: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
