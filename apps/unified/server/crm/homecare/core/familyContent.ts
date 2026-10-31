// What a relative sees of the daily care (row 5/6, care_family_content; not ready until the owner has tried it): the tasks planned for each
// upcoming visit, the task log of past visits, the meals the caregiver recorded, and the documents the office chose to share — each behind
// the relative's own switch (care plan for the daily care, documents for the documents, vitals for the vitals).
//
// Only what is safe to show: a task's name and whether it was done. A caregiver's note on a skipped or refused task is NOT shown (it may
// say things the agency keeps internal); the office reads those. Documents are shown only when the office ticked "share with family".
import { and, desc, eq, inArray } from 'drizzle-orm'
import { clientTaskTemplates, documents, visitMeal } from '../../../db/schema/index.ts'
import type { CrmDeps } from '../../deps.ts'
import { addDays, type AgencyTime } from './agencyTime.ts'
import { taskBelongsTo, type VisitWhen } from './taskDays.ts'
import type { TaskReport } from './taskReport.ts'
import type { OfflineSaves } from './offlineSaves.ts'

export const FAMILY_CONTENT_FEATURE = 'care_family_content'
export const PAST_DAYS = 30
export const UPCOMING_DAYS = 14

/** The meals a caregiver can record and how much was eaten — the codes are stored, the labels are what every screen shows. */
export const MEALS = [
  { code: 'breakfast', label: 'Breakfast' }, { code: 'lunch', label: 'Lunch' }, { code: 'dinner', label: 'Dinner' }, { code: 'snack', label: 'Snack' },
] as const
export const AMOUNTS = [
  { code: 'all', label: 'Ate all of it' }, { code: 'most', label: 'Ate most of it' }, { code: 'half', label: 'Ate about half' },
  { code: 'little', label: 'Ate a little' }, { code: 'none', label: 'Did not eat' },
] as const
const MIME: Record<string, string> = {
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', txt: 'text/plain',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}
export const mimeOf = (ext: string | null | undefined) => MIME[String(ext || '').toLowerCase()] || 'application/octet-stream'
export const mealLabel = (code: string) => MEALS.find((m) => m.code === code)?.label ?? code
export const amountLabel = (code: string) => AMOUNTS.find((a) => a.code === code)?.label ?? code

/** How the task log words a result for a relative. */
const FAMILY_STATE: Record<string, string> = {
  done: 'Done', done_earlier: 'Done earlier this week', skipped: 'Not done this visit', refused: 'Declined', not_recorded: 'Not recorded',
}

const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))
/** When a scheduled visit happens, from its date and wall-clock times ('YYYY-MM-DD', 'HH:MM'). */
export function scheduledWhen(date: string, start: string, end: string): VisitWhen {
  const [y, m, d] = date.split('-').map(Number)
  const s = minutesOf(start), e = minutesOf(end)
  return { dow: new Date(Date.UTC(y, m - 1, d)).getUTCDay(), startMin: s, endMin: e, spansDays: e < s }
}

