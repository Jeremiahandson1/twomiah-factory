// Per-client care task checklists and the per-shift completion log.
//
//   /api/care-tasks/client/:clientId                 the client's active checklist (anyone signed in)
//   /api/care-tasks/client/:clientId          POST   add a task (office)
//   /api/care-tasks/:id                       PUT    edit / DELETE soft-remove (office)
//   /api/care-tasks/client/:clientId/import          bulk-create from an insurer assessment (office)
//   /api/care-tasks/client/:clientId/parse-assessment-pdf   read the assessment PDF, write nothing (office)
//   /api/care-tasks/client/:clientId/adherence       what is getting done (office)
//   /api/care-tasks/time-entry/:timeEntryId          the checklist for one shift (its caregiver, or the office)
//   /api/care-tasks/time-entry/:timeEntryId/:taskId  PUT mark completed / skipped / refused / pending
//
// Minutes per week is weekly_frequency x allotted_minutes, always derived on read; a 15-minute
// unit is minutes / 15.
import { Hono } from 'hono'
import { sql, eq, and } from 'drizzle-orm'
import { db } from '../../db/index.ts'
import { clientTaskTemplates, shiftTaskCompletions, clients, timeEntries } from '../../db/schema.ts'
import { authenticate, requireAdmin } from '../middleware/auth.ts'
import { uploadedForm } from '../utils/upload.ts'
import { agencyState, agencyTimezone } from '../services/agencyTime.ts'
import { formatsForState } from '../services/assessmentImports.ts'
import { AssessmentPdfError } from '../services/midasAssessmentPdf.ts'
import { isOffice, userIdOf, writeCareAudit, rowsOf, wholeNumber } from '../helpers/careAudit.ts'

const app = new Hono()
app.use('*', authenticate)

export const CATEGORIES = ['adl', 'iadl', 'medication', 'companion', 'safety', 'other']
export const STATUSES = ['pending', 'completed', 'skipped', 'refused']

// Frequency is a positive whole number; anything else is 1 (the source CRM's rule).
export const normFreq = (v: unknown) => {
  const n = parseInt(String(v), 10)
  return Number.isFinite(n) && n > 0 ? n : 1
}
export const normTimeOfDay = (v: unknown) => (['AM', 'PM', 'any'].includes(String(v)) ? String(v) : 'any')
export const normCadence = (v: unknown) => (v === 'weekly' ? 'weekly' : 'daily')

const TASK_COLUMNS = sql`id, client_id, task_name, description, category, allotted_minutes,
  weekly_frequency, days_of_week, time_of_day, assessment_source, cadence,
  (COALESCE(weekly_frequency, 1) * COALESCE(allotted_minutes, 0)) AS minutes_per_week,
  sort_order, is_active, created_at, updated_at`

const clientExists = async (id: string) =>
  !!(await db.select({ id: clients.id }).from(clients).where(eq(clients.id, id)).limit(1))[0]

const nextSortOrder = async (q: any, clientId: string): Promise<number> =>
  Number(rowsOf(await q.execute(sql`SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM client_task_templates WHERE client_id = ${clientId}`))[0]?.next ?? 0)

// ── the formats this agency can import ─────────────────────────────────────
app.get('/assessment-formats', requireAdmin, async (c) => {
  const state = await agencyState()
  return c.json(formatsForState(state).map(({ id, label, insurer, portal, states }) => ({ id, label, insurer, portal, states })))
})

// ── the client's checklist ──────────────────────────────────────────────────
app.get('/client/:clientId', async (c) => {
  const rows = rowsOf(await db.execute(sql`
    SELECT ${TASK_COLUMNS} FROM client_task_templates
     WHERE client_id = ${c.req.param('clientId')} AND is_active = true
     ORDER BY sort_order, created_at`))
  return c.json(rows)
})

