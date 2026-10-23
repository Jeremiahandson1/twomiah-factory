// /api/compliance — the compliance dashboard (certifications and background checks running out, performance ratings)
// and the login-activity monitor. Moved from templates/crm-homecare/backend/src/routes/compliance.ts.
//
// The template's requireAdmin (admin or owner) on every path becomes care-compliance: read for the reads, create for
// a new rating. A caregiver holds no care-compliance permission.
//
// Changes: every read is the signed-in person's company's; "a caregiver" is a person whose role is the field rung
// (stored 'caregiver' on moved agencies, 'field' on new ones — permissions.normalizeRole), not the literal string;
// lists are { data, pagination } (RULEBOOK §3). One fix: POST /ratings stored the request body as it came, so a
// caller could write any column (its id, its company); it now takes the rating's own fields only.
import { Hono } from 'hono'
import { and, avg, count, desc, eq, inArray, lte } from 'drizzle-orm'
import { addDays, createAgencyTime } from '../core/agencyTime.ts'
import { auditLog, backgroundChecks, clients, performanceRatings, user } from '../../../db/schema/index.ts'
import { fail, list, one, listAll } from '../../../http/reply.ts'
import type { AppEnv } from '../../../http/env.ts'
import type { CrmDeps } from '../../deps.ts'
import { isCaregiverSeat } from '../core/caregiverAccess.ts'

/** The fields a performance rating is made of (the rest — id, company, timestamps — are the server's). */
const RATING_FIELDS = ['caregiverId', 'clientId', 'ratingDate', 'satisfactionScore', 'punctualityScore', 'professionalismScore',
  'careQualityScore', 'comments', 'noShows', 'lateArrivals'] as const

