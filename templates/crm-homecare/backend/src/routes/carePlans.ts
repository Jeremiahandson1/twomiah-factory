// Care plans & service agreements.
//
//   GET    /api/care-plans                       list (?clientId), with the client's name
//   GET    /api/care-plans/summary               counts (office)
//   GET    /api/care-plans/visit-schedule/:clientId   the client's live recurring schedule in words (office)
//   POST   /api/care-plans                       create (office)
//   POST   /api/care-plans/from-template/:templateId  a DRAFT plan pre-filled from a template (office)
//   PUT    /api/care-plans/:id                   update — only the fields sent; '' clears (office)
//   GET    /api/care-plans/:id/revisions         prior versions, newest first (office)
//   GET    /api/care-plans/:id/pdf               printable plan (office)
//   POST   /api/care-plans/:id/generate-schedule recurring shifts from the plan (office)
//   DELETE /api/care-plans/:id                   (office)
//
// Every content change is snapshotted to care_plan_revisions by a database trigger. The API sets
// crm.user_id on the same transaction as its UPDATE so the revision records who made the change.
//
// visitSchedule is never taken from the browser as text: 'current' makes the server copy the
// client's live schedule (dated today), '' clears it, absent leaves it alone.
import { Hono } from 'hono'
import { sql, eq, desc, asc, and } from 'drizzle-orm'
import { db } from '../../db/index.ts'
import { carePlans, carePlanTemplates, clients, users, agencies, clientEmergencyContacts, schedules } from '../../db/schema.ts'
import { authenticate, requireAdmin } from '../middleware/auth.ts'
import { getClientVisitSchedule } from '../services/carePlanSchedule.ts'
import { carePlanPdf, pdfFileName } from '../services/carePdf.ts'
import { isAssessmentSource } from '../services/assessmentImports.ts'
import { checkAuthorizationBalance } from '../helpers/authorizationCheck.ts'
import { shiftHours } from '../helpers/shiftHours.ts'
import { agencyTimezone } from '../services/agencyTime.ts'
import { userIdOf, writeCareAudit, rowsOf } from '../helpers/careAudit.ts'

const app = new Hono()
app.use('*', authenticate)

const YMD = /^\d{4}-\d{2}-\d{2}$/
const HHMM = /^\d{1,2}:\d{2}(:\d{2})?$/

// Body key -> column. Only keys present in the body are written; '' is written as NULL.
export const CARE_PLAN_FIELDS = {
  serviceType: 'serviceType', serviceDescription: 'serviceDescription', frequency: 'frequency',
  careGoals: 'careGoals', specialInstructions: 'specialInstructions', precautions: 'precautions',
  medicationNotes: 'medicationNotes', mobilityNotes: 'mobilityNotes', dietaryNotes: 'dietaryNotes',
  communicationNotes: 'communicationNotes', startDate: 'startDate', endDate: 'endDate',
} as const
const DATE_FIELDS = new Set(['startDate', 'endDate'])
const STATUSES = ['active', 'draft', 'inactive', 'completed']

async function resolveVisitSchedule(value: unknown, clientId: string): Promise<{ set: false } | { set: true; text: string | null; asOf: string | null } | { error: string }> {
  if (value === undefined) return { set: false }
  if (value === '' || value === null) return { set: true, text: null, asOf: null }
  if (value !== 'current') return { error: "visitSchedule must be 'current' or ''" }
  const sched = await getClientVisitSchedule(clientId)
  if (!sched.text) return { error: 'This client has no recurring visits scheduled in the next 4 weeks, so there is no schedule to save.' }
  return { set: true, text: sched.text, asOf: sched.asOf }
}

const planSelect = {
  plan: carePlans,
  clientFirstName: clients.firstName,
  clientLastName: clients.lastName,
}
const flatten = (r: any) => ({
  ...r.plan,
  clientFirstName: r.clientFirstName,
  clientLastName: r.clientLastName,
  clientName: `${r.clientFirstName || ''} ${r.clientLastName || ''}`.trim(),
})

// GET / — list all, ?clientId filter, newest first
app.get('/', async (c) => {
  const clientId = c.req.query('clientId')
  const rows = await db.select(planSelect).from(carePlans)
    .leftJoin(clients, eq(carePlans.clientId, clients.id))
    .where(clientId ? eq(carePlans.clientId, clientId) : undefined)
    .orderBy(desc(carePlans.createdAt))
  return c.json(rows.map(flatten))
})

