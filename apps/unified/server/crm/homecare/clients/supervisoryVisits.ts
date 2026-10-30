// /api/supervisory-visits — a check-in on each client's care every 60 or 90 days (item 11,
// docs/parity/homecare-supervisory-visits.md). Mounted only for an agency with care_supervisory_visits (not ready).
//
//   GET    /                        { ruleDays, today, clients[] } — every client with a rule: last visit, due date, status
//                                   overdue | due_soon | ok
//   PUT    /rule { days: 60 | 90 }  the agency's rule
//   PUT    /client/:id/interval { days: number | null }  one client's own days (null = the agency's rule, 0 = none needed)
//   GET    /client/:id              that client's visits, newest first
//   POST   /client/:id              record a visit (the form)
//
// Permissions: all of it is the office's (care-clients:update) — the form holds what clients and caregivers said, which
// a caregiver is not shown. Replies follow RULEBOOK §3.
import { Hono } from 'hono'
import { and, eq } from 'drizzle-orm'
import { clients, supervisoryVisit, user as userTable } from '../../../db/schema/index.ts'
import { supervisoryHistory } from '../../../data/homecareSupervisory.ts'
import type { AppEnv } from '../../../http/env.ts'
import { done, fail, one, listAll } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import type { HomecareCore } from '../core/index.ts'
import { AGENCY_RULES } from '../core/supervisory.ts'
import { body, who, type ClientAccess } from '../clients/shared.ts'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 4000) : null)

export function createSupervisoryVisitRoutes(core: HomecareCore, d: CrmDeps, access: ClientAccess) {
  const app = new Hono<AppEnv>()
  const perm = d.permissions.requirePermission
  const db = d.db

  app.get('/', perm('care-clients:update'), async (c) => {
    const { companyId } = who(c)
    const { ruleDays, today, clients: rows } = await core.supervisory.dueList(companyId)
    return one(c, { ruleDays, today, clients: rows })
  })

  app.put('/rule', perm('care-clients:update'), async (c) => {
    const { companyId } = who(c)
    const days = Number((await body(c)).days)
    if (!(AGENCY_RULES as readonly number[]).includes(days)) return fail(c, 400, 'Supervisory visits are every 60 or every 90 days.', 'bad_rule')
    await core.supervisory.setRule(companyId, days)
    return one(c, { ruleDays: days })
  })

  app.put('/client/:clientId/interval', perm('care-clients:update'), async (c) => {
    const { companyId } = who(c)
    const clientId = c.req.param('clientId')!
    const raw = (await body(c)).days
    let days: number | null
    if (raw === null || raw === '' || raw === undefined) days = null
    else {
      days = Number(raw)
      if (!Number.isInteger(days) || days < 0 || days > 365) return fail(c, 400, 'Days between visits must be a whole number from 0 to 365 (0 means this client needs none).', 'bad_interval')
    }
    const [row] = await db.update(clients).set({ supervisoryIntervalDays: days, updatedAt: new Date() } as any)
      .where(and(eq(clients.id, clientId), eq(clients.companyId, companyId))).returning({ id: clients.id })
    if (!row) return fail(c, 404, 'Client not found')
    return one(c, { clientId, intervalDays: days })
  })

  app.get('/client/:clientId', perm('care-clients:update'), async (c) => {
    const { companyId } = who(c)
    const clientId = c.req.param('clientId')!
    if (!(await access.clientInCompany(companyId, clientId))) return fail(c, 404, 'Client not found')
    return listAll(c, await supervisoryHistory(db, companyId, clientId))
  })

  app.post('/client/:clientId', perm('care-clients:update'), async (c) => {
    const { user, companyId, me } = who(c)
    const clientId = c.req.param('clientId')!
    const b = await body(c)
    if (!(await access.clientInCompany(companyId, clientId))) return fail(c, 404, 'Client not found')
    const today = await core.time.today(companyId)
    const visitDate = b.visitDate ? String(b.visitDate) : today
    if (!DATE_RE.test(visitDate)) return fail(c, 400, 'The visit date must be a date (YYYY-MM-DD).', 'bad_date')
    if (visitDate > today) return fail(c, 400, 'A visit that has not happened yet cannot be recorded.', 'future_date')
    const visitType = b.visitType === 'phone' ? 'phone' : 'home'
    if (b.caregiverId && !(await access.personInCompany(companyId, String(b.caregiverId)))) return fail(c, 404, 'Caregiver not found')
    const carePlanFollowed = b.carePlanFollowed === true || b.carePlanFollowed === 'true' ? true : b.carePlanFollowed === false || b.carePlanFollowed === 'false' ? false : null
    const clientFeedback = text(b.clientFeedback), caregiverFeedback = text(b.caregiverFeedback), concerns = text(b.concerns), followUpNotes = text(b.followUpNotes)
    if (!clientFeedback && !caregiverFeedback && !concerns && !followUpNotes && carePlanFollowed === null) {
      return fail(c, 400, 'Fill in at least one thing from the visit: what the client said, how the caregiver is doing, a concern, or whether the plan is being followed.', 'empty_visit')
    }
    const [row] = await db.insert(supervisoryVisit).values({
      companyId, clientId, visitDate, supervisorId: me, caregiverId: b.caregiverId ? String(b.caregiverId) : null,
      visitType, clientFeedback, carePlanFollowed, caregiverFeedback, concerns, followUpNotes,
    } as any).returning()
    await core.careAudit.writeCareAudit(user, 'CREATE', 'supervisory_visit', row.id, row)
    return one(c, row, 201)
  })

  return app
}