app.post('/client/:clientId', requireAdmin, async (c) => {
  const clientId = c.req.param('clientId')
  const b = await c.req.json().catch(() => ({}))
  if (!b.taskName || !String(b.taskName).trim()) return c.json({ error: 'taskName is required' }, 400)
  if (b.category != null && b.category !== '' && !CATEGORIES.includes(b.category)) return c.json({ error: 'category is not valid' }, 400)
  let minutes = 0
  if (b.allottedMinutes !== undefined && b.allottedMinutes !== null && b.allottedMinutes !== '') {
    const m = wholeNumber(b.allottedMinutes)
    if (m === undefined) return c.json({ error: 'Minutes per task must be a whole number of minutes' }, 400)
    minutes = m
  }
  if (!(await clientExists(clientId))) return c.json({ error: 'Client not found' }, 404)
  const sortOrder = wholeNumber(b.sortOrder) ?? await nextSortOrder(db, clientId)
  const [row] = await db.insert(clientTaskTemplates).values({
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
    sortOrder,
    createdById: userIdOf(c.get('user' as any)),
  }).returning()
  await writeCareAudit(c.get('user' as any), 'CREATE', 'client_task_templates', row.id, row)
  return c.json(row)
})

// ── insurer assessment: read the PDF (writes nothing) ───────────────────────
app.post('/client/:clientId/parse-assessment-pdf', requireAdmin, async (c) => {
  const form = await uploadedForm(c)
  const file = form.get('file') as File | null
  if (!file || typeof (file as any).arrayBuffer !== 'function') return c.json({ error: 'Choose a PDF file' }, 400)
  if (file.size > 5 * 1024 * 1024) return c.json({ error: 'PDF is larger than 5 MB' }, 400)
  const [client] = await db.select({ firstName: clients.firstName, lastName: clients.lastName })
    .from(clients).where(eq(clients.id, c.req.param('clientId'))).limit(1)
  if (!client) return c.json({ error: 'Client not found' }, 404)

  const available = formatsForState(await agencyState())
  const wanted = String(form.get('format') || '') || available[0]?.id
  const format = available.find((f) => f.id === wanted)
  if (!format) return c.json({ error: 'That assessment format is not available for this agency.' }, 400)

  try {
    const parsed: any = await format.parse(new Uint8Array(await file.arrayBuffer()))
    const norm = (s: unknown) => String(s || '').trim().toLowerCase()
    parsed.clientNameMatch = norm(parsed.member.lastName) === norm(client.lastName)
      && norm(parsed.member.firstName) === norm(client.firstName)
    parsed.format = { id: format.id, label: format.label, insurer: format.insurer }
    return c.json(parsed)
  } catch (err: any) {
    if (err instanceof AssessmentPdfError) return c.json({ error: err.message }, 422)
    console.error('Parse assessment PDF error:', err)
    return c.json({ error: 'Could not read that PDF' }, 422)
  }
})

// ── bulk-create from a parsed assessment ────────────────────────────────────
// Body: { tasks: [{ taskName, category, allottedMinutes, weeklyFrequency, daysOfWeek, timeOfDay,
// description }], replaceExisting, source, assessmentTotals: { minsPerWeek } }. All-or-nothing.
// The reconciliation block lets a misread assessment be caught before it drives a checklist.
app.post('/client/:clientId/import', requireAdmin, async (c) => {
  const clientId = c.req.param('clientId')
  const b = await c.req.json().catch(() => ({}))
  const { tasks, replaceExisting, source, assessmentTotals } = b || {}
  if (!Array.isArray(tasks) || tasks.length === 0) return c.json({ error: 'tasks must be a non-empty array' }, 400)

  const clean: any[] = []
  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i] || {}
    if (!t.taskName || !String(t.taskName).trim()) return c.json({ error: `Row ${i + 1}: taskName is required` }, 400)
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
  if (!(await clientExists(clientId))) return c.json({ error: 'Client not found' }, 404)

  const computedMinsPerWeek = clean.reduce((sum, t) => sum + t.weeklyFrequency * t.allottedMinutes, 0)
  const expected = assessmentTotals && assessmentTotals.minsPerWeek !== null && assessmentTotals.minsPerWeek !== ''
    && Number.isFinite(+assessmentTotals.minsPerWeek) ? +assessmentTotals.minsPerWeek : null
  const reconciliation = {
    computedMinsPerWeek,
    expectedMinsPerWeek: expected,
    match: expected == null ? null : computedMinsPerWeek === expected,
    computedUnitsPerWeek: +(computedMinsPerWeek / 15).toFixed(2),
  }

  const user = c.get('user' as any)
  const inserted = await db.transaction(async (tx) => {
    if (replaceExisting) {
      await tx.update(clientTaskTemplates).set({ isActive: false, updatedAt: new Date() })
        .where(and(eq(clientTaskTemplates.clientId, clientId), eq(clientTaskTemplates.isActive, true)))
    }
    const base = await nextSortOrder(tx, clientId)
    const ids: string[] = []
    for (let i = 0; i < clean.length; i++) {
      const [r] = await tx.insert(clientTaskTemplates).values({
        clientId, ...clean[i], assessmentSource: source || 'midas_import', sortOrder: base + i, createdById: userIdOf(user),
      }).returning({ id: clientTaskTemplates.id })
      ids.push(r.id)
    }
    return ids
  })
  await writeCareAudit(user, 'IMPORT', 'client_task_templates', null,
    { clientId, count: inserted.length, replaceExisting: !!replaceExisting, source, reconciliation })
  return c.json({ success: true, imported: inserted.length, replacedExisting: !!replaceExisting, reconciliation })
})

