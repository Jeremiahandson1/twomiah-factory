import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { prospectAppointments, lead } from '../../db/schema.ts'
import { eq, and, gte, lte, desc, sql } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)

// GET /api/prospect-appointments — list with ?month, ?year filters
app.get('/', async (c) => {
  const { month, year } = c.req.query()

  const conditions: any[] = []

  if (month && year) {
    const m = parseInt(month)
    const y = parseInt(year)
    const startDate = `${y}-${String(m).padStart(2, '0')}-01`
    const endMonth = m === 12 ? 1 : m + 1
    const endYear = m === 12 ? y + 1 : y
    const endDate = `${endYear}-${String(endMonth).padStart(2, '0')}-01`
    conditions.push(gte(prospectAppointments.scheduledDate, startDate))
    conditions.push(lte(prospectAppointments.scheduledDate, endDate))
  } else if (year) {
    conditions.push(gte(prospectAppointments.scheduledDate, `${year}-01-01`))
    conditions.push(lte(prospectAppointments.scheduledDate, `${year}-12-31`))
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined

  const rows = await db
    .select({
      id: prospectAppointments.id,
      leadId: prospectAppointments.leadId,
      scheduledDate: prospectAppointments.scheduledDate,
      scheduledTime: prospectAppointments.scheduledTime,
      notes: prospectAppointments.notes,
      status: prospectAppointments.status,
      createdById: prospectAppointments.createdById,
      createdAt: prospectAppointments.createdAt,
      homeownerName: lead.homeownerName,
    })
    .from(prospectAppointments)
    .leftJoin(lead, eq(prospectAppointments.leadId, lead.id))
    .where(whereClause)
    .orderBy(desc(prospectAppointments.scheduledDate))

  return c.json(rows)
})

// POST /api/prospect-appointments — insert
app.post('/', async (c) => {
  const user = c.get('user')
  const body = await c.req.json()

  const [appointment] = await db
    .insert(prospectAppointments)
    .values({
      leadId: body.leadId,
      scheduledDate: body.scheduledDate,
      scheduledTime: body.scheduledTime,
      notes: body.notes,
      status: body.status || 'scheduled',
      createdById: user.userId,
    })
    .returning()

  return c.json(appointment, 201)
})

// DELETE /api/prospect-appointments/:id
app.delete('/:id', async (c) => {
  const id = c.req.param('id')

  const [deleted] = await db
    .delete(prospectAppointments)
    .where(eq(prospectAppointments.id, id))
    .returning()

  if (!deleted) return c.json({ error: 'Appointment not found' }, 404)

  return c.json({ success: true })
})

export default app
