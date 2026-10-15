// /api/schedules-enhanced — list schedules, and the Schedule Hub / grid's create (single, recurring,
// bi-weekly, split, training). POST ported from the CVHC home care CRM (clinicalRoutes.js
// POST /schedules-enhanced).
import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { schedules, users, clients } from '../../db/schema.ts'
import { eq, and, gte, lte, sql } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { authenticate, requireAdmin } from '../middleware/auth.ts'
import { one, scheduleById, userIdOf } from '../helpers/scheduleRows.ts'
import { schedTs, hms, shiftHours, DATE_RE } from '../services/scheduleOccurrences.ts'
import { alignBiweeklyAnchor } from '../helpers/biweekly.ts'
import { checkAuthorizationBalance } from '../helpers/authorizationCheck.ts'
import { agencyNow } from '../helpers/agencyTime.ts'
import { recordAudit } from '../services/visitNotify.ts'

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

const isDup = (e: any) => e?.code === '23505' || /unique|duplicate key/i.test(e?.message || '')

// POST /api/schedules-enhanced
app.post('/', requireAdmin, async (c) => {
  const user = c.get('user') as any
  const b = await c.req.json().catch(() => ({})) as any
  const { caregiverId, clientId, scheduleType, date, notes, frequency, splitShift, isTraining } = b
  const startTime = hms(b.startTime), endTime = hms(b.endTime)
  if (!caregiverId || !clientId || !startTime || !endTime) return c.json({ error: 'Missing required fields' }, 400)
  if (startTime === endTime) return c.json({ error: 'Start and end time cannot be the same' }, 400)

  const dayOfWeek = b.dayOfWeek === '' || b.dayOfWeek === null || b.dayOfWeek === undefined ? null : Number(b.dayOfWeek)
  const isRecurring = dayOfWeek !== null
  if (isRecurring && !(Number.isInteger(dayOfWeek) && dayOfWeek! >= 0 && dayOfWeek! <= 6)) return c.json({ error: 'dayOfWeek must be 0 (Sunday) to 6 (Saturday).' }, 400)
  if (!isRecurring && !(date && DATE_RE.test(date))) return c.json({ error: 'A one-time shift needs its date (YYYY-MM-DD).' }, 400)

  // A recurring pattern's effective date is never in the past (it would back-bill / back-pay);
  // a past start date is pulled forward to today and the response says so.
  const { date: today } = await agencyNow()
  let effectiveDate: string | null = b.effectiveDate || null
  let effectiveDateClamped = false
  if (isRecurring) {
    if (effectiveDate && effectiveDate < today) effectiveDateClamped = true
    effectiveDate = (effectiveDate && effectiveDate >= today) ? effectiveDate : today
  }
  // Bi-weekly: the anchor sits on the row's own weekday (see helpers/biweekly.ts).
  let anchorDate: string | null = b.anchorDate || null
  if (isRecurring && (frequency || 'weekly') === 'biweekly') {
    anchorDate = alignBiweeklyAnchor({ anchorDate: b.anchorDate, effectiveDate, dayOfWeek })
  }

  let totalHours = shiftHours(startTime, endTime)
  if (splitShift?.startTime && splitShift?.endTime) totalHours += shiftHours(splitShift.startTime, splitShift.endTime)
  const authCheck = isTraining ? { warnings: [] as string[] } : await checkAuthorizationBalance(clientId, totalHours)
  const base = isRecurring ? effectiveDate! : date

  const insert = async (start: string, end: string, split?: { group: string; segment: number }) => {
    const id = createId()
    await db.execute(sql`
      INSERT INTO schedules (id, caregiver_id, client_id, schedule_type, day_of_week, date, start_time, end_time, notes,
                             frequency, effective_date, anchor_date, is_split_shift, split_shift_group_id, split_segment,
                             is_training, is_active, status, created_at, updated_at)
      VALUES (${id}, ${caregiverId}, ${clientId}, ${scheduleType || (isRecurring ? 'recurring' : 'one-time')}, ${dayOfWeek},
              ${isRecurring ? null : date}::date, ${schedTs(start, base)}::timestamp, ${schedTs(end, base)}::timestamp,
              ${notes || null}, ${frequency || 'weekly'}, ${effectiveDate}::date, ${anchorDate}::date,
              ${!!split}, ${split?.group ?? null}, ${split?.segment ?? null}, ${!!isTraining}, true, 'active', NOW(), NOW())`)
    return id
  }

  // A one-time shift overlapping one the caregiver already has that day.
  const oneTimeConflict = async (start: string, end: string) => !isRecurring && !!(await one(sql`
    SELECT id FROM schedules WHERE caregiver_id = ${caregiverId} AND is_active = true AND date = ${date}::date
       AND NOT (end_time::time <= ${start}::time OR start_time::time >= ${end}::time)`))

  try {
    if (splitShift) {
      const s2 = hms(splitShift.startTime), e2 = hms(splitShift.endTime)
      if (!s2 || !e2) return c.json({ error: 'Split shift requires startTime and endTime' }, 400)
      if (s2 <= endTime) return c.json({ error: 'Split shift segment 2 must start after segment 1 ends' }, 400)
      if (await oneTimeConflict(startTime, endTime)) return c.json({ error: 'Caregiver has a conflicting schedule during segment 1' }, 400)
      if (await oneTimeConflict(s2, e2)) return c.json({ error: 'Caregiver has a conflicting schedule during segment 2' }, 400)
      const group = createId()
      const id1 = await insert(startTime, endTime, { group, segment: 1 })
      const id2 = await insert(s2, e2, { group, segment: 2 })
      const segments = [await scheduleById(id1), await scheduleById(id2)]
      await recordAudit(userIdOf(user), 'CREATE', 'schedules', id1, null, { splitShift: true, segments })
      return c.json({ splitShift: true, segments, effectiveDateClamped, effectiveDate, anchorDate, authWarnings: authCheck.warnings }, 201)
    }

    // One-time duplicate guard: a double-submit returns the existing row, not a billable twin.
    if (!isRecurring) {
      const existing = await one<any>(sql`
        SELECT id FROM schedules WHERE is_active = true AND day_of_week IS NULL
           AND caregiver_id = ${caregiverId} AND client_id = ${clientId} AND date = ${date}::date
           AND start_time::time = ${startTime}::time AND end_time::time = ${endTime}::time LIMIT 1`)
      if (existing) {
        return c.json({ ...(await scheduleById(existing.id)), duplicate: true, effectiveDateClamped, effectiveDate, authWarnings: authCheck.warnings }, 200)
      }
    }
    const id = await insert(startTime, endTime)
    const row = await scheduleById(id)
    await recordAudit(userIdOf(user), 'CREATE', 'schedules', id, null, row)
    return c.json({ ...row, effectiveDateClamped, effectiveDate, anchorDate, authWarnings: authCheck.warnings }, 201)
  } catch (e: any) {
    if (isDup(e)) return c.json({ error: 'This caregiver already has this exact shift (same client, day, and time).', duplicate: true }, 409)
    throw e
  }
})

export default app
