import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { carePlans, clients } from '../../db/schema.ts'
import { eq, desc } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)

// GET / — list all, ?clientId filter, join clients for name, order by createdAt desc
app.get('/', async (c) => {
  try {
    const clientId = c.req.query('clientId')

    let query = db
      .select({
        id: carePlans.id,
        clientId: carePlans.clientId,
        serviceType: carePlans.serviceType,
        frequency: carePlans.frequency,
        careGoals: carePlans.careGoals,
        specialInstructions: carePlans.specialInstructions,
        precautions: carePlans.precautions,
        startDate: carePlans.startDate,
        endDate: carePlans.endDate,
        status: carePlans.status,
        createdById: carePlans.createdById,
        createdAt: carePlans.createdAt,
        updatedAt: carePlans.updatedAt,
        clientFirstName: clients.firstName,
        clientLastName: clients.lastName,
      })
      .from(carePlans)
      .leftJoin(clients, eq(carePlans.clientId, clients.id))
      .orderBy(desc(carePlans.createdAt))

    if (clientId) {
      query = query.where(eq(carePlans.clientId, clientId))
    }

    const rows = await query
    return c.json(rows)
  } catch (error: any) {
    return c.json({ error: error.message }, 500)
  }
})

// POST / — insert, set createdById from auth user
app.post('/', async (c) => {
  try {
    const user = c.get('user' as any)
    const body = await c.req.json()
    const [row] = await db
      .insert(carePlans)
      .values({ ...body, createdById: user.userId })
      .returning()
    return c.json(row, 201)
  } catch (error: any) {
    return c.json({ error: error.message }, 500)
  }
})

// PUT /:id — update by id, set updatedAt
app.put('/:id', async (c) => {
  try {
    const id = c.req.param('id')
    const body = await c.req.json()
    const [row] = await db
      .update(carePlans)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(carePlans.id, id))
      .returning()
    return c.json(row)
  } catch (error: any) {
    return c.json({ error: error.message }, 500)
  }
})

export default app
