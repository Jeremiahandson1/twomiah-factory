import { Hono } from 'hono'
import { eq, asc } from 'drizzle-orm'
import { db } from '../../db/index.ts'
import { agencies, users } from '../../db/schema.ts'
import { authenticate, requireAdmin } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)

// GET /
app.get('/', async (c) => {
  const [agency] = await db.select().from(agencies).limit(1)
  return c.json(agency || {})
})

// PUT /
app.put('/', requireAdmin, async (c) => {
  const body = await c.req.json()
  const [existing] = await db.select().from(agencies).limit(1)

  let agency
  if (existing) {
    ;[agency] = await db
      .update(agencies)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(agencies.id, existing.id))
      .returning()
  } else {
    const slug = (body.name || 'agency').toLowerCase().replace(/[^a-z0-9]/g, '-')
    ;[agency] = await db.insert(agencies).values({ ...body, slug }).returning()
  }

  return c.json(agency)
})

// GET /users - User management (all staff)
app.get('/users', requireAdmin, async (c) => {
  const userList = await db
    .select({
      id: users.id,
      email: users.email,
      firstName: users.firstName,
      lastName: users.lastName,
      role: users.role,
      isActive: users.isActive,
      lastLogin: users.lastLogin,
    })
    .from(users)
    .orderBy(asc(users.role), asc(users.lastName))

  return c.json(userList)
})

export default app
