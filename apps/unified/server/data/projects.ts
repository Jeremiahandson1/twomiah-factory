// The project module's queries that need SQL the query builder can't say (RULEBOOK §2): the change-order money
// roll-up and the activity timeline's metadata match. Moved from templates/crm/backend/src/routes/projects.ts.
import { eq, and, or, count, desc, sql } from 'drizzle-orm'
import { changeOrder, activity } from '../db/schema/index.ts'

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
