import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { trainingRecords, users } from '../../db/schema.ts'
import { eq, desc } from 'drizzle-orm'
import { authenticate, requireAdmin } from '../middleware/auth.ts'

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

// POST /api/training-records — the office records training
app.post('/', requireAdmin, async (c) => {
  const body = await c.req.json().catch(() => ({})) as any
  if (!body.caregiverId || !body.trainingName) return c.json({ error: 'caregiverId and trainingName are required' }, 400)
  const user = c.get('user') as any
  const [row] = await db.insert(trainingRecords).values({
    caregiverId: body.caregiverId,
    trainingName: body.trainingName,
    provider: body.provider || null,
    completedDate: body.completedDate || null,
    expiryDate: body.expiryDate || null,
    hoursCompleted: body.hoursCompleted === '' || body.hoursCompleted == null ? null : String(body.hoursCompleted),
    certificateUrl: body.certificateUrl || null,
    certificationNumber: body.certificationNumber || null,
    status: body.status || 'completed',
    recordedById: user?.userId || null,
  }).returning()
  return c.json(row, 201)
})

// DELETE /api/training-records/:id
app.delete('/:id', requireAdmin, async (c) => {
  const [row] = await db.delete(trainingRecords).where(eq(trainingRecords.id, c.req.param('id'))).returning({ id: trainingRecords.id })
  if (!row) return c.json({ error: 'Training record not found' }, 404)
  return c.json({ success: true })
})

export default app