export function createFamilyContent(d: CrmDeps, deps: { time: AgencyTime; taskReport: TaskReport; offlineSaves: OfflineSaves }) {
  const enabled = (companyId: string) => d.features.isFeatureEnabled(companyId, FAMILY_CONTENT_FEATURE)

  /** The tasks planned for each of these upcoming visits ({ date, startTime, endTime, … } from the schedule), only those that belong to it. */
  async function upcoming(companyId: string, clientId: string, visits: any[]) {
    const tasks = await d.db.select().from(clientTaskTemplates)
      .where(and(eq(clientTaskTemplates.companyId, companyId), eq(clientTaskTemplates.clientId, clientId), eq(clientTaskTemplates.isActive, true)))
      .orderBy(clientTaskTemplates.sortOrder, clientTaskTemplates.createdAt)
    return visits.map((v) => {
      const when = scheduledWhen(v.date, v.startTime, v.endTime)
      return {
        id: v.id, date: v.date, startTime: v.startTime, endTime: v.endTime, caregiverFirst: v.caregiverFirst ?? null, caregiverLast: v.caregiverLast ?? null,
        tasks: tasks.filter((t: any) => taskBelongsTo(t, when)).map((t: any) => ({
          taskId: t.id, taskName: t.taskName, category: t.category, allottedMinutes: t.allottedMinutes, weekly: t.cadence === 'weekly', timeOfDay: t.timeOfDay,
        })),
      }
    })
  }

  /** The finished visits of the last 30 days, newest first, each with its tasks as done or not (no caregiver notes), and its meals. */
  async function past(companyId: string, clientId: string) {
    const today = await deps.time.today(companyId)
    const rep = await deps.taskReport.run(companyId, { from: addDays(today, -(PAST_DAYS - 1)), to: today, clientId })
    const visits = [...rep.visits].reverse().slice(0, 30)
    const meals = visits.length ? await d.db.select().from(visitMeal)
      .where(and(eq(visitMeal.companyId, companyId), inArray(visitMeal.timeEntryId, visits.map((v) => v.timeEntryId)))) : []
    return visits.map((v) => ({
      timeEntryId: v.timeEntryId, visitDate: v.visitDate, startTime: v.startTime, endTime: v.endTime, caregiverName: v.caregiverName,
      tasks: v.tasks.map((t) => ({ taskId: t.taskId, taskName: t.taskName, state: t.state, stateLabel: FAMILY_STATE[t.state] || t.stateLabel })),
      meals: meals.filter((m: any) => m.timeEntryId === v.timeEntryId).sort((a: any, b: any) => +new Date(a.servedAt) - +new Date(b.servedAt))
        .map((m: any) => ({ id: m.id, meal: m.meal, mealLabel: mealLabel(m.meal), description: m.description, amountEaten: m.amountEaten, amountLabel: amountLabel(m.amountEaten), servedAt: m.servedAt })),
    }))
  }

  /** The documents the office shared for this client — nothing confidential, nothing it did not tick. */
  async function sharedDocuments(companyId: string, clientId: string) {
    return d.db.select({
      id: documents.id, name: documents.name, documentType: documents.documentType, description: documents.description,
      fileName: documents.fileName, fileType: documents.fileType, fileSize: documents.fileSize, createdAt: documents.createdAt,
    }).from(documents).where(and(eq(documents.companyId, companyId), eq(documents.entityType, 'client'), eq(documents.entityId, clientId),
      eq(documents.shareWithFamily, true), eq(documents.isConfidential, false))).orderBy(desc(documents.createdAt)).limit(200)
  }
  async function sharedDocumentFile(companyId: string, clientId: string, id: string) {
    const [doc] = await d.db.select().from(documents).where(and(eq(documents.id, id), eq(documents.companyId, companyId), eq(documents.entityType, 'client'),
      eq(documents.entityId, clientId), eq(documents.shareWithFamily, true), eq(documents.isConfidential, false))).limit(1)
    return doc ?? null
  }

  /** Share (or stop sharing) one client's document with their family. A confidential document, or one that is not a client's, cannot be shared. */
  async function setSharing(companyId: string, id: string, share: boolean): Promise<'ok' | 'missing' | 'not_client' | 'confidential'> {
    const [doc] = await d.db.select({ entityType: documents.entityType, isConfidential: documents.isConfidential }).from(documents)
      .where(and(eq(documents.id, id), eq(documents.companyId, companyId))).limit(1)
    if (!doc) return 'missing'
    if (share && doc.entityType !== 'client') return 'not_client'
    if (share && doc.isConfidential) return 'confidential'
    await d.db.update(documents).set({ shareWithFamily: share, updatedAt: new Date() }).where(and(eq(documents.id, id), eq(documents.companyId, companyId)))
    return 'ok'
  }

  /** The meals recorded on one visit, in the order they were served. */
  async function mealsFor(companyId: string, timeEntryId: string) {
    const rows = await d.db.select().from(visitMeal).where(and(eq(visitMeal.companyId, companyId), eq(visitMeal.timeEntryId, timeEntryId))).orderBy(visitMeal.servedAt)
    return rows.map((m: any) => ({ id: m.id, meal: m.meal, mealLabel: mealLabel(m.meal), description: m.description, amountEaten: m.amountEaten, amountLabel: amountLabel(m.amountEaten), note: m.note, servedAt: m.servedAt }))
  }

  /** Record (or correct) one meal on a visit — one row per meal per visit. A meal written on a phone without signal keeps the time it was served. */
  async function recordMeal(companyId: string, entry: { id: string; clientId: string }, by: string, input: { meal?: unknown; description?: unknown; amountEaten?: unknown; note?: unknown; savedAt?: unknown }):
    Promise<{ ok: true } | { ok: false; message: string; code: string; fields?: Record<string, string> }> {
    const meal = String(input.meal ?? '')
    if (!MEALS.some((m) => m.code === meal)) return { ok: false, message: 'Pick breakfast, lunch, dinner or a snack.', code: 'bad_meal', fields: { meal: 'Pick a meal' } }
    const amount = String(input.amountEaten ?? '')
    if (!AMOUNTS.some((a) => a.code === amount)) return { ok: false, message: 'Say how much was eaten.', code: 'bad_amount', fields: { amountEaten: 'Pick an amount' } }
    const description = String(input.description ?? '').trim().slice(0, 300)
    if (!description) return { ok: false, message: 'Write what was served.', code: 'description_required', fields: { description: 'What was served' } }
    const note = input.note && String(input.note).trim() ? String(input.note).trim().slice(0, 500) : null
    let servedAt = new Date()
    if (input.savedAt !== undefined && await deps.offlineSaves.enabled(companyId)) {
      const t = deps.offlineSaves.savedTime(input.savedAt)
      if ('problem' in t) return { ok: false, message: t.problem, code: 'bad_saved_time' }
      if (t.at) servedAt = t.at
    }
    const values = { description, amountEaten: amount, note, recordedById: by, servedAt }
    await d.db.insert(visitMeal).values({ companyId, timeEntryId: entry.id, clientId: entry.clientId, meal, ...values })
      .onConflictDoUpdate({ target: [visitMeal.timeEntryId, visitMeal.meal], set: values })
    return { ok: true }
  }
  async function removeMeal(companyId: string, timeEntryId: string, meal: string) {
    await d.db.delete(visitMeal).where(and(eq(visitMeal.companyId, companyId), eq(visitMeal.timeEntryId, timeEntryId), eq(visitMeal.meal, meal)))
  }

  return { enabled, upcoming, past, mealsFor, recordMeal, removeMeal, sharedDocuments, sharedDocumentFile, setSharing }
}
export type FamilyContent = ReturnType<typeof createFamilyContent>
