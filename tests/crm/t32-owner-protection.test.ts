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
  check('…and a manager still cannot', mgr.status === 403, mgr)
}

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
