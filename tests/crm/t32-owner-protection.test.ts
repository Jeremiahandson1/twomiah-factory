// T32 B6 — an admin demoted the owner, and nothing could put the owner back.
//
// PUT /api/company/users/:id accepted role 'admin' for the owner's own row: the enum allows it, and
// the last-administrator guard was satisfied by the admin doing the demoting. 'owner' is not an
// assignable role, so no API call by anyone could restore it. ctrtest was left with no owner and
// needed the Factory's bootstrap endpoint to recover.
//
// Four things are asserted here, and the fourth was not in the report — I found it while fixing the
// third: DELETE had the same hole, and worse, because deleting the owner leaves nothing to promote.
import { Hono } from 'hono'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}

const { setupSchema } = await import('./setup.ts')
await setupSchema()
const { db } = await import('./db/index.ts')
const { company, user } = await import('./db/schema.ts')

const [co] = await db.insert(company).values({
  name: 'Owner Guard', slug: 'owner-guard', email: 'og@test.local', state: 'OH', settings: {},
  enabledFeatures: ['team'],
} as any).returning()
const mk = async (role: string, tag: string) => (await db.insert(user).values({
  email: `${tag}-og@test.local`, passwordHash: 'x', firstName: tag, lastName: 'U', role, companyId: co.id, isActive: true,
} as any).returning())[0]
const owner = await mk('owner', 'owner')
const admin = await mk('admin', 'admin')
const manager = await mk('manager', 'manager')

const app = new Hono()
app.route('/api/company', (await import('./src/routes/company.ts')).default)
app.onError((await import('./src/utils/errors.ts')).errorHandler)
const as = (who: any) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method, headers: { 'content-type': 'application/json', 'x-test-user': who.id },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}
const asOwner = as(owner), asAdmin = as(admin), asManager = as(manager)
const roleOf = async (id: string) => (await db.select().from(user).where((await import('drizzle-orm')).eq(user.id, id)).limit(1))[0]?.role

// ══════════ 1. an admin cannot touch the owner's row ════════════════════════════════════════════
{
  const r = await asAdmin('PUT', `/api/company/users/${owner.id}`, { role: 'admin' })
  check('an admin cannot demote the owner', r.status === 403, r)
  check('…and the owner is still the owner', (await roleOf(owner.id)) === 'owner', await roleOf(owner.id))

  const d = await asAdmin('PUT', `/api/company/users/${owner.id}`, { isActive: false })
  check('an admin cannot deactivate the owner either', d.status === 403, d)

  const del = await asAdmin('DELETE', `/api/company/users/${owner.id}`)
  check('an admin cannot DELETE the owner (not in the report — found while fixing it)', del.status === 403, del)
  check('…and the owner row is still there', !!(await roleOf(owner.id)), null)
}

// ══════════ 2. not even the owner can drop the role ═════════════════════════════════════════════
{
  const r = await asOwner('PUT', `/api/company/users/${owner.id}`, { role: 'admin' })
  check('the owner cannot demote themselves — a company with no owner is unrecoverable', r.status === 400, r)
  check('…and the refusal names the way out', /transfer/i.test(JSON.stringify(r.json)), r.json)
  check('…and the role did not change', (await roleOf(owner.id)) === 'owner', await roleOf(owner.id))
}

// ══════════ 3. ownership MOVES, and only the owner can move it ══════════════════════════════════
{
  const nope = await asAdmin('POST', '/api/company/transfer-ownership', { userId: admin.id })
  check('an admin cannot take the company', nope.status === 403, nope)

  const bad = await asOwner('POST', '/api/company/transfer-ownership', {})
  check('a transfer with no user named is refused', bad.status === 400, bad)

  const self = await asOwner('POST', '/api/company/transfer-ownership', { userId: owner.id })
  check('transferring to yourself is refused', self.status === 400, self)

  const ok = await asOwner('POST', '/api/company/transfer-ownership', { userId: manager.id })
  check('the owner can hand the company to somebody else', ok.status === 200, ok)
  check('…the named user is now the owner', (await roleOf(manager.id)) === 'owner', await roleOf(manager.id))
  check('…and the previous owner is now an admin, not nothing', (await roleOf(owner.id)) === 'admin', await roleOf(owner.id))

  // Exactly one owner, always — the whole point of moving rather than granting.
  const all = await db.select().from(user)
  check('…so the company has exactly one owner', all.filter((u: any) => u.role === 'owner').length === 1,
    all.map((u: any) => `${u.email}=${u.role}`))

  // And the new owner can hand it back, which proves the door is not one-way.
  const back = await as(manager)('POST', '/api/company/transfer-ownership', { userId: owner.id })
  check('the new owner can hand it back', back.status === 200, back)
  check('…and ownership is where it started', (await roleOf(owner.id)) === 'owner', await roleOf(owner.id))
}