// ── what's getting done ─────────────────────────────────────────────────────
// Per active task over the window: completed / skipped / refused, and the last completion. The
// screen derives "not addressed" for daily tasks as shifts - completed - skipped - refused.
app.get('/client/:clientId/adherence', requireAdmin, async (c) => {
  const days = Math.min(Math.max(parseInt(c.req.query('days') || '', 10) || 30, 1), 180)
  const clientId = c.req.param('clientId')
  const since = sql`NOW() - (${String(days)} || ' days')::interval`
  const totalShifts = Number(rowsOf(await db.execute(sql`
    SELECT COUNT(*)::int AS n FROM time_entries WHERE client_id = ${clientId} AND start_time >= ${since}`))[0]?.n || 0)
  const tasks = rowsOf(await db.execute(sql`
    SELECT t.id AS task_id, t.task_name, t.category, t.cadence,
           COUNT(*) FILTER (WHERE sc.status = 'completed' AND te.start_time >= ${since})::int AS completed,
           COUNT(*) FILTER (WHERE sc.status = 'skipped'   AND te.start_time >= ${since})::int AS skipped,
           COUNT(*) FILTER (WHERE sc.status = 'refused'   AND te.start_time >= ${since})::int AS refused,
           MAX(sc.completed_at) FILTER (WHERE te.start_time >= ${since}) AS last_completed
      FROM client_task_templates t
      LEFT JOIN shift_task_completions sc ON sc.task_template_id = t.id
      LEFT JOIN time_entries te ON te.id = sc.time_entry_id
     WHERE t.client_id = ${clientId} AND t.is_active = true
     GROUP BY t.id, t.task_name, t.category, t.cadence, t.sort_order
     ORDER BY t.sort_order, t.task_name`))
  return c.json({ days, totalShifts, tasks })
})

// ── one shift's checklist ───────────────────────────────────────────────────
const loadEntry = async (id: string) =>
  (await db.select({ id: timeEntries.id, clientId: timeEntries.clientId, caregiverId: timeEntries.caregiverId })
    .from(timeEntries).where(eq(timeEntries.id, id)).limit(1))[0]

app.get('/time-entry/:timeEntryId', async (c) => {
  const user = c.get('user' as any)
  const entry = await loadEntry(c.req.param('timeEntryId'))
  if (!entry) return c.json({ error: 'Time entry not found' }, 404)
  if (entry.caregiverId !== userIdOf(user) && !isOffice(user)) return c.json({ error: 'Not your shift' }, 403)
  const tz = await agencyTimezone()
  // Monday 00:00 of the agency's current week, as the UTC wall clock time_entries are stored in.
  const weekStart = sql`((date_trunc('week', NOW() AT TIME ZONE ${tz}) AT TIME ZONE ${tz}) AT TIME ZONE 'UTC')`
  const rows = rowsOf(await db.execute(sql`
    SELECT t.id AS task_id, t.task_name, t.description, t.category, t.allotted_minutes,
           t.weekly_frequency, t.days_of_week, t.time_of_day, t.sort_order, t.cadence,
           sc.id AS completion_id, COALESCE(sc.status, 'pending') AS status,
           sc.notes, sc.completed_at, sc.updated_at,
           EXISTS (
             SELECT 1 FROM shift_task_completions sc2
               JOIN time_entries te2 ON te2.id = sc2.time_entry_id
              WHERE sc2.task_template_id = t.id
                AND sc2.status = 'completed'
                AND te2.start_time >= ${weekStart}
           ) AS done_this_week
      FROM client_task_templates t
      LEFT JOIN shift_task_completions sc ON sc.task_template_id = t.id AND sc.time_entry_id = ${entry.id}
     WHERE t.client_id = ${entry.clientId} AND t.is_active = true
     ORDER BY t.sort_order, t.created_at`))
  return c.json(rows)
})

