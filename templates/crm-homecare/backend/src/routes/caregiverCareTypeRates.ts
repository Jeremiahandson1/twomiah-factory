import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { caregiverCareTypeRates, careTypes } from '../../db/schema.ts'
import { eq } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)

// GET / — list with ?caregiverId filter, join careTypes for name
app.get('/', async (c) => {
  try {
    const caregiverId = c.req.query('caregiverId')

    let query = db
      .select({
        id: caregiverCareTypeRates.id,
        caregiverId: caregiverCareTypeRates.caregiverId,
        careTypeId: caregiverCareTypeRates.careTypeId,
        hourlyRate: caregiverCareTypeRates.hourlyRate,
        overtimeRate: caregiverCareTypeRates.overtimeRate,
        holidayRate: caregiverCareTypeRates.holidayRate,
        createdAt: caregiverCareTypeRates.createdAt,
        updatedAt: caregiverCareTypeRates.updatedAt,
        careTypeName: careTypes.name,
      })
      .from(caregiverCareTypeRates)
      .leftJoin(careTypes, eq(caregiverCareTypeRates.careTypeId, careTypes.id))

    if (caregiverId) {
      query = query.where(eq(caregiverCareTypeRates.caregiverId, caregiverId))
    }

    const rows = await query
    return c.json(rows)
  } catch (error: any) {
    return c.json({ error: error.message }, 500)
  }
})

// POST / — insert
app.post('/', async (c) => {
  try {
    const body = await c.req.json()
    const [row] = await db
      .insert(caregiverCareTypeRates)
      .values(body)
      .returning()
    return c.json(row, 201)
  } catch (error: any) {
    return c.json({ error: error.message }, 500)
  }
})

// PUT /:id — update by id
app.put('/:id', async (c) => {
  try {
    const id = c.req.param('id')
    const body = await c.req.json()
    const [row] = await db
      .update(caregiverCareTypeRates)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(caregiverCareTypeRates.id, id))
      .returning()
    return c.json(row)
  } catch (error: any) {
    return c.json({ error: error.message }, 500)
  }
})

export default app