// ══════════ 4. an admin can see the list it is allowed to change ════════════════════════════════
{
  const list = await asAdmin('GET', '/api/company/users')
  check('an admin can list users, because it can already create and delete them', list.status === 200, list)
  // A FRESH manager: the one above was handed the company and handed it back in step 3, so it is an
  // admin by now. Reusing it here had this assertion failing on my own test's side effect.
  const plainManager = await mk('manager', 'mgr2')
  const mgr = await as(plainManager)('GET', '/api/company/users')
  /**
   * SUPERSEDED BY T41, and narrowed rather than reversed.
   *
   * This asserted 403 — "an admin can list users, because it can already create and delete them",
   * so listing was tied to the power to change. That principle still holds for the ADMINISTRATION
   * list, and the block at the bottom of this file re-checks it: email, lastLogin and
   * extraPermissions are still behind users:read, and create/update/delete are still requireAdmin.
   *
   * What it could not survive is that this same endpoint is every assignment picker. T41 reported
   * Landscaping's manager Dispatch Board as permanently empty — "/api/company/users 403s for the
   * manager and the board shows '0 Total Jobs' with no assign list" — plus the same background 403
   * emptying rep filters on Roofing, Events, Showcase and RV. The refusal was the bug.
   *
   * So a manager now gets a roster of names and roles and nothing else. The assertion changes from
   * "is refused" to "is given the narrow thing", which is the distinction the old rule lacked.
   */
  check('…and a manager gets the ROSTER rather than the administration list', mgr.status === 200,
    { status: mgr.status, body: JSON.stringify(mgr.json)?.slice(0, 120) })
  check('…without the fields only an administrator needs',
    Array.isArray(mgr.json) && mgr.json.every((u: any) => !('email' in u) && !('extraPermissions' in u)),
    Array.isArray(mgr.json) ? Object.keys(mgr.json[0] || {}) : mgr.json)
}

// ══════════ 5. a company that has ALREADY lost its owner can be recovered ═══════════════════════
{
  /**
   * The guards above stop a company losing its owner. They do nothing for one that already has —
   * and ctrtest had, during the very round that found B6. The report's closing line: "twomiah14
   * @gmail.com is currently role admin, not owner. It cannot be restored through the app; it needs a
   * direct database update."
   *
   * A product whose recovery path is "somebody with database access fixes it by hand" has not
   * recovered from the fault; it has moved it off the product and onto a person. So when a company
   * has NO owner, an admin may claim it — there is no owner to protect, and the only people who can
   * reach the endpoint already hold requireAdmin.
   *
   * A separate company, because the one above has an owner and the whole point here is a company
   * that does not.
   */
  const [orphan] = await db.insert(company).values({
    name: 'Ownerless', slug: 'ownerless', email: 'orphan@test.local', state: 'OH', settings: {},
    enabledFeatures: ['team'],
  } as any).returning()
  const mkIn = async (role: string, tag: string) => (await db.insert(user).values({
    email: `${tag}-orphan@test.local`, passwordHash: 'x', firstName: tag, lastName: 'U',
    role, companyId: orphan.id, isActive: true,
  } as any).returning())[0]
  const strandedAdmin = await mkIn('admin', 'admin')
  const strandedMgr = await mkIn('manager', 'mgr')
  const colleague = await mkIn('admin', 'admin2')

  const owners = async () => (await db.select().from(user)).filter((u: any) => u.companyId === orphan.id && u.role === 'owner')
  check('the company genuinely has no owner', (await owners()).length === 0, await owners())

  const nope = await as(strandedMgr)('POST', '/api/company/transfer-ownership', { userId: strandedMgr.id })
  check('a MANAGER cannot claim an ownerless company — requireAdmin still applies', nope.status === 403, nope)
  check('…and it is still ownerless', (await owners()).length === 0, await owners())

  const claim = await as(strandedAdmin)('POST', '/api/company/transfer-ownership', { userId: strandedAdmin.id })
  check('an ADMIN can claim an ownerless company, for themselves', claim.status === 200, claim)
  check('…and is now the owner', (await roleOf(strandedAdmin.id)) === 'owner', await roleOf(strandedAdmin.id))
  check('…exactly one of them', (await owners()).length === 1, (await owners()).map((u: any) => u.email))

  // And once there IS an owner, the carve-out closes again — this is the part that would otherwise
  // be a permanent hole rather than a recovery.
  const grab = await as(colleague)('POST', '/api/company/transfer-ownership', { userId: colleague.id })
  check('a second admin cannot then take it off them', grab.status === 403, grab)
  check('…ownership did not move', (await roleOf(strandedAdmin.id)) === 'owner' && (await roleOf(colleague.id)) === 'admin',
    { first: await roleOf(strandedAdmin.id), second: await roleOf(colleague.id) })

  // The other shape of recovery: an admin handing an ownerless company to somebody else, and staying
  // an admin themselves rather than being demoted out of a role they already had.
  await db.update(user).set({ role: 'admin' }).where((await import('drizzle-orm')).eq(user.id, strandedAdmin.id))
  check('…(the company is ownerless again for the next case)', (await owners()).length === 0, null)
  const handOver = await as(strandedAdmin)('POST', '/api/company/transfer-ownership', { userId: colleague.id })
  check('an admin can hand an ownerless company to a colleague', handOver.status === 200, handOver)
  check('…the colleague is the owner', (await roleOf(colleague.id)) === 'owner', await roleOf(colleague.id))
  check('…and the admin who did it is still an admin, not demoted out of nothing',
    (await roleOf(strandedAdmin.id)) === 'admin', await roleOf(strandedAdmin.id))
}