app.put('/time-entry/:timeEntryId/:taskId', async (c) => {
  const user = c.get('user' as any)
  const b = await c.req.json().catch(() => ({}))
  if (!STATUSES.includes(b?.status)) return c.json({ error: 'Invalid status' }, 400)
  const entry = await loadEntry(c.req.param('timeEntryId'))
  if (!entry) return c.json({ error: 'Time entry not found' }, 404)
  if (entry.caregiverId !== userIdOf(user) && !isOffice(user)) return c.json({ error: 'Not your shift' }, 403)
  const [task] = await db.select({ id: clientTaskTemplates.id, clientId: clientTaskTemplates.clientId })
    .from(clientTaskTemplates).where(eq(clientTaskTemplates.id, c.req.param('taskId'))).limit(1)
  if (!task || task.clientId !== entry.clientId) return c.json({ error: 'Task not found for this client' }, 404)

  const completedAt = b.status === 'completed' ? new Date() : null
  const notes = b.notes ? String(b.notes) : null
  const [row] = await db.insert(shiftTaskCompletions)
    .values({ timeEntryId: entry.id, taskTemplateId: task.id, status: b.status, notes, completedAt })
    .onConflictDoUpdate({
      target: [shiftTaskCompletions.timeEntryId, shiftTaskCompletions.taskTemplateId],
      set: { status: b.status, notes, completedAt, updatedAt: new Date() },
    })
    .returning()
  return c.json(row)
})

// ── edit / remove one task ──────────────────────────────────────────────────
app.put('/:id', requireAdmin, async (c) => {
  const b = await c.req.json().catch(() => ({}))
  const set: Record<string, unknown> = { updatedAt: new Date() }
  if (b.taskName !== undefined && b.taskName !== null) {
    if (!String(b.taskName).trim()) return c.json({ error: 'taskName cannot be blank' }, 400)
    set.taskName = String(b.taskName).trim()
  }
  if (b.description !== undefined && b.description !== null) set.description = String(b.description)
  if (b.category !== undefined && b.category !== null) {
    if (!CATEGORIES.includes(b.category)) return c.json({ error: 'category is not valid' }, 400)
    set.category = b.category
  }
  if (b.allottedMinutes !== undefined && b.allottedMinutes !== null) {
    const m = wholeNumber(b.allottedMinutes)
    if (m === undefined) return c.json({ error: 'Minutes per task must be a whole number of minutes' }, 400)
    set.allottedMinutes = m
  }
  if (b.sortOrder !== undefined && b.sortOrder !== null) {
    const s = wholeNumber(b.sortOrder)
    if (s === undefined) return c.json({ error: 'sortOrder must be a whole number' }, 400)
    set.sortOrder = s
  }
  if (b.weeklyFrequency !== undefined && b.weeklyFrequency !== null) set.weeklyFrequency = normFreq(b.weeklyFrequency)
  if (b.daysOfWeek !== undefined && b.daysOfWeek !== null) set.daysOfWeek = b.daysOfWeek
  if (b.timeOfDay) set.timeOfDay = normTimeOfDay(b.timeOfDay)
  if (b.cadence) set.cadence = normCadence(b.cadence)
  const [row] = await db.update(clientTaskTemplates).set(set).where(eq(clientTaskTemplates.id, c.req.param('id'))).returning()
  if (!row) return c.json({ error: 'Task not found' }, 404)
  await writeCareAudit(c.get('user' as any), 'UPDATE', 'client_task_templates', row.id, row)
  return c.json(row)
})

app.delete('/:id', requireAdmin, async (c) => {
  const [row] = await db.update(clientTaskTemplates).set({ isActive: false, updatedAt: new Date() })
    .where(eq(clientTaskTemplates.id, c.req.param('id'))).returning({ id: clientTaskTemplates.id })
  if (!row) return c.json({ error: 'Task not found' }, 404)
  await writeCareAudit(c.get('user' as any), 'DELETE', 'client_task_templates', row.id, { soft_deleted: true })
  return c.json({ success: true })
})

export default app