app.get('/summary', requireAdmin, async (c) => {
  const [total, active, byServiceType, byClient] = await Promise.all([
    db.execute(sql`SELECT COUNT(*)::int AS total_plans FROM care_plans`),
    db.execute(sql`SELECT COUNT(*)::int AS active_plans FROM care_plans WHERE (start_date IS NULL OR start_date <= CURRENT_DATE) AND (end_date IS NULL OR end_date >= CURRENT_DATE)`),
    db.execute(sql`SELECT service_type, COUNT(*)::int AS count FROM care_plans GROUP BY service_type ORDER BY count DESC`),
    db.execute(sql`SELECT cl.id, cl.first_name || ' ' || cl.last_name AS client_name, COUNT(cp.id)::int AS plan_count
                     FROM clients cl LEFT JOIN care_plans cp ON cl.id = cp.client_id
                    GROUP BY cl.id, cl.first_name, cl.last_name HAVING COUNT(cp.id) > 0 ORDER BY plan_count DESC`),
  ])
  return c.json({
    total: rowsOf(total)[0]?.total_plans ?? 0,
    active: rowsOf(active)[0]?.active_plans ?? 0,
    byServiceType: rowsOf(byServiceType),
    byClient: rowsOf(byClient),
  })
})

app.get('/visit-schedule/:clientId', requireAdmin, async (c) => {
  return c.json(await getClientVisitSchedule(c.req.param('clientId')))
})

// POST / — create. clientId and serviceType are required.
app.post('/', requireAdmin, async (c) => {
  const user = c.get('user' as any)
  const b = await c.req.json().catch(() => ({}))
  if (!b.clientId || !b.serviceType) return c.json({ error: 'clientId and serviceType are required' }, 400)
  for (const k of DATE_FIELDS) {
    if (b[k] && !YMD.test(String(b[k]))) return c.json({ error: `${k} must be a date (YYYY-MM-DD)` }, 400)
  }
  const [client] = await db.select({ id: clients.id }).from(clients).where(eq(clients.id, b.clientId)).limit(1)
  if (!client) return c.json({ error: 'Client not found' }, 404)
  const snap = await resolveVisitSchedule(b.visitSchedule, b.clientId)
  if ('error' in snap) return c.json({ error: snap.error }, 400)

  const values: Record<string, unknown> = { clientId: b.clientId, createdById: userIdOf(user) }
  for (const key of Object.keys(CARE_PLAN_FIELDS)) values[key] = b[key] === '' || b[key] === undefined ? null : b[key]
  if (b.status && STATUSES.includes(b.status)) values.status = b.status
  if (snap.set) { values.visitSchedule = snap.text; values.visitScheduleAsOf = snap.asOf }
  const [row] = await db.insert(carePlans).values(values as any).returning()
  await writeCareAudit(user, 'CREATE', 'care_plans', row.id, row)
  return c.json(row, 201)
})

// A DRAFT plan pre-filled from a template, so nobody starts from a blank page.
app.post('/from-template/:templateId', requireAdmin, async (c) => {
  const user = c.get('user' as any)
  const b = await c.req.json().catch(() => ({}))
  if (!b.clientId) return c.json({ error: 'clientId is required' }, 400)
  for (const k of DATE_FIELDS) {
    if (b[k] && !YMD.test(String(b[k]))) return c.json({ error: `${k} must be a date (YYYY-MM-DD)` }, 400)
  }
  const [t] = await db.select().from(carePlanTemplates).where(eq(carePlanTemplates.id, c.req.param('templateId'))).limit(1)
  if (!t) return c.json({ error: 'Template not found' }, 404)
  const [client] = await db.select({ id: clients.id }).from(clients).where(eq(clients.id, b.clientId)).limit(1)
  if (!client) return c.json({ error: 'Client not found' }, 404)
  const [row] = await db.insert(carePlans).values({
    clientId: b.clientId,
    serviceType: t.serviceType, serviceDescription: t.serviceDescription, frequency: t.frequency,
    careGoals: t.careGoals, specialInstructions: t.specialInstructions, precautions: t.precautions,
    medicationNotes: t.medicationNotes, mobilityNotes: t.mobilityNotes, dietaryNotes: t.dietaryNotes,
    communicationNotes: t.communicationNotes,
    startDate: b.startDate || null, endDate: b.endDate || null,
    createdById: userIdOf(user), status: 'draft',
  }).returning()
  await writeCareAudit(user, 'CREATE', 'care_plans', row.id, { ...row, _from_template: t.templateName })
  return c.json({ carePlan: row, appliedTemplate: t.templateName }, 201)
})

