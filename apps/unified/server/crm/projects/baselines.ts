// SCHEDULE BASELINE (parity tier 3, contractor — Buildertrend's baseline and "baseline vs actual"; feature schedule_baseline, not
// ready). The project_baseline table sat in the schema with nothing reading it; this finishes it. A baseline is a saved copy of a
// project's schedule (each task's name and dates) at the moment the plan was agreed; the comparison lines each task's plan up with
// where it stands now, in whole days:
//   · starts late / early (start slip), finishes late / early (finish slip), longer / shorter (duration change);
//   · a task added since the baseline is "new", one removed since is "removed";
//   · the project: the plan's last finish against today's last finish.
//
//   GET    /report                     projects:read     every project with a baseline, plan against now (the company-wide
//                                                        baseline report): finish slip, tasks late / early / new / removed
//   GET    /:projectId                 projects:read     the project's baselines, newest first
//   POST   /:projectId                 projects:update   { name? } — save the schedule as it is now
//   GET    /:projectId/compare         projects:read     ?baselineId= (default: the newest) — plan against now
//   DELETE /baseline/:id               projects:update
import { Hono } from 'hono'
import { z } from 'zod'
import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import { project, projectBaseline, projectTask } from '../../db/schema/index.ts'
import type { AppEnv } from '../../http/env.ts'
import { done, fail, one } from '../../http/reply.ts'
import { invalid } from '../../http/errors.ts'
import type { CrmDeps } from '../deps.ts'

const DAY = 86_400_000
interface Snap { taskId: string; name: string; startDate: string | null; endDate: string | null }
/** A date as its calendar day (UTC midnight), so slips are whole days. */
const dayOf = (v: unknown): number | null => {
  if (!v) return null
  const d = new Date(v as any)
  return isNaN(d.getTime()) ? null : Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}
const iso = (v: unknown) => { const n = dayOf(v); return n == null ? null : new Date(n).toISOString().slice(0, 10) }
const days = (a: number | null, b: number | null) => (a == null || b == null ? null : Math.round((a - b) / DAY))

export interface CompareRow {
  taskId: string; name: string; state: 'kept' | 'new' | 'removed'
  planStart: string | null; planEnd: string | null; nowStart: string | null; nowEnd: string | null
  /** + late, − early; null when a side has no date. */
  startSlip: number | null; finishSlip: number | null; durationChange: number | null
}

/** Plan against now, task by task (pure: the route and the tests use it). */
export function compareSchedules(plan: Snap[], now: Snap[]): { rows: CompareRow[]; projectFinishSlip: number | null; planFinish: string | null; nowFinish: string | null } {
  const byId = new Map(now.map((t) => [t.taskId, t]))
  const rows: CompareRow[] = []
  for (const p of plan) {
    const n = byId.get(p.taskId)
    const ps = dayOf(p.startDate), pe = dayOf(p.endDate)
    if (!n) { rows.push({ taskId: p.taskId, name: p.name, state: 'removed', planStart: iso(ps), planEnd: iso(pe), nowStart: null, nowEnd: null, startSlip: null, finishSlip: null, durationChange: null }); continue }
    const ns = dayOf(n.startDate), ne = dayOf(n.endDate)
    const pdur = ps != null && pe != null ? pe - ps : null, ndur = ns != null && ne != null ? ne - ns : null
    rows.push({ taskId: p.taskId, name: n.name, state: 'kept', planStart: iso(ps), planEnd: iso(pe), nowStart: iso(ns), nowEnd: iso(ne),
      startSlip: days(ns, ps), finishSlip: days(ne, pe), durationChange: pdur == null || ndur == null ? null : Math.round((ndur - pdur) / DAY) })
  }
  const planned = new Set(plan.map((p) => p.taskId))
  for (const n of now) if (!planned.has(n.taskId)) rows.push({ taskId: n.taskId, name: n.name, state: 'new', planStart: null, planEnd: null, nowStart: iso(n.startDate), nowEnd: iso(n.endDate), startSlip: null, finishSlip: null, durationChange: null })
  const last = (list: Snap[]) => list.map((t) => dayOf(t.endDate)).filter((x): x is number => x != null).reduce((m, x) => Math.max(m, x), -Infinity)
  const pf = last(plan), nf = last(now)
  const planFinish = Number.isFinite(pf) ? new Date(pf).toISOString().slice(0, 10) : null
  const nowFinish = Number.isFinite(nf) ? new Date(nf).toISOString().slice(0, 10) : null
  return { rows, planFinish, nowFinish, projectFinishSlip: Number.isFinite(pf) && Number.isFinite(nf) ? Math.round((nf - pf) / DAY) : null }
}

