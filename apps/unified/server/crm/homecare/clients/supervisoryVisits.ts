// /api/supervisory-visits — a check-in on each client's care on a regular cycle (item 11 + row 24,
// docs/parity/homecare-supervisory-visits.md). Mounted only for an agency with care_supervisory_visits (not ready).
//
// The office (care-clients:update):
//   GET    /                        { ruleDays, today, clients[] } — every client with a rule: last visit, due date, status
//                                   overdue | due_soon | ok, where the days come from, the next planned visit
//   PUT    /rule { days: 60 | 90 }  the agency's rule
//   GET|PUT /settings { questions[], requireSignatures }  the agency's own questions, and whether both signatures are required
//   PUT    /client/:id/interval { days: number | null }  one client's own days (null = the code's or agency's, 0 = none needed)
//   GET    /client/:id              that client's done visits, newest first
//   POST   /client/:id              record a visit that was not planned (the form)
//   POST   /client/:id/plan { date, time, supervisorId, visitType?, caregiverId? }  put a visit on the calendar
//   GET    /calendar?from&to        the planned visits between two days (the schedule calendar)
//   PUT    /visits/:id { date?, time?, supervisorId?, visitType? }  move a planned visit or give it to someone else
//   POST   /visits/:id/cancel       take a planned visit off the calendar
//   GET    /visits/:id/signatures   a done visit's two signatures (images)
//
// The supervisor named on a planned visit (care-clients:read, and it must be theirs — or the office's):
//   GET    /mine                    my planned visits, soonest first, with the agency's questions and signature rule
//   GET    /visits/:id              one planned visit, to open on the phone
//   POST   /visits/:id/start        I am starting it
//   POST   /visits/:id/complete     the form, the answers and the signatures: the visit is done
//
// Replies follow RULEBOOK §3.
import { Hono } from 'hono'
import { and, eq } from 'drizzle-orm'
import { clients, supervisoryVisit } from '../../../db/schema/index.ts'
import { plannedBetween, plannedForSupervisor, supervisoryHistory, supervisoryVisitById } from '../../../data/homecareSupervisory.ts'
import type { AppEnv } from '../../../http/env.ts'
import { fail, one, listAll } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import type { HomecareCore } from '../core/index.ts'
import { AGENCY_RULES, checkVisitForm } from '../core/supervisory.ts'
import { addDays, fmtClock, hmsIn } from '../core/agencyTime.ts'
import { actsForAnyone } from '../core/caregiverAccess.ts'
import { body, who, type ClientAccess } from '../clients/shared.ts'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const MAX_CALENDAR_DAYS = 62

