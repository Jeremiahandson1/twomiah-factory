// Project templates (brief item 5/6 — contractors): save a project as a template, start a new project from one.
//
//   GET    /api/project-templates                 the saved templates, with how many tasks and punch items each has   projects:read
//   GET    /api/project-templates/:id             one template: its phases/milestones/tasks and its starter punch list  projects:read
//   POST   /api/project-templates/from-project    { projectId, name, description?, includePunchList? }                  projects:update
//   PUT    /api/project-templates/:id             rename / describe                                                     projects:update
//   DELETE /api/project-templates/:id                                                                                   projects:delete
//   POST   /api/project-templates/:id/start       the new project's fields (name, client, start date …)                projects:create
//
// What a template keeps: the project's schedule tasks (the Gantt's phases, milestones and tasks) as days after the start and
// how long each lasts, their nesting, and the project's punch-list items as a starter list. What it never keeps: who was
// assigned, how far along anything was, the money, the documents, the client. Starting one puts the tasks on the new
// project's own dates (when it has a start date) and the starter list on its punch list — each only where the business has
// that feature on, and the answer says what was left out. Nothing here moves money.
import { Hono } from 'hono'
import { z } from 'zod'
import { and, asc, count, eq } from 'drizzle-orm'
import { project, projectTask, punchListItem, projectTemplate, projectTemplateTask, projectTemplatePunchItem } from '../../db/schema/index.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, one, listAll } from '../../http/reply.ts'
import type { CrmDeps } from '../deps.ts'
import { insertProject, projectInput } from './projects.ts'

const DAY = 86_400_000
const wholeDays = (from: Date, to: Date) => Math.round((to.getTime() - from.getTime()) / DAY)
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY)

const saveSchema = z.object({
  projectId: z.string().min(1),
  name: z.string().trim().min(1, 'Name the template').max(120, 'A template name is 120 characters or fewer'),
  description: z.string().trim().max(500).optional(),
  includePunchList: z.boolean().default(true),
})
const editSchema = z.object({ name: z.string().trim().min(1).max(120).optional(), description: z.string().trim().max(500).nullable().optional() })

