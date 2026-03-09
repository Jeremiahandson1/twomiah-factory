import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { mileageEntries, users, clients } from '../../db/schema.ts'
import { eq, and, gte, lte, desc, count } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)

// GET /api/mileage — list with filters and pagination
app.get('/', async (c) => {
  const { caregiverId, startDate, endDate, page = '1', limit = '50' } = c.req.query()
  const skip = (parseInt(page) - 1) * parseInt(limit)

  const conditions: any[] = []
  if (caregiverId) conditions.push(eq(mileageEntries.caregiverId, caregiverId))
  if (startDate) conditions.push(gte(mileageEntries.date, startDate))
  if (endDate) conditions.push(lte(mileageEntries.date, endDate))

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined

  const [rows, [{ value: total }]] = await Promise.all([
    db
      .select({
        id: mileageEntries.id,
        caregiverId: mileageEntries.caregiverId,
        date: mileageEntries.date,
        startLocation: mileageEntries.startLocation,
        endLocation: mileageEntries.endLocation,
        miles: mileageEntries.miles,
        ratePerMile: mileageEntries.ratePerMile,
        amount: mileageEntries.amount,
        clientId: mileageEntries.clientId,
        notes: mileageEntries.notes,
        createdAt: mileageEntries.createdAt,
        caregiverFirstName: users.firstName,
        caregiverLastName: users.lastName,
        clientFirstName: clients.firstName,
        clientLastName: clients.lastName,
      })
      .from(mileageEntries)
      .leftJoin(users, eq(mileageEntries.caregiverId, users.id))
      .leftJoin(clients, eq(mileageEntries.clientId, clients.id))
      .where(whereClause)
      .orderBy(desc(mileageEntries.date))
      .offset(skip)
      .limit(parseInt(limit)),
    db.select({ value: count() }).from(mileageEntries).where(whereClause),
  ])

  const entries = rows.map(({ caregiverFirstName, caregiverLastName, clientFirstName, clientLastName, ...entry }) => ({
    ...entry,
    caregiverName: caregiverFirstName ? `${caregiverFirstName} ${caregiverLastName}` : null,
    clientName: clientFirstName ? `${clientFirstName} ${clientLastName}` : null,
  }))

  return c.json({ entries, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) })
})

// POST /api/mileage — insert, auto-calculate amount
app.post('/', async (c) => {
  const user = c.get('user')
  const body = await c.req.json()

  const caregiverId = body.caregiverId || user.userId
  const miles = parseFloat(body.miles) || 0
  const ratePerMile = parseFloat(body.ratePerMile) || 0.67
  const amount = (miles * ratePerMile).toFixed(2)

  const [entry] = await db
    .insert(mileageEntries)
    .values({
      caregiverId,
      date: body.date,
      startLocation: body.startLocation,
      endLocation: body.endLocation,
      miles: String(miles),
      ratePerMile: String(ratePerMile),
      amount,
      clientId: body.clientId || null,
      notes: body.notes,
    })
    .returning()

  return c.json(entry, 201)
})

export default app
