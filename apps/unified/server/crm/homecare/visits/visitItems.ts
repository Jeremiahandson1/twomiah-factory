// /api/visit-items — forms, interventions, goals and tasks for every visit (care_visit_items, not ready), and the clock-out note rule.
//
//   Office (care-clients:update / create / delete as the action is):
//     GET    /?clientId=&kind=         the items (a client's own, or all)      POST /     add      PUT /:id   edit     DELETE /:id  remove
//     GET    /goals/:clientId          how each goal went, visit by visit
//     GET|PUT /settings { noteRequired }  whether a live clock-out needs a visit note
//   The visit (the caregiver's own, or the office):
//     GET    /visit/:timeEntryId                       the items for this visit and what is recorded
//     PUT    /visit/:timeEntryId/:itemId { status, rating?, note?, savedAt? }   evv:update
//     POST   /visit/:timeEntryId/:itemId/form { data, signature? }              evv:create — fill in the attached form
// Gated by the feature in the mount; replies follow RULEBOOK §3.
import { Hono } from 'hono'
import { and, desc, eq } from 'drizzle-orm'
import { formSubmissions, formTemplates, timeEntries, user as users, visitItem, visitItemLog } from '../../../db/schema/index.ts'
import type { AppEnv } from '../../../http/env.ts'
import { done, fail, list, listAll, one } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import type { HomecareCore } from '../core/index.ts'
import { KINDS, RATINGS, STATUSES } from '../core/visitItems.ts'
import { isEmptyAnswer, parseFields } from '../clients/forms.ts'
import { body, who, type ClientAccess } from '../clients/shared.ts'

export const SKIP_NEEDS_REASON = 'Say why this was skipped: add a note with the reason, then mark it Skipped.'
export const REFUSAL_NEEDS_REASON = 'Say why the client refused: add a note with the reason, then mark it Refused.'

