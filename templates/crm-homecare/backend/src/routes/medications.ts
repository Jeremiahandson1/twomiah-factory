import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { medications, medicationLogs } from '../../db/schema.ts'
import { eq, and, gte, lte, desc } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)

// GET /api/medications/client/:id — list active medications for client
app.get('/client/:id', async (c) => {
  const clientId = c.req.param('id')

  const rows = await db
    .select()
    .from(medications)
    .where(
      and(
        eq(medications.clientId, clientId),
        eq(medications.status, 'active')
      )
    )
    .orderBy(desc(medications.createdAt))

  return c.json(rows)
})

// GET /api/medications/logs/client/:id?startDate=&endDate=
app.get('/logs/client/:id', async (c) => {
  const clientId = c.req.param('id')
  const { startDate, endDate } = c.req.query()

  const conditions: any[] = [eq(medicationLogs.clientId, clientId)]
  if (startDate) conditions.push(gte(medicationLogs.administeredAt, new Date(startDate)))
  if (endDate) conditions.push(lte(medicationLogs.administeredAt, new Date(endDate)))

  const rows = await db
    .select()
    .from(medicationLogs)
    .where(and(...conditions))
    .orderBy(desc(medicationLogs.administeredAt))

  return c.json(rows)
})

// POST /api/medications
app.post('/', async (c) => {
  const body = await c.req.json()

  if (!body.clientId || !body.name) {
    return c.json({ error: 'clientId and name are required' }, 400)
  }

  const [row] = await db
    .insert(medications)
    .values({
      clientId: body.clientId,
      name: body.name,
      dosage: body.dosage,
      frequency: body.frequency,
      route: body.route,
      indication: body.indication,
      prescribedBy: body.prescribedBy,
      startDate: body.startDate,
      endDate: body.endDate,
      status: body.status || 'active',
      notes: body.notes,
    })
    .returning()

  return c.json(row, 201)
})

// PUT /api/medications/:id
app.put('/:id', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json()

  const [row] = await db
    .update(medications)
    .set({
      name: body.name,
      dosage: body.dosage,
      frequency: body.frequency,
      route: body.route,
      indication: body.indication,
      prescribedBy: body.prescribedBy,
      startDate: body.startDate,
      endDate: body.endDate,
      status: body.status,
      notes: body.notes,
      updatedAt: new Date(),
    })
    .where(eq(medications.id, id))
    .returning()

  if (!row) return c.json({ error: 'Medication not found' }, 404)
  return c.json(row)
})

// POST /api/medications/:id/discontinue
app.post('/:id/discontinue', async (c) => {
  const id = c.req.param('id')

  const [row] = await db
    .update(medications)
    .set({
      status: 'discontinued',
      endDate: new Date().toISOString().slice(0, 10),
      updatedAt: new Date(),
    })
    .where(eq(medications.id, id))
    .returning()

  if (!row) return c.json({ error: 'Medication not found' }, 404)
  return c.json(row)
})

// POST /api/medications/log
app.post('/log', async (c) => {
  const user = c.get('user') as any
  const body = await c.req.json()

  if (!body.medicationId || !body.clientId || !body.administeredAt) {
    return c.json({ error: 'medicationId, clientId, and administeredAt are required' }, 400)
  }

  const [row] = await db
    .insert(medicationLogs)
    .values({
      medicationId: body.medicationId,
      clientId: body.clientId,
      caregiverId: user.userId,
      administeredAt: new Date(body.administeredAt),
      status: body.status || 'given',
      notes: body.notes,
    })
    .returning()

  return c.json(row, 201)
})

export default app
