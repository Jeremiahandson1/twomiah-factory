import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { careTypes } from '../../db/schema.ts'
import { eq, asc } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)

// GET / — list all active care types, ordered by name
app.get('/', async (c) => {
  try {
    const rows = await db
      .select()
      .from(careTypes)
      .where(eq(careTypes.isActive, true))
      .orderBy(asc(careTypes.name))

    return c.json(rows)
  } catch (error: any) {
    return c.json({ error: error.message }, 500)
  }
})

export default app
