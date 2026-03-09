import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { caregiverTimeOff, users } from '../../db/schema.ts'
import { eq, and } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)

// GET / — list where type='blackout', join users for caregiver name
app.get('/', async (c) => {
  try {
    const rows = await db
      .select({
        id: caregiverTimeOff.id,
        caregiverId: caregiverTimeOff.caregiverId,
        startDate: caregiverTimeOff.startDate,
        endDate: caregiverTimeOff.endDate,
        type: caregiverTimeOff.type,
        reason: caregiverTimeOff.reason,
        approvedById: caregiverTimeOff.approvedById,
        status: caregiverTimeOff.status,
        createdAt: caregiverTimeOff.createdAt,
        caregiverFirstName: users.firstName,
        caregiverLastName: users.lastName,
      })
      .from(caregiverTimeOff)
      .leftJoin(users, eq(caregiverTimeOff.caregiverId, users.id))
      .where(eq(caregiverTimeOff.type, 'blackout'))

    return c.json(rows)
  } catch (error: any) {
    return c.json({ error: error.message }, 500)
  }
})

// POST / — insert with type='blackout'
app.post('/', async (c) => {
  try {
    const body = await c.req.json()
    const [row] = await db
      .insert(caregiverTimeOff)
      .values({ ...body, type: 'blackout' })
      .returning()
    return c.json(row, 201)
  } catch (error: any) {
    return c.json({ error: error.message }, 500)
  }
})

// DELETE /:id — delete by id
app.delete('/:id', async (c) => {
  try {
    const id = c.req.param('id')
    await db
      .delete(caregiverTimeOff)
      .where(and(eq(caregiverTimeOff.id, id), eq(caregiverTimeOff.type, 'blackout')))
    return c.json({ success: true })
  } catch (error: any) {
    return c.json({ error: error.message }, 500)
  }
})

export default app
