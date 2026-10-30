// Inspection checklists (brief item 7 — contractors): a reusable list of questions for one kind of visit, answered pass /
// fail / not applicable with a note and photos, where a FAILED line puts a snag on the project's punch list by itself.
//
//   GET    /api/inspection-templates                      the saved checklists, with their lines                    inspections:read
//   POST   /api/inspection-templates                      { name, type?, items: string[] }                          inspections:create
//   PUT    /api/inspection-templates/:id                  rename / retype / replace the lines                       inspections:update
//   DELETE /api/inspection-templates/:id                                                                            inspections:delete
//
//   GET    /api/inspection-checklists/:id                 the visit, its checklist lines and its photos             inspections:read
//   POST   /api/inspection-checklists/:id/start           { templateId } or { items: string[] }                     inspections:update
//   POST   /api/inspection-checklists/:id/items           { label } — one more line on this visit                   inspections:update
//   PUT    /api/inspection-checklists/:id/items/:itemId   { result?: pass|fail|na|pending, note? }                  inspections:update
//   DELETE /api/inspection-checklists/:id/items/:itemId                                                             inspections:update
//   POST/GET/DELETE /api/inspection-checklists/:id/photos…  the visit's photos (recordPhotos.ts, same rules as a daily log's)
//
// A visit's lines are COPIED from the template, so changing a template later never rewrites a visit that happened.
// Answers are taken while the visit has no result; once it is passed or failed the record is final (inspections.ts).
// A line marked "fail" puts one item on the project's punch list (only where Punch Lists is on), remembered on the line so
// marking it again never makes a second; changing the answer takes that snag back off while nobody has touched it. That is
// done on the inspector's own right (inspections:update) — the same way an approved quote fills its budget — not on
// punch-lists:create, which a field seat does not hold. Nothing here moves money.
import { Hono } from 'hono'
import { z } from 'zod'
import { and, asc, count, eq, inArray } from 'drizzle-orm'
import { createActorName } from '@twomiah/tenant-backend'
import { inspection, inspectionItem, inspectionTemplate, inspectionTemplateItem, project, punchListItem, user } from '../../db/schema/index.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, one, listAll } from '../../http/reply.ts'
import type { CrmDeps } from '../deps.ts'
import { recordPhotos } from './recordPhotos.ts'

export const RESULTS = ['pending', 'pass', 'fail', 'na'] as const
const RESULTABLE = ['scheduled', 'in_progress', 'rescheduled']
export const MAX_LINES = 200

const lines = z.array(z.string().trim().min(1, 'A line cannot be empty').max(300, 'A line is 300 characters or fewer')).min(1, 'Add at least one line').max(MAX_LINES, `A checklist holds up to ${MAX_LINES} lines`)
const templateSchema = z.object({
  name: z.string().trim().min(1, 'Name the checklist').max(120, 'A checklist name is 120 characters or fewer'),
  type: z.string().trim().max(60).nullable().optional(),
  items: lines,
})
const answerSchema = z.object({ result: z.enum(RESULTS).optional(), note: z.string().trim().max(1000).nullable().optional() })

/** What a visit's lines add up to — shared with inspections.ts, which refuses to pass a visit that has failures or open lines. */
export async function checklistCounts(d: CrmDeps, companyId: string, inspectionIds: string[]) {
  const out = new Map<string, { total: number; answered: number; failed: number }>()
  if (!inspectionIds.length) return out
  const rows = await d.db.select({ inspectionId: inspectionItem.inspectionId, result: inspectionItem.result })
    .from(inspectionItem).where(and(eq(inspectionItem.companyId, companyId), inArray(inspectionItem.inspectionId, inspectionIds)))
  for (const r of rows as any[]) {
    const c = out.get(r.inspectionId) || { total: 0, answered: 0, failed: 0 }
    c.total++
    if (r.result !== 'pending') c.answered++
    if (r.result === 'fail') c.failed++
    out.set(r.inspectionId, c)
  }
  return out
}

export async function checklistLines(d: CrmDeps, companyId: string, inspectionId: string) {
  return d.db.select().from(inspectionItem)
    .where(and(eq(inspectionItem.inspectionId, inspectionId), eq(inspectionItem.companyId, companyId)))
    .orderBy(asc(inspectionItem.sortOrder), asc(inspectionItem.id)) as Promise<any[]>
}

