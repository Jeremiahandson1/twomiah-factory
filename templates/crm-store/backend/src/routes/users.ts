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

  const body = await c.req.json().catch(() => ({}))
  if (typeof (body as any).email === 'string') (body as any).email = (body as any).email.toLowerCase().trim()

  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message || 'Invalid user details' }, 400)
  }
  const data = parsed.data

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

export default app
