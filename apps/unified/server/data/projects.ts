// The project module's queries that need SQL the query builder can't say (RULEBOOK §2): the change-order money
// roll-up and the activity timeline's metadata match. Moved from templates/crm/backend/src/routes/projects.ts.
import { eq, and, or, count, desc, sql } from 'drizzle-orm'
import { changeOrder, activity, project, quote } from '../db/schema/index.ts'

/**
 * Every change order on a project, grouped by status: the summed amount and how many. Over ALL of them, never a
 * capped list, so the contract figures and the count are right on a project with any number (T32 H4, T48).
 */
export async function changeOrderTotalsByStatus(db: any, projectId: string, companyId: string): Promise<{ status: string; amount: string; n: number }[]> {
  return db.select({
    status: changeOrder.status,
    amount: sql<string>`COALESCE(SUM(${changeOrder.amount}), 0)`,
    n: count(),
  })
    .from(changeOrder)
    .where(and(eq(changeOrder.projectId, projectId), eq(changeOrder.companyId, companyId)))
    .groupBy(changeOrder.status)
}

/**
 * A project's contract once a quote on it is signed: every approved quote on the project plus every approved change order — the one figure
 * project.estimated_value holds (the list, the page, Reports and the portal read it; a change order's approval adds to it from then on).
 * The payment schedule and the WIP report reach the same total (crm/projects/paymentSchedule.ts, crm/field/reportsDepth.ts).
 */
export async function setProjectContract(db: any, companyId: string, projectId: string): Promise<number | null> {
  const [q] = await db.select({ v: sql<string>`COALESCE(SUM(${quote.total}), 0)` }).from(quote)
    .where(and(eq(quote.companyId, companyId), eq(quote.projectId, projectId), eq(quote.status, 'approved')))
  const quoted = Number(q?.v || 0)
  if (!(quoted > 0)) return null
  const [co] = await db.select({ v: sql<string>`COALESCE(SUM(${changeOrder.amount}), 0)` }).from(changeOrder)
    .where(and(eq(changeOrder.companyId, companyId), eq(changeOrder.projectId, projectId), eq(changeOrder.status, 'approved')))
  const value = Math.round((quoted + Number(co?.v || 0)) * 100) / 100
  await db.update(project).set({ estimatedValue: value.toFixed(2), updatedAt: new Date() }).where(and(eq(project.id, projectId), eq(project.companyId, companyId)))
  return value
}

/**
 * A project's activity timeline, newest first, at most 200: rows linked to the project directly
 * (entityType 'project') or through metadata.projectId (a portal collaborator's actions).
 */
export async function projectActivity(db: any, companyId: string, projectId: string): Promise<Record<string, any>[]> {
  return db
    .select()
    .from(activity)
    .where(and(
      eq(activity.companyId, companyId),
      or(
        and(eq(activity.entityType, 'project'), eq(activity.entityId, projectId)),
        sql`${activity.metadata}->>'projectId' = ${projectId}`,
      ),
    ))
    .orderBy(desc(activity.createdAt))
    .limit(200)
}
