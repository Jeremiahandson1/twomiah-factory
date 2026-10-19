// Care plans and service agreements. Moved from templates/crm-homecare/backend/src/routes/carePlans.ts.
//
//   GET    /api/care-plans                            list (?clientId), with the client's name and isActive
//   GET    /api/care-plans/summary                    counts (office)
//   GET    /api/care-plans/visit-schedule/:clientId   the client's live recurring schedule in words (office)
//   POST   /api/care-plans                            create (office)
//   POST   /api/care-plans/from-template/:templateId  a DRAFT plan pre-filled from a template (office)
//   PUT    /api/care-plans/:id                        update — only the fields sent; '' clears (office)
//   GET    /api/care-plans/:id/revisions              prior versions, newest first (office)
//   GET    /api/care-plans/:id/pdf                    printable plan (office)
//   POST   /api/care-plans/:id/generate-schedule      recurring shifts from the plan (office)
//   DELETE /api/care-plans/:id                        (office)
//
// Every content change keeps the OLD row in care_plan_revisions with who made it. The template did this with a
// database trigger (0017_care.sql, trg_snapshot_care_plan) fed by a transaction-local crm.user_id; the unified
// migrations have no such trigger, and this route is the only writer of care_plans, so the same snapshot is written
// here, in the same transaction as the UPDATE, with the plan row locked so two edits number their revisions in turn.
//
// Permissions: the list is care-clients:read (a caregiver sees the plans of the clients they serve); the office's
// reads and writes are care-clients:update / create / delete; generating shifts is care-schedule:create.
// Replies: the list and the revisions are { data, pagination }; the revisions are camelCase (they were snake_case).
import { Hono } from 'hono'
import { and, asc, count, desc, eq, inArray } from 'drizzle-orm'
import { ymdIn } from '../core/agencyTime.ts'
import {
  carePlans, carePlanTemplates, carePlanRevisions, clients, company, clientEmergencyContacts, schedules, user as users,
} from '../../../db/schema/index.ts'
import { carePlanSummaryCounts, carePlanRevisionRows, nextCarePlanRevision, clientIdsServedBy, clientTaskRows } from '../../../data/homecareClients.ts'
import type { AppEnv } from '../../../http/env.ts'
import { done, fail, one } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import type { HomecareCore } from '../core/index.ts'
import { activePlanWhere, isPlanActive, CARE_PLAN_STATUSES } from '../core/carePlanStatus.ts'
import { withWeeklyMinutes } from '../core/careTaskMinutes.ts'
import { carePlanPdf, pdfFileName } from '../core/carePdf.ts'
import { isAssessmentSource } from '../core/assessmentImports.ts'
import { shiftHours } from '../core/scheduleOccurrences.ts'
import { createSchedulingShared } from '../scheduling/shared.ts'
import { body, who, whole, NOT_YOUR_CLIENT, type ClientAccess } from './shared.ts'

const YMD = /^\d{4}-\d{2}-\d{2}$/
const HHMM = /^\d{1,2}:\d{2}(:\d{2})?$/

// Body key → column. Only keys present in the body are written; '' is written as NULL.
export const CARE_PLAN_FIELDS = [
  'serviceType', 'serviceDescription', 'frequency', 'careGoals', 'specialInstructions', 'precautions',
  'medicationNotes', 'mobilityNotes', 'dietaryNotes', 'communicationNotes', 'startDate', 'endDate',
] as const
const DATE_FIELDS = new Set(['startDate', 'endDate'])
const STATUSES: readonly string[] = CARE_PLAN_STATUSES
// What a revision snapshots — the columns whose change the template's trigger watched.
const CONTENT = [...CARE_PLAN_FIELDS, 'status', 'visitSchedule', 'visitScheduleAsOf'] as const