export const photosFor = (d: CrmDeps) => recordPhotos(d, {
  table: inspection, base: '/api/inspection-checklists', folder: 'inspections', read: 'inspections:read', write: 'inspections:update', notFound: 'Inspection not found',
})

export function createInspectionTemplateRoutes(d: CrmDeps) {
  const { db } = d
  const { requirePermission } = d.permissions
  const app = new Hono<AppEnv>()
  const own = async (companyId: string, id: string) =>
    (await db.select().from(inspectionTemplate).where(and(eq(inspectionTemplate.id, id), eq(inspectionTemplate.companyId, companyId))).limit(1))[0]
  const itemsOf = (companyId: string, templateId: string) =>
    db.select().from(inspectionTemplateItem).where(and(eq(inspectionTemplateItem.templateId, templateId), eq(inspectionTemplateItem.companyId, companyId)))
      .orderBy(asc(inspectionTemplateItem.sortOrder), asc(inspectionTemplateItem.id)) as Promise<any[]>
  const writeItems = async (companyId: string, templateId: string, labels: string[]) => {
    await db.delete(inspectionTemplateItem).where(and(eq(inspectionTemplateItem.templateId, templateId), eq(inspectionTemplateItem.companyId, companyId)))
    await db.insert(inspectionTemplateItem).values(labels.map((label, i) => ({ companyId, templateId, label, sortOrder: i })) as any)
  }
  const taken = (c: any) => fail(c, 409, 'You already have a checklist with that name.', 'inspection_template_name_taken')

  app.get('/', requirePermission('inspections:read'), async (c) => {
    const me = c.get('user') as any
    const rows = await db.select().from(inspectionTemplate).where(eq(inspectionTemplate.companyId, me.companyId)).orderBy(asc(inspectionTemplate.name))
    const out = []
    for (const t of rows as any[]) out.push({ ...t, items: await itemsOf(me.companyId, t.id) })
    return listAll(c, out)
  })

  app.post('/', requirePermission('inspections:create'), async (c) => {
    const me = c.get('user') as any
    const parsed = templateSchema.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) return fail(c, 400, parsed.error.issues[0]?.message || 'Check the checklist')
    const data = parsed.data
    const [dupe] = await db.select({ id: inspectionTemplate.id }).from(inspectionTemplate).where(and(eq(inspectionTemplate.companyId, me.companyId), eq(inspectionTemplate.name, data.name))).limit(1)
    if (dupe) return taken(c)
    const [t] = await db.insert(inspectionTemplate).values({ companyId: me.companyId, name: data.name, type: data.type || null } as any).returning()
    await writeItems(me.companyId, (t as any).id, data.items)
    return one(c, { ...t, items: await itemsOf(me.companyId, (t as any).id) }, 201)
  })

  app.put('/:id', requirePermission('inspections:update'), async (c) => {
    const me = c.get('user') as any
    const t = await own(me.companyId, c.req.param('id'))
    if (!t) return fail(c, 404, 'Checklist not found')
    const parsed = templateSchema.partial().safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) return fail(c, 400, parsed.error.issues[0]?.message || 'Check the checklist')
    const data = parsed.data
    if (data.name && data.name !== t.name) {
      const [dupe] = await db.select({ id: inspectionTemplate.id }).from(inspectionTemplate).where(and(eq(inspectionTemplate.companyId, me.companyId), eq(inspectionTemplate.name, data.name))).limit(1)
      if (dupe) return taken(c)
    }
    const set: any = {}
    if (data.name) set.name = data.name
    if (data.type !== undefined) set.type = data.type || null
    if (Object.keys(set).length) await db.update(inspectionTemplate).set(set).where(and(eq(inspectionTemplate.id, t.id), eq(inspectionTemplate.companyId, me.companyId)))
    if (data.items) await writeItems(me.companyId, t.id, data.items)
    const fresh = await own(me.companyId, t.id)
    return one(c, { ...fresh, items: await itemsOf(me.companyId, t.id) })
  })

  app.delete('/:id', requirePermission('inspections:delete'), async (c) => {
    const me = c.get('user') as any
    const [gone] = await db.delete(inspectionTemplate).where(and(eq(inspectionTemplate.id, c.req.param('id')), eq(inspectionTemplate.companyId, me.companyId))).returning()
    if (!gone) return fail(c, 404, 'Checklist not found')
    return c.body(null, 204)
  })

  return app
}

