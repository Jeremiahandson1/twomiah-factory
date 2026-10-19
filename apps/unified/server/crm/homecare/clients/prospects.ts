// Prospects and their intake appointments: the office's pipeline of people who may become clients. Moved from
// templates/crm-homecare/backend/src/routes/{prospects,prospectAppointments}.ts. A prospect is a row of the shared
// `lead` table (source 'manual'); converting one makes the client. The shared Leads module (/api/leads) serves the
// same rows to the lead inbox; these two routers are home care's own intake screens over them.
//
// Permissions: both were office-only (requireAdmin on every route — caregivers never see prospects), so each takes a
// care-clients permission a caregiver does not hold: reading is care-clients:update, adding care-clients:create,
// removing care-clients:delete.
//
// Fixed in the move:
//   · a new prospect took "the first agency" as its company (the template's one-agency database); it is the signed-in
//     person's company now.
//   · convert set lead.converted_contact_id to the new CLIENT's id. In the unified schema that column references the
//     CRM's contact table, so every convert would fail on the foreign key; the client is not a contact. The lead is
//     marked converted and the link is kept in the clinical audit trail (CONVERT lead → client) instead.
//   · an appointment could name a lead of any company; it must be one of the company's.
import { Hono } from 'hono'
import { and, desc, eq, gte, lte } from 'drizzle-orm'
import { lead, clients, prospectAppointments } from '../../../db/schema/index.ts'
import type { AppEnv } from '../../../http/env.ts'
import { done, fail, one } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import type { HomecareCore } from '../core/index.ts'
import { body, who, whole } from './shared.ts'

export function createProspectRoutes(core: HomecareCore, d: CrmDeps) {
  const app = new Hono<AppEnv>()
  const { requirePermission } = d.permissions
  const { db } = d

  // GET /api/prospects — every lead, newest first.
  app.get('/', requirePermission('care-clients:update'), async (c) => {
    const { companyId } = who(c)
    return whole(c, await db.select().from(lead).where(eq(lead.companyId, companyId)).orderBy(desc(lead.receivedAt)))
  })

  // POST /api/prospects — a manual lead.
  app.post('/', requirePermission('care-clients:create'), async (c) => {
    const { companyId } = who(c)
    const b = await body(c)
    const [row] = await db.insert(lead).values({
      companyId,
      sourcePlatform: 'manual',
      homeownerName: b.homeownerName || b.name || '',
      email: b.email, phone: b.phone, jobType: b.jobType, location: b.location, budget: b.budget, description: b.description,
      status: 'new',
    }).returning()
    return one(c, row, 201)
  })

  // POST /api/prospects/:id/convert — the prospect becomes a client.
  app.post('/:id/convert', requirePermission('care-clients:create'), async (c) => {
    const { user, companyId } = who(c)
    const id = c.req.param('id')
    const scope = and(eq(lead.id, id), eq(lead.companyId, companyId))
    const [prospect] = await db.select().from(lead).where(scope).limit(1)
    if (!prospect) return fail(c, 404, 'Prospect not found')
    if (prospect.status === 'converted') return fail(c, 400, 'Prospect already converted')
    const parts = (prospect.homeownerName || '').trim().split(/\s+/)
    const [client] = await db.insert(clients).values({
      companyId,
      firstName: parts[0] || 'Unknown',
      lastName: parts.slice(1).join(' ') || 'Unknown',
      email: prospect.email, phone: prospect.phone, address: prospect.location, notes: prospect.description,
    }).returning()
    const [updated] = await db.update(lead).set({ status: 'converted', updatedAt: new Date() }).where(scope).returning()
    await core.careAudit.writeCareAudit(user, 'CONVERT', 'lead', id, { clientId: client.id })
    return one(c, { success: true, lead: updated, client })
  })

  return app
}

export function createProspectAppointmentRoutes(d: CrmDeps) {
  const app = new Hono<AppEnv>()
  const { requirePermission } = d.permissions
  const { db } = d

  // GET /api/prospect-appointments — ?month&year, or ?year.
  app.get('/', requirePermission('care-clients:update'), async (c) => {
    const { companyId } = who(c)
    const { month, year } = c.req.query()
    const conditions: any[] = [eq(prospectAppointments.companyId, companyId)]
    if (month && year) {
      const m = parseInt(month), y = parseInt(year)
      const endMonth = m === 12 ? 1 : m + 1
      const endYear = m === 12 ? y + 1 : y
      conditions.push(gte(prospectAppointments.scheduledDate, `${y}-${String(m).padStart(2, '0')}-01`))
      conditions.push(lte(prospectAppointments.scheduledDate, `${endYear}-${String(endMonth).padStart(2, '0')}-01`))
    } else if (year) {
      conditions.push(gte(prospectAppointments.scheduledDate, `${year}-01-01`))
      conditions.push(lte(prospectAppointments.scheduledDate, `${year}-12-31`))
    }
    const rows = await db.select({
      id: prospectAppointments.id, leadId: prospectAppointments.leadId, scheduledDate: prospectAppointments.scheduledDate,
      scheduledTime: prospectAppointments.scheduledTime, notes: prospectAppointments.notes, status: prospectAppointments.status,
      createdById: prospectAppointments.createdById, createdAt: prospectAppointments.createdAt, homeownerName: lead.homeownerName,
    }).from(prospectAppointments).leftJoin(lead, eq(prospectAppointments.leadId, lead.id))
      .where(and(...conditions)).orderBy(desc(prospectAppointments.scheduledDate))
    return whole(c, rows)
  })

  app.post('/', requirePermission('care-clients:create'), async (c) => {
    const { companyId, me } = who(c)
    const b = await body(c)
    if (b.leadId) {
      const [own] = await db.select({ id: lead.id }).from(lead).where(and(eq(lead.id, b.leadId), eq(lead.companyId, companyId))).limit(1)
      if (!own) return fail(c, 404, 'Prospect not found')
    }
    const [row] = await db.insert(prospectAppointments).values({
      companyId, leadId: b.leadId, scheduledDate: b.scheduledDate, scheduledTime: b.scheduledTime, notes: b.notes,
      status: b.status || 'scheduled', createdById: me,
    }).returning()
    return one(c, row, 201)
  })

  app.delete('/:id', requirePermission('care-clients:delete'), async (c) => {
    const { companyId } = who(c)
    const [deleted] = await db.delete(prospectAppointments)
      .where(and(eq(prospectAppointments.id, c.req.param('id')), eq(prospectAppointments.companyId, companyId))).returning({ id: prospectAppointments.id })
    return deleted ? done(c) : fail(c, 404, 'Appointment not found')
  })

  return app
}