export function createCarePlanRoutes(core: HomecareCore, d: CrmDeps, access: ClientAccess) {
  const app = new Hono<AppEnv>()
  const { requirePermission } = d.permissions
  const { db } = d
  const scheduling = createSchedulingShared(d)

  // visitSchedule is never taken from the browser as text: 'current' copies the client's live schedule (dated today),
  // '' clears it, absent leaves it alone.
  async function resolveVisitSchedule(companyId: string, value: unknown, clientId: string): Promise<{ set: false } | { set: true; text: string | null; asOf: string | null } | { error: string }> {
    if (value === undefined) return { set: false }
    if (value === '' || value === null) return { set: true, text: null, asOf: null }
    if (value !== 'current') return { error: "visitSchedule must be 'current' or ''" }
    const sched = await core.carePlanSchedule.getClientVisitSchedule(companyId, clientId)
    if (!sched.text) return { error: 'This client has no recurring visits scheduled in the next 4 weeks, so there is no schedule to save.' }
    return { set: true, text: sched.text, asOf: sched.asOf }
  }

  // isActive is the server's answer (core/carePlanStatus.ts) — no screen re-derives it.
  const flatten = (r: any, today: string) => ({
    ...r.plan,
    isActive: isPlanActive(r.plan, today),
    clientFirstName: r.clientFirstName,
    clientLastName: r.clientLastName,
    clientName: `${r.clientFirstName || ''} ${r.clientLastName || ''}`.trim(),
  })

  // GET / — every plan, ?clientId, newest first. A caregiver sees the plans of the clients they serve only.
  app.get('/', requirePermission('care-clients:read'), async (c) => {
    const { user, companyId, me } = who(c)
    const clientId = c.req.query('clientId')
    if (clientId && !(await access.maySeeClient(user, clientId))) return fail(c, 403, NOT_YOUR_CLIENT)
    let scope: any
    if (!access.office(user)) {
      const served = await clientIdsServedBy(db, companyId, me)
      if (!served.length) return whole(c, [])
      scope = inArray(carePlans.clientId, served)
    }
    const rows = await db.select({ plan: carePlans, clientFirstName: clients.firstName, clientLastName: clients.lastName })
      .from(carePlans)
      .leftJoin(clients, eq(carePlans.clientId, clients.id))
      .where(and(eq(carePlans.companyId, companyId), clientId ? eq(carePlans.clientId, clientId) : undefined, scope))
      .orderBy(desc(carePlans.createdAt))
    const today = await core.time.today(companyId)
    return whole(c, rows.map((r: any) => flatten(r, today)))
  })

  app.get('/summary', requirePermission('care-clients:update'), async (c) => {
    const { companyId } = who(c)
    const today = await core.time.today(companyId)
    const [counts, [active]] = await Promise.all([
      carePlanSummaryCounts(db, companyId),
      db.select({ n: count() }).from(carePlans).where(and(eq(carePlans.companyId, companyId), activePlanWhere(today))),
    ])
    return one(c, { total: counts.total, active: Number(active?.n ?? 0), byServiceType: counts.byServiceType, byClient: counts.byClient })
  })

  app.get('/visit-schedule/:clientId', requirePermission('care-clients:update'), async (c) => {
    const { companyId } = who(c)
    return one(c, await core.carePlanSchedule.getClientVisitSchedule(companyId, c.req.param('clientId')))
  })

  // POST / — create. clientId and serviceType are required.
  app.post('/', requirePermission('care-clients:create'), async (c) => {
    const { user, companyId, me } = who(c)
    const b = await body(c)
    if (!b.clientId || !b.serviceType) return fail(c, 400, 'clientId and serviceType are required')
    for (const k of DATE_FIELDS) if (b[k] && !YMD.test(String(b[k]))) return fail(c, 400, `${k} must be a date (YYYY-MM-DD)`)
    if (!(await access.clientInCompany(companyId, b.clientId))) return fail(c, 404, 'Client not found')
    const snap = await resolveVisitSchedule(companyId, b.visitSchedule, b.clientId)
    if ('error' in snap) return fail(c, 400, snap.error)
    const values: Record<string, unknown> = { clientId: b.clientId, createdById: me }
    for (const key of CARE_PLAN_FIELDS) values[key] = b[key] === '' || b[key] === undefined ? null : b[key]
    if (b.status && STATUSES.includes(b.status)) values.status = b.status
    if (snap.set) { values.visitSchedule = snap.text; values.visitScheduleAsOf = snap.asOf }
    const [row] = await db.insert(carePlans).values({ ...values, companyId } as any).returning()
    await core.careAudit.writeCareAudit(user, 'CREATE', 'care_plans', row.id, row)
    return one(c, row, 201)
  })

  // A DRAFT plan pre-filled from a template, so nobody starts from a blank page.
  app.post('/from-template/:templateId', requirePermission('care-clients:create'), async (c) => {
    const { user, companyId, me } = who(c)
    const b = await body(c)
    if (!b.clientId) return fail(c, 400, 'clientId is required')
    for (const k of DATE_FIELDS) if (b[k] && !YMD.test(String(b[k]))) return fail(c, 400, `${k} must be a date (YYYY-MM-DD)`)
    const [t] = await db.select().from(carePlanTemplates)
      .where(and(eq(carePlanTemplates.id, c.req.param('templateId')), eq(carePlanTemplates.companyId, companyId))).limit(1)
    if (!t) return fail(c, 404, 'Template not found')
    if (!(await access.clientInCompany(companyId, b.clientId))) return fail(c, 404, 'Client not found')
    const [row] = await db.insert(carePlans).values({
      companyId,
      clientId: b.clientId,
      serviceType: t.serviceType, serviceDescription: t.serviceDescription, frequency: t.frequency,
      careGoals: t.careGoals, specialInstructions: t.specialInstructions, precautions: t.precautions,
      medicationNotes: t.medicationNotes, mobilityNotes: t.mobilityNotes, dietaryNotes: t.dietaryNotes,
      communicationNotes: t.communicationNotes,
      startDate: b.startDate || null, endDate: b.endDate || null,
      createdById: me, status: 'draft',
    }).returning()
    await core.careAudit.writeCareAudit(user, 'CREATE', 'care_plans', row.id, { ...row, _from_template: t.templateName })
    return one(c, { carePlan: row, appliedTemplate: t.templateName }, 201)
  })

  // PUT /:id — only fields present are updated; '' clears (so an end date can be removed). serviceType can't be cleared.
  app.put('/:id', requirePermission('care-clients:update'), async (c) => {
    const { user, companyId, me } = who(c)
    const id = c.req.param('id')
    const b = await body(c)
    const set: Record<string, unknown> = {}
    for (const key of CARE_PLAN_FIELDS) {
      if (!(key in b)) continue
      const v = b[key] === '' ? null : b[key]
      if (key === 'serviceType' && !v) return fail(c, 400, 'serviceType cannot be blank')
      if (DATE_FIELDS.has(key) && v != null && !YMD.test(String(v))) return fail(c, 400, `${key} must be a date (YYYY-MM-DD)`)
      set[key] = v
    }
    if ('status' in b) {
      if (!STATUSES.includes(b.status)) return fail(c, 400, 'status is not valid')
      set.status = b.status
    }
    const scope = and(eq(carePlans.id, id), eq(carePlans.companyId, companyId))
    const [plan] = await db.select({ id: carePlans.id, clientId: carePlans.clientId }).from(carePlans).where(scope).limit(1)
    if (!plan) return fail(c, 404, 'Care plan not found')
    if ('visitSchedule' in b) {
      const snap = await resolveVisitSchedule(companyId, b.visitSchedule, plan.clientId)
      if ('error' in snap) return fail(c, 400, snap.error)
      if (snap.set) { set.visitSchedule = snap.text; set.visitScheduleAsOf = snap.asOf }
    }
    set.updatedAt = new Date()
    const row = await db.transaction(async (tx: any) => {
      const [old] = await tx.select().from(carePlans).where(scope).limit(1).for('update')
      const [updated] = await tx.update(carePlans).set(set as any).where(scope).returning()
      // A content change keeps the old row, numbered after the last, with its author; a no-op keeps nothing.
      if (old && updated && CONTENT.some((k) => (old as any)[k] !== (updated as any)[k])) {
        await tx.insert(carePlanRevisions).values({
          companyId,
          carePlanId: id,
          revisionNumber: await nextCarePlanRevision(tx, companyId, id),
          changedById: me || null,
          serviceType: old.serviceType, serviceDescription: old.serviceDescription, frequency: old.frequency,
          careGoals: old.careGoals, specialInstructions: old.specialInstructions, precautions: old.precautions,
          medicationNotes: old.medicationNotes, mobilityNotes: old.mobilityNotes, dietaryNotes: old.dietaryNotes,
          communicationNotes: old.communicationNotes, startDate: old.startDate, endDate: old.endDate, status: old.status,
          visitSchedule: old.visitSchedule, visitScheduleAsOf: old.visitScheduleAsOf,
        })
      }
      return updated
    })
    await core.careAudit.writeCareAudit(user, 'UPDATE', 'care_plans', id, row)
    return one(c, { ...row, isActive: isPlanActive(row, await core.time.today(companyId)) })
  })

  app.get('/:id/revisions', requirePermission('care-clients:update'), async (c) => {
    const { companyId } = who(c)
    return whole(c, await carePlanRevisionRows(db, companyId, c.req.param('id')))
  })

  app.get('/:id/pdf', requirePermission('care-clients:update'), async (c) => {
    const { companyId } = who(c)
    const [r] = await db.select({ plan: carePlans, client: clients, authorFirst: users.firstName, authorLast: users.lastName })
      .from(carePlans)
      .innerJoin(clients, eq(carePlans.clientId, clients.id))
      .leftJoin(users, eq(carePlans.createdById, users.id))
      .where(and(eq(carePlans.id, c.req.param('id')), eq(carePlans.companyId, companyId))).limit(1)
    if (!r) return fail(c, 404, 'Care plan not found')
    const [agency] = await db.select({ name: company.name }).from(company).where(eq(company.id, companyId)).limit(1)
    const [contact] = await db.select({ name: clientEmergencyContacts.name, phone: clientEmergencyContacts.phone })
      .from(clientEmergencyContacts)
      .where(and(eq(clientEmergencyContacts.clientId, r.plan.clientId), eq(clientEmergencyContacts.companyId, companyId)))
      .orderBy(desc(clientEmergencyContacts.isPrimary), asc(clientEmergencyContacts.createdAt)).limit(1)
    const tasks = withWeeklyMinutes(await clientTaskRows(db, companyId, r.plan.clientId), await core.careTaskMinutes.clientVisitsPerWeek(companyId, r.plan.clientId))
    const tz = await core.time.timezone(companyId)
    const pdf = await carePlanPdf({
      agencyName: agency?.name || '',
      plan: r.plan,
      client: r.client,
      author: r.authorFirst ? { firstName: r.authorFirst, lastName: r.authorLast || '' } : null,
      createdOn: new Date(r.plan.createdAt).toLocaleDateString('en-US', { timeZone: tz }),
      emergencyContact: contact || null,
      tasks,
      isAssessmentSource,
    })
    // The file's day is the agency's, as createdOn above (UTC's put an evening plan on the next day).
    const ymd = ymdIn(new Date(r.plan.createdAt), tz)
    return new Response(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${pdfFileName(`care-plan-${r.client.lastName}-${r.client.firstName}-${ymd}.pdf`)}"`,
      },
    })
  })

  // Recurring weekly shifts from the plan. Refused when the client already has visits in the next four weeks —
  // generating would double-book them. Authorization is advice, never a gate.
  app.post('/:id/generate-schedule', requirePermission('care-schedule:create'), async (c) => {
    const { user, companyId } = who(c)
    const b = await body(c)
    const { caregiverId, startTime, endTime, daysOfWeek, startDate, endDate } = b || {}
    if (!caregiverId || !startTime || !endTime || !Array.isArray(daysOfWeek) || !daysOfWeek.length) {
      return fail(c, 400, 'caregiverId, startTime, endTime, and daysOfWeek are required')
    }
    if (!HHMM.test(String(startTime)) || !HHMM.test(String(endTime))) return fail(c, 400, 'startTime and endTime must be HH:MM')
    const days = [...new Set(daysOfWeek.map((x: unknown) => Number(x)))] as number[]
    if (days.some((x) => !Number.isInteger(x) || x < 0 || x > 6)) return fail(c, 400, 'daysOfWeek must be 0 (Sunday) to 6 (Saturday)')
    for (const [k, v] of [['startDate', startDate], ['endDate', endDate]] as const) {
      if (v && !YMD.test(String(v))) return fail(c, 400, `${k} must be a date (YYYY-MM-DD)`)
    }
    const [plan] = await db.select().from(carePlans).where(and(eq(carePlans.id, c.req.param('id')), eq(carePlans.companyId, companyId))).limit(1)
    if (!plan) return fail(c, 404, 'Care plan not found')
    if (!(await access.personInCompany(companyId, String(caregiverId)))) return fail(c, 404, 'Caregiver not found')

    const existing = await core.carePlanSchedule.getClientVisitSchedule(companyId, plan.clientId)
    if (existing.upcomingVisits > 0) {
      return fail(c, 409, `This client already has ${existing.upcomingVisits} visit(s) scheduled in the next ${existing.windowDays} days. Generating would double-book them — change the shifts in Scheduling instead.`)
    }
    const authCheck = await scheduling.checkAuthorizationBalance(companyId, plan.clientId, shiftHours(startTime, endTime) * days.length)
    const warnings = [...(authCheck.warnings || [])]

    // schedules.start_time / end_time are timestamps carrying the time of day; the date part is the effective date,
    // the same way the schedule hub writes them.
    const effective = startDate || plan.startDate || existing.asOf
    const toTs = (t: string) => new Date(`${effective}T${String(t).slice(0, 5).padStart(5, '0')}:00Z`)
    const created: any[] = []
    for (const dayOfWeek of days) {
      const [row] = await db.insert(schedules).values({
        companyId, caregiverId, clientId: plan.clientId, scheduleType: 'recurring', dayOfWeek,
        startTime: toTs(startTime), endTime: toTs(endTime),
        notes: `Generated from care plan: ${plan.serviceType || 'General'}`,
        frequency: 'weekly', effectiveDate: startDate || plan.startDate || null, endDate: endDate || plan.endDate || null,
        isActive: true,
      }).returning()
      created.push(row)
      await core.careAudit.writeCareAudit(user, 'CREATE', 'schedules', row.id, { ...row, _source: 'care_plan_generation' })
    }
    return one(c, { success: true, created: created.length, schedules: created, carePlanId: plan.id, warnings }, 201)
  })

  app.delete('/:id', requirePermission('care-clients:delete'), async (c) => {
    const { user, companyId } = who(c)
    const [row] = await db.delete(carePlans).where(and(eq(carePlans.id, c.req.param('id')), eq(carePlans.companyId, companyId))).returning()
    if (!row) return fail(c, 404, 'Care plan not found')
    await core.careAudit.writeCareAudit(user, 'DELETE', 'care_plans', row.id, null, row)
    return done(c, 'Care plan deleted')
  })

  return app
}
