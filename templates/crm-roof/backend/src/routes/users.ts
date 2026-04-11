import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { user } from '../../db/schema.ts'
import { eq, and } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)

// GET / — list company users (for dropdowns: assign rep, assign crew lead, etc.)
app.get('/', async (c) => {
  const currentUser = c.get('user') as any
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
    .where(and(eq(user.companyId, currentUser.companyId), eq(user.isActive, true)))

  return c.json({ data: users })
})

export default app
