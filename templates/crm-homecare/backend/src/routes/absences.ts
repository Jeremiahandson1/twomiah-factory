import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { absences, users, clients } from '../../db/schema.ts'
import { eq, desc } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)

// GET / — list all absences, optional ?caregiverId filter, join users+clients for names
app.get('/', async (c) => {
  try {
    const caregiverId = c.req.query('caregiverId')

    let query = db
      .select({
        id: absences.id,
        caregiverId: absences.caregiverId,
        clientId: absences.clientId,
        date: absences.date,
        type: absences.type,
        reason: absences.reason,
        reportedById: absences.reportedById,
        coverageNeeded: absences.coverageNeeded,
        coverageAssignedTo: absences.coverageAssignedTo,
        createdAt: absences.createdAt,
        caregiverFirstName: users.firstName,
        caregiverLastName: users.lastName,
        clientFirstName: clients.firstName,
        clientLastName: clients.lastName,
      })
      .from(absences)
      .leftJoin(users, eq(absences.caregiverId, users.id))
      .leftJoin(clients, eq(absences.clientId, clients.id))
      .orderBy(desc(absences.date))

    if (caregiverId) {
      query = query.where(eq(absences.caregiverId, caregiverId))
    }

    const rows = await query
    return c.json(rows)
  } catch (error: any) {
    return c.json({ error: error.message }, 500)
  }
})

// GET /my — get absences for current authenticated user
app.get('/my', async (c) => {
  try {
    const user = c.get('user' as any)
    const rows = await db
      .select({
        id: absences.id,
        caregiverId: absences.caregiverId,
        clientId: absences.clientId,
        date: absences.date,
        type: absences.type,
        reason: absences.reason,
        reportedById: absences.reportedById,
        coverageNeeded: absences.coverageNeeded,
        coverageAssignedTo: absences.coverageAssignedTo,
        createdAt: absences.createdAt,
        clientFirstName: clients.firstName,
        clientLastName: clients.lastName,
      })
      .from(absences)
      .leftJoin(clients, eq(absences.clientId, clients.id))
      .where(eq(absences.caregiverId, user.userId))
      .orderBy(desc(absences.date))

    return c.json(rows)
  } catch (error: any) {
    return c.json({ error: error.message }, 500)
  }
})

// POST / — insert absence, set reportedById from auth user
app.post('/', async (c) => {
  try {
    const user = c.get('user' as any)
    const body = await c.req.json()
    const [row] = await db
      .insert(absences)
      .values({ ...body, reportedById: user.userId })
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
    await db.delete(absences).where(eq(absences.id, id))
    return c.json({ success: true })
  } catch (error: any) {
    return c.json({ error: error.message }, 500)
  }
})

export default app
