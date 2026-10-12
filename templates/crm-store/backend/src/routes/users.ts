// Team logins for the store admin.
//
// crm-store shipped with no way to create a second login: nothing in the app
// ever inserted into `users`, so a store owner paying a seat-based plan was
// permanently a one-person account.
//
// Logins are the owner's (users:read, team:create, team:update — admin and up, and a shop has no admin
// seat): a manager runs the shop but does not decide who else gets into it.
//
// The roles a login can hold here: owner, manager, staff (middleware/permissions.ts says what each may do).
import { Hono } from 'hono'
import { z } from 'zod'
import { eq, sql } from 'drizzle-orm'
import { db } from '../../db/index.ts'
import { users } from '../../db/schema.ts'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import audit from '../services/audit.ts'

const app = new Hono()
app.use('*', authenticate)

// The roles the owner hands out. 'owner' is not one of them: the store has one owner, minted when the
// store itself was provisioned, and making a second is not a button.
const ASSIGNABLE_ROLES = ['manager', 'staff'] as const

// GET / — the team list. Password material never leaves the server.
app.get('/', requirePermission('users:read'), async (c) => {
  const list = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      isActive: users.isActive,
      createdAt: users.createdAt,
    })
    .from(users)

  return c.json({ data: list })
})

// POST / — add a team login. The owner sets the first password and passes it
// on; there is deliberately no invite email, because tenant outbound mail isn't
// proven on every store and an invite that silently never arrives is
// indistinguishable from a broken product.
app.post('/', requirePermission('team:create'), async (c) => {
  const schema = z.object({
    email: z.string().email(),
    password: z.string().min(8),
    name: z.string().min(1),
    role: z.enum(ASSIGNABLE_ROLES, { errorMap: () => ({ message: 'Role must be manager or staff' }) }).default('staff'),
  })

  const body = (await c.req.json().catch(() => null)) ?? {}
  if (typeof (body as any).email === 'string') (body as any).email = (body as any).email.toLowerCase().trim()

  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message || 'Invalid user details' }, 400)
  }
  const data = parsed.data

  // Hash before the transaction — bcrypt takes ~100ms and must not be done
  // while holding a lock.
  const passwordHash = await Bun.password.hash(data.password, 'bcrypt')

  // Seat cap. Env-only here: store_settings has no free-form settings column
  // (only typed shippingZones/taxRates), so unlike the CRM templates there is
  // nowhere to stash a per-tenant override without a migration. Unset => no
  // cap, on purpose — refusing a paying owner's staff member because we never
  // recorded their plan is a worse failure than a missed cap.
  //
  // Count + insert must be serialised, or two concurrent adds each count the
  // same N and both insert, exceeding the plan. The CRM templates lock their
  // company row; this database has no company table (one store per database),
  // so a transaction-scoped ADVISORY lock plays that role. It releases
  // automatically on commit or rollback.
  const outcome = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('crm_store_seat_add'))`)

    const envSeats = Number.parseInt(process.env.SEAT_LIMIT || '', 10)
    const seatLimit = Number.isInteger(envSeats) && envSeats > 0 ? envSeats : null
    if (seatLimit) {
      const activeSeats = await tx.select({ id: users.id }).from(users).where(eq(users.isActive, true))
      if (activeSeats.length >= seatLimit) {
        return { status: 403 as const, body: {
          error: `Your plan includes ${seatLimit} user${seatLimit === 1 ? '' : 's'} and ${activeSeats.length} are already active. Deactivate someone or upgrade to add more.`,
          seatLimit,
          activeSeats: activeSeats.length,
        } }
      }
    }

    // users.email carries a unique index — check first so the caller gets a
    // readable message instead of a raw constraint violation.
    const [existing] = await tx.select({ id: users.id }).from(users).where(eq(users.email, data.email)).limit(1)
    if (existing) return { status: 409 as const, body: { error: 'That email already has an account here' } }

    const [created] = await tx
      .insert(users)
      .values({ email: data.email, name: data.name, role: data.role, passwordHash })
      .returning({
        id: users.id,
        email: users.email,
        name: users.name,
        role: users.role,
        isActive: users.isActive,
        createdAt: users.createdAt,
      })

    return { status: 201 as const, body: created }
  })

  // Logged after the transaction has committed — never from inside it, where a second connection would wait on this one.
  if (outcome.status === 201) {
    const u = outcome.body as any
    await audit.log({ action: 'create', entity: 'user', entityId: u.id, entityName: u.name || u.email, metadata: { description: `Login added — ${u.email}, as ${u.role}` }, req: c })
  }
  return c.json(outcome.body as any, outcome.status)
})

// PUT /:id — rename a team member, change their role, or revoke their access.
//
// Deactivation, not deletion: orders and fulfilment history reference the user,
// and the seat count is of ACTIVE users so isActive=false is what frees a seat.
// Until this existed a store owner had NO way to remove a login — a departing
// employee kept full access to products, orders, customers and payments, and
// the only recourse was editing the database.
app.put('/:id', requirePermission('team:update'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const schema = z.object({
    name: z.string().min(1).optional(),
    isActive: z.boolean().optional(),
    // Promote a member of staff to manager or back. Without this the only way to change somebody's
    // seat was to revoke the login and make a new one — under a different email, because the old
    // address stays taken.
    role: z.enum(ASSIGNABLE_ROLES, { errorMap: () => ({ message: 'Role must be manager or staff' }) }).optional(),
  })
  const parsed = schema.safeParse(await c.req.json().catch(() => ({})))
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message || 'Invalid changes' }, 400)
  const data = parsed.data
  // An empty UPDATE SET 500'd. Return a clean 400. (BUG-10)
  if (Object.keys(data).length === 0) return c.json({ error: 'No editable changes provided.' }, 400)

  const [target] = await db.select().from(users).where(eq(users.id, id)).limit(1)
  if (!target) return c.json({ error: 'User not found' }, 404)

  // The owner's seat is not changed from this screen — demoting it would leave the store with nobody
  // who can reach payments, settings or logins. And nobody re-roles themselves.
  if (data.role !== undefined && data.role !== target.role) {
    if (target.role === 'owner') return c.json({ error: "The owner's role can't be changed." }, 400)
    if (id === currentUser.userId) return c.json({ error: "You can't change your own role." }, 400)
  }

  // An owner locking themselves out has no way back in without a DB edit.
  if (data.isActive === false) {
    if (id === currentUser.userId) return c.json({ error: "You can't remove your own access." }, 400)
    if (target.role === 'owner') {
      const active = await db.select({ id: users.id, role: users.role }).from(users).where(eq(users.isActive, true))
      if (active.filter(u => u.role === 'owner').length <= 1) {
        return c.json({ error: 'This is the only owner — you cannot deactivate them.' }, 400)
      }
    }
  }

  const [updated] = await db.update(users).set(data).where(eq(users.id, id)).returning({
    id: users.id,
    email: users.email,
    name: users.name,
    role: users.role,
    isActive: users.isActive,
    createdAt: users.createdAt,
  })
  const changes = audit.diff(target as any, updated as any, Object.keys(data))
  await audit.log({
    action: data.role !== undefined && data.role !== target.role ? 'role_change' : 'update',
    entity: 'user', entityId: updated.id, entityName: updated.name || updated.email, changes,
    metadata: data.isActive !== undefined && data.isActive !== target.isActive ? { description: data.isActive ? `Access restored — ${updated.email}` : `Access revoked — ${updated.email}` } : null,
    req: c,
  })

  return c.json(updated)
})

export default app
