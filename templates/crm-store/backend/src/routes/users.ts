// Staff accounts for the store admin.
//
// crm-store shipped with no way to create a second login: nothing in the app
// ever inserted into `users`, so a store owner paying a seat-based plan was
// permanently a one-person account. The schema has always modelled this
// (`role: owner | staff`) — only the route was missing.
//
// Owner-only on purpose: `staff` should not be able to mint more logins.
import { Hono } from 'hono'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db } from '../../db/index.ts'
import { users } from '../../db/schema.ts'
import { authenticate, requireOwner } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)

// GET / — the staff list. Password material never leaves the server.
app.get('/', requireOwner, async (c) => {
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

// POST / — add a staff login. The owner sets the first password and passes it
// on; there is deliberately no invite email, because tenant outbound mail isn't
// proven on every store and an invite that silently never arrives is
// indistinguishable from a broken product.
app.post('/', requireOwner, async (c) => {
  const schema = z.object({
    email: z.string().email(),
    password: z.string().min(8),
    name: z.string().min(1),
    // 'owner' is intentionally not creatable — the store has one owner, minted
    // when the store itself was provisioned.
    role: z.enum(['staff']).default('staff'),
  })

  const body = (await c.req.json().catch(() => null)) ?? {}
  if (typeof (body as any).email === 'string') (body as any).email = (body as any).email.toLowerCase().trim()

  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message || 'Invalid user details' }, 400)
  }
  const data = parsed.data

  // Seat cap. Env-only here: store_settings has no free-form settings column
  // (only typed shippingZones/taxRates), so unlike the CRM templates there is
  // nowhere to stash a per-tenant override without a migration. Unset => no
  // cap, on purpose — refusing a paying owner's staff member because we never
  // recorded their plan is a worse failure than a missed cap.
  const envSeats = Number.parseInt(process.env.SEAT_LIMIT || '', 10)
  const seatLimit = Number.isInteger(envSeats) && envSeats > 0 ? envSeats : null
  if (seatLimit) {
    const activeSeats = await db.select({ id: users.id }).from(users).where(eq(users.isActive, true))
    if (activeSeats.length >= seatLimit) {
      return c.json({
        error: `Your plan includes ${seatLimit} user${seatLimit === 1 ? '' : 's'} and ${activeSeats.length} are already active. Deactivate someone or upgrade to add more.`,
        seatLimit,
        activeSeats: activeSeats.length,
      }, 403)
    }
  }

  // users.email carries a unique index — check first so the caller gets a
  // readable message instead of a raw constraint violation.
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, data.email)).limit(1)
  if (existing) return c.json({ error: 'That email already has an account here' }, 409)

  const passwordHash = await Bun.password.hash(data.password, 'bcrypt')

  const [created] = await db
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

  return c.json(created, 201)
})

// PUT /:id — rename a staff member, or revoke their access.
//
// Deactivation, not deletion: orders and fulfilment history reference the user,
// and the seat count is of ACTIVE users so isActive=false is what frees a seat.
// Until this existed a store owner had NO way to remove a login — a departing
// employee kept full access to products, orders, customers and payments, and
// the only recourse was editing the database.
app.put('/:id', requireOwner, async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const schema = z.object({
    name: z.string().min(1).optional(),
    isActive: z.boolean().optional(),
  })
  const parsed = schema.safeParse(await c.req.json().catch(() => ({})))
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message || 'Invalid changes' }, 400)
  const data = parsed.data

  const [target] = await db.select().from(users).where(eq(users.id, id)).limit(1)
  if (!target) return c.json({ error: 'User not found' }, 404)

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

  return c.json(updated)
})

export default app