// PUT /:id — only fields present are updated; a field sent as '' is cleared (so an end date can
// be removed). serviceType can't be cleared.
app.put('/:id', requireAdmin, async (c) => {
  const user = c.get('user' as any)
  const id = c.req.param('id')
  const b = await c.req.json().catch(() => ({}))
  const set: Record<string, unknown> = {}
  for (const key of Object.keys(CARE_PLAN_FIELDS)) {
    if (!(key in b)) continue
    const v = b[key] === '' ? null : b[key]
    if (key === 'serviceType' && !v) return c.json({ error: 'serviceType cannot be blank' }, 400)
    if (DATE_FIELDS.has(key) && v != null && !YMD.test(String(v))) return c.json({ error: `${key} must be a date (YYYY-MM-DD)` }, 400)
    set[key] = v
  }
  if ('status' in b) {
    if (!STATUSES.includes(b.status)) return c.json({ error: 'status is not valid' }, 400)
    set.status = b.status
  }
  const [plan] = await db.select({ id: carePlans.id, clientId: carePlans.clientId }).from(carePlans).where(eq(carePlans.id, id)).limit(1)
  if (!plan) return c.json({ error: 'Care plan not found' }, 404)
  if ('visitSchedule' in b) {
    const snap = await resolveVisitSchedule(b.visitSchedule, plan.clientId)
    if ('error' in snap) return c.json({ error: snap.error }, 400)
    if (snap.set) { set.visitSchedule = snap.text; set.visitScheduleAsOf = snap.asOf }
  }
  set.updatedAt = new Date()
  const row = await db.transaction(async (tx) => {
    // Transaction-local, on the same connection as the UPDATE, so the snapshot trigger records
    // who made the change.
    await tx.execute(sql`SELECT set_config('crm.user_id', ${userIdOf(user) || ''}, true)`)
    const [updated] = await tx.update(carePlans).set(set as any).where(eq(carePlans.id, id)).returning()
    return updated
  })
  await writeCareAudit(user, 'UPDATE', 'care_plans', id, row)
  return c.json(row)
})

app.get('/:id/revisions', requireAdmin, async (c) => {
  const rows = rowsOf(await db.execute(sql`
    SELECT cpr.*, u.first_name AS changed_by_first, u.last_name AS changed_by_last
      FROM care_plan_revisions cpr
      LEFT JOIN users u ON cpr.changed_by_id = u.id
     WHERE cpr.care_plan_id = ${c.req.param('id')}
     ORDER BY cpr.revision_number DESC`))
  return c.json(rows)
})

app.get('/:id/pdf', requireAdmin, async (c) => {
  const [r] = await db.select({ plan: carePlans, client: clients, authorFirst: users.firstName, authorLast: users.lastName })
    .from(carePlans)
    .innerJoin(clients, eq(carePlans.clientId, clients.id))
    .leftJoin(users, eq(carePlans.createdById, users.id))
    .where(eq(carePlans.id, c.req.param('id'))).limit(1)
  if (!r) return c.json({ error: 'Care plan not found' }, 404)
  const [agency] = await db.select({ name: agencies.name }).from(agencies).limit(1)
  const [contact] = await db.select({ name: clientEmergencyContacts.name, phone: clientEmergencyContacts.phone })
    .from(clientEmergencyContacts)
    .where(eq(clientEmergencyContacts.clientId, r.plan.clientId))
    .orderBy(desc(clientEmergencyContacts.isPrimary), asc(clientEmergencyContacts.createdAt)).limit(1)
  const tasks = rowsOf(await db.execute(sql`
    SELECT task_name, category, weekly_frequency, allotted_minutes, assessment_source
      FROM client_task_templates WHERE client_id = ${r.plan.clientId} AND is_active = true
     ORDER BY sort_order, created_at`))
  const tz = await agencyTimezone()
  const createdOn = new Date(r.plan.createdAt).toLocaleDateString('en-US', { timeZone: tz })
  const pdf = await carePlanPdf({
    agencyName: agency?.name || '',
    plan: r.plan,
    client: r.client,
    author: r.authorFirst ? { firstName: r.authorFirst, lastName: r.authorLast || '' } : null,
    createdOn,
    emergencyContact: contact || null,
    tasks,
    isAssessmentSource,
  })
  const ymd = new Date(r.plan.createdAt).toISOString().slice(0, 10)
  return new Response(pdf, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${pdfFileName(`care-plan-${r.client.lastName}-${r.client.firstName}-${ymd}.pdf`)}"`,
    },
  })
})

