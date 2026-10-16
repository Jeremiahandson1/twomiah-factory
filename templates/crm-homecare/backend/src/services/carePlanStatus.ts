// The ONE rule for "this care plan is active" (Run 4 HIGH 2).
//
// A plan is active when its status is 'active' AND the agency's today falls inside its dates (no start
// date = already started, no end date = open-ended). A draft (every plan made from a template starts
// as one) is never active, whatever its dates, until the office sets it Active.
//
// Every reader goes through here: the office list (each plan carries `isActive`), the office summary
// count, the family portal's care plan, and the caregiver app (which reads `isActive` from the list).
// Before this, the office counted by dates only (a draft read "1 active plan" and wore an Active tag
// beside its Draft tag) while the family portal counted by status only ("No active care plan found").
import { and, eq, gte, isNull, lte, or, type SQL } from 'drizzle-orm'
import { carePlans } from '../../db/schema.ts'

export const CARE_PLAN_STATUSES = ['active', 'draft', 'inactive', 'completed'] as const

/** Where-clause: the plans active on `today` (YYYY-MM-DD, the agency's date). */
export function activePlanWhere(today: string): SQL {
  return and(
    eq(carePlans.status, 'active'),
    or(isNull(carePlans.startDate), lte(carePlans.startDate, today)),
    or(isNull(carePlans.endDate), gte(carePlans.endDate, today)),
  ) as SQL
}

const ymd = (d: unknown): string | null => (d == null || d === '' ? null : String(d instanceof Date ? d.toISOString() : d).slice(0, 10))

/** The same rule for one row already read (startDate / endDate as DATE strings). */
export function isPlanActive(plan: { status?: string | null; startDate?: unknown; endDate?: unknown }, today: string): boolean {
  if ((plan.status || 'active') !== 'active') return false
  const s = ymd(plan.startDate), e = ymd(plan.endDate)
  return (!s || s <= today) && (!e || e >= today)
}
