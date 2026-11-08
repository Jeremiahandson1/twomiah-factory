// The contractor's client portal, finished (contractor parity row 10; docs/parity/contractor-portal.md; Buildertrend's client
// portal and per-job client permissions, JobTread's customer portal; feature client_portal_plus, not ready).
//
// OFFICE  /api/client-portal (projects:read to read, projects:update to change)
//   GET/PUT /defaults                     the company's default: what a project's client sees and is emailed about
//   GET/PUT /:projectId/settings          the project's own (a project without one reads the default)
//   PUT     /daily-logs/:id/share         { shared } — a daily log shown to the client, or not
//   PUT     /documents/:id/share          { shared } — a project photo or file shown to the client, or not
//   GET/POST /:projectId/todos, PUT/DELETE /todos/:id     the client's to-dos
//   GET     /:projectId/comments          the client's comments on the schedule, with the office's answers
//   POST    /:projectId/tasks/:taskId/comments            { body } — the office answers on a task
//   GET     /:projectId/preview           exactly what the client's project page shows
//   POST    /:projectId/notify            { what: 'schedule' | 'files' } — tell the client, once, by email
// A daily log shared, or a to-do added, tells the client by email at once where the project's settings say so.
//
// PORTAL (handed to the shared portal as `projectExtras`; it signs the client in and passes THEIR contact row). Every rule is in
// the query: their own project only (project.contact_id), the section on for that project, and the item shared. What the client
// is told is named field by field — a daily log's date, weather, work done and its photos; never safety notes, delays, who was
// on site or the materials list.
import { Hono } from 'hono'
import { z } from 'zod'
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm'
import type { PortalProjectExtras } from '@twomiah/tenant-backend'
import { clientTodo, company as companyTable, contact, dailyLog, document, project, projectPortalSetting, projectTask, projectTaskComment } from '../../db/schema/index.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, one, listAll } from '../../http/reply.ts'
import type { CrmDeps } from '../deps.ts'
import { createPaymentSchedule } from './paymentSchedule.ts'
import { createSignRequests } from './signRequests.ts'

export const CLIENT_PORTAL_PLUS = 'client_portal_plus'
const IMAGE = /^image\/(jpeg|png|webp|gif)$/
const INLINE = /^(image\/(jpeg|png|webp|gif)|application\/pdf)$/
const DAY = 86_400_000
const NOTIFY_KEYS = ['dailyLogs', 'schedule', 'todos', 'payments', 'documents', 'files'] as const

const settingsBody = z.object({
  schedule: z.enum(['off', 'phases', 'all']).optional(),
  scheduleWeeks: z.number().int().min(1).max(104).nullable().optional(),
  dailyLogs: z.boolean().optional(), photos: z.boolean().optional(), todos: z.boolean().optional(),
  payments: z.boolean().optional(), documents: z.boolean().optional(), shareByDefault: z.boolean().optional(),
  // Any of the known keys (a record keyed by an enum demands every key): unknown ones are dropped.
  notify: z.record(z.string(), z.boolean()).transform((o) => Object.fromEntries(Object.entries(o).filter(([k]) => (NOTIFY_KEYS as readonly string[]).includes(k)))).optional(),
})
const todoBody = z.object({
  title: z.string().trim().min(1, 'Give the to-do a title').max(200),
  notes: z.string().trim().max(4000).nullable().optional(),
  checklist: z.array(z.object({ text: z.string().trim().min(1).max(300), done: z.boolean().default(false) })).max(50).optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-11-30').nullable().optional(),
})
const commentBody = z.object({ body: z.string().trim().min(1, 'Write something').max(2000) })

/** What a project with no settings of its own, in a company with no default, shows: Buildertrend's defaults, nothing emailed. */
export const BUILT_IN = { schedule: 'phases', scheduleWeeks: null, dailyLogs: true, photos: true, todos: true, payments: true, documents: true, shareByDefault: false, notify: {} as Record<string, boolean> }
const shape = (r: any) => r ? { schedule: r.schedule, scheduleWeeks: r.scheduleWeeks ?? null, dailyLogs: !!r.dailyLogs, photos: !!r.photos, todos: !!r.todos, payments: !!r.payments, documents: !!r.documents, shareByDefault: !!r.shareByDefault, notify: r.notify || {} } : { ...BUILT_IN }
const iso = (v: unknown) => (v ? new Date(v as any).toISOString() : null)
const esc = (x: string) => x.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] as string))

