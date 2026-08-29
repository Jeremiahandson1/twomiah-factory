import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { incidents, users, clients } from '../../db/schema.ts'
import { eq, and, desc, sql } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)

// GET /api/incidents?status=&severity=
app.get('/', async (c) => {
  const { status, severity } = c.req.query()

  const conditions: any[] = []
  if (status) conditions.push(eq(incidents.investigationStatus, status))
  if (severity) conditions.push(eq(incidents.severity, severity))

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined

  // Alias for caregiver user join
  const caregiver = users

  const rows = await db
    .select({
      id: incidents.id,
      clientId: incidents.clientId,
      caregiverId: incidents.caregiverId,
      incidentType: incidents.incidentType,
      severity: incidents.severity,
      date: incidents.date,
      description: incidents.description,
      involvedParties: incidents.involvedParties,
      actionTaken: incidents.actionTaken,
      investigationStatus: incidents.investigationStatus,
      resolvedAt: incidents.resolvedAt,
      resolvedById: incidents.resolvedById,
      reportedById: incidents.reportedById,
      createdAt: incidents.createdAt,
      updatedAt: incidents.updatedAt,
      caregiverFirstName: caregiver.firstName,
      caregiverLastName: caregiver.lastName,
      clientFirstName: clients.firstName,
      clientLastName: clients.lastName,
    })
    .from(incidents)
    .leftJoin(caregiver, eq(incidents.caregiverId, caregiver.id))
    .leftJoin(clients, eq(incidents.clientId, clients.id))
    .where(whereClause)
    .orderBy(desc(incidents.date))
    .limit(200)

  return c.json(rows)
})

// POST /api/incidents
app.post('/', async (c) => {
  const user = c.get('user') as any
  const body = await c.req.json()

  // The form posts `incidentDate`; accept it as an alias for `date` so a fully
  // completed incident isn't rejected. (Incident reports are legally mandatory.)
  const date = body.date ?? body.incidentDate

  if (!body.incidentType || !body.description || !date) {
    return c.json({ error: 'incidentType, description, and date are required' }, 400)
  }

  const [row] = await db
    .insert(incidents)
    .values({
      clientId: body.clientId,
      // Optional FK/text: the form posts "" when left blank, which crashes the
      // insert (empty string into a uuid FK column → 500). Treat blank as absent. (C-05)
      caregiverId: body.caregiverId || null,
      incidentType: body.incidentType,
      severity: body.severity || 'low',
      date: date,
      description: body.description,
      involvedParties: body.involvedParties || null,
      actionTaken: body.actionTaken || null,
      investigationStatus: body.investigationStatus || 'open',
      reportedById: user.userId,
    })
    .returning()

  return c.json(row, 201)
})

// PUT /api/incidents/:id
app.put('/:id', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json()

  const [row] = await db
    .update(incidents)
    .set({
      clientId: body.clientId,
      caregiverId: body.caregiverId,
      incidentType: body.incidentType,
      severity: body.severity,
      date: body.date,
      description: body.description,
      involvedParties: body.involvedParties,
      actionTaken: body.actionTaken,
      investigationStatus: body.investigationStatus,
      resolvedAt: body.resolvedAt ? new Date(body.resolvedAt) : undefined,
      resolvedById: body.resolvedById,
      updatedAt: new Date(),
    })
    .where(eq(incidents.id, id))
    .returning()

  if (!row) return c.json({ error: 'Incident not found' }, 404)
  return c.json(row)
})

// Delete was missing entirely — the UI's delete control 404'd then showed nothing. (M-14)
app.delete('/:id', async (c) => {
  const id = c.req.param('id')
  const [row] = await db.delete(incidents).where(eq(incidents.id, id)).returning()
  if (!row) return c.json({ error: 'Incident not found' }, 404)
  return c.json({ success: true })
})

export default app
