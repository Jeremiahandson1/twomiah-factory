import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { caregiverAvailability } from '../../db/schema.ts'
import { eq } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)

// GET /:id — get by caregiverId (not by row id)
app.get('/:id', async (c) => {
  try {
    const caregiverId = c.req.param('id')
    const [row] = await db
      .select()
      .from(caregiverAvailability)
      .where(eq(caregiverAvailability.caregiverId, caregiverId))
      .limit(1)

    if (!row) {
      return c.json({ message: 'No availability record found' }, 404)
    }
    return c.json(row)
  } catch (error: any) {
    return c.json({ error: error.message }, 500)
  }
})

// PUT /:id — upsert: check if exists by caregiverId, update or insert
app.put('/:id', async (c) => {
  try {
    const caregiverId = c.req.param('id')
    const body = await c.req.json()

    const [existing] = await db
      .select()
      .from(caregiverAvailability)
      .where(eq(caregiverAvailability.caregiverId, caregiverId))
      .limit(1)

    if (existing) {
      const [row] = await db
        .update(caregiverAvailability)
        .set({ ...body, updatedAt: new Date() })
        .where(eq(caregiverAvailability.caregiverId, caregiverId))
        .returning()
      return c.json(row)
    } else {
      const [row] = await db
        .insert(caregiverAvailability)
        .values({ ...body, caregiverId })
        .returning()
      return c.json(row, 201)
    }
  } catch (error: any) {
    return c.json({ error: error.message }, 500)
  }
})

export default app
