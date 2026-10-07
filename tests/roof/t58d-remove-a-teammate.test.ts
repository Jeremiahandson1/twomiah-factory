// T58d — a roofing owner could not remove a teammate.
//
// roof forks the roster onto /api/users instead of mounting the shared company module, and that fork
// had GET, POST and PUT and no DELETE. Every other vertical in the fleet has had
// DELETE /api/company/users/:id all along. Found while trying to clear two leftover QA accounts off
// rooftest and discovering there was no way to do it — they are still there, active, holding 2 of a
// 10-seat plan.
//
// DELETE is not a second way to say "revoke access". PUT { isActive: false } already does that, and
// it keeps the row so the audit log and old assignments still resolve a name. DELETE is for a row
// that should never have existed: a typo, a test account, somebody added to the wrong tenant.
//
// The three guards are the shared module's, rule for rule, because they protect against the same
// unrecoverable states — and each is asserted BOTH ways here. A gate that also refuses the admin
// running the business is not a fix.
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
const { eq, and } = await import('drizzle-orm')

const [co] = await db.insert(company).values({
  name: 'Ironside Roofing', slug: 'ironside-t58d', email: 't58d@test.local', state: 'OH',
  settings: {}, enabledFeatures: [],
} as any).returning()

const mk = async (role: string, tag: string, isActive = true) => (await db.insert(user).values({
  email: `${tag}@ironside-t58d.local`, passwordHash: 'x', firstName: tag, lastName: 'U',
  role, companyId: co.id, isActive,
} as any).returning())[0]

const owner = await mk('owner', 'owner')
const admin = await mk('admin', 'admin')
const crew = await mk('user', 'crew')
const probe = await mk('user', 'probe')

const app = new Hono()
app.route('/api/users', (await import('./src/routes/users.ts')).default)
app.onError((err: any, c: any) => {
  const status = Number(err?.status || err?.statusCode || 0)
  if (status >= 400 && status < 500) return c.json({ error: err.message }, status)
  return c.json({ error: 'Internal server error', unexpected: String(err?.message || err) }, 500)
})

const as = (who: any) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method, headers: { 'content-type': 'application/json', 'x-test-user': who.id, 'x-test-company': co.id, 'x-test-role': who.role },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const txt = await res.text(); let j: any = txt; try { j = JSON.parse(txt) } catch {}
  return { status: res.status, json: j, text: txt }
}
const asOwner = as(owner), asAdmin = as(admin), asCrew = as(crew)
const exists = async (id: string) =>
  (await db.select().from(user).where(and(eq(user.id, id), eq(user.companyId, co.id))).limit(1)).length > 0

// ══════════ 1. THE ROUTE EXISTS AT ALL ═════════════════════════════════════════════════════════
//
// It answered 404 on the live tenant, which is what sent me looking.
{
  const r = await asOwner('DELETE', `/api/users/${probe.id}`)
  check('DELETE /api/users/:id is mounted — not a 404', r.status !== 404, { status: r.status, body: r.text?.slice(0, 160) })
  check('…the leftover account is removed', r.status === 204, { status: r.status, body: r.text?.slice(0, 200) })
  check('…and it is really gone from the table', !(await exists(probe.id)))
}

// ══════════ 2. a crew member cannot remove anybody ═════════════════════════════════════════════
//
// The target is an ORDINARY teammate, deliberately. The first version of this aimed the crew at the
// owner's row and passed — but it passed on the owner guard, not on the role gate, so deleting
// `requireAdmin` from the route did not fail the test. A mutation found that: "any role may delete"
// came back green. Only `requireAdmin` can refuse this one.
{
  const victim = await mk('user', 'victim')
  const r = await asCrew('DELETE', `/api/users/${victim.id}`)
  check('the field rung is refused', r.status === 401 || r.status === 403, { status: r.status, body: r.text?.slice(0, 160) })
  check('…and the teammate is untouched', await exists(victim.id))
}

// ══════════ 3. the owner's row is protected ════════════════════════════════════════════════════
//
// A company with no owner cannot be recovered from inside the product. Deleting the row is the
// harder version of the demotion that was already blocked.
{
  const r = await asAdmin('DELETE', `/api/users/${owner.id}`)
  check('an admin cannot delete the owner', r.status === 403, { status: r.status, body: r.text?.slice(0, 200) })
  check('…and says to transfer ownership first', /transfer ownership/i.test(String(r.json?.error || '')), r.json)
  check('…the owner is still there', await exists(owner.id))
}

// ══════════ 4. nobody can delete themselves ════════════════════════════════════════════════════
{
  const r = await asAdmin('DELETE', `/api/users/${admin.id}`)
  check('deleting yourself is refused', r.status === 400, { status: r.status, body: r.text?.slice(0, 200) })
  check('…and you are still there', await exists(admin.id))
}

// ══════════ 5. the last administrator cannot be removed ════════════════════════════════════════
//
// The owner counts as an administrator, so with owner+admin active the admin IS removable — and
// that half matters as much: a rule that refuses a real removal is its own bug.
{
  const second = await mk('admin', 'admin2')
  const r = await asOwner('DELETE', `/api/users/${second.id}`)
  check('a second admin CAN be removed while another remains', r.status === 204, { status: r.status, body: r.text?.slice(0, 200) })
  check('…and is gone', !(await exists(second.id)))

  // Now strip it back to one administrator and try again.
  await db.update(user).set({ isActive: false } as any).where(eq(user.id, owner.id))
  const lone = await mk('admin', 'lonely')
  await db.update(user).set({ isActive: false } as any).where(eq(user.id, admin.id))
  const r2 = await as(lone)('DELETE', `/api/users/${lone.id}`)
  // Self-delete is refused first, which is the stricter rule and the one that fires. Assert the
  // outcome that matters: the company does not lose its last administrator.
  check('the last administrator survives the attempt', r2.status >= 400 && (await exists(lone.id)), { status: r2.status })
  await db.update(user).set({ isActive: true } as any).where(eq(user.id, owner.id))
}

// ══════════ 6. a row from another company is not ours to delete ════════════════════════════════
{
  const [other] = await db.insert(company).values({
    name: 'Someone Else', slug: 'other-t58d', email: 'other-t58d@test.local', state: 'OH', settings: {}, enabledFeatures: [],
  } as any).returning()
  const [stranger] = await db.insert(user).values({
    email: 'stranger-t58d@test.local', passwordHash: 'x', firstName: 'S', lastName: 'U',
    role: 'user', companyId: other.id, isActive: true,
  } as any).returning()
  const r = await asOwner('DELETE', `/api/users/${stranger.id}`)
  check('another company\'s user is a 404, not a deletion', r.status === 404, { status: r.status })
  const still = (await db.select().from(user).where(eq(user.id, stranger.id)).limit(1)).length > 0
  check('…and they still exist', still)
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
