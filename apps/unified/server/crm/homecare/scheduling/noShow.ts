// /api/no-show — no-show monitoring and its configuration. Moved from templates/crm-homecare/backend/src/routes/noShow.ts.
//
// The office's, all of it (the template's requireAdmin on every path — CVHC left them on verifyToken alone, so any
// caregiver could change the detection config or resolve alerts): care-schedule:update, which a caregiver does not hold.
//
// Replies: the alerts are a list reply ({ data, pagination }). /stats is camelCase: { total, openCount, resolvedCount,
// falseAlarmCount, todayCount, weekCount, resolved, pending } (the template answered open_count, today_count … — the
// No-Show screen and the dashboard banner read those and must read the camelCase keys).
import { Hono } from 'hono'
import { and, desc, eq } from 'drizzle-orm'
import { noshowAlerts, noshowAlertConfig, user, clients } from '../../../db/schema/index.ts'
import type { AppEnv } from '../../../http/env.ts'
import { fail, one, listAll } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import type { HomecareCore } from '../core/index.ts'
import { noShowStats } from '../../../data/homecareScheduling.ts'
import { who } from './shared.ts'

export function createNoShowRoutes(core: HomecareCore, d: CrmDeps) {
  const app = new Hono<AppEnv>()
  const db = d.db
  app.use('*', d.permissions.requirePermission('care-schedule:update'))

  // GET /api/no-show/alerts — ?status (default open; 'all' for every one)
  app.get('/alerts', async (c) => {
    const { companyId } = who(c)
    const status = c.req.query('status') || 'open'
    const rows = await db
      .select({
        id: noshowAlerts.id,
        scheduleId: noshowAlerts.scheduleId,
        caregiverId: noshowAlerts.caregiverId,
        clientId: noshowAlerts.clientId,
        shiftDate: noshowAlerts.shiftDate,
        expectedStart: noshowAlerts.expectedStart,
        alertedAt: noshowAlerts.alertedAt,
        resolvedAt: noshowAlerts.resolvedAt,
        resolvedById: noshowAlerts.resolvedById,
        resolutionNote: noshowAlerts.resolutionNote,
        status: noshowAlerts.status,
        smsSent: noshowAlerts.smsSent,
        createdAt: noshowAlerts.createdAt,
        caregiverFirstName: user.firstName,
        caregiverLastName: user.lastName,
        clientFirstName: clients.firstName,
        clientLastName: clients.lastName,
      })
      .from(noshowAlerts)
      .leftJoin(user, eq(noshowAlerts.caregiverId, user.id))
      .leftJoin(clients, eq(noshowAlerts.clientId, clients.id))
      .where(and(eq(noshowAlerts.companyId, companyId), status !== 'all' ? eq(noshowAlerts.status, status) : undefined))
      .orderBy(desc(noshowAlerts.shiftDate))

    const alerts = rows.map(({ caregiverFirstName, caregiverLastName, clientFirstName, clientLastName, ...alert }: any) => ({
      ...alert,
      caregiverName: caregiverFirstName ? `${caregiverFirstName} ${caregiverLastName}` : null,
      clientName: clientFirstName ? `${clientFirstName} ${clientLastName}` : null,
    }))
    return listAll(c, alerts)
  })

  // GET /api/no-show/stats — "today" is the agency's calendar day. resolved / pending are the older names, kept.
  app.get('/stats', async (c) => {
    const { companyId } = who(c)
    const r = await noShowStats(db, companyId, await core.time.today(companyId))
    return one(c, { ...r, resolved: r.resolvedCount, pending: r.openCount })
  })

  // GET /api/no-show/config
  app.get('/config', async (c) => {
    const { companyId } = who(c)
    const [config] = await db.select().from(noshowAlertConfig).where(eq(noshowAlertConfig.companyId, companyId)).limit(1)
    if (!config) {
      return one(c, { graceMinutes: 15, notifyAdmin: true, notifyCaregiver: true, notifyClientFamily: false, adminPhone: null, adminEmail: null, isActive: true })
    }
    return one(c, config)
  })

  // POST /api/no-show/run-check — a stub (the manual check is not built)
  app.post('/run-check', (c) => one(c, { checked: 0, alertsCreated: 0 }))

  // PUT /api/no-show/alerts/:id/resolve
  app.put('/alerts/:id/resolve', async (c) => {
    const { companyId, me } = who(c)
    const { resolutionNote, status } = await c.req.json().catch(() => ({})) as any
    // Resolved, or a false alarm (the screen's two buttons; /stats counts false alarms apart). The template stored
    // 'resolved' for both.
    if (status !== undefined && status !== 'resolved' && status !== 'false_alarm') return fail(c, 400, "status must be 'resolved' or 'false_alarm'")
    const [updated] = await db.update(noshowAlerts)
      .set({ status: status === 'false_alarm' ? 'false_alarm' : 'resolved', resolvedAt: new Date(), resolvedById: me, resolutionNote: resolutionNote || null })
      .where(and(eq(noshowAlerts.id, c.req.param('id')), eq(noshowAlerts.companyId, companyId)))
      .returning()
    if (!updated) return fail(c, 404, 'Alert not found')
    return one(c, updated)
  })

  // PUT /api/no-show/config — upsert
  app.put('/config', async (c) => {
    const { companyId } = who(c)
    const body = await c.req.json().catch(() => ({})) as any
    const [existing] = await db.select({ id: noshowAlertConfig.id }).from(noshowAlertConfig).where(eq(noshowAlertConfig.companyId, companyId)).limit(1)
    if (existing) {
      const [updated] = await db.update(noshowAlertConfig)
        .set({
          graceMinutes: body.graceMinutes, notifyAdmin: body.notifyAdmin, notifyCaregiver: body.notifyCaregiver,
          notifyClientFamily: body.notifyClientFamily, adminPhone: body.adminPhone, adminEmail: body.adminEmail,
          isActive: body.isActive, updatedAt: new Date(),
        })
        .where(and(eq(noshowAlertConfig.id, existing.id), eq(noshowAlertConfig.companyId, companyId)))
        .returning()
      return one(c, updated)
    }
    const [created] = await db.insert(noshowAlertConfig)
      .values({
        companyId,
        graceMinutes: body.graceMinutes ?? 15, notifyAdmin: body.notifyAdmin ?? true, notifyCaregiver: body.notifyCaregiver ?? true,
        notifyClientFamily: body.notifyClientFamily ?? false, adminPhone: body.adminPhone, adminEmail: body.adminEmail, isActive: body.isActive ?? true,
      })
      .returning()
    return one(c, created)
  })

  return app
}
