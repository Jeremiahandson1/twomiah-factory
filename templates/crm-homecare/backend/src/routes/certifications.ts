import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { certificationRecords } from '../../db/schema.ts'
import { eq, desc } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)

// GET /api/certifications?caregiverId=
app.get('/', async (c) => {
  const { caregiverId } = c.req.query()

  const rows = caregiverId
    ? await db.select().from(certificationRecords).where(eq(certificationRecords.caregiverId, caregiverId)).orderBy(desc(certificationRecords.createdAt))
    : await db.select().from(certificationRecords).orderBy(desc(certificationRecords.createdAt)).limit(500)

  return c.json(rows)
})

// GET /api/certifications/caregiver/:id
app.get('/caregiver/:id', async (c) => {
  const caregiverId = c.req.param('id')

  const rows = await db
    .select()
    .from(certificationRecords)
    .where(eq(certificationRecords.caregiverId, caregiverId))
    .orderBy(desc(certificationRecords.createdAt))

  return c.json(rows)
})

// POST /api/certifications
app.post('/', async (c) => {
  const body = await c.req.json()

  if (!body.caregiverId || !body.certificationType) {
    return c.json({ error: 'caregiverId and certificationType are required' }, 400)
  }

  const [row] = await db
    .insert(certificationRecords)
    .values({
      caregiverId: body.caregiverId,
      certificationType: body.certificationType,
      issuingBody: body.issuingBody,
      issueDate: body.issueDate,
      expiryDate: body.expiryDate,
      documentUrl: body.documentUrl,
      status: body.status || 'active',
    })
    .returning()

  return c.json(row, 201)
})

// DELETE /api/certifications/:id
app.delete('/:id', async (c) => {
  const id = c.req.param('id')

  const [row] = await db
    .delete(certificationRecords)
    .where(eq(certificationRecords.id, id))
    .returning()

  if (!row) return c.json({ error: 'Certification not found' }, 404)
  return c.json({ success: true })
})

export default app