export function createProjectTemplateRoutes(d: CrmDeps) {
  const { db } = d
  const { requirePermission, hasPermission, getExtraPermissions } = d.permissions
  const app = new Hono<AppEnv>()

  const may = async (c: any, permission: string) => {
    const u = c.get('user') as any
    try { return !!hasPermission(u?.role, permission, await getExtraPermissions(u?.userId)) } catch { return false }
  }
  const own = async (companyId: string, id: string) =>
    (await db.select().from(projectTemplate).where(and(eq(projectTemplate.id, id), eq(projectTemplate.companyId, companyId))).limit(1))[0]
  const parts = async (companyId: string, templateId: string) => {
    const [tasks, punch] = await Promise.all([
      db.select().from(projectTemplateTask).where(and(eq(projectTemplateTask.templateId, templateId), eq(projectTemplateTask.companyId, companyId))).orderBy(asc(projectTemplateTask.sortOrder), asc(projectTemplateTask.id)),
      db.select().from(projectTemplatePunchItem).where(and(eq(projectTemplatePunchItem.templateId, templateId), eq(projectTemplatePunchItem.companyId, companyId))).orderBy(asc(projectTemplatePunchItem.sortOrder), asc(projectTemplatePunchItem.id)),
    ])
    return { tasks, punchItems: punch }
  }

  app.get('/', requirePermission('projects:read'), async (c) => {
    const me = c.get('user') as any
    const rows = await db.select().from(projectTemplate).where(eq(projectTemplate.companyId, me.companyId)).orderBy(asc(projectTemplate.name))
    const out = []
    for (const t of rows) {
      const [{ value: tasks }] = await db.select({ value: count() }).from(projectTemplateTask).where(eq(projectTemplateTask.templateId, t.id))
      const [{ value: punchItems }] = await db.select({ value: count() }).from(projectTemplatePunchItem).where(eq(projectTemplatePunchItem.templateId, t.id))
      out.push({ ...t, taskCount: Number(tasks), punchItemCount: Number(punchItems) })
    }
    return listAll(c, out)
  })

  app.get('/:id', requirePermission('projects:read'), async (c) => {
    const me = c.get('user') as any
    const t = await own(me.companyId, c.req.param('id'))
    if (!t) return fail(c, 404, 'Template not found')
    return one(c, { ...t, ...(await parts(me.companyId, t.id)) })
  })

  app.post('/from-project', requirePermission('projects:update'), async (c) => {
    const me = c.get('user') as any
    const parsed = saveSchema.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) return fail(c, 400, parsed.error.issues[0]?.message || 'Check the template details')
    const data = parsed.data
    const [p] = await db.select().from(project).where(and(eq(project.id, data.projectId), eq(project.companyId, me.companyId))).limit(1)
    if (!p) return fail(c, 404, 'Project not found')
    if ((await db.select({ id: projectTemplate.id }).from(projectTemplate).where(and(eq(projectTemplate.companyId, me.companyId), eq(projectTemplate.name, data.name))).limit(1))[0]) {
      return fail(c, 409, `You already have a template called "${data.name}". Pick another name, or delete that one first.`)
    }
    // The punch list is the project's to read: a seat that cannot read punch lists saves the schedule only.
    const withPunch = data.includePunchList && (await may(c, 'punch-lists:read')) && (await d.features.isFeatureEnabled(me.companyId, 'punch_lists'))
    const tasks = await db.select().from(projectTask).where(and(eq(projectTask.projectId, p.id), eq(projectTask.companyId, me.companyId))).orderBy(asc(projectTask.startDate), asc(projectTask.createdAt), asc(projectTask.id))
    const punch = withPunch ? await db.select().from(punchListItem).where(and(eq(punchListItem.projectId, p.id), eq(punchListItem.companyId, me.companyId))).orderBy(asc(punchListItem.createdAt), asc(punchListItem.id)) : []

    // Days after the earliest start (else the project's own start) — a template has no calendar of its own.
    const starts = tasks.map((t: any) => t.startDate).filter(Boolean).map((x: any) => new Date(x))
    const base: Date | null = starts.length ? new Date(Math.min(...starts.map((s: Date) => s.getTime()))) : p.startDate ? new Date(p.startDate) : null

    const made = await db.transaction(async (tx: any) => {
      const [t] = await tx.insert(projectTemplate).values({ companyId: me.companyId, name: data.name, description: data.description || null, type: p.type ?? null, fromProjectId: p.id }).returning()
      const ids = new Map<string, string>()
      for (let i = 0; i < tasks.length; i++) ids.set(tasks[i].id, (await tx.insert(projectTemplateTask).values({ companyId: me.companyId, templateId: t.id, name: '·', sortOrder: i }).returning())[0].id)
      for (let i = 0; i < tasks.length; i++) {
        const k = tasks[i]
        const start = k.startDate ? new Date(k.startDate) : null
        const end = k.endDate ? new Date(k.endDate) : null
        const span = start && end ? Math.max(0, wholeDays(start, end)) : 0
        await tx.update(projectTemplateTask).set({
          parentId: k.parentId ? ids.get(k.parentId) ?? null : null,
          name: k.name, description: k.description ?? null,
          offsetDays: start && base ? Math.max(0, wholeDays(base, start)) : 0,
          spanDays: span,
          milestone: !!start && !!end && span === 0,
        }).where(eq(projectTemplateTask.id, ids.get(k.id)!))
      }
      for (let i = 0; i < punch.length; i++) {
        await tx.insert(projectTemplatePunchItem).values({ companyId: me.companyId, templateId: t.id, description: punch[i].description, location: punch[i].location ?? null, priority: punch[i].priority || 'normal', sortOrder: i })
      }
      return t
    })
    return one(c, { ...made, taskCount: tasks.length, punchItemCount: punch.length, ...(data.includePunchList && !withPunch ? { punchListLeftOut: true } : {}) }, 201)
  })

  app.put('/:id', requirePermission('projects:update'), async (c) => {
    const me = c.get('user') as any
    const t = await own(me.companyId, c.req.param('id'))
    if (!t) return fail(c, 404, 'Template not found')
    const parsed = editSchema.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) return fail(c, 400, parsed.error.issues[0]?.message || 'Check the template details')
    if (parsed.data.name && parsed.data.name !== t.name &&
      (await db.select({ id: projectTemplate.id }).from(projectTemplate).where(and(eq(projectTemplate.companyId, me.companyId), eq(projectTemplate.name, parsed.data.name))).limit(1))[0]) {
      return fail(c, 409, `You already have a template called "${parsed.data.name}".`)
    }
    const [row] = await db.update(projectTemplate).set({
      ...(parsed.data.name ? { name: parsed.data.name } : {}),
      ...(parsed.data.description !== undefined ? { description: parsed.data.description || null } : {}),
    }).where(eq(projectTemplate.id, t.id)).returning()
    return one(c, row)
  })

  app.delete('/:id', requirePermission('projects:delete'), async (c) => {
    const me = c.get('user') as any
    const t = await own(me.companyId, c.req.param('id'))
    if (!t) return fail(c, 404, 'Template not found')
    await db.delete(projectTemplate).where(eq(projectTemplate.id, t.id))
    return one(c, { deleted: true })
  })

  app.post('/:id/start', requirePermission('projects:create'), async (c) => {
    const me = c.get('user') as any
    const t = await own(me.companyId, c.req.param('id'))
    if (!t) return fail(c, 404, 'Template not found')
    const body = await c.req.json().catch(() => ({}))
    const parsed = projectInput.safeParse({ type: t.type ?? undefined, description: t.description ?? undefined, ...body })
    if (!parsed.success) return fail(c, 400, parsed.error.issues[0]?.message || 'Check the project details')
    const { tasks, punchItems } = await parts(me.companyId, t.id)
    const startsOn = parsed.data.startDate ? new Date(parsed.data.startDate) : null
    const wantTasks = tasks.length > 0 && (await d.features.isFeatureEnabled(me.companyId, 'gantt_charts'))
    const wantPunch = punchItems.length > 0 && (await d.features.isFeatureEnabled(me.companyId, 'punch_lists')) && (await may(c, 'punch-lists:create'))

    const result = await db.transaction(async (tx: any) => {
      const made = await insertProject(tx, me.companyId, parsed.data)
      if (wantTasks) {
        const ids = new Map<string, string>()
        // A parent is written before the tasks under it, so the saved order (phases first as they were) is enough; a
        // child that came first is parented in a second pass.
        for (const k of tasks) {
          const start = startsOn ? addDays(startsOn, k.offsetDays) : null
          const [row] = await tx.insert(projectTask).values({
            companyId: me.companyId, projectId: made.id, name: k.name, description: k.description ?? null,
            startDate: start, endDate: start ? addDays(start, k.spanDays) : null,
            duration: k.milestone ? 0 : k.spanDays || null,
          }).returning()
          ids.set(k.id, row.id)
        }
        for (const k of tasks) if (k.parentId && ids.get(k.parentId)) await tx.update(projectTask).set({ parentId: ids.get(k.parentId)! }).where(eq(projectTask.id, ids.get(k.id)!))
      }
      if (wantPunch) {
        let n = 0
        for (const k of punchItems) {
          n += 1
          await tx.insert(punchListItem).values({ companyId: me.companyId, projectId: made.id, number: `PL-${String(n).padStart(3, '0')}`, description: k.description, location: k.location ?? null, priority: k.priority || 'normal' })
        }
      }
      return made
    })
    return one(c, {
      ...result,
      fromTemplate: { id: t.id, name: t.name },
      copied: { tasks: wantTasks ? tasks.length : 0, punchItems: wantPunch ? punchItems.length : 0 },
      leftOut: [
        ...(tasks.length && !wantTasks ? ['schedule tasks (Gantt Charts is off)'] : []),
        ...(punchItems.length && !wantPunch ? ['starter punch list (Punch Lists is off, or you cannot create punch items)'] : []),
        ...(wantTasks && tasks.length && !startsOn ? ['task dates (give the project a start date to place them)'] : []),
      ],
    }, 201)
  })

  return app
}
