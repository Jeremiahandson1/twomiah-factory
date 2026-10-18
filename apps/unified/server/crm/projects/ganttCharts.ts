// Gantt charts: a read-only projection of the company's projects as time bars; nothing is stored. Moved from
// templates/crm/backend/src/routes/ganttCharts.ts.
import { Hono } from 'hono'
import { eq, and } from 'drizzle-orm'
import { project } from '../../db/schema/index.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, list, one } from '../../http/reply.ts'
import type { CrmDeps } from '../deps.ts'

/** A project as a Gantt bar. With no dates set, created → updated, so the bar still renders. */
const bar = (p: any) => ({
  id: p.id,
  name: p.name,
  startDate: p.startDate || p.createdAt,
  endDate: p.endDate || p.targetCompletionDate || p.updatedAt,
  status: p.status,
  percentComplete: p.percentComplete || 0,
  phases: p.phases || [],
})

export function createGanttChartRoutes(d: CrmDeps) {
  const { db } = d
  const app = new Hono<AppEnv>()

  // Every project of the company, optionally one status, as Gantt bars.
  app.get('/', async (c) => {
    const currentUser = c.get('user') as any
    const status = c.req.query('status')

    const conditions = [eq(project.companyId, currentUser.companyId)]
    if (status) conditions.push(eq(project.status, status))

    const projects: any[] = await db.select().from(project).where(and(...conditions))
    const ganttData = projects.map(bar)
    return list(c, ganttData, { page: 1, limit: ganttData.length, total: ganttData.length })
  })

  // One project's bar — the project detail page.
  app.get('/:projectId', async (c) => {
    const currentUser = c.get('user') as any
    const projectId = c.req.param('projectId')

    const [p] = await db
      .select()
      .from(project)
      .where(and(eq(project.id, projectId), eq(project.companyId, currentUser.companyId)))
      .limit(1)
    if (!p) return fail(c, 404, 'Project not found')

    return one(c, { project: bar(p) })
  })

  return app
}
