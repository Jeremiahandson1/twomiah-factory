import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { adlRequirements, adlLogs, users, clients, timeEntries } from '../../db/schema.ts'
import { eq, and, desc, gte, lte, sql } from 'drizzle-orm'
import { authenticate, requireAdmin } from '../middleware/auth.ts'
import { isOffice, userIdOf, rowsOf } from '../helpers/careAudit.ts'
import { requireClientAccess, maySeeClient, careWriteRefusal } from '../helpers/caregiverAccess.ts'

// A caregiver reads and logs ADLs only for the clients they serve (helpers/caregiverAccess.ts).
const app = new Hono()
app.use('*', authenticate)

const YMD = /^\d{4}-\d{2}-\d{2}$/

// The ADL categories the screens offer.
export const ADL_CATEGORIES = [
  { id: 'bathing', name: 'Bathing', icon: '🛁' },
  { id: 'dressing', name: 'Dressing', icon: '👕' },
  { id: 'grooming', name: 'Grooming', icon: '💇' },
  { id: 'feeding', name: 'Feeding/Eating', icon: '🍽️' },
  { id: 'toileting', name: 'Toileting', icon: '🚽' },
  { id: 'transferring', name: 'Transferring', icon: '🧑‍🦽' },
  { id: 'mobility', name: 'Mobility', icon: '🚶' },
  { id: 'medication', name: 'Medication Reminders', icon: '💊' },
  { id: 'housekeeping', name: 'Light Housekeeping', icon: '🧹' },
  { id: 'laundry', name: 'Laundry', icon: '🧺' },
  { id: 'meal_prep', name: 'Meal Preparation', icon: '👨‍🍳' },
  { id: 'companionship', name: 'Companionship', icon: '💬' },
  { id: 'errands', name: 'Errands/Shopping', icon: '🛒' },
  { id: 'transportation', name: 'Transportation', icon: '🚗' },
]

app.get('/categories', (c) => c.json(ADL_CATEGORIES))

// GET /api/adl/client/:clientId/requirements
app.get('/client/:clientId/requirements', requireClientAccess(), async (c) => {
  const { clientId } = c.req.param()

  const rows = await db
    .select()
    .from(adlRequirements)
    .where(and(eq(adlRequirements.clientId, clientId), eq(adlRequirements.isActive, true)))
    .orderBy(adlRequirements.adlCategory)

  return c.json(rows)
})

const LOG_FIELDS = {
  id: adlLogs.id,
  clientId: adlLogs.clientId,
  caregiverId: adlLogs.caregiverId,
  timeEntryId: adlLogs.timeEntryId,
  adlCategory: adlLogs.adlCategory,
  status: adlLogs.status,
  assistanceLevel: adlLogs.assistanceLevel,
  performedAt: adlLogs.performedAt,
  notes: adlLogs.notes,
  createdAt: adlLogs.createdAt,
  // the names the screens read (caregiver_first / caregiver_last)
  caregiverFirst: users.firstName,
  caregiverLast: users.lastName,
}

// GET /api/adl/client/:clientId/logs?startDate=&endDate=
app.get('/client/:clientId/logs', requireClientAccess(), async (c) => {
  const { clientId } = c.req.param()
  const { startDate, endDate } = c.req.query()

  const conditions: any[] = [eq(adlLogs.clientId, clientId)]
  if (startDate && !isNaN(new Date(startDate).getTime())) conditions.push(gte(adlLogs.performedAt, new Date(startDate)))
  if (endDate && !isNaN(new Date(endDate + 'T23:59:59').getTime())) conditions.push(lte(adlLogs.performedAt, new Date(endDate + 'T23:59:59')))

  const rows = await db
    .select(LOG_FIELDS)
    .from(adlLogs)
    .leftJoin(users, eq(adlLogs.caregiverId, users.id))
    .where(and(...conditions))
    .orderBy(desc(adlLogs.performedAt))

  return c.json(rows)
})

// GET /api/adl/logs/time-entry/:timeEntryId — what was logged on one visit
app.get('/logs/time-entry/:timeEntryId', async (c) => {
  // A caregiver reads their own visit's log, or one for a client they care for (as the MAR's).
  const user = c.get('user') as any
  if (!isOffice(user)) {
    const [te] = await db.select({ clientId: timeEntries.clientId, caregiverId: timeEntries.caregiverId }).from(timeEntries).where(eq(timeEntries.id, c.req.param('timeEntryId'))).limit(1)
    if (!te) return c.json({ error: 'Visit not found' }, 404)
    if (te.caregiverId !== userIdOf(user) && !(await maySeeClient(user, te.clientId))) return c.json({ error: 'You can only see the clients you care for.' }, 403)
  }
  const rows = await db
    .select(LOG_FIELDS)
    .from(adlLogs)
    .leftJoin(users, eq(adlLogs.caregiverId, users.id))
    .where(eq(adlLogs.timeEntryId, c.req.param('timeEntryId')))
    .orderBy(adlLogs.performedAt)
  return c.json(rows)
})

