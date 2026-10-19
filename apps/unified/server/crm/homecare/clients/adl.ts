// ADLs (activities of daily living): a client's requirements, and what was done on each visit. Moved from
// templates/crm-homecare/backend/src/routes/adl.ts. A caregiver reads and logs ADLs only for the clients they serve;
// the office may attribute a logged ADL to the caregiver who did it and back-date it.
//
// Permissions: reads are care-clients:read; logging an ADL is evv:create (the caregiver's visit work); requirements are
// the office's (care-clients:create / update / delete). Replies: lists are { data, pagination }; the completion report
// is camelCase (adlCategory, completedCount … — it was snake_case); DELETE answers { success: true } (was { ok: true }).
import { Hono } from 'hono'
import { and, asc, desc, eq, gte, lt, lte } from 'drizzle-orm'
import { adlRequirements, adlLogs, timeEntries, user as users } from '../../../db/schema/index.ts'
import { adlCompletion } from '../../../data/homecareClients.ts'
import type { AppEnv } from '../../../http/env.ts'
import { done, fail, one } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import type { HomecareCore } from '../core/index.ts'
import { body, who, whole, NOT_YOUR_CLIENT, type ClientAccess } from './shared.ts'

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
  caregiverFirst: users.firstName,
  caregiverLast: users.lastName,
}

