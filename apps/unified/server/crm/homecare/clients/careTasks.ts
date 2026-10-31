// Per-client care task checklists and the per-shift completion log. Moved from
// templates/crm-homecare/backend/src/routes/careTasks.ts.
//
//   /api/care-tasks/assessment-formats              the insurer imports this agency's state can use (office)
//   /api/care-tasks/client/:clientId          GET   the client's active checklist (the office, or a caregiver who serves them)
//   /api/care-tasks/client/:clientId          POST  add a task (office)
//   /api/care-tasks/:id                       PUT   edit / DELETE soft-remove (office)
//   /api/care-tasks/client/:clientId/import         bulk-create from an insurer assessment (office)
//   /api/care-tasks/client/:clientId/parse-assessment-pdf   read the assessment PDF, write nothing (office)
//   /api/care-tasks/client/:clientId/adherence      what is getting done (office)
//   /api/care-tasks/time-entry/:timeEntryId         the checklist for one shift (its caregiver, or the office)
//   /api/care-tasks/time-entry/:timeEntryId/:taskId PUT mark completed / skipped / refused / pending
//
// Minutes per week is derived on read by core/careTaskMinutes.ts (a daily task counts once per scheduled visit; a
// weekly or assessment-imported task its own times per week); a 15-minute unit is minutes / 15.
//
// Permissions: the checklists are care-clients:read; ticking a shift's task is evv:update (the caregiver's visit work,
// their own shift for a client they serve); every office action is care-clients:create / update / delete.
// Replies: the checklist and the shift's checklist are { data, pagination } in camelCase (bare snake_case arrays before:
// taskName, minutesPerWeek, timesPerWeek, everyVisit, doneThisWeek, taskId …); the adherence tasks are camelCase.
import { Hono } from 'hono'
import { and, eq } from 'drizzle-orm'
import { clientTaskTemplates, shiftTaskCompletions, clients, timeEntries } from '../../../db/schema/index.ts'
import { clientTaskRows, nextTaskSortOrder, taskAdherence, shiftChecklist } from '../../../data/homecareClients.ts'
import type { AppEnv } from '../../../http/env.ts'
import { done, fail, one } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import type { HomecareCore } from '../core/index.ts'
import { wholeNumber } from '../core/careAudit.ts'
import { REQUIRED_TASKS_FEATURE } from '../core/requiredTasks.ts'
import { uploadedForm } from '../core/upload.ts'
import { formatsForState } from '../core/assessmentImports.ts'
import { AssessmentPdfError } from '../core/midasAssessmentPdf.ts'
import { withWeeklyMinutes } from '../core/careTaskMinutes.ts'
import { body, who, whole, type ClientAccess } from './shared.ts'

export const CATEGORIES = ['adl', 'iadl', 'medication', 'companion', 'safety', 'other']
export const STATUSES = ['pending', 'completed', 'skipped', 'refused']
export const SKIP_NEEDS_REASON = 'This task is required. Say why it was skipped: add a note with the reason, then mark it Skipped.'
export const REFUSAL_NEEDS_REASON = 'Say why the client refused this task: add a note with the reason (the Note button), then mark it Refused.'

// Frequency is a positive whole number; anything else is 1 (the source CRM's rule).
export const normFreq = (v: unknown) => {
  const n = parseInt(String(v), 10)
  return Number.isFinite(n) && n > 0 ? n : 1
}
export const normTimeOfDay = (v: unknown) => (['AM', 'PM', 'any'].includes(String(v)) ? String(v) : 'any')
export const normCadence = (v: unknown) => (v === 'weekly' ? 'weekly' : 'daily')

