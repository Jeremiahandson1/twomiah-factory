import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { backgroundChecks, users } from '../../db/schema.ts'
import { eq, and, lte } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)

// Helper to strip sensitive fields from a record
function stripSensitive(row: any) {
  if (!row) return row
  const { ssnEncrypted, driversLicenseEncrypted, ...safe } = row
  return safe
}

// GET / — list with ?status, ?type filters, join users for caregiver name
app.get('/', async (c) => {
  try {
    const status = c.req.query('status')
    const type = c.req.query('type')

    const conditions: any[] = []
    if (status) conditions.push(eq(backgroundChecks.status, status))
    if (type) conditions.push(eq(backgroundChecks.checkType, type))

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined

    const rows = await db
      .select({
        id: backgroundChecks.id,
        caregiverId: backgroundChecks.caregiverId,
        checkType: backgroundChecks.checkType,
        provider: backgroundChecks.provider,
        cost: backgroundChecks.cost,
        status: backgroundChecks.status,
        initiatedDate: backgroundChecks.initiatedDate,
        expirationDate: backgroundChecks.expirationDate,
        worcsReferenceNumber: backgroundChecks.worcsReferenceNumber,
        worcsStatus: backgroundChecks.worcsStatus,
        driversLicenseState: backgroundChecks.driversLicenseState,
        notes: backgroundChecks.notes,
        createdById: backgroundChecks.createdById,
        createdAt: backgroundChecks.createdAt,
        updatedAt: backgroundChecks.updatedAt,
        caregiverFirstName: users.firstName,
        caregiverLastName: users.lastName,
      })
      .from(backgroundChecks)
      .leftJoin(users, eq(backgroundChecks.caregiverId, users.id))
      .where(whereClause)

    return c.json(rows)
  } catch (error: any) {
    return c.json({ error: error.message }, 500)
  }
})

// GET /overview/expiring — where expirationDate <= 30 days from now
app.get('/overview/expiring', async (c) => {
  try {
    const thirtyDaysFromNow = new Date()
    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30)
    const dateStr = thirtyDaysFromNow.toISOString().split('T')[0]

    const rows = await db
      .select({
        id: backgroundChecks.id,
        caregiverId: backgroundChecks.caregiverId,
        checkType: backgroundChecks.checkType,
        provider: backgroundChecks.provider,
        cost: backgroundChecks.cost,
        status: backgroundChecks.status,
        initiatedDate: backgroundChecks.initiatedDate,
        expirationDate: backgroundChecks.expirationDate,
        worcsReferenceNumber: backgroundChecks.worcsReferenceNumber,
        worcsStatus: backgroundChecks.worcsStatus,
        driversLicenseState: backgroundChecks.driversLicenseState,
        notes: backgroundChecks.notes,
        createdById: backgroundChecks.createdById,
        createdAt: backgroundChecks.createdAt,
        updatedAt: backgroundChecks.updatedAt,
        caregiverFirstName: users.firstName,
        caregiverLastName: users.lastName,
      })
      .from(backgroundChecks)
      .leftJoin(users, eq(backgroundChecks.caregiverId, users.id))
      .where(lte(backgroundChecks.expirationDate, dateStr))

    return c.json(rows)
  } catch (error: any) {
    return c.json({ error: error.message }, 500)
  }
})

// GET /caregiver/:id — filter by caregiverId
app.get('/caregiver/:id', async (c) => {
  try {
    const caregiverId = c.req.param('id')
    const rows = await db
      .select({
        id: backgroundChecks.id,
        caregiverId: backgroundChecks.caregiverId,
        checkType: backgroundChecks.checkType,
        provider: backgroundChecks.provider,
        cost: backgroundChecks.cost,
        status: backgroundChecks.status,
        initiatedDate: backgroundChecks.initiatedDate,
        expirationDate: backgroundChecks.expirationDate,
        worcsReferenceNumber: backgroundChecks.worcsReferenceNumber,
        worcsStatus: backgroundChecks.worcsStatus,
        driversLicenseState: backgroundChecks.driversLicenseState,
        notes: backgroundChecks.notes,
        createdById: backgroundChecks.createdById,
        createdAt: backgroundChecks.createdAt,
        updatedAt: backgroundChecks.updatedAt,
      })
      .from(backgroundChecks)
      .where(eq(backgroundChecks.caregiverId, caregiverId))

    return c.json(rows)
  } catch (error: any) {
    return c.json({ error: error.message }, 500)
  }
})

// POST / — insert
app.post('/', async (c) => {
  try {
    const body = await c.req.json()
    const [row] = await db.insert(backgroundChecks).values(body).returning()
    return c.json(stripSensitive(row), 201)
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
      .update(backgroundChecks)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(backgroundChecks.id, id))
      .returning()
    return c.json(stripSensitive(row))
  } catch (error: any) {
    return c.json({ error: error.message }, 500)
  }
})

export default app