// ══════════ T41 · the roster read is not user administration ════════════════════════════════════
//
// GET /api/company/users was `users:read` only — the owner, plus anyone the owner grants it to. But
// that list IS every assignment picker and rep filter, so the refusal broke working screens:
//
//   "The manager's Dispatch Board is always empty: /api/jobs returns 9 jobs, but
//    /api/company/users 403s for the manager and the board shows '0 Total Jobs' with no assign
//    list. The owner sees the jobs."  — Landscaping, a HIGH
//   "/api/users 403s in the background, so rep filters come up empty."  — Roofing
//   Events, Showcase and RV reported the same background 403 on Settings.
//
// It now accepts `team:read` as well — the permission that means "see the roster", which manager,
// field and viewer all hold. What a team:read caller gets is NARROWER, because email, lastLogin and
// extraPermissions are user administration rather than the roster: opening those to everyone who
// can see a colleague would have traded one fault for another.
//
// The write routes above are untouched and still requireAdmin — which the assertions below re-check,
// because widening a read must not widen anything else.
console.log('\n══════════ T41 · who may read the roster ══════════')
{
  /**
   * A FRESH manager. The `manager` at the top of this file was handed the company and handed it
   * back in step 3, so it is an ADMIN by now — which is exactly the side effect the block above
   * documents having been caught by. Reusing it here had the write refusals "failing" with 201 and
   * 200, and the narrowed-payload assertion failing because an admin correctly gets the full one.
   */
  const t41Manager = await mk('manager', 'mgr-t41')
  const asT41Manager = as(t41Manager)
  const asField = as(await mk('field', 'tech'))
  const asViewer = as(await mk('viewer', 'onlooker'))

  // ── the owner's view is unchanged ──
  const full = await asOwner('GET', '/api/company/users')
  check('T41: the owner still reads the full user list', full.status === 200 && Array.isArray(full.json),
    { status: full.status })
  const ownerRow = (full.json || []).find((u: any) => u.id === owner.id)
  check('T41: …with the administration fields on it', !!ownerRow?.email && 'extraPermissions' in (ownerRow || {}),
    Object.keys(ownerRow || {}))

  // ── THE ASSERTION THIS SECTION EXISTS FOR ──
  const mgr = await asT41Manager('GET', '/api/company/users')
  check('T41: a MANAGER is no longer refused the roster', mgr.status === 200,
    { status: mgr.status, body: JSON.stringify(mgr.json)?.slice(0, 160) })
  check('T41: …and it is not empty, so an assign list can be built', Array.isArray(mgr.json) && mgr.json.length >= 4,
    Array.isArray(mgr.json) ? mgr.json.length : mgr.json)
  check('T41: …carrying the name and role a picker needs',
    (mgr.json || []).every((u: any) => u.id && u.firstName && u.role), (mgr.json || [])[0])

  // ── but not the administration fields ──
  // Array.isArray, not `|| []`: a 403 answers an error OBJECT, and flatMap on that throws a
  // TypeError that ends the file with no summary — a refusal reading as a broken test.
  const leaked = (payload: any) => {
    const rows = Array.isArray(payload) ? payload : []
    return [...new Set(rows.flatMap((r: any) => ['email', 'lastLogin', 'extraPermissions', 'phone'].filter((k) => k in r)))]
  }
  check('T41: …and NOT email, last login or the extra grants', leaked(mgr.json).length === 0, leaked(mgr.json))

  /**
   * A FIELD SEAT IS STILL REFUSED, and that is the matrix's decision rather than this endpoint's:
   * `field` does not hold team:read (contacts/jobs/time/expenses and little else). The widening is
   * "whoever may read the team may read the roster" — it does not grant team:read to anybody.
   *
   * Asserted explicitly so the blast radius of the change is pinned, not assumed.
   */
  const field = await asField('GET', '/api/company/users')
  check('T41: a field seat is still refused — it does not hold team:read', field.status === 403,
    { status: field.status })

  const viewer = await asViewer('GET', '/api/company/users')
  check('T41: a viewer reads the roster, because it DOES hold team:read', viewer.status === 200,
    { status: viewer.status })
  check('T41: …equally narrowed', leaked(viewer.json).length === 0, leaked(viewer.json))

  // ── widening the READ widened nothing else ──
  const w1 = await asT41Manager('POST', '/api/company/users', {
    email: 'nope-og@test.local', password: 'Sufficiently-long-1', firstName: 'No', lastName: 'Way',
  })
  check('T41: a manager still cannot CREATE a user', w1.status === 403, { status: w1.status })
  const w2 = await asT41Manager('PUT', `/api/company/users/${t41Manager.id}`, { role: 'admin' })
  check('T41: …nor change a role', w2.status === 403, { status: w2.status })
  const w3 = await asT41Manager('DELETE', `/api/company/users/${t41Manager.id}`)
  check('T41: …nor delete one', w3.status === 403, { status: w3.status })
  check('T41: …and the manager is still a manager', (await roleOf(t41Manager.id)) === 'manager', await roleOf(t41Manager.id))
}

