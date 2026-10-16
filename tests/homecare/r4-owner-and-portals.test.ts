// Run 4 home care blockers 1–3 (10/16): the sign-up login is the agency's OWNER, and a cancelled agency's portals pause.
//
//   1. "After a Factory 'Cancel now', the OWNER signs in and gets … 'Only the account owner can restart the
//      subscription.' There is no Restart button."
//   2. "Plan & Billing is read-only for the owner … and has no link to that portal."
//   3. "The family portal ignores the lock. After the cancel, the family member's schedule, medications and messages
//      calls still returned 200 and rendered."
//
// The cause of 1 and 2, read: the shared billing router asks home care's canManage (routes/billing.ts:
// `role === 'owner'`), and home care's seed (db/seed.template.ts) created the sign-up login as role 'admin' — so the
// agency had no owner at all. The Run 3 lock test seeded an 'owner' by hand and never saw it. Here the owner is made
// by the seed's own rule (db/signupOwner.ts), and the billing doors are asked of that login.
// The cause of 3: familyAuth and portalAuth sign their people in on their own paths and never reached the staff lock.
// The Factory is answered here (fetch stubbed); nothing leaves the machine.
process.env.FACTORY_URL = 'https://factory.hc-r4-test.local'
process.env.FACTORY_SYNC_KEY = 'hc-r4-test-key'
process.env.TENANT_ID = 'tenant-hc-r4-test'
process.env.JWT_SECRET = process.env.JWT_SECRET || 'hc-r4-test-secret'
import { Hono } from 'hono'
import { readFileSync } from 'node:fs'
import jwt from 'jsonwebtoken'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}

let factorySays: any = null
const sub = (o: Record<string, unknown>) => ({ plan: 'starter10', planName: 'Starter', product: 'crm', monthlyAmount: 99, billingCycle: 'monthly', billingType: 'subscription', status: 'active', billingStatus: 'active', nextBillingDate: null, trialEndsAt: null, seats: 10, hasStripeCustomer: true, syncedAt: new Date().toISOString(), ...o })
const factoryCalls: string[] = []
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(input?.url ?? input)
  if (!url.startsWith(process.env.FACTORY_URL!)) return realFetch(input, init)
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } })
  factoryCalls.push(url)
  if (url.endsWith('/subscription')) return json(factorySays)
  if (url.endsWith('/restart-checkout')) return json({ url: 'https://checkout.stripe.test/c/hc-r4' })
  if (url.endsWith('/billing-portal-link')) return json({ url: 'https://billing.stripe.test/p/hc-r4' })
  return json({})
}) as any

const ROOT = process.env.FACTORY_ROOT || '../../'
const { setupSchema } = await import('./setup.ts')
await setupSchema()
const { db } = await import('./db/index.ts')
const { agencies, users, clients, familyMembers } = await import('./db/schema.ts')
const { eq } = await import('drizzle-orm')
const { ensureSignupOwner } = await import('./db/signupOwner.ts')
const [ag] = await db.insert(agencies).values({ name: 'R4 Care', slug: 'r4-care', state: 'WI', settings: {} } as any).returning()

