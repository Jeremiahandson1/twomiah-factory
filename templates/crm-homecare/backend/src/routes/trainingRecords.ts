import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { trainingRecords, users } from '../../db/schema.ts'
import { eq, desc } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)

// GET /api/training-records
app.get('/', async (c) => {
  const { caregiverId } = c.req.query()

  const query = db
    .select({
      id: trainingRecords.id,
      caregiverId: trainingRecords.caregiverId,
      trainingName: trainingRecords.trainingName,
      provider: trainingRecords.provider,
      completedDate: trainingRecords.completedDate,
      expiryDate: trainingRecords.expiryDate,
      hoursCompleted: trainingRecords.hoursCompleted,
      certificateUrl: trainingRecords.certificateUrl,
      status: trainingRecords.status,
      createdAt: trainingRecords.createdAt,
      caregiverFirstName: users.firstName,
      caregiverLastName: users.lastName,
    })
    .from(trainingRecords)
    .leftJoin(users, eq(trainingRecords.caregiverId, users.id))
    .orderBy(desc(trainingRecords.createdAt))

  const rows = caregiverId
    ? await query.where(eq(trainingRecords.caregiverId, caregiverId))
    : await query

  return c.json(rows)
})

// GET /api/training-records/:id — get records for a specific caregiver
app.get('/:id', async (c) => {
  const caregiverId = c.req.param('id')

  const rows = await db
    .select({
      id: trainingRecords.id,
      caregiverId: trainingRecords.caregiverId,
      trainingName: trainingRecords.trainingName,
      provider: trainingRecords.provider,
      completedDate: trainingRecords.completedDate,
      expiryDate: trainingRecords.expiryDate,
      hoursCompleted: trainingRecords.hoursCompleted,
      certificateUrl: trainingRecords.certificateUrl,
      status: trainingRecords.status,
      createdAt: trainingRecords.createdAt,
      caregiverFirstName: users.firstName,
      caregiverLastName: users.lastName,
    })
    .from(trainingRecords)
    .leftJoin(users, eq(trainingRecords.caregiverId, users.id))
    .where(eq(trainingRecords.caregiverId, caregiverId))
    .orderBy(desc(trainingRecords.createdAt))

  return c.json(rows)
})

// POST /api/training-records
app.post('/', async (c) => {
  const body = await c.req.json()
  const [row] = await db.insert(trainingRecords).values(body).returning()
  return c.json(row, 201)
})

export default app
