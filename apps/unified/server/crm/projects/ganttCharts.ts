// Gantt charts: the company's projects as time bars, each with its tasks (project_task). Moved from
// templates/crm/backend/src/routes/ganttCharts.ts, which was a read-only projection.
//
// The chart could not be planned on: no adding a task, no dragging a bar (live test, 2026-10-22). project_task had
// sat in the schema since the move with nothing reading or writing it. Now the chart reads a project's tasks with it,
// adds a task, and moves or stretches a task or the project itself — each write a date range on the company's own
// record, asked of projects:update (the right a project's own edit asks; reading the chart stays as it was).
import { Hono } from 'hono'
import { z } from 'zod'
import { eq, and, asc, inArray } from 'drizzle-orm'
import { project, projectTask } from '../../db/schema/index.ts'
import type { AppEnv } from '../../http/env.ts'
import { done, fail, one, listAll } from '../../http/reply.ts'
import { invalid } from '../../http/errors.ts'
import type { CrmDeps } from '../deps.ts'

/** A project as a Gantt bar. With no dates set, created → updated, so the bar still renders. */
const bar = (p: any, tasks: any[] = []) => ({
  id: p.id,
  name: p.name,
  startDate: p.startDate || p.createdAt,
  endDate: p.endDate || p.targetCompletionDate || p.updatedAt,
  status: p.status,
  percentComplete: p.percentComplete || 0,
  phases: p.phases || [],
  tasks: tasks.map(taskBar),
})

const taskBar = (t: any) => ({
  id: t.id, projectId: t.projectId, name: t.name, startDate: t.startDate, endDate: t.endDate,
  progress: t.progress ?? 0, status: t.status,
})

/** A calendar day, YYYY-MM-DD, stored as that day's UTC midnight (a Gantt bar is whole days). */
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-11-03').refine((v) => !Number.isNaN(new Date(`${v}T00:00:00Z`).getTime()), 'That is not a real date')
const asDate = (v: string) => new Date(`${v}T00:00:00Z`)
const range = z.object({ startDate: day, endDate: day }).refine((r) => r.endDate >= r.startDate, { message: 'The end date cannot be before the start date', path: ['endDate'] })
const newTask = z.object({ name: z.string().trim().min(1, 'Give the task a name').max(200, 'Name is too long (200 characters max)'), startDate: day, endDate: day })
  .refine((r) => r.endDate >= r.startDate, { message: 'The end date cannot be before the start date', path: ['endDate'] })
const taskPatch = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  startDate: day.optional(),
  endDate: day.optional(),
  progress: z.number().int().min(0).max(100).optional(),
})

export function createGanttChartRoutes(d: CrmDeps) {
  const { db } = d
  const { requirePermission } = d.permissions
  const app = new Hono<AppEnv>()

  const ownProject = async (companyId: string, id: string) =>
    (await db.select().from(project).where(and(eq(project.id, id), eq(project.companyId, companyId))).limit(1))[0]
  const tasksOf = async (companyId: string, projectIds: string[]) => projectIds.length
    ? db.select().from(projectTask).where(and(eq(projectTask.companyId, companyId), inArray(projectTask.projectId, projectIds))).orderBy(asc(projectTask.startDate), asc(projectTask.createdAt))
    : []

  // Every project of the company, optionally one status, as Gantt bars with their tasks.
  app.get('/', async (c) => {
    const currentUser = c.get('user') as any
    const status = c.req.query('status')

    const conditions = [eq(project.companyId, currentUser.companyId)]
    if (status) conditions.push(eq(project.status, status))

    const projects: any[] = await db.select().from(project).where(and(...conditions))
    const tasks: any[] = await tasksOf(currentUser.companyId, projects.map((p) => p.id))
    const ganttData = projects.map((p) => bar(p, tasks.filter((t) => t.projectId === p.id)))
    return listAll(c, ganttData)
  })

  // One project's bar — the project detail page.
  app.get('/:projectId', async (c) => {
    const currentUser = c.get('user') as any
    const p = await ownProject(currentUser.companyId, c.req.param('projectId'))
    if (!p) return fail(c, 404, 'Project not found')
    return one(c, { project: bar(p, await tasksOf(currentUser.companyId, [p.id])) })
  })

  // Drag the project's own bar: its start and end move (or stretch) together.
  app.patch('/:projectId/dates', requirePermission('projects:update'), async (c) => {
    const currentUser = c.get('user') as any
    const parsed = range.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) return invalid(c, parsed.error)
    const [row] = await db.update(project)
      .set({ startDate: asDate(parsed.data.startDate), endDate: asDate(parsed.data.endDate), updatedAt: new Date() } as any)
      .where(and(eq(project.id, c.req.param('projectId')), eq(project.companyId, currentUser.companyId))).returning()
    if (!row) return fail(c, 404, 'Project not found')
    return one(c, bar(row))
  })

  // Add a task to a project.
  app.post('/:projectId/tasks', requirePermission('projects:update'), async (c) => {
    const currentUser = c.get('user') as any
    const parsed = newTask.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) return invalid(c, parsed.error)
    const p = await ownProject(currentUser.companyId, c.req.param('projectId'))
    if (!p) return fail(c, 404, 'Project not found')
    const [row] = await db.insert(projectTask).values({
      companyId: currentUser.companyId, projectId: p.id, name: parsed.data.name,
      startDate: asDate(parsed.data.startDate), endDate: asDate(parsed.data.endDate),
    }).returning()
    return one(c, taskBar(row), 201)
  })

  // Drag a task (new dates), rename it, or set how far along it is.
  app.patch('/tasks/:id', requirePermission('projects:update'), async (c) => {
    const currentUser = c.get('user') as any
    const parsed = taskPatch.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) return invalid(c, parsed.error)
    const [existing] = await db.select().from(projectTask)
      .where(and(eq(projectTask.id, c.req.param('id')), eq(projectTask.companyId, currentUser.companyId))).limit(1)
    if (!existing) return fail(c, 404, 'Task not found')
    const set: Record<string, unknown> = { updatedAt: new Date() }
    if (parsed.data.name !== undefined) set.name = parsed.data.name
    if (parsed.data.progress !== undefined) set.progress = parsed.data.progress
    if (parsed.data.startDate !== undefined) set.startDate = asDate(parsed.data.startDate)
    if (parsed.data.endDate !== undefined) set.endDate = asDate(parsed.data.endDate)
    // The range the task WILL have, whichever end moved, is checked against the other.
    const start = (set.startDate as Date | undefined) ?? existing.startDate
    const end = (set.endDate as Date | undefined) ?? existing.endDate
    if (start && end && new Date(end).getTime() < new Date(start).getTime()) return fail(c, 400, 'The end date cannot be before the start date')
    const [row] = await db.update(projectTask).set(set as any).where(and(eq(projectTask.id, existing.id), eq(projectTask.companyId, currentUser.companyId))).returning()
    return one(c, taskBar(row))
  })

  app.delete('/tasks/:id', requirePermission('projects:update'), async (c) => {
    const currentUser = c.get('user') as any
    const [gone] = await db.delete(projectTask)
      .where(and(eq(projectTask.id, c.req.param('id')), eq(projectTask.companyId, currentUser.companyId))).returning({ id: projectTask.id })
    if (!gone) return fail(c, 404, 'Task not found')
    return done(c)
  })

  return app
}
