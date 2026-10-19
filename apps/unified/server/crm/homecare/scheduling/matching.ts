// /api/matching — Smart Matching: caregivers' capabilities, clients' needs, preferences and restrictions, and the
// matcher. Moved from templates/crm-homecare/backend/src/routes/matching.ts.
//
// Permissions: every write is the office's (the template's requireAdmin): a client's needs and preferences are the
// client record (care-clients:update); capabilities, restrictions (client_assignments) and the matcher are the
// schedule's (care-schedule:update). A caregiver holds neither. Reads: capabilities are care-schedule:read; a client's
// needs, preferences and restrictions are care-clients:read.
//
// Fixed in the move: the template answered a client's needs (medical conditions, allergies), preferences and
// restrictions to any signed-in person for any client; a caregiver now reads them only for a client they care for
// (core.access.requireClientAccess, the one rule for a caregiver's client reads). No caregiver screen reads them.
//
// Replies: the three lists (capabilities, a caregiver's capabilities, restrictions) are list replies
// ({ data, pagination }); the rest as before.
//
// Not moved (2026-10-19): the template's POST /capabilities (a no-op: a capability exists once a caregiver has it) and
// POST /apply-schedule (answered success and applied nothing). Each said "done" for work it never did; the screen no
// longer offers either. Scheduling from the matcher's suggestions is the schedule's own form.
import { Hono } from 'hono'
import { and, eq } from 'drizzle-orm'
import { caregiverProfiles, clients, clientAssignments, user } from '../../../db/schema/index.ts'
import type { AppEnv } from '../../../http/env.ts'
import { done, fail, list, one } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import type { HomecareCore } from '../core/index.ts'
import { who } from './shared.ts'

const asList = (c: any, rows: any[]) => list(c, rows, { page: 1, limit: rows.length, total: rows.length })