export function createInspectionChecklistRoutes(d: CrmDeps) {
  const { db } = d
  const { requirePermission } = d.permissions
  const app = new Hono<AppEnv>()
  const actorName = createActorName({ db, tables: { user } } as any)
  const photos = photosFor(d)

  const load = async (id: string, companyId: string) =>
    (await db.select().from(inspection).where(and(eq(inspection.id, id), eq(inspection.companyId, companyId))).limit(1))[0] as any
  /** Answers are taken while the visit has no result. A result is the record of what was found (inspections.ts). */
  const closed = (c: any, row: any) => RESULTABLE.includes(row.status) ? null
    : fail(c, 400, `${row.number} was ${row.status}. The checklist is part of that record, so it is not changed — book a re-inspection instead.`, 'inspection_already_resulted')
  const nextPunchNumber = async (companyId: string, projectId: string) => {
    const [{ value }] = await db.select({ value: count() }).from(punchListItem).where(and(eq(punchListItem.companyId, companyId), eq(punchListItem.projectId, projectId)))
    return `PL-${String(Number(value) + 1).padStart(3, '0')}`
  }

  app.get('/:id', requirePermission('inspections:read'), async (c) => {
    const me = c.get('user') as any
    const row = await load(c.req.param('id'), me.companyId)
    if (!row) return fail(c, 404, 'Inspection not found')
    const [proj] = await db.select({ id: project.id, name: project.name }).from(project).where(eq(project.id, row.projectId)).limit(1)
    return one(c, { ...photos.withUrls(row), project: proj || null, items: await checklistLines(d, me.companyId, row.id) })
  })

  app.post('/:id/start', requirePermission('inspections:update'), async (c) => {
    const me = c.get('user') as any
    const row = await load(c.req.param('id'), me.companyId)
    if (!row) return fail(c, 404, 'Inspection not found')
    const refused = closed(c, row)
    if (refused) return refused
    const body = await c.req.json().catch(() => ({})) as any
    if ((await checklistLines(d, me.companyId, row.id)).length) return fail(c, 409, `${row.number} already has a checklist. Add a line to it instead.`, 'checklist_exists')
    let labels: string[] = []
    if (typeof body?.templateId === 'string') {
      const [t] = await db.select().from(inspectionTemplate).where(and(eq(inspectionTemplate.id, body.templateId), eq(inspectionTemplate.companyId, me.companyId))).limit(1)
      if (!t) return fail(c, 404, 'Checklist not found')
      labels = ((await db.select().from(inspectionTemplateItem).where(and(eq(inspectionTemplateItem.templateId, (t as any).id), eq(inspectionTemplateItem.companyId, me.companyId)))
        .orderBy(asc(inspectionTemplateItem.sortOrder), asc(inspectionTemplateItem.id))) as any[]).map((i) => i.label)
    } else {
      const parsed = lines.safeParse(body?.items)
      if (!parsed.success) return fail(c, 400, parsed.error.issues[0]?.message || 'Pick a checklist or add some lines')
      labels = parsed.data
    }
    if (!labels.length) return fail(c, 400, 'That checklist has no lines.')
    await db.insert(inspectionItem).values(labels.map((label, i) => ({ companyId: me.companyId, inspectionId: row.id, label, sortOrder: i })) as any)
    return one(c, { ...photos.withUrls(row), items: await checklistLines(d, me.companyId, row.id) }, 201)
  })

  app.post('/:id/items', requirePermission('inspections:update'), async (c) => {
    const me = c.get('user') as any
    const row = await load(c.req.param('id'), me.companyId)
    if (!row) return fail(c, 404, 'Inspection not found')
    const refused = closed(c, row)
    if (refused) return refused
    const parsed = z.object({ label: z.string().trim().min(1, 'Say what to check').max(300) }).safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) return fail(c, 400, parsed.error.issues[0]?.message || 'Say what to check')
    const existing = await checklistLines(d, me.companyId, row.id)
    if (existing.length >= MAX_LINES) return fail(c, 400, `A checklist holds up to ${MAX_LINES} lines.`)
    const [made] = await db.insert(inspectionItem).values({ companyId: me.companyId, inspectionId: row.id, label: parsed.data.label, sortOrder: existing.length } as any).returning()
    return one(c, made, 201)
  })

  app.put('/:id/items/:itemId', requirePermission('inspections:update'), async (c) => {
    const me = c.get('user') as any
    const row = await load(c.req.param('id'), me.companyId)
    if (!row) return fail(c, 404, 'Inspection not found')
    const refused = closed(c, row)
    if (refused) return refused
    const [line] = await db.select().from(inspectionItem).where(and(eq(inspectionItem.id, c.req.param('itemId')), eq(inspectionItem.inspectionId, row.id), eq(inspectionItem.companyId, me.companyId))).limit(1) as any[]
    if (!line) return fail(c, 404, 'Checklist line not found')
    const parsed = answerSchema.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) return fail(c, 400, 'Answer pass, fail, not applicable or pending')
    const result = parsed.data.result ?? line.result
    const note = parsed.data.note !== undefined ? (parsed.data.note || null) : line.note
    // A failed line has to say what is wrong — the snag it makes is worded from it, and the crew works from that.
    if (result === 'fail' && !(note && note.length >= 3)) return fail(c, 400, 'Say what is wrong with it, so whoever fixes it knows.', 'checklist_fail_needs_note')

    const set: any = { result, note, answeredAt: result === 'pending' ? null : new Date(), answeredBy: result === 'pending' ? null : await actorName(me) }
    let punch: any = null
    let punchSkipped: string | null = null

    if (result === 'fail') {
      if (!(await d.features.isFeatureEnabled(me.companyId, 'punch_lists'))) punchSkipped = 'Punch Lists is not switched on, so no punch-list item was made.'
      else if (line.punchListItemId) {
        // Already has its snag: keep it in step with the wording, unless somebody has already started on it.
        const [p] = await db.update(punchListItem).set({ description: snagText(row, line.label), notes: note, updatedAt: new Date() })
          .where(and(eq(punchListItem.id, line.punchListItemId), eq(punchListItem.companyId, me.companyId), eq(punchListItem.status, 'open'))).returning() as any[]
        punch = p || null
      } else {
        const [p] = await db.insert(punchListItem).values({
          companyId: me.companyId, projectId: row.projectId, number: await nextPunchNumber(me.companyId, row.projectId),
          description: snagText(row, line.label), notes: note, priority: 'high', location: row.type,
        } as any).returning() as any[]
        set.punchListItemId = p.id
        punch = p
      }
    } else if (line.punchListItemId) {
      // Changed its mind. The snag goes only if it is still exactly as the checklist left it (open) — otherwise somebody
      // is already working on it and it stays on the list.
      const [gone] = await db.delete(punchListItem).where(and(eq(punchListItem.id, line.punchListItemId), eq(punchListItem.companyId, me.companyId), eq(punchListItem.status, 'open'))).returning() as any[]
      if (gone) set.punchListItemId = null
      else punchSkipped = 'The punch-list item it made has already been worked on, so it was left on the list.'
    }

    const [updated] = await db.update(inspectionItem).set(set).where(and(eq(inspectionItem.id, line.id), eq(inspectionItem.companyId, me.companyId))).returning()
    return one(c, { item: updated, punchItem: punch, note: punchSkipped })
  })

  app.delete('/:id/items/:itemId', requirePermission('inspections:update'), async (c) => {
    const me = c.get('user') as any
    const row = await load(c.req.param('id'), me.companyId)
    if (!row) return fail(c, 404, 'Inspection not found')
    const refused = closed(c, row)
    if (refused) return refused
    const [line] = await db.select().from(inspectionItem).where(and(eq(inspectionItem.id, c.req.param('itemId')), eq(inspectionItem.inspectionId, row.id), eq(inspectionItem.companyId, me.companyId))).limit(1) as any[]
    if (!line) return fail(c, 404, 'Checklist line not found')
    // A line that made a snag takes back a snag nobody has started on, as changing its answer does.
    if (line.punchListItemId) await db.delete(punchListItem).where(and(eq(punchListItem.id, line.punchListItemId), eq(punchListItem.companyId, me.companyId), eq(punchListItem.status, 'open')))
    await db.delete(inspectionItem).where(and(eq(inspectionItem.id, line.id), eq(inspectionItem.companyId, me.companyId)))
    return c.body(null, 204)
  })

  photos.routes(app)

  return app
}

const snagText = (row: any, label: string) => `${row.type} inspection ${row.number}: ${label}`
