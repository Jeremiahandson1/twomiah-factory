// Inside a visit: forms to fill in, interventions, goals, and tasks for every visit (item 4, care_visit_items; not ready until the
// owner has tried it on a phone), plus the agency's rule that a visit note is needed to clock out.
//
//   · FORM      the agency attaches one of its form templates to a client's visits (or to every visit). The caregiver fills it in during
//               the visit; the filled-in form is kept as an ordinary form submission about the client, and the visit points at it.
//   · INTERVENTION  what to do for a goal ("Walk the hallway with the walker twice"): done, skipped or refused, with a note.
//   · GOAL      a client's care goal: each visit records how it went (progress, no change, declined) and may add a note.
//   · GENERAL TASK  a task that is not one client's ("Wash hands on arrival"): done / skipped / refused, for every visit.
//   An item may be REQUIRED: a live clock-out waits until it is done, or skipped / refused with a reason. A clock-out saved on the
//   phone without signal is already a fact: it is recorded and flagged for the office, as for required tasks.
//   · VISIT NOTE  when the agency switches it on (company.settings.visitNoteRequired), a live clock-out needs a note.
import { and, asc, eq, isNull, or } from 'drizzle-orm'
import { company, visitItem, visitItemLog } from '../../../db/schema/index.ts'
import type { CrmDeps } from '../../deps.ts'

export const VISIT_ITEMS_FEATURE = 'care_visit_items'
export const KINDS = ['form', 'intervention', 'goal', 'general_task'] as const
export const STATUSES = ['done', 'skipped', 'refused'] as const
export const RATINGS = ['progress', 'no_change', 'declined'] as const
export const KIND_ORDER: Record<string, number> = { form: 0, intervention: 1, goal: 2, general_task: 3 }

export interface ItemState {
  id: string; kind: string; name: string; detail: string | null; goalId: string | null; formTemplateId: string | null; required: boolean; clientId: string | null
  status: string | null; rating: string | null; note: string | null; formSubmissionId: string | null; completedAt: Date | null
}

/** Is a required item settled? Done, or skipped / refused (the note rule is enforced when it is saved). Pure. */
export const isSettled = (log: { status?: string | null } | undefined | null) => !!log && (log.status === 'done' || log.status === 'skipped' || log.status === 'refused')

export function createVisitItems(d: CrmDeps) {
  const enabled = (companyId: string) => d.features.isFeatureEnabled(companyId, VISIT_ITEMS_FEATURE)

  async function noteRequired(companyId: string): Promise<boolean> {
    if (!(await enabled(companyId))) return false
    const [row] = await d.db.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1)
    return (row?.settings as any)?.visitNoteRequired === true
  }
  async function setNoteRequired(companyId: string, on: boolean) {
    const [row] = await d.db.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1)
    await d.db.update(company).set({ settings: { ...((row?.settings as object) || {}), visitNoteRequired: on } as any, updatedAt: new Date() } as any).where(eq(company.id, companyId))
    return on
  }

  /** The items for this visit — the client's own and the agency-wide ones — with what has been recorded, in screen order. */
  async function forVisit(companyId: string, entry: { id: string; clientId: string }): Promise<ItemState[]> {
    const items = await d.db.select().from(visitItem).where(and(
      eq(visitItem.companyId, companyId), eq(visitItem.isActive, true), or(eq(visitItem.clientId, entry.clientId), isNull(visitItem.clientId))))
      .orderBy(asc(visitItem.sortOrder), asc(visitItem.createdAt))
    const logs = await d.db.select().from(visitItemLog).where(and(eq(visitItemLog.companyId, companyId), eq(visitItemLog.timeEntryId, entry.id)))
    const byItem = new Map<string, any>(logs.map((l: any) => [l.itemId, l]))
    return items.map((i: any) => {
      const l = byItem.get(i.id)
      return {
        id: i.id, kind: i.kind, name: i.name, detail: i.detail, goalId: i.goalId, formTemplateId: i.formTemplateId, required: i.required, clientId: i.clientId,
        status: l?.status ?? null, rating: l?.rating ?? null, note: l?.note ?? null, formSubmissionId: l?.formSubmissionId ?? null, completedAt: l?.completedAt ?? null,
      }
    }).sort((a: ItemState, b: ItemState) => (KIND_ORDER[a.kind] - KIND_ORDER[b.kind]))
  }

  /** The required items still open on this visit ([] when the agency does not have the feature). */
  async function pendingFor(companyId: string, entry: { id: string; clientId: string }): Promise<{ id: string; name: string }[]> {
    if (!(await enabled(companyId))) return []
    return (await forVisit(companyId, entry)).filter((i) => i.required && !isSettled({ status: i.status })).map((i) => ({ id: i.id, name: i.name }))
  }

  return { enabled, noteRequired, setNoteRequired, forVisit, pendingFor }
}
export type VisitItems = ReturnType<typeof createVisitItems>