export function createMatchingRoutes(core: HomecareCore, d: CrmDeps) {
  const app = new Hono<AppEnv>()
  const perm = d.permissions.requirePermission
  const db = d.db
  const clientRead = [perm('care-clients:read'), core.access.requireClientAccess('id')] as const

  // GET /api/matching/capabilities — the distinct capabilities on caregiver profiles (free text, comma-separated)
  app.get('/capabilities', perm('care-schedule:read'), async (c) => {
    const { companyId } = who(c)
    const rows = await db.select({ capabilities: caregiverProfiles.capabilities }).from(caregiverProfiles).where(eq(caregiverProfiles.companyId, companyId))
    const allCaps = new Set<string>()
    for (const row of rows) {
      if (!row.capabilities) continue
      for (const cap of String(row.capabilities).split(',')) { const t = cap.trim(); if (t) allCaps.add(t) }
    }
    return asList(c, [...allCaps].sort())
  })

  // GET /api/matching/caregiver/:id/capabilities
  app.get('/caregiver/:id/capabilities', perm('care-schedule:read'), async (c) => {
    const { companyId } = who(c)
    const [row] = await db.select({ capabilities: caregiverProfiles.capabilities }).from(caregiverProfiles)
      .where(and(eq(caregiverProfiles.caregiverId, c.req.param('id')), eq(caregiverProfiles.companyId, companyId))).limit(1)
    const caps = row?.capabilities ? String(row.capabilities).split(',').map((s) => s.trim()).filter(Boolean) : []
    return asList(c, caps)
  })

  // PUT /api/matching/caregiver/:id/capabilities
  app.put('/caregiver/:id/capabilities', perm('care-schedule:update'), async (c) => {
    const { companyId } = who(c)
    const caregiverId = c.req.param('id')
    const body = await c.req.json().catch(() => ({})) as any
    const capabilitiesStr = Array.isArray(body.capabilities) ? body.capabilities.join(', ') : body.capabilities || ''

    const [existing] = await db.select({ id: caregiverProfiles.id, companyId: caregiverProfiles.companyId }).from(caregiverProfiles)
      .where(eq(caregiverProfiles.caregiverId, caregiverId)).limit(1)
    if (existing) {
      if (existing.companyId !== companyId) return fail(c, 404, 'Caregiver not found')
      await db.update(caregiverProfiles).set({ capabilities: capabilitiesStr, updatedAt: new Date() })
        .where(and(eq(caregiverProfiles.caregiverId, caregiverId), eq(caregiverProfiles.companyId, companyId)))
    } else {
      const [person] = await db.select({ id: user.id }).from(user).where(and(eq(user.id, caregiverId), eq(user.companyId, companyId))).limit(1)
      if (!person) return fail(c, 404, 'Caregiver not found')
      await db.insert(caregiverProfiles).values({ companyId, caregiverId, capabilities: capabilitiesStr })
    }
    return done(c)
  })

  // GET /api/matching/client/:id/needs
  app.get('/client/:id/needs', ...clientRead, async (c) => {
    const { companyId } = who(c)
    const [row] = await db.select({ id: clients.id, medicalConditions: clients.medicalConditions, allergies: clients.allergies, serviceType: clients.serviceType })
      .from(clients).where(and(eq(clients.id, c.req.param('id')!), eq(clients.companyId, companyId))).limit(1)
    if (!row) return fail(c, 404, 'Client not found')
    return one(c, row)
  })

  // PUT /api/matching/client/:id/needs
  app.put('/client/:id/needs', perm('care-clients:update'), async (c) => {
    const { companyId } = who(c)
    const body = await c.req.json().catch(() => ({})) as any
    const [row] = await db.update(clients)
      .set({ medicalConditions: body.medicalConditions, allergies: body.allergies, serviceType: body.serviceType, updatedAt: new Date() })
      .where(and(eq(clients.id, c.req.param('id')), eq(clients.companyId, companyId)))
      .returning({ id: clients.id })
    if (!row) return fail(c, 404, 'Client not found')
    return done(c)
  })

  // GET /api/matching/client/:id/schedule-prefs
  app.get('/client/:id/schedule-prefs', ...clientRead, async (c) => {
    const { companyId } = who(c)
    const [row] = await db.select({ id: clients.id, preferredCaregivers: clients.preferredCaregivers, doNotUseCaregivers: clients.doNotUseCaregivers })
      .from(clients).where(and(eq(clients.id, c.req.param('id')!), eq(clients.companyId, companyId))).limit(1)
    if (!row) return fail(c, 404, 'Client not found')
    return one(c, row)
  })

  // PUT /api/matching/client/:id/schedule-prefs
  app.put('/client/:id/schedule-prefs', perm('care-clients:update'), async (c) => {
    const { companyId } = who(c)
    const body = await c.req.json().catch(() => ({})) as any
    const [row] = await db.update(clients)
      .set({ preferredCaregivers: body.preferredCaregivers, doNotUseCaregivers: body.doNotUseCaregivers, updatedAt: new Date() })
      .where(and(eq(clients.id, c.req.param('id')), eq(clients.companyId, companyId)))
      .returning({ id: clients.id })
    if (!row) return fail(c, 404, 'Client not found')
    return done(c)
  })

  // GET /api/matching/client/:id/restrictions
  app.get('/client/:id/restrictions', ...clientRead, async (c) => {
    const { companyId } = who(c)
    const rows = await db.select().from(clientAssignments)
      .where(and(eq(clientAssignments.companyId, companyId), eq(clientAssignments.clientId, c.req.param('id')!), eq(clientAssignments.status, 'restricted')))
    return asList(c, rows)
  })

  // POST /api/matching/client/:id/restrictions
  app.post('/client/:id/restrictions', perm('care-schedule:update'), async (c) => {
    const { companyId } = who(c)
    const clientId = c.req.param('id')
    const body = await c.req.json().catch(() => ({})) as any
    if (!body.caregiverId) return fail(c, 400, 'caregiverId is required')
    const [cl] = await db.select({ id: clients.id }).from(clients).where(and(eq(clients.id, clientId), eq(clients.companyId, companyId))).limit(1)
    if (!cl) return fail(c, 404, 'Client not found')
    const [row] = await db.insert(clientAssignments).values({
      companyId, clientId, caregiverId: body.caregiverId, assignmentDate: await core.time.today(companyId), status: 'restricted', notes: body.notes,
    }).returning()
    return one(c, row, 201)
  })

  // DELETE /api/matching/restrictions/:id
  app.delete('/restrictions/:id', perm('care-schedule:update'), async (c) => {
    const { companyId } = who(c)
    const [row] = await db.delete(clientAssignments)
      .where(and(eq(clientAssignments.id, c.req.param('id')), eq(clientAssignments.companyId, companyId))).returning()
    if (!row) return fail(c, 404, 'Restriction not found')
    return done(c)
  })

  // POST /api/matching/optimize — rank caregivers for each active client (preferred first, do-not-use left out)
  app.post('/optimize', perm('care-schedule:update'), async (c) => {
    const { companyId } = who(c)
    const caregivers = await db
      .select({ caregiverId: caregiverProfiles.caregiverId, firstName: user.firstName, lastName: user.lastName })
      .from(caregiverProfiles)
      .innerJoin(user, eq(caregiverProfiles.caregiverId, user.id))
      .where(and(eq(caregiverProfiles.companyId, companyId), eq(user.isActive, true)))
    const activeClients = await db
      .select({ id: clients.id, firstName: clients.firstName, lastName: clients.lastName, preferredCaregivers: clients.preferredCaregivers, doNotUseCaregivers: clients.doNotUseCaregivers })
      .from(clients)
      .where(and(eq(clients.companyId, companyId), eq(clients.isActive, true)))

    const assignments = activeClients.map((client: any) => {
      const dnu = (client.doNotUseCaregivers as string[]) || []
      const preferred = (client.preferredCaregivers as string[]) || []
      const eligible = caregivers
        .filter((cg: any) => !dnu.includes(cg.caregiverId))
        .map((cg: any) => ({ caregiverId: cg.caregiverId, caregiverName: `${cg.firstName} ${cg.lastName}`, score: preferred.includes(cg.caregiverId) ? 100 : 50 }))
        .sort((a: any, b: any) => b.score - a.score)
      return { clientId: client.id, clientName: `${client.firstName} ${client.lastName}`, suggestedCaregivers: eligible.slice(0, 5) }
    })

    // The Optimizer UI reads summary.coveragePercent (C-09).
    const covered = assignments.filter((a: any) => a.suggestedCaregivers.length > 0).length
    const coveragePercent = assignments.length ? Math.round((covered / assignments.length) * 100) : 0
    return one(c, {
      assignments, score: assignments.length, covered, coveragePercent,
      summary: { totalClients: assignments.length, covered, uncovered: assignments.length - covered, coveragePercent },
    })
  })

  return app
}
