// Gantt charts: the company's projects as time bars, each with its tasks (project_task). Moved from
// templates/crm/backend/src/routes/ganttCharts.ts, which was a read-only projection.
//
// The chart could not be planned on: no adding a task, no dragging a bar (live test, 2026-10-22). project_task had
// sat in the schema since the move with nothing reading or writing it. Now the chart reads a project's tasks with it,
// adds a task, and moves or stretches a task or the project itself — each write a date range on the company's own
// record, asked of projects:update (the right a project's own edit asks; reading the chart stays as it was).
//
// TASK LINKS (contractor parity row 7c; Buildertrend predecessors, JobTread dependencies; feature task_links, not ready). A link
// says a task waits on another of the project's tasks: after it ENDS (finish_to_start: starts the day after it ends, plus the
// lag) or once it STARTS (start_to_start: starts the same day, plus the lag). Linked tasks stay linked, as Buildertrend's do: a
// task is placed on the latest day its links allow and keeps its length, so moving a task — either way — moves the tasks that
// wait on it, and theirs in turn. A link that would make a loop is refused.
//   POST   /api/gantt-charts/:projectId/links   { predecessorId, successorId, type?, lagDays? }   projects:update
//   DELETE /api/gantt-charts/links/:id                                                           projects:update
// Each project bar carries `links` while the feature is on; moving a task answers `moved`, the tasks its links moved.
import { Hono } from 'hono'
import { z } from 'zod'
import { eq, and, asc, inArray } from 'drizzle-orm'
import { project, projectTask, taskDependency } from '../../db/schema/index.ts'
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

const linkRow = (l: any) => ({ id: l.id, predecessorId: l.predecessorId, successorId: l.successorId, type: l.type, lagDays: l.lagDays })
const LINK_TYPES = ['finish_to_start', 'start_to_start'] as const
export const TASK_LINKS = 'task_links'

/**
 * Where each linked task falls once `changed` has moved: every task reachable from it through links is placed on the latest day
 * its links allow and keeps its length. Pure, on rows already read; answers only the tasks whose dates change.
 */
