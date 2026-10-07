import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { company, user } from '../../db/schema.ts'
import { eq, and } from 'drizzle-orm'
import { authenticate, requireAdmin } from '../middleware/auth.ts'
import { requirePermission, requireAnyPermission, hasPermission, getExtraPermissions } from '../middleware/permissions.ts'
import { passwordSchema } from '../shared/index.ts'

const app = new Hono()
app.use('*', authenticate)

// GET / — list company users (for dropdowns: assign rep, assign crew lead, etc.)
//
// Active-only by DEFAULT, because that is what the assignment dropdowns want.
// Pass ?includeInactive=1 for the Settings list, which has to show revoked
// people so they can be reactivated — otherwise deactivating someone hides them
// forever and the action is one-way.
/**
 * `users:read` OR `team:read`. (T41)
 *
 * It was "Owner + owner-granted 'users:read' only (Wrench QA decision)" — and the comment directly
 * above explains why that could not hold: this list IS the assignment dropdowns. Five screens read
 * it (Canvassing, Jobs, Job detail, Pipeline, Reports), and T41 found the consequence:
 * "/api/users 403s in the background, so rep filters come up empty."
 *
 * The Wrench decision was about who may MANAGE seats, and the write routes below still say
 * requireAdmin. Knowing who your colleagues are, so you can assign work to one of them, is a
 * different question — and it is the one `team:read` exists to answer.
 *
 * A team:read caller gets the fields a dropdown needs and not the contact details: email and phone
 * are staff PII and belong to the Settings list, which is read with users:read.
 */
app.get('/', requireAnyPermission(['users:read', 'team:read']), async (c) => {
  const currentUser = c.get('user') as any
  const includeInactive = c.req.query('includeInactive') === '1'
  const where = includeInactive
    ? eq(user.companyId, currentUser.companyId)
    : and(eq(user.companyId, currentUser.companyId), eq(user.isActive, true))
  const users = await db
    .select({
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      phone: user.phone,
      role: user.role,
      isActive: user.isActive,
    })
    .from(user)
    .where(where)

  const full = hasPermission(currentUser.role, 'users:read', await getExtraPermissions(currentUser.userId))
  if (full) return c.json({ data: users })

  return c.json({
    data: users.map(({ email, phone, ...rest }) => rest),
  })
})

// POST / — add a teammate (a real login seat).
//
// This is what makes the seat-based plan deliverable: without it an owner could
// see the Users list but had no way to add anyone, so every account was a
// one-person account no matter which tier they paid for. The Settings page used
// to POST /api/users/invite, which was never implemented and 404'd.
//
// The admin sets the teammate's first password and passes it on. We deliberately
// do NOT email an invite link: tenant outbound mail isn't proven on every tenant,
// and a mailed invite that silently never arrives looks identical to a broken
// product. `role` is limited to the roles this app actually checks
// (requireAdmin = admin|owner, requireManager adds manager) — 'owner' is not
// creatable here because signup mints the single owner.
app.post('/', requireAdmin, async (c) => {
  const currentUser = c.get('user') as any
  const schema = z.object({
    email: z.string().email(),
    password: passwordSchema,
    firstName: z.string().min(1),
    lastName: z.string().min(1),
    phone: z.string().optional(),
    role: z.enum(['admin', 'manager', 'user', 'viewer']).default('user'),
  })

  // .catch: a missing or malformed body must not throw past validation into a
  // 500 — the caller gets a 400 that names the problem instead.
  const body = (await c.req.json().catch(() => null)) ?? ({} as any)
  if (typeof body.email === 'string') body.email = body.email.toLowerCase().trim()

  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message || 'Invalid user details' }, 400)
  }
  const data = parsed.data

  // Hash before the transaction — bcrypt takes ~100ms and must not be done
  // while holding a row lock.
  const passwordHash = await Bun.password.hash(data.password, 'bcrypt')
  const { password: _password, ...rest } = data

  // Seat cap — same contract as the crm-family templates. SEAT_LIMIT (env,
  // written by the factory at deploy) wins; company.settings.seatLimit lets
  // staff change it without a redeploy. Neither set => no cap, on purpose:
  // refusing a paying customer's teammate because we never recorded their plan
  // is a worse failure than a missed cap.
  //
  // Count + insert run together under a lock. A bare transaction would NOT be
  // enough: at READ COMMITTED two concurrent adds each count the same 9 and both
  // insert, putting a 10-seat plan on 11. Taking the company row FOR UPDATE
  // makes competing adds for this company queue behind us.
  const outcome = await db.transaction(async (tx) => {
    const [companyRow] = await tx.select().from(company)
      .where(eq(company.id, currentUser.companyId)).limit(1).for('update')

    const envSeats = Number.parseInt(process.env.SEAT_LIMIT || '', 10)
    const settingSeats = Number.parseInt(String((companyRow?.settings as any)?.seatLimit ?? ''), 10)
    const seatLimit = Number.isInteger(envSeats) && envSeats > 0
      ? envSeats
      : (Number.isInteger(settingSeats) && settingSeats > 0 ? settingSeats : null)

    if (seatLimit) {
      // Deactivated users free a seat, so count only those who can sign in.
      const activeSeats = await tx.select({ id: user.id }).from(user)
        .where(and(eq(user.companyId, currentUser.companyId), eq(user.isActive, true)))
      if (activeSeats.length >= seatLimit) {
        return { status: 403 as const, body: {
          error: `Your plan includes ${seatLimit} user${seatLimit === 1 ? '' : 's'} and ${activeSeats.length} are already active. Deactivate someone or upgrade to add more.`,
          seatLimit,
          activeSeats: activeSeats.length,
        } }
      }
    }

    // Scoped to the company: the same address may legitimately exist in another tenant.
    const [existing] = await tx
      .select({ id: user.id })
      .from(user)
      .where(and(eq(user.email, data.email), eq(user.companyId, currentUser.companyId)))
      .limit(1)
    if (existing) return { status: 409 as const, body: { error: 'That email already has an account here' } }

    const [created] = await tx
      .insert(user)
      .values({ ...rest, passwordHash, companyId: currentUser.companyId })
      .returning({
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        phone: user.phone,
        role: user.role,
        isActive: user.isActive,
      })

    return { status: 201 as const, body: created }
  })

  return c.json(outcome.body as any, outcome.status)
})