export function createClientPortal(d: CrmDeps) {
  const { db } = d
  const storage = d.services.storage as any
  const on = (companyId: string) => (companyId ? d.features.isFeatureEnabled(companyId, CLIENT_PORTAL_PLUS).catch(() => false) : Promise.resolve(false))

  const defaultRow = async (companyId: string) => (await db.select().from(projectPortalSetting).where(and(eq(projectPortalSetting.companyId, companyId), isNull(projectPortalSetting.projectId))).limit(1))[0]
  const projectRow = async (companyId: string, projectId: string) => (await db.select().from(projectPortalSetting).where(and(eq(projectPortalSetting.companyId, companyId), eq(projectPortalSetting.projectId, projectId))).limit(1))[0]
  /** The project's settings: its own, else the company's default, else the built-in ones. */
  const settingsFor = async (companyId: string, projectId: string) => shape((await projectRow(companyId, projectId)) ?? (await defaultRow(companyId)))

  const save = async (companyId: string, projectId: string | null, patch: any) => {
    const existing = projectId ? await projectRow(companyId, projectId) : await defaultRow(companyId)
    const base = existing ? shape(existing) : projectId ? await settingsFor(companyId, projectId) : { ...BUILT_IN }
    const next = { ...base, ...patch, notify: { ...(base.notify || {}), ...(patch.notify || {}) }, updatedAt: new Date() }
    if (existing) await db.update(projectPortalSetting).set(next).where(eq(projectPortalSetting.id, existing.id))
    else await db.insert(projectPortalSetting).values({ companyId, projectId, ...next })
    return projectId ? settingsFor(companyId, projectId) : shape(await defaultRow(companyId))
  }

  /** Email the project's client, where its settings say to tell them about `what`. Answers what happened, never throws. */
  const tellClient = async (companyId: string, projectId: string, what: typeof NOTIFY_KEYS[number], words: string, force = false): Promise<'email' | 'not-asked' | 'no-way'> => {
    const s = await settingsFor(companyId, projectId)
    if (!force && !s.notify?.[what]) return 'not-asked'
    const [p] = await db.select({ name: project.name, contactId: project.contactId }).from(project).where(and(eq(project.id, projectId), eq(project.companyId, companyId))).limit(1)
    if (!p?.contactId) return 'no-way'
    const [who] = await db.select().from(contact).where(and(eq(contact.id, p.contactId), eq(contact.companyId, companyId))).limit(1) as any[]
    const origin = String(process.env.FRONTEND_URL || '').replace(/\/+$/, '')
    if (!who || !who.portalEnabled || !who.portalToken || !String(who.email || '').trim() || who.emailOptOut || !/^https?:\/\//.test(origin)) return 'no-way'
    const [co] = await db.select({ name: companyTable.name }).from(companyTable).where(eq(companyTable.id, companyId)).limit(1)
    const link = `${origin}/portal/${who.portalToken}`
    const first = String(who.name || '').trim().split(/\s+/)[0] || 'there'
    try {
      await (d.services as any).emailService.sendRaw({
        to: String(who.email).trim(), subject: `${words} — ${p.name}`,
        html: `<p>Hi ${esc(first)},</p><p>${esc(co?.name || 'Your builder')}: ${esc(words)} on ${esc(p.name)}.</p><p><a href="${esc(link)}">Open your portal</a></p>`,
      })
      return 'email'
    } catch { return 'no-way' }
  }

  // The payment schedule (row 10b, paymentSchedule.ts): it tells the client through the same settings.
  const payments = createPaymentSchedule(d, tellClient)
  // Documents to e-sign (row 10c, signRequests.ts).
  const signs = createSignRequests(d, tellClient)

  // ── what the client sees ───────────────────────────────────────────────────────────────────────

  const ownProject = async (cont: any, projectId: string) => {
    if (!cont?.id || !cont?.companyId) return null
    return (await db.select().from(project).where(and(eq(project.id, projectId), eq(project.companyId, cont.companyId), eq(project.contactId, cont.id))).limit(1))[0] as any
  }

  /** The project page's extra sections, as this client may see them. */
  async function view(companyId: string, projectId: string) {
    const s = await settingsFor(companyId, projectId)
    const out: any = { sections: { schedule: s.schedule, dailyLogs: s.dailyLogs, photos: s.photos, todos: s.todos, payments: s.payments, documents: s.documents } }
    if (s.documents) out.toSign = await signs.listFor(companyId, projectId)
    // The payment schedule (row 10b): what is due, what is paid, and the released ones' invoices to pay online.
    if (s.payments) {
      const ps = await payments.scheduleFor(companyId, projectId)
      if (ps && ps.payments.length) out.payments = { contract: ps.contract.value, paid: ps.paid, payments: ps.payments.filter((p) => p.state !== 'void').map(({ id, name, amount, dueDate, milestone, state, invoiceId, invoiceNumber, balance }) => ({ id, name, amount, dueDate, milestone: milestone ? { name: milestone.name, done: milestone.done } : null, state, invoiceId, invoiceNumber, balance })) }
    }
    if (s.schedule !== 'off') {
      let tasks = await db.select().from(projectTask).where(and(eq(projectTask.companyId, companyId), eq(projectTask.projectId, projectId))).orderBy(asc(projectTask.startDate), asc(projectTask.createdAt)) as any[]
      if (s.schedule === 'phases') tasks = tasks.filter((t) => !t.parentId)
      if (s.scheduleWeeks) {
        const until = Date.now() + s.scheduleWeeks * 7 * DAY
        tasks = tasks.filter((t) => !t.startDate || new Date(t.startDate).getTime() <= until)
      }
      const comments = tasks.length ? await db.select().from(projectTaskComment).where(and(eq(projectTaskComment.companyId, companyId), inArray(projectTaskComment.taskId, tasks.map((t) => t.id)))).orderBy(asc(projectTaskComment.createdAt), asc(projectTaskComment.id)) as any[] : []
      out.schedule = tasks.map((t) => ({
        id: t.id, name: t.name, startDate: iso(t.startDate), endDate: iso(t.endDate), progress: t.progress ?? 0, status: t.status,
        comments: comments.filter((c) => c.taskId === t.id).map((c) => ({ id: c.id, body: c.body, fromClient: !!c.contactId, createdAt: iso(c.createdAt) })),
      }))
    }
    if (s.dailyLogs) {
      const logs = await db.select().from(dailyLog).where(and(eq(dailyLog.companyId, companyId), eq(dailyLog.projectId, projectId), eq(dailyLog.sharedWithClient, true))).orderBy(desc(dailyLog.date), asc(dailyLog.id)).limit(100) as any[]
      out.dailyLogs = logs.map((l) => ({
        id: l.id, date: iso(l.date), weather: l.weather || null, workPerformed: l.workPerformed || null, workCompleted: l.workCompleted || null,
        // A photo by its id and caption only — never its stored path or who took it (recordPhotos.ts RecordPhoto).
        // …and only with Photos & files on (contractor live test 11/07: a shared log's photo showed with the switch off).
        photos: s.photos ? (Array.isArray(l.photos) ? l.photos : []).filter((p: any) => p?.id).map((p: any) => ({ id: String(p.id), caption: p.caption || null })) : [],
      }))
    }
    if (s.photos) {
      const docs = await db.select().from(document).where(and(eq(document.companyId, companyId), eq(document.projectId, projectId), eq(document.sharedWithCustomer, true))).orderBy(desc(document.createdAt), asc(document.id)) as any[]
      out.files = docs.map((x) => ({ id: x.id, name: x.name, type: x.type, mimeType: x.mimeType || null, createdAt: iso(x.createdAt), image: IMAGE.test(String(x.mimeType || '')) }))
    }
    if (s.todos) {
      const todos = await db.select().from(clientTodo).where(and(eq(clientTodo.companyId, companyId), eq(clientTodo.projectId, projectId))).orderBy(asc(clientTodo.status), asc(clientTodo.dueDate), asc(clientTodo.createdAt)) as any[]
      out.todos = todos.map((t) => ({ id: t.id, title: t.title, notes: t.notes || null, checklist: Array.isArray(t.checklist) ? t.checklist : [], dueDate: iso(t.dueDate), status: t.status, completedAt: iso(t.completedAt) }))
    }
    return out
  }

  const extras: PortalProjectExtras = {
    // Photos & files off: the portal's own Project Files are closed too (contractor live test 11/07: the button still opened).
    async filesOn(cont, projectId) {
      if (!(await on(cont?.companyId))) return true
      return (await settingsFor(cont.companyId, projectId)).photos
    },
    async view(cont, projectId) {
      if (!(await on(cont?.companyId)) || !(await ownProject(cont, projectId))) return null
      return view(cont.companyId, projectId)
    },
    async comment(cont, projectId, taskId, body) {
      if (!(await on(cont?.companyId)) || !(await ownProject(cont, projectId))) return null
      if ((await settingsFor(cont.companyId, projectId)).schedule === 'off') return null
      const [t] = await db.select().from(projectTask).where(and(eq(projectTask.id, taskId), eq(projectTask.projectId, projectId), eq(projectTask.companyId, cont.companyId))).limit(1)
      if (!t) return null
      const text = String(body || '').trim().slice(0, 2000)
      if (!text) return { error: 'Write something' }
      const [row] = await db.insert(projectTaskComment).values({ companyId: cont.companyId, projectId, taskId, contactId: cont.id, body: text }).returning()
      return { id: row.id, body: row.body, fromClient: true, createdAt: iso(row.createdAt) }
    },
    async todo(cont, projectId, todoId, change) {
      if (!(await on(cont?.companyId)) || !(await ownProject(cont, projectId))) return null
      if (!(await settingsFor(cont.companyId, projectId)).todos) return null
      const [t] = await db.select().from(clientTodo).where(and(eq(clientTodo.id, todoId), eq(clientTodo.projectId, projectId), eq(clientTodo.companyId, cont.companyId))).limit(1) as any[]
      if (!t) return null
      const list = Array.isArray(t.checklist) ? [...t.checklist] : []
      const set: any = { updatedAt: new Date() }
      if (typeof change?.item === 'number') {
        if (!Number.isInteger(change.item) || change.item < 0 || change.item >= list.length) return { error: 'No such item on the list' }
        list[change.item] = { ...list[change.item], done: !!change.done }
        set.checklist = list
      }
      if (typeof change?.complete === 'boolean') {
        set.status = change.complete ? 'done' : 'open'
        set.completedAt = change.complete ? new Date() : null
      }
      const [row] = await db.update(clientTodo).set(set).where(eq(clientTodo.id, t.id)).returning()
      return { id: row.id, checklist: row.checklist, status: row.status, completedAt: iso(row.completedAt) }
    },
    async sign(cont, projectId, requestId, input) {
      if (!(await on(cont?.companyId)) || !(await ownProject(cont, projectId))) return null
      if (!(await settingsFor(cont.companyId, projectId)).documents) return null
      return signs.sign(cont, projectId, requestId, input)
    },
    async file(cont, projectId, kind, id) {
      if (!(await on(cont?.companyId)) || !(await ownProject(cont, projectId))) return null
      const s = await settingsFor(cont.companyId, projectId)
      if (kind === 'sign') return s.documents ? signs.file(cont.companyId, projectId, id) : null
      if (kind === 'document' && s.photos) {
        const [x] = await db.select().from(document).where(and(eq(document.id, id), eq(document.projectId, projectId), eq(document.companyId, cont.companyId), eq(document.sharedWithCustomer, true))).limit(1) as any[]
        if (!x || !x.path || String(x.path).includes('..') || !String(x.path).startsWith(`${cont.companyId}/`)) return null
        const obj = await storage.getObject(String(x.path)).catch(() => null)
        if (!obj) return null
        const type = String(x.mimeType || obj.contentType || '')
        const inline = INLINE.test(String(obj.contentType || '')) && INLINE.test(type)
        return { body: obj.body, contentType: inline ? type : 'application/octet-stream', filename: x.originalName || x.name || 'document', inline }
      }
      if (kind === 'log-photo' && s.dailyLogs && s.photos) {
        const [logId, photoId] = String(id).split(':')
        const [l] = await db.select().from(dailyLog).where(and(eq(dailyLog.id, logId), eq(dailyLog.projectId, projectId), eq(dailyLog.companyId, cont.companyId), eq(dailyLog.sharedWithClient, true))).limit(1) as any[]
        const p = l && Array.isArray(l.photos) ? l.photos.find((x: any) => String(x?.id) === photoId) : null
        // The company's own folder of the store, as the office's photo door requires.
        if (!p?.path || String(p.path).includes('..') || !String(p.path).startsWith(`${cont.companyId}/`)) return null
        const obj = await storage.getObject(String(p.path)).catch(() => null)
        const type = String(obj?.contentType || '')
        if (!obj || !IMAGE.test(type)) return null
        return { body: obj.body, contentType: type, filename: `site-photo.${type.split('/')[1] === 'jpeg' ? 'jpg' : type.split('/')[1]}`, inline: true }
      }
      return null
    },
  }

  // ── the office ─────────────────────────────────────────────────────────────────────────────────

  function routes() {
    const { requirePermission } = d.permissions
    const app = new Hono<AppEnv>()
    app.use('*', async (c, next) => {
      if (!(await on((c.get('user') as any).companyId))) return fail(c, 404, 'Not found')
      await next()
    })
    const mine = async (c: any, projectId: string) => (await db.select({ id: project.id }).from(project).where(and(eq(project.id, projectId), eq(project.companyId, (c.get('user') as any).companyId))).limit(1))[0]

    payments.routes(app)
    signs.routes(app)

    app.get('/defaults', requirePermission('projects:read'), async (c) => one(c, shape(await defaultRow((c.get('user') as any).companyId))))
    app.put('/defaults', requirePermission('projects:update'), async (c) => {
      const parsed = settingsBody.safeParse(await c.req.json().catch(() => ({})))
      if (!parsed.success) return fail(c, 400, parsed.error.issues[0]?.message || 'Check the settings')
      return one(c, await save((c.get('user') as any).companyId, null, parsed.data))
    })
    app.get('/:projectId/settings', requirePermission('projects:read'), async (c) => {
      if (!(await mine(c, c.req.param('projectId')))) return fail(c, 404, 'Project not found')
      return one(c, await settingsFor((c.get('user') as any).companyId, c.req.param('projectId')))
    })
    app.put('/:projectId/settings', requirePermission('projects:update'), async (c) => {
      if (!(await mine(c, c.req.param('projectId')))) return fail(c, 404, 'Project not found')
      const parsed = settingsBody.safeParse(await c.req.json().catch(() => ({})))
      if (!parsed.success) return fail(c, 400, parsed.error.issues[0]?.message || 'Check the settings')
      return one(c, await save((c.get('user') as any).companyId, c.req.param('projectId'), parsed.data))
    })

    app.put('/daily-logs/:id/share', requirePermission('projects:update'), async (c) => {
      const me = c.get('user') as any
      const shared = !!(await c.req.json().catch(() => ({})))?.shared
      const [l] = await db.select().from(dailyLog).where(and(eq(dailyLog.id, c.req.param('id')), eq(dailyLog.companyId, me.companyId))).limit(1) as any[]
      if (!l) return fail(c, 404, 'Daily log not found')
      await db.update(dailyLog).set({ sharedWithClient: shared }).where(eq(dailyLog.id, l.id))
      const told = shared && !l.sharedWithClient ? await tellClient(me.companyId, l.projectId, 'dailyLogs', 'A new daily log is in your portal') : 'not-asked'
      return one(c, { id: l.id, sharedWithClient: shared, told })
    })
    app.put('/documents/:id/share', requirePermission('projects:update'), async (c) => {
      const me = c.get('user') as any
      const shared = !!(await c.req.json().catch(() => ({})))?.shared
      const [x] = await db.select().from(document).where(and(eq(document.id, c.req.param('id')), eq(document.companyId, me.companyId))).limit(1) as any[]
      if (!x || !x.projectId) return fail(c, 404, 'File not found on a project')
      await db.update(document).set({ sharedWithCustomer: shared }).where(eq(document.id, x.id))
      return one(c, { id: x.id, sharedWithCustomer: shared })
    })

    app.get('/:projectId/todos', requirePermission('projects:read'), async (c) => {
      if (!(await mine(c, c.req.param('projectId')))) return fail(c, 404, 'Project not found')
      return listAll(c, await db.select().from(clientTodo).where(and(eq(clientTodo.companyId, (c.get('user') as any).companyId), eq(clientTodo.projectId, c.req.param('projectId')))).orderBy(asc(clientTodo.status), asc(clientTodo.dueDate), asc(clientTodo.createdAt)))
    })
    app.post('/:projectId/todos', requirePermission('projects:update'), async (c) => {
      const me = c.get('user') as any
      const projectId = c.req.param('projectId')
      if (!(await mine(c, projectId))) return fail(c, 404, 'Project not found')
      const parsed = todoBody.safeParse(await c.req.json().catch(() => ({})))
      if (!parsed.success) return fail(c, 400, parsed.error.issues[0]?.message || 'Check the to-do')
      const [row] = await db.insert(clientTodo).values({
        companyId: me.companyId, projectId, title: parsed.data.title, notes: parsed.data.notes || null, checklist: parsed.data.checklist || [],
        dueDate: parsed.data.dueDate ? new Date(`${parsed.data.dueDate}T00:00:00Z`) : null, createdById: me.userId ?? null,
      }).returning()
      const told = await tellClient(me.companyId, projectId, 'todos', `A new to-do for you: ${parsed.data.title}`)
      return one(c, { ...row, told }, 201)
    })
    app.put('/todos/:id', requirePermission('projects:update'), async (c) => {
      const me = c.get('user') as any
      const [t] = await db.select().from(clientTodo).where(and(eq(clientTodo.id, c.req.param('id')), eq(clientTodo.companyId, me.companyId))).limit(1)
      if (!t) return fail(c, 404, 'To-do not found')
      const parsed = todoBody.partial().safeParse(await c.req.json().catch(() => ({})))
      if (!parsed.success) return fail(c, 400, parsed.error.issues[0]?.message || 'Check the to-do')
      const v = parsed.data
      const [row] = await db.update(clientTodo).set({
        ...(v.title ? { title: v.title } : {}), ...(v.notes !== undefined ? { notes: v.notes || null } : {}),
        ...(v.checklist ? { checklist: v.checklist } : {}), ...(v.dueDate !== undefined ? { dueDate: v.dueDate ? new Date(`${v.dueDate}T00:00:00Z`) : null } : {}),
        updatedAt: new Date(),
      }).where(eq(clientTodo.id, t.id)).returning()
      return one(c, row)
    })
    app.delete('/todos/:id', requirePermission('projects:update'), async (c) => {
      const [gone] = await db.delete(clientTodo).where(and(eq(clientTodo.id, c.req.param('id')), eq(clientTodo.companyId, (c.get('user') as any).companyId))).returning({ id: clientTodo.id })
      if (!gone) return fail(c, 404, 'To-do not found')
      return one(c, { deleted: true })
    })

    app.get('/:projectId/comments', requirePermission('projects:read'), async (c) => {
      const me = c.get('user') as any
      if (!(await mine(c, c.req.param('projectId')))) return fail(c, 404, 'Project not found')
      const rows = await db.select({ id: projectTaskComment.id, taskId: projectTaskComment.taskId, taskName: projectTask.name, body: projectTaskComment.body, contactId: projectTaskComment.contactId, userId: projectTaskComment.userId, createdAt: projectTaskComment.createdAt })
        .from(projectTaskComment).leftJoin(projectTask, eq(projectTask.id, projectTaskComment.taskId))
        .where(and(eq(projectTaskComment.companyId, me.companyId), eq(projectTaskComment.projectId, c.req.param('projectId')))).orderBy(asc(projectTaskComment.createdAt), asc(projectTaskComment.id)) as any[]
      return listAll(c, rows.map((r) => ({ ...r, fromClient: !!r.contactId })))
    })
    app.post('/:projectId/tasks/:taskId/comments', requirePermission('projects:update'), async (c) => {
      const me = c.get('user') as any
      const projectId = c.req.param('projectId')
      const [t] = await db.select().from(projectTask).where(and(eq(projectTask.id, c.req.param('taskId')), eq(projectTask.projectId, projectId), eq(projectTask.companyId, me.companyId))).limit(1)
      if (!t) return fail(c, 404, 'Task not found')
      const parsed = commentBody.safeParse(await c.req.json().catch(() => ({})))
      if (!parsed.success) return fail(c, 400, parsed.error.issues[0]?.message || 'Write something')
      const [row] = await db.insert(projectTaskComment).values({ companyId: me.companyId, projectId, taskId: t.id, userId: me.userId ?? null, body: parsed.data.body }).returning()
      return one(c, { ...row, fromClient: false }, 201)
    })

    app.get('/:projectId/preview', requirePermission('projects:read'), async (c) => {
      if (!(await mine(c, c.req.param('projectId')))) return fail(c, 404, 'Project not found')
      return one(c, await view((c.get('user') as any).companyId, c.req.param('projectId')))
    })
    app.post('/:projectId/notify', requirePermission('projects:update'), async (c) => {
      const me = c.get('user') as any
      if (!(await mine(c, c.req.param('projectId')))) return fail(c, 404, 'Project not found')
      const what = String((await c.req.json().catch(() => ({})))?.what || '')
      const words = what === 'schedule' ? 'The schedule has been updated' : what === 'files' ? 'New photos and files are in your portal' : null
      if (!words) return fail(c, 400, 'Say what changed: schedule or files')
      const told = await tellClient(me.companyId, c.req.param('projectId'), what as any, words, true)
      if (told !== 'email') return fail(c, 409, 'No way to reach the client: no email, their portal is off, or they opted out.')
      return one(c, { told })
    })

    return app
  }

  return { extras, routes, settingsFor, tellClient, view }
}