export function createCareTaskRoutes(core: HomecareCore, d: CrmDeps, access: ClientAccess) {
  const app = new Hono<AppEnv>()
  const { requirePermission } = d.permissions
  const { db } = d

  /** One of the company's time entries (a shift), or undefined. */
  const loadEntry = async (companyId: string, id: string) =>
    (await db.select({ id: timeEntries.id, clientId: timeEntries.clientId, caregiverId: timeEntries.caregiverId })
      .from(timeEntries).where(and(eq(timeEntries.id, id), eq(timeEntries.companyId, companyId))).limit(1))[0]

  // ── the formats this agency can import ──
  app.get('/assessment-formats', requirePermission('care-clients:update'), async (c) => {
    const { companyId } = who(c)
    const state = await core.time.state(companyId)
    return whole(c, formatsForState(state).map(({ id, label, insurer, portal, states }) => ({ id, label, insurer, portal, states })))
  })

  // ── the client's checklist ──
  app.get('/client/:clientId', requirePermission('care-clients:read'), access.requireClientAccess(), async (c) => {
    const { companyId } = who(c)
    const clientId = c.req.param('clientId')!
    const rows = await clientTaskRows(db, companyId, clientId)
    // timesPerWeek / minutesPerWeek / everyVisit: the one rule (core/careTaskMinutes.ts).
    return whole(c, withWeeklyMinutes(rows, await core.careTaskMinutes.clientVisitsPerWeek(companyId, clientId)))
  })

  app.post('/client/:clientId', requirePermission('care-clients:create'), async (c) => {
    const { user, companyId, me } = who(c)
    const clientId = c.req.param('clientId')!
    const b = await body(c)
    if (!b.taskName || !String(b.taskName).trim()) return fail(c, 400, 'taskName is required')
    if (b.category != null && b.category !== '' && !CATEGORIES.includes(b.category)) return fail(c, 400, 'category is not valid')
    let minutes = 0
    if (b.allottedMinutes !== undefined && b.allottedMinutes !== null && b.allottedMinutes !== '') {
      const m = wholeNumber(b.allottedMinutes)
      if (m === undefined) return fail(c, 400, 'Minutes per task must be a whole number of minutes')
      minutes = m
    }
    if (!(await access.clientInCompany(companyId, clientId))) return fail(c, 404, 'Client not found')
    const makeRequired = b.isRequired === true || b.isRequired === 'true'
    if (makeRequired && !(await d.features.isFeatureEnabled(companyId, REQUIRED_TASKS_FEATURE))) return fail(c, 400, 'Required tasks are not switched on for this agency yet.', 'required_tasks_not_available')
    const sortOrder = wholeNumber(b.sortOrder) ?? await nextTaskSortOrder(db, companyId, clientId)
    const [row] = await db.insert(clientTaskTemplates).values({
      companyId,
      clientId,
      taskName: String(b.taskName).trim(),
      description: b.description ? String(b.description) : null,
      category: b.category || 'other',
      allottedMinutes: minutes,
      weeklyFrequency: normFreq(b.weeklyFrequency),
      daysOfWeek: b.daysOfWeek || null,
      timeOfDay: normTimeOfDay(b.timeOfDay),
      assessmentSource: b.assessmentSource || null,
      cadence: normCadence(b.cadence),
      isRequired: makeRequired,
      sortOrder,
      createdById: me,
    }).returning()
    await core.careAudit.writeCareAudit(user, 'CREATE', 'client_task_templates', row.id, row)
    return one(c, row)
  })

  // ── insurer assessment: read the PDF (writes nothing) ──
  app.post('/client/:clientId/parse-assessment-pdf', requirePermission('care-clients:update'), async (c) => {
    const { companyId } = who(c)
    const form = await uploadedForm(c)
    const file = form.get('file') as File | null
    if (!file || typeof (file as any).arrayBuffer !== 'function') return fail(c, 400, 'Choose a PDF file')
    if (file.size > 5 * 1024 * 1024) return fail(c, 400, 'PDF is larger than 5 MB')
    const [client] = await db.select({ firstName: clients.firstName, lastName: clients.lastName }).from(clients)
      .where(and(eq(clients.id, c.req.param('clientId')!), eq(clients.companyId, companyId))).limit(1)
    if (!client) return fail(c, 404, 'Client not found')
    const available = formatsForState(await core.time.state(companyId))
    const wanted = String(form.get('format') || '') || available[0]?.id
    const format = available.find((f) => f.id === wanted)
    if (!format) return fail(c, 400, 'That assessment format is not available for this agency.')
    try {
      const parsed: any = await format.parse(new Uint8Array(await file.arrayBuffer()))
      const norm = (s: unknown) => String(s || '').trim().toLowerCase()
      parsed.clientNameMatch = norm(parsed.member.lastName) === norm(client.lastName) && norm(parsed.member.firstName) === norm(client.firstName)
      parsed.format = { id: format.id, label: format.label, insurer: format.insurer }
      return one(c, parsed)
    } catch (err: any) {
      if (err instanceof AssessmentPdfError) return fail(c, 422, err.message)
      d.logger.error('Parse assessment PDF error', { error: err?.message })
      return fail(c, 422, 'Could not read that PDF')
    }
  })

  // ── bulk-create from a parsed assessment ──
  // Body: { tasks: [{ taskName, category, allottedMinutes, weeklyFrequency, daysOfWeek, timeOfDay, description }],
  // replaceExisting, source, assessmentTotals: { minsPerWeek } }. All-or-nothing. The reconciliation lets a misread
  // assessment be caught before it drives a checklist.
  app.post('/client/:clientId/import', requirePermission('care-clients:create'), async (c) => {
    const { user, companyId, me } = who(c)
    const clientId = c.req.param('clientId')!
    const { tasks, replaceExisting, source, assessmentTotals } = await body(c)
    if (!Array.isArray(tasks) || tasks.length === 0) return fail(c, 400, 'tasks must be a non-empty array')
    const clean: any[] = []
    for (let i = 0; i < tasks.length; i++) {
      const t = tasks[i] || {}
      if (!t.taskName || !String(t.taskName).trim()) return fail(c, 400, `Row ${i + 1}: taskName is required`)
      clean.push({
        taskName: String(t.taskName).trim(),
        description: t.description ? String(t.description).trim() : null,
        category: CATEGORIES.includes(t.category) ? t.category : 'iadl',
        allottedMinutes: Math.max(0, parseInt(t.allottedMinutes, 10) || 0),
        weeklyFrequency: normFreq(t.weeklyFrequency),
        daysOfWeek: t.daysOfWeek ? String(t.daysOfWeek).trim() : null,
        timeOfDay: normTimeOfDay(t.timeOfDay),
      })
    }
    if (!(await access.clientInCompany(companyId, clientId))) return fail(c, 404, 'Client not found')

    const computedMinsPerWeek = clean.reduce((sum, t) => sum + t.weeklyFrequency * t.allottedMinutes, 0)
    const expected = assessmentTotals && assessmentTotals.minsPerWeek !== null && assessmentTotals.minsPerWeek !== ''
      && Number.isFinite(+assessmentTotals.minsPerWeek) ? +assessmentTotals.minsPerWeek : null
    const reconciliation = {
      computedMinsPerWeek,
      expectedMinsPerWeek: expected,
      match: expected == null ? null : computedMinsPerWeek === expected,
      computedUnitsPerWeek: +(computedMinsPerWeek / 15).toFixed(2),
    }
    const inserted = await db.transaction(async (tx: any) => {
      if (replaceExisting) {
        await tx.update(clientTaskTemplates).set({ isActive: false, updatedAt: new Date() }).where(and(
          eq(clientTaskTemplates.companyId, companyId), eq(clientTaskTemplates.clientId, clientId), eq(clientTaskTemplates.isActive, true)))
      }
      const base = await nextTaskSortOrder(tx, companyId, clientId)
      const ids: string[] = []
      for (let i = 0; i < clean.length; i++) {
        const [r] = await tx.insert(clientTaskTemplates).values({
          companyId, clientId, ...clean[i], assessmentSource: source || 'midas_import', sortOrder: base + i, createdById: me,
        }).returning({ id: clientTaskTemplates.id })
        ids.push(r.id)
      }
      return ids
    })
    await core.careAudit.writeCareAudit(user, 'IMPORT', 'client_task_templates', null,
      { clientId, count: inserted.length, replaceExisting: !!replaceExisting, source, reconciliation })
    return one(c, { success: true, imported: inserted.length, replacedExisting: !!replaceExisting, reconciliation })
  })

  // ── what's getting done ── per active task over the window; the screen derives "not addressed" for daily tasks.
  app.get('/client/:clientId/adherence', requirePermission('care-clients:update'), async (c) => {
    const { companyId } = who(c)
    const days = Math.min(Math.max(parseInt(c.req.query('days') || '', 10) || 30, 1), 180)
    const { totalShifts, tasks } = await taskAdherence(db, companyId, c.req.param('clientId')!, days)
    return one(c, { days, totalShifts, tasks })
  })

  // ── one shift's checklist ──
  app.get('/time-entry/:timeEntryId', requirePermission('care-clients:read'), async (c) => {
    const { user, companyId, me } = who(c)
    const entry = await loadEntry(companyId, c.req.param('timeEntryId')!)
    if (!entry) return fail(c, 404, 'Time entry not found')
    if (entry.caregiverId !== me && !access.office(user)) return fail(c, 403, 'Not your shift')
    const tz = await core.time.timezone(companyId)
    return whole(c, await shiftChecklist(db, companyId, entry.id, entry.clientId, tz))
  })

  app.put('/time-entry/:timeEntryId/:taskId', requirePermission('evv:update'), async (c) => {
    const { user, companyId, me } = who(c)
    const b = await body(c)
    if (!STATUSES.includes(b?.status)) return fail(c, 400, 'Invalid status')
    const entry = await loadEntry(companyId, c.req.param('timeEntryId')!)
    if (!entry) return fail(c, 404, 'Time entry not found')
    if (entry.caregiverId !== me && !access.office(user)) return fail(c, 403, 'Not your shift')
    const refused = await access.careWriteRefusal(c, entry.clientId)
    if (refused) return refused
    const [task] = await db.select({ id: clientTaskTemplates.id, clientId: clientTaskTemplates.clientId, isRequired: clientTaskTemplates.isRequired }).from(clientTaskTemplates)
      .where(and(eq(clientTaskTemplates.id, c.req.param('taskId')), eq(clientTaskTemplates.companyId, companyId))).limit(1)
    if (!task || task.clientId !== entry.clientId) return fail(c, 404, 'Task not found for this client')

    // Item 4 (care_offline_saves): a task done on the phone without signal is stamped with the time it was done, not the time it arrived.
    let doneAt = new Date()
    if (b.savedAt !== undefined && await core.offlineSaves.enabled(companyId)) {
      const t = core.offlineSaves.savedTime(b.savedAt)
      if ('problem' in t) return fail(c, 400, t.problem, 'bad_saved_time')
      if (t.at) doneAt = t.at
    }
    const completedAt = b.status === 'completed' ? doneAt : null
    const notes = b.notes && String(b.notes).trim() ? String(b.notes).trim() : null
    // A refusal is a care event the office and the visit record must be able to explain, so it carries the reason.
    if (b.status === 'refused' && !notes) return fail(c, 400, REFUSAL_NEEDS_REASON)
    // A required task may only be skipped with a reason (care_required_tasks); other tasks keep today's rules.
    if (b.status === 'skipped' && !notes && task.isRequired && await core.requiredTasks.enabled(companyId)) return fail(c, 400, SKIP_NEEDS_REASON, 'skip_needs_reason')
    const [row] = await db.insert(shiftTaskCompletions)
      .values({ companyId, timeEntryId: entry.id, taskTemplateId: task.id, status: b.status, notes, completedAt })
      .onConflictDoUpdate({
        target: [shiftTaskCompletions.timeEntryId, shiftTaskCompletions.taskTemplateId],
        set: { status: b.status, notes, completedAt, updatedAt: new Date() },
      })
      .returning()
    return one(c, row)
  })

  // ── edit / remove one task ──
  app.put('/:id', requirePermission('care-clients:update'), async (c) => {
    const { user, companyId } = who(c)
    const b = await body(c)
    const set: Record<string, unknown> = { updatedAt: new Date() }
    if (b.taskName !== undefined && b.taskName !== null) {
      if (!String(b.taskName).trim()) return fail(c, 400, 'taskName cannot be blank')
      set.taskName = String(b.taskName).trim()
    }
    if (b.description !== undefined && b.description !== null) set.description = String(b.description)
    if (b.category !== undefined && b.category !== null) {
      if (!CATEGORIES.includes(b.category)) return fail(c, 400, 'category is not valid')
      set.category = b.category
    }
    if (b.allottedMinutes !== undefined && b.allottedMinutes !== null) {
      const m = wholeNumber(b.allottedMinutes)
      if (m === undefined) return fail(c, 400, 'Minutes per task must be a whole number of minutes')
      set.allottedMinutes = m
    }
    if (b.sortOrder !== undefined && b.sortOrder !== null) {
      const s = wholeNumber(b.sortOrder)
      if (s === undefined) return fail(c, 400, 'sortOrder must be a whole number')
      set.sortOrder = s
    }
    if (b.weeklyFrequency !== undefined && b.weeklyFrequency !== null) set.weeklyFrequency = normFreq(b.weeklyFrequency)
    if (b.daysOfWeek !== undefined && b.daysOfWeek !== null) set.daysOfWeek = b.daysOfWeek
    if (b.timeOfDay) set.timeOfDay = normTimeOfDay(b.timeOfDay)
    if (b.cadence) set.cadence = normCadence(b.cadence)
    if (b.isRequired !== undefined && b.isRequired !== null) {
      const want = b.isRequired === true || b.isRequired === 'true'
      if (want && !(await core.requiredTasks.enabled(companyId))) return fail(c, 400, 'Required tasks are not switched on for this agency yet.', 'required_tasks_not_available')
      set.isRequired = want
    }
    const [row] = await db.update(clientTaskTemplates).set(set)
      .where(and(eq(clientTaskTemplates.id, c.req.param('id')), eq(clientTaskTemplates.companyId, companyId))).returning()
    if (!row) return fail(c, 404, 'Task not found')
    await core.careAudit.writeCareAudit(user, 'UPDATE', 'client_task_templates', row.id, row)
    return one(c, row)
  })

  app.delete('/:id', requirePermission('care-clients:delete'), async (c) => {
    const { user, companyId } = who(c)
    const [row] = await db.update(clientTaskTemplates).set({ isActive: false, updatedAt: new Date() })
      .where(and(eq(clientTaskTemplates.id, c.req.param('id')), eq(clientTaskTemplates.companyId, companyId)))
      .returning({ id: clientTaskTemplates.id })
    if (!row) return fail(c, 404, 'Task not found')
    await core.careAudit.writeCareAudit(user, 'DELETE', 'client_task_templates', row.id, { soft_deleted: true })
    return done(c)
  })

  return app
}
