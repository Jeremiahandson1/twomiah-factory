// What the contractor's phone needs that a field seat may not otherwise read (contractor parity row 11; contractor_phone, not ready).
//
//   GET /api/project-phone/:projectId/cost-codes   the project's cost codes, by name only — never what any of them is budgeted at
//
// A crew clocks its hours against a project and one of its cost codes (Buildertrend / JobTread's mobile time clock). The codes are
// the project's budget lines (crm/billing/quoteBudget.ts), which are reports:read; a crew member holds time:create, so this answers
// the names alone, to anyone who may clock in or read the project.
import { Hono } from 'hono'
import { and, asc, eq } from 'drizzle-orm'
import { project, projectBudgetLine } from '../../db/schema/index.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, one } from '../../http/reply.ts'
import type { CrmDeps } from '../deps.ts'

export const CONTRACTOR_PHONE = 'contractor_phone'

export function createProjectPhoneRoutes(d: CrmDeps) {
  const { db } = d
  const app = new Hono<AppEnv>()
  app.use('*', async (c, next) => {
    if (!(await d.features.isFeatureEnabled((c.get('user') as any).companyId, CONTRACTOR_PHONE))) return fail(c, 404, 'Not found')
    await next()
  })
  app.get('/:projectId/cost-codes', d.permissions.requireAnyPermission(['time:create', 'projects:read']), async (c) => {
    const me = c.get('user') as any
    const projectId = c.req.param('projectId')
    const [p] = await db.select({ id: project.id }).from(project).where(and(eq(project.id, projectId), eq(project.companyId, me.companyId))).limit(1)
    if (!p) return fail(c, 404, 'Project not found')
    const rows = await db.select({ code: projectBudgetLine.costCode }).from(projectBudgetLine)
      .where(and(eq(projectBudgetLine.companyId, me.companyId), eq(projectBudgetLine.projectId, projectId))).orderBy(asc(projectBudgetLine.costCode))
    return one(c, { codes: [...new Set(rows.map((r: any) => String(r.code)).filter(Boolean))] })
  })
  return app
}