// PUT /:id — change a teammate's role, or revoke their access.
//
// Revoking is a deactivation, not a delete: jobs, quotes and audit rows point at
// this user, and the seat count is of ACTIVE users, so isActive=false is what
// actually frees a seat. Before this route existed there was no way to remove
// someone's access at all — a fired employee kept their login until somebody
// edited the database by hand.
app.put('/:id', requireAdmin, async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const schema = z.object({
    firstName: z.string().min(1).optional(),
    lastName: z.string().min(1).optional(),
    phone: z.string().optional(),
    role: z.enum(['admin', 'manager', 'user', 'viewer']).optional(),
    isActive: z.boolean().optional(),
  })
  const parsed = schema.safeParse(await c.req.json().catch(() => ({})))
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message || 'Invalid changes' }, 400)
  const data = parsed.data

  const [target] = await db.select().from(user)
    .where(and(eq(user.id, id), eq(user.companyId, currentUser.companyId))).limit(1)
  if (!target) return c.json({ error: 'User not found' }, 404)

  // Losing the last administrator is unrecoverable from inside the product.
  const losingAccess = data.isActive === false
  const demoting = data.role !== undefined && data.role !== 'admin' && (target.role === 'admin' || target.role === 'owner')
  if (losingAccess && id === currentUser.userId) {
    return c.json({ error: "You can't remove your own access." }, 400)
  }
  if ((losingAccess || demoting) && (target.role === 'admin' || target.role === 'owner')) {
    const activeUsers = await db.select({ id: user.id, role: user.role }).from(user)
      .where(and(eq(user.companyId, currentUser.companyId), eq(user.isActive, true)))
    const admins = activeUsers.filter(u => u.role === 'admin' || u.role === 'owner')
    if (admins.length <= 1) {
      return c.json({ error: 'This is the only administrator left — promote someone else first.' }, 400)
    }
  }

  const [updated] = await db.update(user).set({ ...data, updatedAt: new Date() })
    .where(and(eq(user.id, id), eq(user.companyId, currentUser.companyId)))
    .returning({
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      isActive: user.isActive,
    })

  return c.json(updated)
})

/**
 * REMOVE A TEAMMATE. (T58d)
 *
 * This route had GET, POST and PUT and no DELETE, so a roofing owner could add someone and change
 * them but never remove them — the only vertical in the fleet where that is true; every other one
 * mounts the shared company module, which has had DELETE /users/:id all along. Found while clearing
 * two leftover QA accounts off rooftest and discovering there was no way to do it: they are still
 * sitting there, active, holding 2 of a 10-seat plan.
 *
 * Deliberately NOT a soft delete. PUT already does that — `isActive: false` is "revoke access", and
 * it keeps the row so the audit log and every assignment still resolve a name. DELETE is for a row
 * that should never have existed: a typo, a test account, somebody added to the wrong tenant.
 *
 * The guards are the shared module's, rule for rule, because they protect against the same
 * unrecoverable states:
 *   · not yourself — leaves the company reachable by whoever is doing the removing
 *   · not the owner — a company with no owner cannot be recovered from inside the product, and
 *     deleting the row is a harder version of the demotion that was already blocked
 *   · not the last active administrator
 */
app.delete('/:id', requireAdmin, async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  if (id === currentUser.userId) return c.json({ error: 'Cannot delete yourself' }, 400)

  const [target] = await db.select().from(user)
    .where(and(eq(user.id, id), eq(user.companyId, currentUser.companyId))).limit(1)
  if (!target) return c.json({ error: 'User not found' }, 404)

  if (target.role === 'owner') {
    return c.json({
      error: "The owner's account cannot be deleted. Transfer ownership first, then remove the account.",
      code: 'owner_cannot_be_deleted',
    }, 403)
  }

  if (target.isActive && (target.role === 'admin' || target.role === 'owner')) {
    const activeUsers = await db.select({ id: user.id, role: user.role }).from(user)
      .where(and(eq(user.companyId, currentUser.companyId), eq(user.isActive, true)))
    const admins = activeUsers.filter(u => u.role === 'admin' || u.role === 'owner')
    if (admins.length <= 1) {
      return c.json({ error: 'This is the only administrator left — promote someone else first.' }, 400)
    }
  }

  await db.delete(user).where(and(eq(user.id, id), eq(user.companyId, currentUser.companyId)))
  return c.body(null, 204)
})

export default app