export function createComplianceRoutes(d: CrmDeps) {
  const agencyTime = createAgencyTime(d)
  const app = new Hono<AppEnv>()
  const read = d.permissions.requirePermission('care-compliance:read')
  const create = d.permissions.requirePermission('care-compliance:create')
  const isCaregiver = (role: string) => isCaregiverSeat(d, { role })

  // Compliance dashboard - certifications expiring, background checks, etc.
  app.get('/dashboard', read, async (c) => {
    const companyId = c.get('user').companyId
    // Sixty days from the agency's today (the server's UTC day was tomorrow every US evening).
    const soonStr = addDays(await agencyTime.today(companyId), 60)

    const [people, recentBackgroundChecks, performanceRatingRows] = await Promise.all([
      d.db.select({
        id: user.id, firstName: user.firstName, lastName: user.lastName, role: user.role,
        certifications: user.certifications, certificationsExpiry: user.certificationsExpiry,
      }).from(user).where(and(eq(user.companyId, companyId), eq(user.isActive, true))),
      d.db.select({
        id: backgroundChecks.id,
        caregiverId: backgroundChecks.caregiverId,
        checkType: backgroundChecks.checkType,
        provider: backgroundChecks.provider,
        status: backgroundChecks.status,
        initiatedDate: backgroundChecks.initiatedDate,
        expirationDate: backgroundChecks.expirationDate,
        notes: backgroundChecks.notes,
        createdAt: backgroundChecks.createdAt,
        updatedAt: backgroundChecks.updatedAt,
        caregiverFirstName: user.firstName,
        caregiverLastName: user.lastName,
      })
        .from(backgroundChecks)
        .leftJoin(user, eq(backgroundChecks.caregiverId, user.id))
        .where(and(eq(backgroundChecks.companyId, companyId), lte(backgroundChecks.expirationDate, soonStr)))
        .orderBy(backgroundChecks.expirationDate)
        .limit(20),
      d.db.select({
        caregiverId: performanceRatings.caregiverId,
        avgSatisfaction: avg(performanceRatings.satisfactionScore),
        avgPunctuality: avg(performanceRatings.punctualityScore),
        count: count(),
      })
        .from(performanceRatings)
        .where(eq(performanceRatings.companyId, companyId))
        .groupBy(performanceRatings.caregiverId),
    ])
    const caregivers = people.filter((p: any) => isCaregiver(p.role))

    const formattedBgChecks = recentBackgroundChecks.map(({ caregiverFirstName, caregiverLastName, ...rest }: any) => ({
      ...rest,
      caregiver: { firstName: caregiverFirstName, lastName: caregiverLastName },
    }))

    // Identify caregivers with expiring certs
    const expiringCerts = caregivers.flatMap((cg: any) =>
      (cg.certificationsExpiry || []).map((exp: any, i: number) => ({
        caregiverId: cg.id,
        name: `${cg.firstName} ${cg.lastName}`,
        cert: ((cg.certifications || []) as any[])[i],
        expiry: exp,
      })).filter((x: any) => x.expiry && String(x.expiry).slice(0, 10) <= soonStr), // calendar days, compared as days
    )

    const performanceRatingsFormatted = performanceRatingRows.map((r: any) => ({
      caregiverId: r.caregiverId,
      _avg: { satisfactionScore: r.avgSatisfaction ? Number(r.avgSatisfaction) : null, punctualityScore: r.avgPunctuality ? Number(r.avgPunctuality) : null },
      _count: r.count,
    }))

    return one(c, {
      activeCaregiversCount: caregivers.length,
      expiringCerts,
      recentBackgroundChecks: formattedBgChecks,
      performanceRatings: performanceRatingsFormatted,
    })
  })

  // Performance ratings
  app.get('/ratings', read, async (c) => {
    const companyId = c.get('user').companyId
    const caregiverId = c.req.query('caregiverId')
    const where = caregiverId
      ? and(eq(performanceRatings.companyId, companyId), eq(performanceRatings.caregiverId, caregiverId))
      : eq(performanceRatings.companyId, companyId)

    const rows = await d.db.select({
      id: performanceRatings.id,
      caregiverId: performanceRatings.caregiverId,
      clientId: performanceRatings.clientId,
      ratingDate: performanceRatings.ratingDate,
      satisfactionScore: performanceRatings.satisfactionScore,
      punctualityScore: performanceRatings.punctualityScore,
      professionalismScore: performanceRatings.professionalismScore,
      careQualityScore: performanceRatings.careQualityScore,
      comments: performanceRatings.comments,
      noShows: performanceRatings.noShows,
      lateArrivals: performanceRatings.lateArrivals,
      createdAt: performanceRatings.createdAt,
      updatedAt: performanceRatings.updatedAt,
      caregiverFirstName: user.firstName,
      caregiverLastName: user.lastName,
    })
      .from(performanceRatings)
      .leftJoin(user, eq(performanceRatings.caregiverId, user.id))
      .where(where)
      .orderBy(desc(performanceRatings.ratingDate))

    // Client names separately
    const clientIds = [...new Set(rows.map((r: any) => r.clientId).filter(Boolean))] as string[]
    const clientMap: Record<string, { firstName: string; lastName: string }> = {}
    if (clientIds.length > 0) {
      const clientRows = await d.db.select({ id: clients.id, firstName: clients.firstName, lastName: clients.lastName })
        .from(clients)
        .where(and(eq(clients.companyId, companyId), inArray(clients.id, clientIds)))
      for (const cr of clientRows) clientMap[cr.id] = { firstName: cr.firstName, lastName: cr.lastName }
    }

    const formatted = rows.map(({ caregiverFirstName, caregiverLastName, ...rest }: any) => ({
      ...rest,
      caregiver: { firstName: caregiverFirstName, lastName: caregiverLastName },
      client: clientMap[rest.clientId] || null,
    }))
    return listAll(c, formatted)
  })

  app.post('/ratings', create, async (c) => {
    const companyId = c.get('user').companyId
    const b = await c.req.json().catch(() => ({} as any))
    const values: Record<string, unknown> = { companyId }
    for (const k of RATING_FIELDS) if (b?.[k] !== undefined) values[k] = b[k]
    if (!values.caregiverId || !values.clientId) return fail(c, 400, 'Caregiver and client are required')
    // Both must be this company's.
    const [cg] = await d.db.select({ id: user.id }).from(user).where(and(eq(user.id, String(values.caregiverId)), eq(user.companyId, companyId))).limit(1)
    const [cl] = await d.db.select({ id: clients.id }).from(clients).where(and(eq(clients.id, String(values.clientId)), eq(clients.companyId, companyId))).limit(1)
    if (!cg || !cl) return fail(c, 404, 'Caregiver or client not found')
    const [rating] = await d.db.insert(performanceRatings).values({ ...values, companyId } as any).returning()
    return one(c, rating, 201)
  })

  // Login activity monitor: the last 100 sign-in attempts.
  // The last 100 sign-ins and failed attempts, from the app's own audit log — where the shared sign-in records every
  // one, with the person, the address and the browser. The template read its login_activity table, which nothing in
  // the unified app writes (found in the move); an agency's old rows join the audit log in the cutover data move.
  //
  // The owner's and the admins' only: audit:read, the permission the app's own audit log asks (permissions.ts, owner's
  // decision 2026-10-09 — sign-ins and IP addresses are not a manager's). It asked care-compliance:read, which an Office
  // Manager holds, so a manager read every person's sign-ins, addresses and browsers (live role check, 2026-10-23).
  app.get('/login-activity', d.permissions.requirePermission('audit:read'), async (c) => {
    const rows = await d.db.select({
      id: auditLog.id,
      email: auditLog.userEmail,
      userId: auditLog.userId,
      action: auditLog.action,
      ipAddress: auditLog.ipAddress,
      userAgent: auditLog.userAgent,
      metadata: auditLog.metadata,
      createdAt: auditLog.createdAt,
      userFirstName: user.firstName,
      userLastName: user.lastName,
      userRole: user.role,
    })
      .from(auditLog)
      .leftJoin(user, eq(auditLog.userId, user.id))
      .where(and(eq(auditLog.companyId, c.get('user').companyId), inArray(auditLog.action, ['login', 'login_failed'])))
      .orderBy(desc(auditLog.createdAt))
      .limit(100)

    const formatted = rows.map(({ userFirstName, userLastName, userRole, action, metadata, ...rest }: any) => ({
      ...rest,
      success: action === 'login',
      failReason: action === 'login' ? null : ((metadata as any)?.description ?? null),
      user: userFirstName ? { firstName: userFirstName, lastName: userLastName, role: userRole } : null,
    }))
    return list(c, formatted, { page: 1, limit: 100, total: formatted.length })
  })

  return app
}
