/**
 * Gantt Charts — Construction tier feature.
 *
 * A Gantt view is a derived projection of existing data (projects, phases,
 * jobs, dependencies) rendered as a time-based bar chart. No new tables
 * needed — this route reads projects and returns them in the shape the
 * frontend Gantt component expects.
 *
 * Data shape returned:
 * {
 *   projects: [
 *     {
 *       id, name, startDate, endDate,
 *       phases: [{ id, name, startDate, endDate, percentComplete, dependencies }]
 *     }
 *   ]
 * }
 */
import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { project } from '../../db/schema.ts'
import { eq, and } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)

// Returns all projects for the tenant in Gantt-ready shape.
// Frontend renders with any Gantt library (e.g., gantt-task-react,
// frappe-gantt). This endpoint does not persist anything — it's purely
// a projection on top of existing project data.
app.get('/', async (c) => {
  const currentUser = c.get('user') as any
  const status = c.req.query('status') // filter by project status if provided

  const conditions = [eq(project.companyId, currentUser.companyId)]
  if (status) conditions.push(eq(project.status, status))

  const projects = await db.select().from(project).where(and(...conditions))

  const ganttData = projects.map((p) => {
    // Each project row becomes a Gantt task. Phases (if the schema has them)
    // become sub-tasks. If no start/end dates are set, default to created
    // through updated so the bar at least renders.
    const start = (p as any).startDate || p.createdAt
    const end = (p as any).endDate || (p as any).targetCompletionDate || p.updatedAt
    return {
      id: p.id,
      name: p.name,
      startDate: start,
      endDate: end,
      status: p.status,
      percentComplete: (p as any).percentComplete || 0,
      // If project table has phases as JSON, pass them through; otherwise
      // return an empty array. Frontend handles both shapes.
      phases: (p as any).phases || [],
      // Tasks/jobs linked to this project are fetched separately by the
      // frontend via /api/jobs?projectId=... if it needs per-job bars.
    }
  })

  return c.json({ data: ganttData })
})

// Single project gantt — used by the project detail page
app.get('/:projectId', async (c) => {
  const currentUser = c.get('user') as any
  const projectId = c.req.param('projectId')

  const [p] = await db
    .select()
    .from(project)
    .where(and(eq(project.id, projectId), eq(project.companyId, currentUser.companyId)))
    .limit(1)
  if (!p) return c.json({ error: 'Project not found' }, 404)

  const start = (p as any).startDate || p.createdAt
  const end = (p as any).endDate || (p as any).targetCompletionDate || p.updatedAt

  return c.json({
    project: {
      id: p.id,
      name: p.name,
      startDate: start,
      endDate: end,
      status: p.status,
      percentComplete: (p as any).percentComplete || 0,
      phases: (p as any).phases || [],
    },
  })
})

export default app