// GET /api/adl/reports/completion/:clientId?startDate&endDate — per category, default last 30 days
app.get('/reports/completion/:clientId', requireClientAccess(), async (c) => {
  const { startDate, endDate } = c.req.query()
  const from = startDate && YMD.test(startDate) ? startDate : null
  const to = endDate && YMD.test(endDate) ? endDate : null
  const rows = rowsOf(await db.execute(sql`
    SELECT al.adl_category,
           COUNT(*)::int AS total_entries,
           COUNT(*) FILTER (WHERE al.status = 'completed')::int AS completed_count,
           COUNT(*) FILTER (WHERE al.status = 'partial')::int AS partial_count,
           COUNT(*) FILTER (WHERE al.status = 'refused')::int AS refused_count,
           COUNT(*) FILTER (WHERE al.status = 'not_needed')::int AS not_needed_count
      FROM adl_logs al
     WHERE al.client_id = ${c.req.param('clientId')}
       AND al.performed_at >= COALESCE(${from}::date, CURRENT_DATE - INTERVAL '30 days')
       AND al.performed_at <= COALESCE(${to}::date, CURRENT_DATE) + INTERVAL '1 day'
     GROUP BY al.adl_category
     ORDER BY al.adl_category`))
  return c.json(rows)
})

// POST /api/adl/requirements
app.post('/requirements', requireAdmin, async (c) => {
  const body = await c.req.json()
  const { clientId, adlCategory, assistanceLevel, frequency, specialInstructions } = body

  if (!clientId || !adlCategory || !assistanceLevel) {
    return c.json({ error: 'clientId, adlCategory, and assistanceLevel are required' }, 400)
  }

  const [row] = await db.insert(adlRequirements).values({
    clientId,
    adlCategory,
    assistanceLevel,
    frequency,
    specialInstructions,
  }).returning()

  return c.json(row, 201)
})

// PUT /api/adl/requirements/:reqId — assistance level, frequency, instructions (only those sent)
app.put('/requirements/:reqId', requireAdmin, async (c) => {
  const b = await c.req.json().catch(() => ({}))
  const set: Record<string, unknown> = { updatedAt: new Date() }
  if (b.assistanceLevel) set.assistanceLevel = b.assistanceLevel
  if (b.frequency !== undefined && b.frequency !== null) set.frequency = b.frequency
  if (b.specialInstructions !== undefined && b.specialInstructions !== null) set.specialInstructions = b.specialInstructions
  const [row] = await db.update(adlRequirements).set(set).where(eq(adlRequirements.id, c.req.param('reqId'))).returning()
  if (!row) return c.json({ error: 'Requirement not found' }, 404)
  return c.json(row)
})

// DELETE /api/adl/requirements/:reqId
app.delete('/requirements/:reqId', requireAdmin, async (c) => {
  const { reqId } = c.req.param()

  await db.update(adlRequirements)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(adlRequirements.id, reqId))

  return c.json({ ok: true })
})

// POST /api/adl/log
// The office may attribute a logged ADL to the caregiver who performed it (back-entering visit
// records) and back-date it; everyone else always logs as themselves. timeEntryId ties the entry
// to the visit it was recorded on — a caregiver may only name their own.
app.post('/log', async (c) => {
  const user = c.get('user') as any
  const body = await c.req.json()
  const { clientId, adlCategory, status, assistanceLevel, performedAt, notes, caregiverId, timeEntryId } = body

  if (!clientId || !adlCategory || !status) {
    return c.json({ error: 'clientId, adlCategory, and status are required' }, 400)
  }
  const refused = await careWriteRefusal(c, clientId)
  if (refused) return refused
  let when = new Date()
  if (performedAt) {
    when = new Date(performedAt)
    if (isNaN(when.getTime())) return c.json({ error: 'Please enter the date and time this activity was performed' }, 400)
  }
  const [client] = await db.select({ id: clients.id }).from(clients).where(eq(clients.id, clientId)).limit(1)
  if (!client) return c.json({ error: 'Client not found' }, 404)

  let performedBy = userIdOf(user)
  if (isOffice(user) && caregiverId) {
    const [cg] = await db.select({ id: users.id }).from(users).where(eq(users.id, caregiverId)).limit(1)
    if (!cg) return c.json({ error: 'Caregiver not found' }, 404)
    performedBy = cg.id
  }
  if (timeEntryId) {
    const [te] = await db.select({ clientId: timeEntries.clientId, caregiverId: timeEntries.caregiverId }).from(timeEntries).where(eq(timeEntries.id, timeEntryId)).limit(1)
    if (!te || te.clientId !== clientId) return c.json({ error: 'That visit is not this client\'s' }, 400)
    if (!isOffice(user) && te.caregiverId !== userIdOf(user)) return c.json({ error: 'Not your shift' }, 403)
  }

  const [row] = await db.insert(adlLogs).values({
    clientId,
    caregiverId: performedBy,
    timeEntryId: timeEntryId || null,
    adlCategory,
    status,
    assistanceLevel,
    performedAt: when,
    notes,
  }).returning()

  return c.json(row, 201)
})

export default app
