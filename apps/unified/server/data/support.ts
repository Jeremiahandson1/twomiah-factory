// The support desk's figures that need SQL expressions (moved from templates/crm/backend/src/routes/support.ts):
// the SLA-breach count and the pattern report.
import { sql, eq, and, count, inArray } from 'drizzle-orm'
import { supportTicket } from '../db/schema/index.ts'

/** Tickets per status, and how many open ones are past their resolve deadline. */
export async function ticketStatusCounts(db: any, companyId: string) {
  const byStatus: { status: string; cnt: number }[] = await db.select({ status: supportTicket.status, cnt: count() })
    .from(supportTicket)
    .where(eq(supportTicket.companyId, companyId))
    .groupBy(supportTicket.status)
  const [breached] = await db.select({ cnt: count() }).from(supportTicket)
    .where(and(
      eq(supportTicket.companyId, companyId),
      inArray(supportTicket.status, ['open', 'in_progress']),
      sql`${supportTicket.slaResolveDue} < now()`,
    ))
  return { byStatus, slaBreached: (breached?.cnt as number) || 0 }
}

/** The pattern report: tickets per category and priority, the average rating, and tickets per day for 30 days. */
export async function ticketPatterns(db: any, companyId: string) {
  const byCategory = await db.select({ category: supportTicket.category, cnt: count() })
    .from(supportTicket)
    .where(eq(supportTicket.companyId, companyId))
    .groupBy(supportTicket.category)
  const byPriority = await db.select({ priority: supportTicket.priority, cnt: count() })
    .from(supportTicket)
    .where(eq(supportTicket.companyId, companyId))
    .groupBy(supportTicket.priority)
  const [rating] = await db.select({
    avg: sql<number>`avg(${supportTicket.rating})`,
    cnt: sql<number>`count(${supportTicket.rating})`,
  }).from(supportTicket)
    .where(and(eq(supportTicket.companyId, companyId), sql`${supportTicket.rating} is not null`))
  const daily = await db.select({ day: sql<string>`date(${supportTicket.createdAt})`, cnt: count() })
    .from(supportTicket)
    .where(and(eq(supportTicket.companyId, companyId), sql`${supportTicket.createdAt} > now() - interval '30 days'`))
    .groupBy(sql`date(${supportTicket.createdAt})`)
    .orderBy(sql`date(${supportTicket.createdAt})`)
  return { byCategory, byPriority, ratingAvg: rating?.avg ?? null, ratedCount: rating?.cnt || 0, daily }
}