// Recurring weekly shifts from the plan. Refused when the client already has visits in the next
// four weeks — generating would double-book them. Authorization is advice, never a gate.
app.post('/:id/generate-schedule', requireAdmin, async (c) => {
  const user = c.get('user' as any)
  const b = await c.req.json().catch(() => ({}))
  const { caregiverId, startTime, endTime, daysOfWeek, startDate, endDate } = b || {}
  if (!caregiverId || !startTime || !endTime || !Array.isArray(daysOfWeek) || !daysOfWeek.length) {
    return c.json({ error: 'caregiverId, startTime, endTime, and daysOfWeek are required' }, 400)
  }
  if (!HHMM.test(String(startTime)) || !HHMM.test(String(endTime))) return c.json({ error: 'startTime and endTime must be HH:MM' }, 400)
  const days = [...new Set(daysOfWeek.map((d: unknown) => Number(d)))]
  if (days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) return c.json({ error: 'daysOfWeek must be 0 (Sunday) to 6 (Saturday)' }, 400)
  for (const [k, v] of [['startDate', startDate], ['endDate', endDate]] as const) {
    if (v && !YMD.test(String(v))) return c.json({ error: `${k} must be a date (YYYY-MM-DD)` }, 400)
  }

  const [plan] = await db.select().from(carePlans).where(eq(carePlans.id, c.req.param('id'))).limit(1)
  if (!plan) return c.json({ error: 'Care plan not found' }, 404)
  const [cg] = await db.select({ id: users.id }).from(users).where(eq(users.id, caregiverId)).limit(1)
  if (!cg) return c.json({ error: 'Caregiver not found' }, 404)

  const existing = await getClientVisitSchedule(plan.clientId)
  if (existing.upcomingVisits > 0) {
    return c.json({
      error: `This client already has ${existing.upcomingVisits} visit(s) scheduled in the next ${existing.windowDays} days. Generating would double-book them — change the shifts in Scheduling instead.`,
    }, 409)
  }

  const perShiftHours = shiftHours(startTime, endTime)
  const authCheck = await checkAuthorizationBalance(plan.clientId, perShiftHours * days.length)
  const warnings = [...(authCheck.warnings || [])]

  // schedules.start_time/end_time are timestamps carrying the time of day; the date part is the
  // effective date, the same way the schedule hub writes them.
  const effective = startDate || plan.startDate || existing.asOf
  const toTs = (t: string) => new Date(`${effective}T${String(t).slice(0, 5).padStart(5, '0')}:00Z`)
  const created: any[] = []
  for (const dayOfWeek of days) {
    const [row] = await db.insert(schedules).values({
      caregiverId, clientId: plan.clientId, scheduleType: 'recurring', dayOfWeek,
      startTime: toTs(startTime), endTime: toTs(endTime),
      notes: `Generated from care plan: ${plan.serviceType || 'General'}`,
      frequency: 'weekly', effectiveDate: startDate || plan.startDate || null, endDate: endDate || plan.endDate || null,
      isActive: true,
    }).returning()
    created.push(row)
    await writeCareAudit(user, 'CREATE', 'schedules', row.id, { ...row, _source: 'care_plan_generation' })
  }
  return c.json({ success: true, created: created.length, schedules: created, carePlanId: plan.id, warnings }, 201)
})

app.delete('/:id', requireAdmin, async (c) => {
  const [row] = await db.delete(carePlans).where(eq(carePlans.id, c.req.param('id'))).returning()
  if (!row) return c.json({ error: 'Care plan not found' }, 404)
  await writeCareAudit(c.get('user' as any), 'DELETE', 'care_plans', row.id, null, row)
  return c.json({ message: 'Care plan deleted' })
})

export default app