export function createSupervisoryVisitRoutes(core: HomecareCore, d: CrmDeps, access: ClientAccess) {
  const app = new Hono<AppEnv>()
  const perm = d.permissions.requirePermission
  const office = perm('care-clients:update')
  const supervisor = perm('care-clients:read')
  const db = d.db
  const sv = core.supervisory
  /** May this person act on this visit: it is theirs, or they are the office. */
  const mayAct = async (c: any, v: any) => v.supervisorId === who(c).me || actsForAnyone(d, who(c).user, 'care-clients:update')
  const loadVisit = (companyId: string, id: string) => supervisoryVisitById(db, companyId, id)
  /** A visit as the phone and the list get it: never the signature images. */
  const shown = (v: any) => { const { supervisorSignature, clientSignature, ...rest } = v; return rest }

  app.get('/', office, async (c) => {
    const { companyId } = who(c)
    const { ruleDays, today, clients: rows } = await sv.dueList(companyId)
    return one(c, { ruleDays, today, clients: rows })
  })

  app.put('/rule', office, async (c) => {
    const { companyId } = who(c)
    const days = Number((await body(c)).days)
    if (!(AGENCY_RULES as readonly number[]).includes(days)) return fail(c, 400, 'Supervisory visits are every 60 or every 90 days.', 'bad_rule')
    await sv.setRule(companyId, days)
    return one(c, { ruleDays: days })
  })

  app.get('/settings', office, async (c) => one(c, await sv.settings(who(c).companyId)))

  app.put('/settings', office, async (c) => {
    const { companyId } = who(c)
    const r = await sv.setSettings(companyId, await body(c))
    if ('problem' in r) return fail(c, 400, r.problem, 'bad_questions', { questions: r.problem })
    return one(c, r)
  })

  app.put('/client/:clientId/interval', office, async (c) => {
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
    if (!row) return fail(c, 404, 'Client not found', 'not_found')
    return one(c, { clientId, intervalDays: days })
  })

  app.get('/client/:clientId', office, async (c) => {
    const { companyId } = who(c)
    const clientId = c.req.param('clientId')!
    if (!(await access.clientInCompany(companyId, clientId))) return fail(c, 404, 'Client not found', 'not_found')
    return listAll(c, await supervisoryHistory(db, companyId, clientId))
  })

  // A visit the office records after it happened (it was not planned).
  app.post('/client/:clientId', office, async (c) => {
    const { user, companyId, me } = who(c)
    const clientId = c.req.param('clientId')!
    const b = await body(c)
    if (!(await access.clientInCompany(companyId, clientId))) return fail(c, 404, 'Client not found', 'not_found')
    const today = await core.time.today(companyId)
    const visitDate = b.visitDate ? String(b.visitDate) : today
    if (!DATE_RE.test(visitDate)) return fail(c, 400, 'The visit date must be a date (YYYY-MM-DD).', 'bad_date')
    if (visitDate > today) return fail(c, 400, 'A visit that has not happened yet cannot be recorded. Plan it instead.', 'future_date')
    if (b.caregiverId && !(await access.personInCompany(companyId, String(b.caregiverId)))) return fail(c, 404, 'Caregiver not found', 'not_found')
    const checked = checkVisitForm(b, await sv.settings(companyId))
    if ('problem' in checked) return fail(c, 400, checked.problem, checked.code, checked.field ? { [checked.field]: checked.problem } : undefined)
    const [row] = await db.insert(supervisoryVisit).values({ companyId, clientId, supervisorId: me, ...sv.doneValues(checked.value, visitDate, 'office') } as any).returning()
    await core.careAudit.writeCareAudit(user, 'CREATE', 'supervisory_visit', row.id, shown(row))
    return one(c, shown(row), 201)
  })

  app.post('/client/:clientId/plan', office, async (c) => {
    const { user, companyId } = who(c)
    const clientId = c.req.param('clientId')!
    const b = await body(c)
    if (!(await access.clientInCompany(companyId, clientId))) return fail(c, 404, 'Client not found', 'not_found')
    const at = await sv.when(companyId, b.date, b.time)
    if ('problem' in at) return fail(c, 400, at.problem, 'bad_time', { [at.field]: at.problem })
    const person = await sv.supervisorOf(companyId, b.supervisorId)
    if (!person) return fail(c, 400, 'Choose who will do the visit.', 'bad_supervisor', { supervisorId: 'Choose someone on your team' })
    if (b.caregiverId && !(await access.personInCompany(companyId, String(b.caregiverId)))) return fail(c, 404, 'Caregiver not found', 'not_found')
    const [already] = await db.select({ id: supervisoryVisit.id }).from(supervisoryVisit)
      .where(and(eq(supervisoryVisit.companyId, companyId), eq(supervisoryVisit.clientId, clientId), eq(supervisoryVisit.status, 'planned'))).limit(1)
    if (already) return fail(c, 409, 'This client already has a visit planned. Move that one instead.', 'already_planned', { plannedId: already.id })
    const [row] = await db.insert(supervisoryVisit).values({
      companyId, clientId, status: 'planned', visitDate: at.date, plannedAt: at.at, supervisorId: person.id,
      visitType: b.visitType === 'phone' ? 'phone' : 'home', caregiverId: b.caregiverId ? String(b.caregiverId) : null,
    } as any).returning()
    await core.careAudit.writeCareAudit(user, 'CREATE', 'supervisory_visit', row.id, shown(row))
    await core.notify.notifyUser(companyId, person.id, 'supervisory_visit', 'Supervisory visit planned', `You have a supervisory visit on ${at.date}. It is in your app.`)
    return one(c, shown(row), 201)
  })

  app.get('/calendar', office, async (c) => {
    const { companyId } = who(c)
    const from = c.req.query('from') || '', to = c.req.query('to') || ''
    if (!DATE_RE.test(from) || !DATE_RE.test(to) || to < from) return fail(c, 400, 'Give the first and last day (YYYY-MM-DD).', 'bad_range')
    if (to > addDays(from, MAX_CALENDAR_DAYS)) return fail(c, 400, `At most ${MAX_CALENDAR_DAYS} days at a time.`, 'range_too_long')
    const tz = await core.time.timezone(companyId)
    return listAll(c, (await plannedBetween(db, companyId, from, to)).map((v: any) => ({ ...v, plannedTime: v.plannedAt ? fmtClock(new Date(v.plannedAt), tz) : null })))
  })

  app.put('/visits/:id', office, async (c) => {
    const { user, companyId } = who(c)
    const v = await loadVisit(companyId, c.req.param('id')!)
    if (!v) return fail(c, 404, 'Visit not found', 'not_found')
    if (v.status !== 'planned') return fail(c, 409, 'Only a planned visit can be moved.', 'not_planned')
    const b = await body(c)
    const patch: Record<string, unknown> = {}
    if (b.date !== undefined || b.time !== undefined) {
      const tz = await core.time.timezone(companyId)
      const at = await sv.when(companyId, b.date ?? v.visitDate, b.time ?? (v.plannedAt ? hmsIn(new Date(v.plannedAt), tz).slice(0, 5) : undefined))
      if ('problem' in at) return fail(c, 400, at.problem, 'bad_time', { [at.field]: at.problem })
      Object.assign(patch, { visitDate: at.date, plannedAt: at.at, reminderSentAt: null })
    }
    if (b.supervisorId !== undefined) {
      const person = await sv.supervisorOf(companyId, b.supervisorId)
      if (!person) return fail(c, 400, 'Choose who will do the visit.', 'bad_supervisor', { supervisorId: 'Choose someone on your team' })
      Object.assign(patch, { supervisorId: person.id, reminderSentAt: null })
    }
    if (b.visitType !== undefined) patch.visitType = b.visitType === 'phone' ? 'phone' : 'home'
    if (!Object.keys(patch).length) return fail(c, 400, 'Nothing to change.', 'nothing_to_change')
    const [row] = await db.update(supervisoryVisit).set(patch as any)
      .where(and(eq(supervisoryVisit.id, v.id), eq(supervisoryVisit.companyId, companyId), eq(supervisoryVisit.status, 'planned'))).returning()
    if (!row) return fail(c, 409, 'Only a planned visit can be moved.', 'not_planned')
    await core.careAudit.writeCareAudit(user, 'UPDATE', 'supervisory_visit', row.id, shown(row))
    return one(c, shown(row))
  })

  app.post('/visits/:id/cancel', office, async (c) => {
    const { user, companyId } = who(c)
    const [row] = await db.update(supervisoryVisit).set({ status: 'cancelled' } as any)
      .where(and(eq(supervisoryVisit.id, c.req.param('id')!), eq(supervisoryVisit.companyId, companyId), eq(supervisoryVisit.status, 'planned'))).returning()
    if (!row) return fail(c, 409, 'Only a planned visit can be cancelled.', 'not_planned')
    await core.careAudit.writeCareAudit(user, 'UPDATE', 'supervisory_visit', row.id, shown(row))
    return one(c, shown(row))
  })

  app.get('/visits/:id/signatures', office, async (c) => {
    const v = await loadVisit(who(c).companyId, c.req.param('id')!)
    if (!v) return fail(c, 404, 'Visit not found', 'not_found')
    return one(c, { supervisorSignature: v.supervisorSignature ?? null, clientSignature: v.clientSignature ?? null, clientSignReason: v.clientSignReason ?? null, signedAt: v.signedAt ?? null })
  })

  // ── The supervisor's phone ────────────────────────────────────────────────────────────
  app.get('/mine', supervisor, async (c) => {
    const { companyId, me } = who(c)
    const [visits, s] = await Promise.all([plannedForSupervisor(db, companyId, me), sv.settings(companyId)])
    const tz = await core.time.timezone(companyId)
    return one(c, { visits: visits.map((v: any) => ({ ...v, plannedTime: v.plannedAt ? fmtClock(new Date(v.plannedAt), tz) : null })), questions: s.questions, requireSignatures: s.requireSignatures })
  })

  app.get('/visits/:id', supervisor, async (c) => {
    const { companyId } = who(c)
    const v = await loadVisit(companyId, c.req.param('id')!)
    if (!v || !(await mayAct(c, v))) return fail(c, 404, 'Visit not found', 'not_found')
    const s = await sv.settings(companyId)
    return one(c, { ...shown(v), questions: s.questions, requireSignatures: s.requireSignatures })
  })

  app.post('/visits/:id/start', supervisor, async (c) => {
    const { user, companyId } = who(c)
    const v = await loadVisit(companyId, c.req.param('id')!)
    if (!v || !(await mayAct(c, v))) return fail(c, 404, 'Visit not found', 'not_found')
    if (v.status !== 'planned') return fail(c, 409, 'This visit is no longer planned.', 'not_planned')
    if (v.startedAt) return one(c, shown(v))
    const [row] = await db.update(supervisoryVisit).set({ startedAt: new Date() } as any)
      .where(and(eq(supervisoryVisit.id, v.id), eq(supervisoryVisit.companyId, companyId), eq(supervisoryVisit.status, 'planned'))).returning()
    if (!row) return fail(c, 409, 'This visit is no longer planned.', 'not_planned')
    await core.careAudit.writeCareAudit(user, 'UPDATE', 'supervisory_visit', row.id, { startedAt: row.startedAt })
    return one(c, shown(row))
  })

  app.post('/visits/:id/complete', supervisor, async (c) => {
    const { user, companyId } = who(c)
    const v = await loadVisit(companyId, c.req.param('id')!)
    if (!v || !(await mayAct(c, v))) return fail(c, 404, 'Visit not found', 'not_found')
    if (v.status !== 'planned') return fail(c, 409, 'This visit has already been finished or cancelled.', 'not_planned')
    const b = await body(c)
    if (b.caregiverId && !(await access.personInCompany(companyId, String(b.caregiverId)))) return fail(c, 404, 'Caregiver not found', 'not_found')
    const checked = checkVisitForm({ visitType: v.visitType, caregiverId: v.caregiverId, ...b }, await sv.settings(companyId))
    if ('problem' in checked) return fail(c, 400, checked.problem, checked.code, checked.field ? { [checked.field]: checked.problem } : undefined)
    const today = await core.time.today(companyId)
    const from = v.supervisorId === who(c).me && b.from === 'phone' ? 'phone' : 'office'
    const [row] = await db.update(supervisoryVisit).set({ ...sv.doneValues(checked.value, today, from), startedAt: v.startedAt ?? new Date() } as any)
      .where(and(eq(supervisoryVisit.id, v.id), eq(supervisoryVisit.companyId, companyId), eq(supervisoryVisit.status, 'planned'))).returning()
    if (!row) return fail(c, 409, 'This visit has already been finished or cancelled.', 'not_planned')
    await core.careAudit.writeCareAudit(user, 'UPDATE', 'supervisory_visit', row.id, shown(row))
    return one(c, shown(row))
  })

  return app
}