const saveBody = z.object({ name: z.string().trim().max(80, 'At most 80 characters').optional() })

export function createBaselineRoutes(d: CrmDeps) {
  const { db, audit } = d
  const { requirePermission } = d.permissions
  const app = new Hono<AppEnv>()

  const projectOf = async (companyId: string, projectId: string) =>
    (await db.select({ id: project.id, name: project.name }).from(project).where(and(eq(project.id, projectId), eq(project.companyId, companyId))).limit(1))[0] ?? null
  const tasksNow = async (companyId: string, projectId: string): Promise<Snap[]> =>
    ((await db.select().from(projectTask).where(and(eq(projectTask.companyId, companyId), eq(projectTask.projectId, projectId))).orderBy(asc(projectTask.startDate), asc(projectTask.createdAt))) as any[])
      .map((t) => ({ taskId: t.id, name: t.name, startDate: t.startDate ? new Date(t.startDate).toISOString() : null, endDate: t.endDate ? new Date(t.endDate).toISOString() : null }))

  // The Gantt chart's ghost bars: for each project asked about, its newest baseline's planned dates by task.
  app.get('/latest/plans', requirePermission('projects:read'), async (c) => {
    const companyId = c.get('user').companyId
    const ids = String(c.req.query('projectIds') || '').split(',').map((x) => x.trim()).filter(Boolean).slice(0, 200)
    if (!ids.length) return one(c, { plans: {} })
    const rows = await db.select().from(projectBaseline).where(and(eq(projectBaseline.companyId, companyId), inArray(projectBaseline.projectId, ids))).orderBy(desc(projectBaseline.createdAt), desc(projectBaseline.id))
    const plans: Record<string, Record<string, { start: string | null; end: string | null }>> = {}
    for (const b of rows as any[]) {
      if (plans[b.projectId]) continue
      plans[b.projectId] = Object.fromEntries(((b.taskSnapshots || []) as Snap[]).map((t) => [t.taskId, { start: iso(t.startDate), end: iso(t.endDate) }]))
    }
    return one(c, { plans })
  })

  // The company-wide report (Buildertrend's baseline report): each project's newest baseline against its schedule now.
  app.get('/report', requirePermission('projects:read'), async (c) => {
    const companyId = c.get('user').companyId
    const bases = await db.select().from(projectBaseline).where(eq(projectBaseline.companyId, companyId)).orderBy(desc(projectBaseline.createdAt), desc(projectBaseline.id))
    const newest = new Map<string, any>()
    for (const b of bases as any[]) if (!newest.has(b.projectId)) newest.set(b.projectId, b)
    const ids = [...newest.keys()]
    if (!ids.length) return one(c, { projects: [] })
    const projects = await db.select({ id: project.id, name: project.name, number: project.number, status: project.status }).from(project).where(and(eq(project.companyId, companyId), inArray(project.id, ids)))
    const tasks = await db.select().from(projectTask).where(and(eq(projectTask.companyId, companyId), inArray(projectTask.projectId, ids))).orderBy(asc(projectTask.startDate), asc(projectTask.createdAt))
    const rows = (projects as any[]).map((p) => {
      const b = newest.get(p.id)
      const now: Snap[] = (tasks as any[]).filter((t) => t.projectId === p.id).map((t) => ({ taskId: t.id, name: t.name, startDate: t.startDate ? new Date(t.startDate).toISOString() : null, endDate: t.endDate ? new Date(t.endDate).toISOString() : null }))
      const cmp = compareSchedules(Array.isArray(b.taskSnapshots) ? b.taskSnapshots : [], now)
      const kept = cmp.rows.filter((r) => r.state !== 'new' && r.state !== 'removed')
      return {
        projectId: p.id, name: p.name, number: p.number ?? null, status: p.status ?? null,
        baseline: { id: b.id, name: b.name, createdAt: new Date(b.createdAt).toISOString() },
        planFinish: cmp.planFinish, nowFinish: cmp.nowFinish, finishSlip: cmp.projectFinishSlip,
        late: kept.filter((r) => (r.finishSlip ?? 0) > 0).length, early: kept.filter((r) => (r.finishSlip ?? 0) < 0).length,
        added: cmp.rows.filter((r) => r.state === 'new').length, removed: cmp.rows.filter((r) => r.state === 'removed').length,
      }
    }).sort((a, b) => (b.finishSlip ?? 0) - (a.finishSlip ?? 0) || a.name.localeCompare(b.name))
    return one(c, { projects: rows })
  })

  app.get('/:projectId', requirePermission('projects:read'), async (c) => {
    const companyId = c.get('user').companyId
    if (!(await projectOf(companyId, c.req.param('projectId')))) return fail(c, 404, 'Project not found')
    const rows = await db.select().from(projectBaseline).where(and(eq(projectBaseline.companyId, companyId), eq(projectBaseline.projectId, c.req.param('projectId')))).orderBy(desc(projectBaseline.createdAt), desc(projectBaseline.id))
    return one(c, { baselines: (rows as any[]).map((b) => ({ id: b.id, name: b.name, createdAt: new Date(b.createdAt).toISOString(), tasks: Array.isArray(b.taskSnapshots) ? b.taskSnapshots.length : 0 })) })
  })

  app.post('/:projectId', requirePermission('projects:update'), async (c) => {
    const parsed = saveBody.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) return invalid(c, parsed.error)
    const companyId = c.get('user').companyId
    const p = await projectOf(companyId, c.req.param('projectId'))
    if (!p) return fail(c, 404, 'Project not found')
    const tasks = await tasksNow(companyId, p.id)
    if (!tasks.length) return fail(c, 400, 'This project has no tasks on its schedule yet, so there is nothing to save as a baseline.')
    const [row] = await db.insert(projectBaseline).values({ companyId, projectId: p.id, name: parsed.data.name || 'Baseline', taskSnapshots: tasks }).returning()
    audit.log({ action: audit.ACTIONS.CREATE, entity: 'project_baseline', entityId: row.id, entityName: `${p.name}: ${row.name}`, metadata: { tasks: tasks.length }, req: c })
    return one(c, { id: row.id, name: row.name, createdAt: new Date(row.createdAt).toISOString(), tasks: tasks.length }, 201)
  })

  app.get('/:projectId/compare', requirePermission('projects:read'), async (c) => {
    const companyId = c.get('user').companyId
    const p = await projectOf(companyId, c.req.param('projectId'))
    if (!p) return fail(c, 404, 'Project not found')
    const wanted = c.req.query('baselineId')
    const [b] = await db.select().from(projectBaseline)
      .where(and(eq(projectBaseline.companyId, companyId), eq(projectBaseline.projectId, p.id), wanted ? eq(projectBaseline.id, wanted) : undefined))
      .orderBy(desc(projectBaseline.createdAt), desc(projectBaseline.id)).limit(1)
    if (!b) return fail(c, 404, wanted ? 'That baseline was not found.' : 'No baseline has been saved for this project yet.')
    const plan: Snap[] = Array.isArray(b.taskSnapshots) ? (b.taskSnapshots as Snap[]) : []
    return one(c, { baseline: { id: b.id, name: b.name, createdAt: new Date(b.createdAt).toISOString() }, ...compareSchedules(plan, await tasksNow(companyId, p.id)) })
  })

  app.delete('/baseline/:id', requirePermission('projects:update'), async (c) => {
    const companyId = c.get('user').companyId
    const gone = await db.delete(projectBaseline).where(and(eq(projectBaseline.id, c.req.param('id')), eq(projectBaseline.companyId, companyId))).returning({ id: projectBaseline.id })
    if (!gone.length) return fail(c, 404, 'That baseline was not found.')
    audit.log({ action: audit.ACTIONS.DELETE, entity: 'project_baseline', entityId: c.req.param('id'), req: c })
    return done(c, 'Baseline removed.')
  })

  return app
}
