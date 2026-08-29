import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { schedules, users, clients } from '../../db/schema.ts'
import { eq, and, gte, lte } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)

// GET /api/schedules-enhanced
app.get('/', async (c) => {
  const { startDate, endDate, caregiverId, clientId } = c.req.query()
  const conditions: any[] = [eq(schedules.isActive, true)]
  if (caregiverId) conditions.push(eq(schedules.caregiverId, caregiverId))
  if (clientId) conditions.push(eq(schedules.clientId, clientId))
  if (startDate) conditions.push(gte(schedules.startTime, new Date(startDate)))
  if (endDate) conditions.push(lte(schedules.startTime, new Date(endDate)))

  const rows = await db
    .select({
      id: schedules.id,
      clientId: schedules.clientId,
      caregiverId: schedules.caregiverId,
      title: schedules.title,
      startTime: schedules.startTime,
      endTime: schedules.endTime,
      frequency: schedules.frequency,
      effectiveDate: schedules.effectiveDate,
      anchorDate: schedules.anchorDate,
      scheduleType: schedules.scheduleType,
      isActive: schedules.isActive,
      dayOfWeek: schedules.dayOfWeek,
      notes: schedules.notes,
      createdAt: schedules.createdAt,
      updatedAt: schedules.updatedAt,
      caregiverFirstName: users.firstName,
      caregiverLastName: users.lastName,
      clientFirstName: clients.firstName,
      clientLastName: clients.lastName,
    })
    .from(schedules)
    .leftJoin(users, eq(schedules.caregiverId, users.id))
    .leftJoin(clients, eq(schedules.clientId, clients.id))
    .where(and(...conditions))

  return c.json(rows)
})

// POST /api/schedules-enhanced — insert with conflict detection
app.post('/', async (c) => {
  const body = await c.req.json()

  // start_time/end_time are TIMESTAMP columns, but the client sends "HH:MM" plus
  // a date (single) or dayOfWeek + effectiveDate (recurring). new Date("09:00") is
  // Invalid, which crashed both the conflict query (toISOString) and the insert.
  // Combine the wall-clock time with the schedule's date into a real datetime.
  const baseDate = body.date || body.effectiveDate || body.anchorDate || new Date().toISOString().slice(0, 10)
  const toTs = (t: unknown): Date | null => {
    if (!t) return null
    const str = String(t)
    if (/^\d{4}-\d{2}-\d{2}T/.test(str)) { const d = new Date(str); return isNaN(d.getTime()) ? null : d }
    const m = str.match(/^(\d{1,2}):(\d{2})/)
    if (!m) return null
    const d = new Date(`${baseDate}T${m[1].padStart(2, '0')}:${m[2]}:00`)
    return isNaN(d.getTime()) ? null : d
  }
  const startTs = toTs(body.startTime)
  const endTs = toTs(body.endTime)
  if (!body.caregiverId || !body.clientId) return c.json({ error: 'A caregiver and client are required.' }, 400)
  if (!startTs || !endTs) return c.json({ error: 'A valid start and end time are required.' }, 400)

  // Conflict check with the normalized timestamps.
  const existing = await db
    .select()
    .from(schedules)
    .where(
      and(
        eq(schedules.caregiverId, body.caregiverId),
        eq(schedules.isActive, true),
        lte(schedules.startTime, endTs),
        gte(schedules.endTime, startTs),
      )
    )
  const conflicts = existing

  // Insert only known columns; coerce empty strings to null (untouched optional
  // inputs were posting "" into date/int/FK columns and 500ing — Cause C).
  const clean = (v: unknown) => (v === '' || v === undefined ? null : v)
  const [row] = await db.insert(schedules).values({
    clientId: body.clientId,
    caregiverId: body.caregiverId,
    title: clean(body.title) as any,
    startTime: startTs,
    endTime: endTs,
    frequency: body.frequency || 'weekly',
    effectiveDate: clean(body.effectiveDate) as any,
    anchorDate: clean(body.anchorDate) as any,
    scheduleType: body.scheduleType || 'recurring',
    isActive: true,
    dayOfWeek: body.dayOfWeek === '' || body.dayOfWeek == null ? null : Number(body.dayOfWeek),
    date: clean(body.date) as any,
    notes: clean(body.notes) as any,
    careTypeId: clean(body.careTypeId) as any,
    status: body.status || 'active',
  }).returning()

  return c.json({
    ...row,
    conflicts,
    valid: conflicts.length === 0,
  }, 201)
})

export default app