// ══════════ T41 · the company row is not the billing record ═════════════════════════════════════
//
// GET /api/company carries no role gate, which is right for the name, address, logo and brand colour
// the whole app renders. COMPANY_SECRETS already removes the provider credentials. What it did not
// remove is the commercial relationship:
//
//   "Staff sees ... subscription plan / Stripe account ID in /api/company."  — Field service
//   "/api/company gives the manager billing details while /api/billing is 403."  — Contractor
//
// The second says it best: the dedicated billing endpoint refuses the manager, and this one handed
// over the same facts as a side effect of loading the shell.
console.log('\n══════════ T41 · who may read the commercial fields ══════════')
{
  await db.update(company).set({
    stripeCustomerId: 'cus_T41PROBE',
    subscriptionTier: 'fleet',
    integrations: { stripeAccountId: 'acct_T41PROBE', quickbooksRealmId: '9130350000000000' },
  } as any).where((await import('drizzle-orm')).eq(company.id, co.id))

  const commercial = (row: any) => ['integrations', 'subscriptionTier', 'stripeCustomerId'].filter((k) => k in (row || {}))

  // The owner runs the business and may see what it pays.
  const byOwner = await asOwner('GET', '/api/company')
  check('T41: the owner reads the company', byOwner.status === 200, { status: byOwner.status })
  check('T41: …including the subscription and the connected accounts',
    commercial(byOwner.json).includes('integrations') && commercial(byOwner.json).includes('subscriptionTier'),
    commercial(byOwner.json))
  // …but never the provider credentials, which COMPANY_SECRETS has always removed.
  check('T41: …and NEVER the Stripe customer id, even for the owner',
    !('stripeCustomerId' in (byOwner.json || {})), Object.keys(byOwner.json || {}).filter((k) => /stripe/i.test(k)))

  // THE ASSERTIONS THIS SECTION EXISTS FOR.
  const mgr2 = await mk('manager', 'mgr-billing')
  const byManager = await as(mgr2)('GET', '/api/company')
  check('T41: a manager still reads the company — the shell needs it', byManager.status === 200,
    { status: byManager.status })
  check('T41: …with the name and branding intact', !!byManager.json?.name, Object.keys(byManager.json || {}).length)
  check('T41: …and NO subscription tier', !('subscriptionTier' in (byManager.json || {})), commercial(byManager.json))
  check('T41: …and NO integrations bag, so no Stripe account id can hide in it',
    !('integrations' in (byManager.json || {})), commercial(byManager.json))
  check('T41: …which is the whole point — the account id is not reachable at all',
    !/acct_T41PROBE/.test(JSON.stringify(byManager.json || {})), JSON.stringify(byManager.json || {}).slice(0, 160))

  const byField = await as(await mk('field', 'tech-billing'))('GET', '/api/company')
  check('T41: a field seat gets the same reduced row', byField.status === 200 && commercial(byField.json).length === 0,
    { status: byField.status, commercial: commercial(byField.json) })
  check('T41: …and cannot see the QuickBooks realm either',
    !/9130350000000000/.test(JSON.stringify(byField.json || {})), JSON.stringify(byField.json || {}).slice(0, 160))
}

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