// ══ 1. the seed's rule: the sign-up login is the owner ═════════════════════════════════════════════════════════════
const signup = { email: 'owner@r4care.test', passwordHash: 'hash-from-signup', firstName: 'Olive', lastName: 'Owner' }
let owner: any
{
  const r = await ensureSignupOwner(db, users, signup)
  owner = r.user
  check(`a new agency's sign-up login is created as the OWNER (${r.result}, ${r.user?.role})`, r.result === 'created' && r.user?.role === 'owner' && r.user?.isActive === true, r)
  const again = await ensureSignupOwner(db, users, { ...signup, passwordHash: 'a-different-hash' })
  const [row] = await db.select().from(users).where(eq(users.id, owner.id))
  check('every boot after: kept, and the password the owner set is never overwritten', again.result === 'kept' && row.passwordHash === 'hash-from-signup' && row.role === 'owner', { again: again.result, row: row.passwordHash })
}
{
  // An agency seeded before this fix: its sign-up login is an 'admin' and it has no owner.
  const [legacy] = await db.insert(users).values({ email: 'legacy@old.test', passwordHash: 'old-hash', firstName: 'L', lastName: 'A', role: 'admin', isActive: true } as any).returning()
  await db.update(users).set({ role: 'admin' }).where(eq(users.id, owner.id)) // no owner in this database now
  const r = await ensureSignupOwner(db, users, { email: 'legacy@old.test', passwordHash: 'x', firstName: 'L', lastName: 'A' })
  const [row] = await db.select().from(users).where(eq(users.id, legacy.id))
  check(`an existing agency with NO owner: its sign-up login (an admin) is made the owner on the next boot (${r.result})`, r.result === 'promoted' && row.role === 'owner' && row.passwordHash === 'old-hash', row)
  // Put the world back: one owner (the sign-up login above), the legacy login an ordinary admin.
  await db.update(users).set({ role: 'admin' }).where(eq(users.id, legacy.id))
  await db.update(users).set({ role: 'owner' }).where(eq(users.id, owner.id))
  const kept = await ensureSignupOwner(db, users, { email: 'legacy@old.test', passwordHash: 'x', firstName: 'L', lastName: 'A' })
  check('an agency that already has an owner: an admin sign-up login is left an admin', kept.result === 'kept' && kept.user.role === 'admin')
  const [cgLogin] = await db.insert(users).values({ email: 'was-signup@old.test', passwordHash: 'h', firstName: 'C', lastName: 'G', role: 'caregiver', isActive: true } as any).returning()
  await db.update(users).set({ role: 'admin' }).where(eq(users.id, owner.id))
  const cgR = await ensureSignupOwner(db, users, { email: 'was-signup@old.test', passwordHash: 'x', firstName: 'C', lastName: 'G' })
  check('a sign-up login someone has since made a caregiver is never promoted', cgR.result === 'kept' && cgR.user.role === 'caregiver', cgR)
  await db.update(users).set({ role: 'owner' }).where(eq(users.id, owner.id))
  void cgLogin
}
{
  const seed = readFileSync(ROOT + 'templates/crm-homecare/backend/db/seed.template.ts', 'utf8')
  check('db/seed.ts (the generated seed) makes the sign-up login through that rule, and creates no admin of its own', /ensureSignupOwner\(db, users, \{\s*email: '\{\{ADMIN_EMAIL\}\}'/.test(seed) && !/role: 'admin'/.test(seed))
}

const mk = async (role: string, tag: string) => (await db.insert(users).values({
  email: `${tag}-hcr4@test.local`, passwordHash: 'x', firstName: tag, lastName: 'U', role, isActive: true,
} as any).returning())[0]
const admin = await mk('admin', 'admin'), cg = await mk('caregiver', 'carol')

const app = new Hono()
app.route('/api/billing', (await import('./src/routes/billing.ts')).default)
app.route('/api/users', (await import('./src/routes/caregivers.ts')).default)
app.route('/api/family-portal', (await import('./src/routes/familyPortal.ts')).default)
app.route('/api/portal', (await import('./src/routes/portal.ts')).default)
app.route('/api/portal', (await import('./src/routes/portalVisits.ts')).default)
const shared = await import('./src/shared/index.ts')
app.route('/api/internal/sync-subscription', shared.createSubscriptionSyncRoute({ db, companyTable: agencies, userTable: users, factoryApiClient: shared.createFactoryApiClient() } as any))

const call = async (headers: Record<string, string>, method: string, path: string, body?: unknown) => {
  const res = await app.request(path, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}
const as = (u: any) => (m: string, p: string, b?: unknown) => call({ 'x-test-user': u.id, 'x-test-role': u.role, 'x-test-company': ag.id }, m, p, b)
const bearer = (t: string) => (m: string, p: string, b?: unknown) => call({ authorization: `Bearer ${t}` }, m, p, b)
const push = async (s: any) => {
  factorySays = s
  const res = await app.request('/api/internal/sync-subscription', { method: 'POST', headers: { 'content-type': 'application/json', 'X-Factory-Key': 'hc-r4-test-key' }, body: JSON.stringify({ subscription: s }) })
  return res.status
}

// ══ 1–2. the billing doors, asked of the seeded owner ═════════════════════════════════════════════════════════════
{
  await push(sub({}))
  const o = await as(owner)('GET', '/api/billing/subscription')
  check(`Plan & Billing: the sign-up owner may manage (mayManage true) (${o.status})`, o.status === 200 && o.json?.mayManage === true, o.json)
  const link = await as(owner)('POST', '/api/billing/portal-link')
  check(`…and gets the billing-portal link — change plan, card, cancel (${link.status})`, link.status === 200 && link.json?.url === 'https://billing.stripe.test/p/hc-r4' && factoryCalls.some((u) => u.endsWith('/customers/tenant-hc-r4-test/billing-portal-link')), link.json)
  const a = await as(admin)('GET', '/api/billing/subscription'), al = await as(admin)('POST', '/api/billing/portal-link')
  check(`an office admin READS the plan (${a.status}) but may not manage it (mayManage false; portal-link ${al.status} owner_only)`, a.status === 200 && a.json?.mayManage === false && al.status === 403 && al.json?.code === 'owner_only', { a: a.json?.mayManage, al: al.json })
  const c = await as(cg)('GET', '/api/billing/subscription'), cl = await as(cg)('POST', '/api/billing/portal-link')
  check(`a caregiver is refused billing altogether (${c.status}, ${cl.status})`, c.status === 403 && cl.status === 403)
}
{
  check("the Factory's Cancel now lands", (await push(sub({ status: 'canceled', billingStatus: 'canceled' }))) === 200)
  const m = await as(owner)('GET', '/api/billing/subscription')
  check(`locked: the lock page asks — the owner may restart (mayManage true) (${m.status})`, m.status === 200 && m.json?.mayManage === true, m.json)
  const r = await as(owner)('POST', '/api/billing/restart-checkout')
  check(`locked: the owner's Restart opens a checkout (${r.status})`, r.status === 200 && r.json?.url === 'https://checkout.stripe.test/c/hc-r4', r.json)
  const ar = await as(admin)('POST', '/api/billing/restart-checkout'), am = await as(admin)('GET', '/api/billing/subscription')
  check(`locked: an admin is told to ask the owner (mayManage false; restart ${ar.status} owner_only)`, am.json?.mayManage === false && ar.status === 403 && ar.json?.code === 'owner_only', { am: am.json?.mayManage, ar: ar.json })
  const cr = await as(cg)('POST', '/api/billing/restart-checkout')
  check(`locked: a caregiver is refused the restart (${cr.status})`, cr.status === 403)
  await push(sub({}))
}
{
  // The screen: PaywallScreen shows Restart exactly when GET /api/billing/subscription says mayManage (read, not rendered:
  // there is no React renderer in this repo's tests). BillingPage offers the portal on the same answer.
  const paywall = readFileSync(ROOT + 'packages/tenant-ui/src/auth/PaywallScreen.tsx', 'utf8')
  check("the lock page's Restart follows /api/billing/subscription's mayManage — the answer proven above", /request\('GET', '\/api\/billing\/subscription'\)\.then\(\(r\) => setMayManage\(!!r\?\.mayManage\)/.test(paywall) && /\{mayManage === true && \(/.test(paywall) && /request\('POST', '\/api\/billing\/restart-checkout'\)/.test(paywall))
  const billing = readFileSync(ROOT + 'packages/tenant-ui/src/settings/BillingPage.tsx', 'utf8')
  check('Plan & Billing offers the portal on the same mayManage', /const mayManage = data\?\.mayManage === true/.test(billing))
  const route = readFileSync(ROOT + 'templates/crm-homecare/backend/src/routes/billing.ts', 'utf8')
  check("home care's canManage is the owner's role — the role the seed now gives the sign-up login", /canManage: \(c: any\) => \(c\.get\('user'\) as any\)\?\.role === 'owner'/.test(route))
}

// ══ the owner's login is the owner's ══════════════════════════════════════════════════════════════════════════════
{
  const rp = await as(admin)('PUT', `/api/users/${owner.id}/reset-password`, { password: 'takeover-123' })
  const ta = await as(admin)('PATCH', `/api/users/${owner.id}/toggle-active`)
  const ca = await as(admin)('POST', '/api/users/convert-to-admin', { userId: owner.id })
  const pu = await as(admin)('PUT', `/api/users/${owner.id}`, { password: 'takeover-123', firstName: 'Mallory' })
  const [row] = await db.select().from(users).where(eq(users.id, owner.id))
  check(`an admin cannot reset, deactivate, demote or rewrite the owner's login (${rp.status}, ${ta.status}, ${ca.status}, ${pu.status})`, [rp, ta, ca, pu].every((r) => r.status === 403 && r.json?.code === 'owner_only') && row.role === 'owner' && row.isActive === true && row.passwordHash === 'hash-from-signup' && row.firstName === 'Olive', { rp: rp.json, row: { role: row.role, active: row.isActive } })
  const self = await as(admin)('PUT', `/api/users/${admin.id}`, { role: 'owner', firstName: 'Ada' })
  const [me] = await db.select().from(users).where(eq(users.id, admin.id))
  check(`an admin cannot make themselves owner through the edit form (${self.status}; role stays ${me.role})`, me.role === 'admin' && me.firstName === 'Ada', me)
  const own = await as(owner)('PUT', `/api/users/${admin.id}/reset-password`, { password: 'new-pass-123' })
  check(`the owner still manages every other login (${own.status})`, own.status === 200)
  const cgOk = await as(admin)('PUT', `/api/users/${cg.id}/reset-password`, { password: 'new-pass-123' })
  check(`…and an admin still manages a caregiver's (${cgOk.status})`, cgOk.status === 200)
}

// ══ 3. the portals pause with the agency ══════════════════════════════════════════════════════════════════════════
const [pat] = await db.insert(clients).values({ firstName: 'Pat', lastName: 'Example', email: 'pat@r4.test', isActive: true, portalEnabled: true, portalToken: 'r4-link-token' } as any).returning()
const pw = await Bun.password.hash('famPass123', 'bcrypt')
await db.insert(familyMembers).values({ clientId: pat.id, name: 'Fran Family', email: 'fran@r4.test', passwordHash: pw, canViewSchedule: true, canViewCarePlan: true, canViewMedications: true, canMessage: true } as any)
const famLogin = await call({}, 'POST', '/api/family-portal/login', { email: 'fran@r4.test', password: 'famPass123' })
const fam = bearer(famLogin.json?.token)
const clientTok = jwt.sign({ role: 'client', clientId: pat.id }, process.env.JWT_SECRET!, { expiresIn: '1h' })
const cli = bearer(clientTok)
const link = (m: string, p: string) => call({ 'x-portal-token': 'r4-link-token' }, m, p)
const FAMILY = ['/api/family-portal/portal/me', '/api/family-portal/portal/client', '/api/family-portal/portal/schedule', '/api/family-portal/portal/medications', '/api/family-portal/portal/messages', '/api/family-portal/portal/care-plan', '/api/family-portal/portal/caregivers', '/api/family-portal/portal/vitals', '/api/family-portal/portal/notes']
const CLIENT = ['/api/portal/me', '/api/portal/history', '/api/portal/invoices', '/api/portal/care-plan', '/api/portal/messages', '/api/portal/notifications', '/api/portal/documents', '/api/portal/caregivers', '/api/portal/visits', '/api/portal/change-requests']
{
  check(`open: the family member signs in (${famLogin.status})`, famLogin.status === 200 && !!famLogin.json?.token)
  const f = await Promise.all(FAMILY.map((p) => fam('GET', p)))
  check('open: every family portal read answers (no lock)', f.every((r) => r.status !== 402 && r.status < 500), f.map((r, i) => `${FAMILY[i]} ${r.status}`))
  const c = await Promise.all(CLIENT.map((p) => cli('GET', p)))
  check('open: every client portal read answers (no lock)', c.every((r) => r.status !== 402 && r.status < 500), c.map((r, i) => `${CLIENT[i]} ${r.status}`))
}
{
  await push(sub({ status: 'canceled', billingStatus: 'canceled' }))
  const f = await Promise.all(FAMILY.map((p) => fam('GET', p)))
  check('locked: every family portal read is refused 402 ACCOUNT_LOCKED (schedule, medications, messages…)', f.every((r) => r.status === 402 && r.json?.code === 'ACCOUNT_LOCKED'), f.map((r, i) => `${FAMILY[i]} ${r.status}`))
  check("locked: …in a family's words — the agency is paused, not 'your subscription'", /agency's account is paused/.test(f[0].json?.error || '') && !/subscribe|owner/i.test(f[0].json?.error || ''), f[0].json)
  const send = await fam('POST', '/api/family-portal/portal/messages', { message: 'hello?' })
  check(`locked: a family message is refused too (${send.status})`, send.status === 402)
  const relog = await call({}, 'POST', '/api/family-portal/login', { email: 'fran@r4.test', password: 'famPass123' })
  check(`locked: signing in still answers, so the screen can say why (${relog.status})`, relog.status === 200)
  const c = await Promise.all(CLIENT.map((p) => cli('GET', p)))
  check('locked: the client portal has the same gap closed — every read 402 ACCOUNT_LOCKED', c.every((r) => r.status === 402 && r.json?.code === 'ACCOUNT_LOCKED'), c.map((r, i) => `${CLIENT[i]} ${r.status}`))
  const viaLink = await link('GET', '/api/portal/me')
  check(`locked: …including a client who opens the emailed link (x-portal-token) (${viaLink.status})`, viaLink.status === 402)
  const preview = jwt.sign({ role: 'client', clientId: pat.id, impersonation: true }, process.env.JWT_SECRET!, { expiresIn: '1h' })
  check('locked: …and the office\'s portal preview', (await bearer(preview)('GET', '/api/portal/me')).status === 402)
  const wrong = await bearer('not-a-token')('GET', '/api/family-portal/portal/schedule')
  check(`a bad token is still refused as a bad token, not told the agency is locked (${wrong.status})`, wrong.status === 401)
}
{
  await push(sub({}))
  const f = await fam('GET', '/api/family-portal/portal/schedule'), c = await cli('GET', '/api/portal/me')
  check(`unlocked: both portals open on the very next request (${f.status}, ${c.status})`, f.status === 200 && c.status === 200)
}

console.log(`\nhomecare-r4-owner-and-portals: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