export function placeLinked(tasks: Array<{ id: string; startDate: any; endDate: any }>, links: Array<{ predecessorId: string; successorId: string; type: string; lagDays: number }>, changed: string[]) {
  const DAYMS = 86_400_000
  const at = new Map(tasks.map((t) => [t.id, { s: t.startDate ? new Date(t.startDate).getTime() : NaN, e: t.endDate ? new Date(t.endDate).getTime() : NaN }]))
  const moved = new Map<string, { s: number; e: number }>()
  const queue = [...changed]
  let guard = 0
  while (queue.length && guard++ < 10_000) {
    const from = queue.shift()!
    for (const l of links.filter((x) => x.predecessorId === from)) {
      const succ = at.get(l.successorId)
      if (!succ || Number.isNaN(succ.s)) continue
      // The latest day any of its links asks for (a link from an undated task asks nothing).
      let want = -Infinity
      for (const k of links.filter((x) => x.successorId === l.successorId)) {
        const p = at.get(k.predecessorId)
        if (!p || Number.isNaN(p.s)) continue
        const base = k.type === 'start_to_start' ? p.s : (Number.isNaN(p.e) ? p.s : p.e) + DAYMS
        want = Math.max(want, base + (k.lagDays || 0) * DAYMS)
      }
      if (!Number.isFinite(want) || want === succ.s) continue
      const len = Number.isNaN(succ.e) ? 0 : succ.e - succ.s
      const next = { s: want, e: want + len }
      at.set(l.successorId, next); moved.set(l.successorId, next)
      queue.push(l.successorId)
    }
  }
  return [...moved.entries()].map(([id, r]) => ({ id, startDate: new Date(r.s), endDate: new Date(r.e) }))
}

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
const newLink = z.object({
  predecessorId: z.string().min(1), successorId: z.string().min(1),
  type: z.enum(LINK_TYPES).default('finish_to_start'),
  lagDays: z.number().int().min(-365).max(365).default(0),
}).refine((r) => r.predecessorId !== r.successorId, { message: 'A task cannot wait on itself', path: ['successorId'] })
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
  const linksOn = (companyId: string) => d.features.isFeatureEnabled(companyId, TASK_LINKS)
  const linksOf = async (companyId: string, projectIds: string[]) => projectIds.length
    ? db.select().from(taskDependency).where(and(eq(taskDependency.companyId, companyId), inArray(taskDependency.projectId, projectIds))).orderBy(asc(taskDependency.createdAt), asc(taskDependency.id))
    : []
  /** Move what `changed` drags along through its links; answers the tasks moved, as bars. */
  const follow = async (companyId: string, projectId: string, changed: string[]) => {
    const [tasks, links] = await Promise.all([tasksOf(companyId, [projectId]), linksOf(companyId, [projectId])])
    const moves = placeLinked(tasks as any[], links as any[], changed)
    const out = []
    for (const m of moves) {
      const [row] = await db.update(projectTask).set({ startDate: m.startDate, endDate: m.endDate, updatedAt: new Date() } as any)
        .where(and(eq(projectTask.id, m.id), eq(projectTask.companyId, companyId))).returning()
      if (row) out.push(taskBar(row))
    }
    return out
  }
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
    const links: any[] = (await linksOn(currentUser.companyId)) ? await linksOf(currentUser.companyId, projects.map((p) => p.id)) : []
    const withLinks = links.length > 0 || (await linksOn(currentUser.companyId))
    const ganttData = projects.map((p) => ({ ...bar(p, tasks.filter((t) => t.projectId === p.id)), ...(withLinks ? { links: links.filter((l) => l.projectId === p.id).map(linkRow) } : {}) }))
    return listAll(c, ganttData)
  })

  // One project's bar — the project detail page.
  app.get('/:projectId', async (c) => {
    const currentUser = c.get('user') as any
    const p = await ownProject(currentUser.companyId, c.req.param('projectId'))
    if (!p) return fail(c, 404, 'Project not found')
    const links = (await linksOn(currentUser.companyId)) ? { links: (await linksOf(currentUser.companyId, [p.id])).map(linkRow) } : {}
    return one(c, { project: { ...bar(p, await tasksOf(currentUser.companyId, [p.id])), ...links } })
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
    // Its dates moved: the tasks linked to it move with it (row 7c).
    const datesMoved = parsed.data.startDate !== undefined || parsed.data.endDate !== undefined
    if (datesMoved && (await linksOn(currentUser.companyId))) return one(c, { ...taskBar(row), moved: await follow(currentUser.companyId, row.projectId, [row.id]) })
    return one(c, taskBar(row))
  })

  // Link two of a project's tasks (row 7c): the successor is placed by the link at once, and what waits on it after it.
  app.post('/:projectId/links', requirePermission('projects:update'), async (c) => {
    const currentUser = c.get('user') as any
    if (!(await linksOn(currentUser.companyId))) return fail(c, 404, 'Not found')
    const parsed = newLink.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) return invalid(c, parsed.error)
    const p = await ownProject(currentUser.companyId, c.req.param('projectId'))
    if (!p) return fail(c, 404, 'Project not found')
    const tasks = await tasksOf(currentUser.companyId, [p.id]) as any[]
    const ids = new Set(tasks.map((t) => t.id))
    if (!ids.has(parsed.data.predecessorId) || !ids.has(parsed.data.successorId)) return fail(c, 400, 'Both tasks must be on this project')
    const links = await linksOf(currentUser.companyId, [p.id]) as any[]
    if (links.some((l) => l.predecessorId === parsed.data.predecessorId && l.successorId === parsed.data.successorId)) return fail(c, 409, 'Those two tasks are already linked')
    // A loop: the predecessor already waits, through links, on the successor.
    const reach = new Set<string>([parsed.data.successorId])
    for (let grew = true; grew;) { grew = false; for (const l of links) if (reach.has(l.predecessorId) && !reach.has(l.successorId)) { reach.add(l.successorId); grew = true } }
    if (reach.has(parsed.data.predecessorId)) return fail(c, 400, 'That would make a loop: the first task already waits on the second')
    const [row] = await db.insert(taskDependency).values({ companyId: currentUser.companyId, projectId: p.id, ...parsed.data }).returning()
    return one(c, { ...linkRow(row), moved: await follow(currentUser.companyId, p.id, [parsed.data.predecessorId]) }, 201)
  })

  app.delete('/links/:id', requirePermission('projects:update'), async (c) => {
    const currentUser = c.get('user') as any
    if (!(await linksOn(currentUser.companyId))) return fail(c, 404, 'Not found')
    const [gone] = await db.delete(taskDependency)
      .where(and(eq(taskDependency.id, c.req.param('id')), eq(taskDependency.companyId, currentUser.companyId))).returning({ id: taskDependency.id })
    if (!gone) return fail(c, 404, 'Link not found')
    return done(c)
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