export function createAdlRoutes(core: HomecareCore, d: CrmDeps, access: ClientAccess) {
  const app = new Hono<AppEnv>()
  const { requirePermission } = d.permissions
  const { db } = d
  const read = requirePermission('care-clients:read')

  app.get('/categories', read, (c) => whole(c, ADL_CATEGORIES))

  app.get('/client/:clientId/requirements', read, access.requireClientAccess(), async (c) => {
    const { companyId } = who(c)
    return whole(c, await db.select().from(adlRequirements)
      .where(and(eq(adlRequirements.companyId, companyId), eq(adlRequirements.clientId, c.req.param('clientId')!), eq(adlRequirements.isActive, true)))
      .orderBy(asc(adlRequirements.adlCategory)))
  })

  // GET /api/adl/client/:clientId/logs?startDate=&endDate=
  app.get('/client/:clientId/logs', read, access.requireClientAccess(), async (c) => {
    const { companyId } = who(c)
    const { startDate, endDate } = c.req.query()
    const conditions: any[] = [eq(adlLogs.companyId, companyId), eq(adlLogs.clientId, c.req.param('clientId')!)]
    // Days on the agency's clock (core/agencyTime.ts range), not the server's UTC day.
    const { from, before } = await core.time.range(companyId, startDate, endDate)
    if (from) conditions.push(gte(adlLogs.performedAt, from))
    if (before) conditions.push(lt(adlLogs.performedAt, before))
    return whole(c, await db.select(LOG_FIELDS).from(adlLogs).leftJoin(users, eq(adlLogs.caregiverId, users.id))
      .where(and(...conditions)).orderBy(desc(adlLogs.performedAt)))
  })

  // GET /api/adl/logs/time-entry/:timeEntryId — what was logged on one visit (a caregiver: their own visit, or a
  // visit to a client they care for, as the MAR's).
  app.get('/logs/time-entry/:timeEntryId', read, async (c) => {
    const { user, companyId, me } = who(c)
    const id = c.req.param('timeEntryId')!
    if (!access.office(user)) {
      const [te] = await db.select({ clientId: timeEntries.clientId, caregiverId: timeEntries.caregiverId }).from(timeEntries)
        .where(and(eq(timeEntries.id, id), eq(timeEntries.companyId, companyId))).limit(1)
      if (!te) return fail(c, 404, 'Visit not found')
      if (te.caregiverId !== me && !(await access.maySeeClient(user, te.clientId))) return fail(c, 403, NOT_YOUR_CLIENT)
    }
    return whole(c, await db.select(LOG_FIELDS).from(adlLogs).leftJoin(users, eq(adlLogs.caregiverId, users.id))
      .where(and(eq(adlLogs.companyId, companyId), eq(adlLogs.timeEntryId, id))).orderBy(asc(adlLogs.performedAt)))
  })

  // GET /api/adl/reports/completion/:clientId?startDate&endDate — per category, default the last 30 days.
  app.get('/reports/completion/:clientId', read, access.requireClientAccess(), async (c) => {
    const { companyId } = who(c)
    const { startDate, endDate } = c.req.query()
    return whole(c, await adlCompletion(db, companyId, c.req.param('clientId')!,
      startDate && YMD.test(startDate) ? startDate : null, endDate && YMD.test(endDate) ? endDate : null))
  })

  app.post('/requirements', requirePermission('care-clients:create'), async (c) => {
    const { companyId } = who(c)
    const { clientId, adlCategory, assistanceLevel, frequency, specialInstructions } = await body(c)
    if (!clientId || !adlCategory || !assistanceLevel) return fail(c, 400, 'clientId, adlCategory, and assistanceLevel are required')
    if (!(await access.clientInCompany(companyId, clientId))) return fail(c, 404, 'Client not found')
    const [row] = await db.insert(adlRequirements).values({ companyId, clientId, adlCategory, assistanceLevel, frequency, specialInstructions }).returning()
    return one(c, row, 201)
  })

  // PUT /api/adl/requirements/:reqId — assistance level, frequency, instructions (only those sent).
  app.put('/requirements/:reqId', requirePermission('care-clients:update'), async (c) => {
    const { companyId } = who(c)
    const b = await body(c)
    const set: Record<string, unknown> = { updatedAt: new Date() }
    if (b.assistanceLevel) set.assistanceLevel = b.assistanceLevel
    if (b.frequency !== undefined && b.frequency !== null) set.frequency = b.frequency
    if (b.specialInstructions !== undefined && b.specialInstructions !== null) set.specialInstructions = b.specialInstructions
    const [row] = await db.update(adlRequirements).set(set)
      .where(and(eq(adlRequirements.id, c.req.param('reqId')), eq(adlRequirements.companyId, companyId))).returning()
    return row ? one(c, row) : fail(c, 404, 'Requirement not found')
  })

  app.delete('/requirements/:reqId', requirePermission('care-clients:delete'), async (c) => {
    const { companyId } = who(c)
    await db.update(adlRequirements).set({ isActive: false, updatedAt: new Date() })
      .where(and(eq(adlRequirements.id, c.req.param('reqId')), eq(adlRequirements.companyId, companyId)))
    return done(c)
  })

  // POST /api/adl/log — timeEntryId ties the entry to its visit; a caregiver may name only their own.
  app.post('/log', requirePermission('evv:create'), async (c) => {
    const { user, companyId, me } = who(c)
    const { clientId, adlCategory, status, assistanceLevel, performedAt, notes, caregiverId, timeEntryId } = await body(c)
    if (!clientId || !adlCategory || !status) return fail(c, 400, 'clientId, adlCategory, and status are required')
    const refused = await access.careWriteRefusal(c, clientId)
    if (refused) return refused
    let when = new Date()
    if (performedAt) {
      when = new Date(performedAt)
      if (isNaN(when.getTime())) return fail(c, 400, 'Please enter the date and time this activity was performed')
    }
    if (!(await access.clientInCompany(companyId, clientId))) return fail(c, 404, 'Client not found')
    let performedBy = me
    if (access.office(user) && caregiverId) {
      const cg = await access.personInCompany(companyId, String(caregiverId))
      if (!cg) return fail(c, 404, 'Caregiver not found')
      performedBy = cg.id
    }
    if (timeEntryId) {
      const [te] = await db.select({ clientId: timeEntries.clientId, caregiverId: timeEntries.caregiverId }).from(timeEntries)
        .where(and(eq(timeEntries.id, timeEntryId), eq(timeEntries.companyId, companyId))).limit(1)
      if (!te || te.clientId !== clientId) return fail(c, 400, 'That visit is not this client\'s')
      if (!access.office(user) && te.caregiverId !== me) return fail(c, 403, 'Not your shift')
    }
    const [row] = await db.insert(adlLogs).values({
      companyId, clientId, caregiverId: performedBy, timeEntryId: timeEntryId || null, adlCategory, status, assistanceLevel, performedAt: when, notes,
    }).returning()
    return one(c, row, 201)
  })

  return app
}