export function createVisitItemRoutes(core: HomecareCore, d: CrmDeps, access: ClientAccess) {
  const app = new Hono<AppEnv>()
  const { requirePermission } = d.permissions
  const manage = requirePermission('care-clients:update')
  const { db } = d

  const loadEntry = async (companyId: string, id: string) =>
    (await db.select({ id: timeEntries.id, clientId: timeEntries.clientId, caregiverId: timeEntries.caregiverId }).from(timeEntries)
      .where(and(eq(timeEntries.id, id), eq(timeEntries.companyId, companyId))).limit(1))[0]

  /** An item's fields from a body, with each fault named in plain words. */
  async function itemFields(companyId: string, b: any, creating: boolean, cur?: any) {
    const errors: Record<string, string> = {}
    const values: Record<string, unknown> = {}
    const kind = creating || 'kind' in b ? String(b.kind ?? '') : cur.kind
    if (creating || 'kind' in b) { if (!(KINDS as readonly string[]).includes(kind)) errors.kind = 'Pick a form, intervention, goal or task.'; else values.kind = kind }
    const clientId = 'clientId' in b ? (b.clientId ? String(b.clientId) : null) : (cur?.clientId ?? null)
    if ('clientId' in b || creating) {
      if (clientId && !(await access.clientInCompany(companyId, clientId))) errors.clientId = 'That client is not on this agency.'
      else values.clientId = clientId
    }
    if ((kind === 'goal' || kind === 'intervention') && !clientId) errors.clientId = 'A goal or intervention belongs to one client.'
    let formTemplateId: string | null = 'formTemplateId' in b ? (b.formTemplateId || null) : (cur?.formTemplateId ?? null)
    let tplName: string | null = null
    if (kind === 'form') {
      const [tpl] = formTemplateId ? await db.select({ id: formTemplates.id, name: formTemplates.name, isActive: formTemplates.isActive }).from(formTemplates).where(and(eq(formTemplates.id, formTemplateId), eq(formTemplates.companyId, companyId))).limit(1) : []
      if (!tpl || !tpl.isActive) errors.formTemplateId = 'Pick one of the agency\'s forms.'
      else { tplName = tpl.name; values.formTemplateId = tpl.id }
    } else if (creating || 'kind' in b) values.formTemplateId = null
    if (creating || 'name' in b) {
      const n = String(b.name ?? '').trim() || (kind === 'form' ? tplName ?? '' : '')
      if (!n) errors.name = 'Write what it is.'
      else if (n.length > 200) errors.name = 'Keep it under 200 characters.'
      else values.name = n
    }
    if ('detail' in b) values.detail = b.detail && String(b.detail).trim() ? String(b.detail).trim().slice(0, 1000) : null
    if (kind === 'intervention') {
      const goalId = 'goalId' in b ? (b.goalId || null) : (cur?.goalId ?? null)
      if (goalId) {
        const [g] = await db.select({ id: visitItem.id }).from(visitItem).where(and(eq(visitItem.id, String(goalId)), eq(visitItem.companyId, companyId), eq(visitItem.kind, 'goal'), eq(visitItem.clientId, clientId as string))).limit(1)
        if (!g) errors.goalId = 'Pick one of this client\'s goals.'
        else values.goalId = g.id
      } else if ('goalId' in b) values.goalId = null
    } else if (creating || 'kind' in b) values.goalId = null
    if ('required' in b) values.required = b.required === true
    if ('sortOrder' in b) { const n = Number(b.sortOrder); if (!Number.isInteger(n) || n < 0 || n > 1000) errors.sortOrder = 'Use a whole number from 0 to 1000.'; else values.sortOrder = n }
    if ('isActive' in b) values.isActive = b.isActive !== false
    return { values, errors }
  }

  app.get('/settings', requirePermission('care-clients:read'), async (c) => one(c, { noteRequired: await core.visitItems.noteRequired(who(c).companyId) }))
  app.put('/settings', manage, async (c) => {
    const b = await body(c)
    if (typeof b.noteRequired !== 'boolean') return fail(c, 400, 'noteRequired must be true or false.', 'bad_setting', { noteRequired: 'Switch it on or off' })
    return one(c, { noteRequired: await core.visitItems.setNoteRequired(who(c).companyId, b.noteRequired) })
  })

  app.get('/', manage, async (c) => {
    const { companyId } = who(c)
    const q = c.req.query()
    const rows = await db.select().from(visitItem).where(and(eq(visitItem.companyId, companyId), q.clientId ? eq(visitItem.clientId, q.clientId) : undefined, q.kind ? eq(visitItem.kind, q.kind) : undefined))
      .orderBy(visitItem.sortOrder, visitItem.createdAt)
    return listAll(c, rows)
  })

  app.post('/', requirePermission('care-clients:create'), async (c) => {
    const { companyId } = who(c)
    const { values, errors } = await itemFields(companyId, await body(c), true)
    if (Object.keys(errors).length) return fail(c, 400, Object.values(errors)[0], 'bad_item', errors)
    const [row] = await db.insert(visitItem).values({ required: false, ...values, companyId } as any).returning()
    return one(c, row, 201)
  })

  app.put('/:id', manage, async (c) => {
    const { companyId } = who(c)
    const [cur] = await db.select().from(visitItem).where(and(eq(visitItem.id, c.req.param('id')!), eq(visitItem.companyId, companyId))).limit(1)
    if (!cur) return fail(c, 404, 'Item not found')
    const { values, errors } = await itemFields(companyId, await body(c), false, cur)
    if (Object.keys(errors).length) return fail(c, 400, Object.values(errors)[0], 'bad_item', errors)
    const [row] = await db.update(visitItem).set({ ...values, updatedAt: new Date() } as any).where(eq(visitItem.id, cur.id)).returning()
    return one(c, row)
  })

  app.delete('/:id', requirePermission('care-clients:delete'), async (c) => {
    const [row] = await db.delete(visitItem).where(and(eq(visitItem.id, c.req.param('id')!), eq(visitItem.companyId, who(c).companyId))).returning({ id: visitItem.id })
    return row ? done(c) : fail(c, 404, 'Item not found')
  })

  // How each of a client's goals went, visit by visit (newest first).
  app.get('/goals/:clientId', manage, async (c) => {
    const { companyId } = who(c)
    const clientId = c.req.param('clientId')!
    if (!(await access.clientInCompany(companyId, clientId))) return fail(c, 404, 'Client not found')
    const rows = await db.select({
      id: visitItemLog.id, goalId: visitItem.id, goal: visitItem.name, status: visitItemLog.status, rating: visitItemLog.rating, note: visitItemLog.note,
      completedAt: visitItemLog.completedAt, startTime: timeEntries.startTime, caregiverFirst: users.firstName, caregiverLast: users.lastName,
    }).from(visitItemLog)
      .innerJoin(visitItem, eq(visitItem.id, visitItemLog.itemId))
      .innerJoin(timeEntries, eq(timeEntries.id, visitItemLog.timeEntryId))
      .innerJoin(users, eq(users.id, timeEntries.caregiverId))
      .where(and(eq(visitItemLog.companyId, companyId), eq(visitItem.kind, 'goal'), eq(timeEntries.clientId, clientId)))
      .orderBy(desc(timeEntries.startTime)).limit(500)
    return list(c, rows, { page: 1, limit: 500, total: rows.length })
  })

  // ── the visit ──
  app.get('/visit/:timeEntryId', requirePermission('care-clients:read'), async (c) => {
    const { user, companyId, me } = who(c)
    const entry = await loadEntry(companyId, c.req.param('timeEntryId')!)
    if (!entry) return fail(c, 404, 'Visit not found')
    if (entry.caregiverId !== me && !access.office(user)) return fail(c, 403, 'Not your shift')
    return listAll(c, await core.visitItems.forVisit(companyId, entry))
  })

  app.put('/visit/:timeEntryId/:itemId', requirePermission('evv:update'), async (c) => {
    const { user, companyId, me } = who(c)
    const b = await body(c)
    if (!(STATUSES as readonly string[]).includes(b?.status)) return fail(c, 400, 'Say whether it was done, skipped or refused.', 'bad_status')
    const entry = await loadEntry(companyId, c.req.param('timeEntryId')!)
    if (!entry) return fail(c, 404, 'Visit not found')
    if (entry.caregiverId !== me && !access.office(user)) return fail(c, 403, 'Not your shift')
    const refused = await access.careWriteRefusal(c, entry.clientId)
    if (refused) return refused
    const item = (await core.visitItems.forVisit(companyId, entry)).find((i) => i.id === c.req.param('itemId'))
    if (!item) return fail(c, 404, 'That is not an item for this visit')
    if (item.kind === 'form' && b.status === 'done') return fail(c, 400, 'Fill in the form to finish it.', 'use_form') // skipped / refused (with a reason) are recorded here
    const note = b.note && String(b.note).trim() ? String(b.note).trim().slice(0, 2000) : null
    let rating: string | null = null
    if (item.kind === 'goal' && b.status === 'done') {
      if (!(RATINGS as readonly string[]).includes(b.rating)) return fail(c, 400, 'Say how it went: progress, no change or declined.', 'rating_required', { rating: 'Pick one' })
      rating = b.rating
    }
    if (b.status === 'refused' && !note) return fail(c, 400, REFUSAL_NEEDS_REASON, 'refusal_needs_reason')
    if (b.status === 'skipped' && !note && item.required) return fail(c, 400, SKIP_NEEDS_REASON, 'skip_needs_reason')
    // Done on a phone without signal: stamped with the time it was done (as for care tasks and doses).
    let doneAt = new Date()
    if (b.savedAt !== undefined && await core.offlineSaves.enabled(companyId)) {
      const t = core.offlineSaves.savedTime(b.savedAt)
      if ('problem' in t) return fail(c, 400, t.problem, 'bad_saved_time')
      if (t.at) doneAt = t.at
    }
    const [row] = await db.insert(visitItemLog)
      .values({ companyId, timeEntryId: entry.id, itemId: item.id, status: b.status, rating, note, completedAt: b.status === 'done' ? doneAt : null })
      .onConflictDoUpdate({ target: [visitItemLog.timeEntryId, visitItemLog.itemId], set: { status: b.status, rating, note, completedAt: b.status === 'done' ? doneAt : null, updatedAt: new Date() } })
      .returning()
    return one(c, row)
  })

  app.post('/visit/:timeEntryId/:itemId/form', requirePermission('evv:create'), async (c) => {
    const { user, companyId, me } = who(c)
    const b = await body(c)
    const entry = await loadEntry(companyId, c.req.param('timeEntryId')!)
    if (!entry) return fail(c, 404, 'Visit not found')
    if (entry.caregiverId !== me && !access.office(user)) return fail(c, 403, 'Not your shift')
    const refused = await access.careWriteRefusal(c, entry.clientId)
    if (refused) return refused
    const item = (await core.visitItems.forVisit(companyId, entry)).find((i) => i.id === c.req.param('itemId'))
    if (!item || item.kind !== 'form' || !item.formTemplateId) return fail(c, 404, 'That is not a form for this visit')
    const [tpl] = await db.select().from(formTemplates).where(and(eq(formTemplates.id, item.formTemplateId), eq(formTemplates.companyId, companyId))).limit(1)
    if (!tpl) return fail(c, 404, 'Form template not found')
    const data = b.data && typeof b.data === 'object' && !Array.isArray(b.data) ? b.data : {}
    const missing = parseFields(tpl.fields).filter((f) => f.required && f.type !== 'section' && isEmptyAnswer(f, data[f.id])).map((f) => f.label)
    if (missing.length) return fail(c, 400, `Please answer: ${missing.join(' · ')}`, 'form_incomplete')
    if (tpl.requiresSignature && !b.signature) return fail(c, 400, 'This form needs a signature', 'signature_required')
    const [submitter] = await db.select({ f: users.firstName, l: users.lastName }).from(users).where(eq(users.id, me)).limit(1)
    const [sub] = await db.insert(formSubmissions).values({
      companyId, templateId: tpl.id, templateName: tpl.name, entityType: 'client', entityId: entry.clientId, clientId: entry.clientId, submittedById: me,
      submittedByName: submitter ? `${submitter.f} ${submitter.l}` : null, data, signature: b.signature || null, signedAt: b.signature ? new Date() : null,
      status: b.signature ? 'signed' : 'submitted',
    }).returning()
    let doneAt = new Date()
    if (b.savedAt !== undefined && await core.offlineSaves.enabled(companyId)) {
      const t = core.offlineSaves.savedTime(b.savedAt)
      if ('problem' in t) return fail(c, 400, t.problem, 'bad_saved_time')
      if (t.at) doneAt = t.at
    }
    const [row] = await db.insert(visitItemLog)
      .values({ companyId, timeEntryId: entry.id, itemId: item.id, status: 'done', formSubmissionId: sub.id, completedAt: doneAt })
      .onConflictDoUpdate({ target: [visitItemLog.timeEntryId, visitItemLog.itemId], set: { status: 'done', formSubmissionId: sub.id, completedAt: doneAt, updatedAt: new Date() } })
      .returning()
    return one(c, { ...row, submission: { id: sub.id, status: sub.status } }, 201)
  })

  return app
}
