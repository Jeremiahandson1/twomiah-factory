// Reports — shared implementation (packages/tenant-backend/src/reporting), vendored into this tenant as
// ../shared at generation. This file only wires the template's tables and middleware in.
import { createReportingRoutes } from '../shared/index.ts'
import { db } from '../../db/index.ts'
import { invoice, payment, job, project, quote, timeEntry, user, contact, serviceRecord, teamMember } from '../../db/schema.ts'
import { and, eq, gte, lte, sql } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'

/**
 * Team productivity, for a salon.
 *
 * The shared report counts hours logged and jobs completed — a salon has neither, so the panel said
 * "No time entries in this period" for every period there has ever been. A chair is measured by the
 * services it performed and what they took, and by BOTH kinds of stylist: a login user (stylistId) and
 * a roster stylist (stylistMemberId), which is why a stylist added under Team was missing from it.
 * (Salon T28 M6)
 */
async function salonTeamProductivity(companyId: string, range: { gte?: Date; lte?: Date }) {
  const where = [eq(serviceRecord.companyId, companyId)]
  if (range?.gte) where.push(gte(serviceRecord.performedAt, range.gte))
  if (range?.lte) where.push(lte(serviceRecord.performedAt, range.lte))

  const rows = await db
    .select({
      firstName: user.firstName,
      lastName: user.lastName,
      memberName: teamMember.name,
      services: sql<number>`count(*)`,
      revenue: sql<string>`COALESCE(SUM(COALESCE(${serviceRecord.priceCharged}::numeric, 0)), 0)`,
    })
    .from(serviceRecord)
    .leftJoin(user, eq(serviceRecord.stylistId, user.id))
    .leftJoin(teamMember, eq(serviceRecord.stylistMemberId, teamMember.id))
    .where(and(...where))
    .groupBy(user.firstName, user.lastName, teamMember.name)

  const out: Array<{ user: { firstName: string; lastName?: string }; servicesCompleted: number; revenue: number }> = []
  for (const r of rows as any[]) {
    const login = [r.firstName, r.lastName].filter(Boolean).join(' ').trim()
    const name = login || String(r.memberName || '').trim()
    if (!name) continue   // an unassigned visit is not a person
    const parts = name.split(/\s+/)
    out.push({
      user: { firstName: parts[0], lastName: parts.slice(1).join(' ') || undefined },
      servicesCompleted: Number(r.services || 0),
      revenue: Math.round(Number(r.revenue || 0) * 100) / 100,
    })
  }
  return out.sort((a, b) => b.revenue - a.revenue || b.servicesCompleted - a.servicesCompleted)
}

export default createReportingRoutes({
  db,
  tables: { invoice, payment, job, project, quote, timeEntry, user, contact },
  authenticate,
  requirePermission,
  options: { teamProductivity: salonTeamProductivity },
})
