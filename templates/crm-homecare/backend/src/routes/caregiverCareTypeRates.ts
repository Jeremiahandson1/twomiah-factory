import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { caregiverCareTypeRates, careTypes } from '../../db/schema.ts'
import { eq } from 'drizzle-orm'
import { authenticate, requireAdmin } from '../middleware/auth.ts'
import { selfSubject } from '../helpers/selfService.ts'

const app = new Hono()
app.use('*', authenticate)
// A caregiver's pay per care type is the office's to set — never the caregiver's own (writes: office).

// GET / — list with ?caregiverId filter, join careTypes for name. Pay: the office reads anyone's (or
// all); a caregiver only their own.
app.get('/', async (c) => {
  try {
    const who = selfSubject(c, c.req.query('caregiverId'))
    if ('refusal' in who) return who.refusal
    const caregiverId = who.office ? c.req.query('caregiverId') : who.id

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
app.post('/', requireAdmin, async (c) => {
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
app.put('/:id', requireAdmin, async (c) => {
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
