// The ONE rule for "this care plan is active" (Run 4 HIGH 2). Moved from
// templates/crm-homecare/backend/src/services/carePlanStatus.ts. Pure (a query-builder condition, no database call).
//
// A plan is active when its status is 'active' AND the agency's today falls inside its dates (no start date = already
// started, no end date = open-ended). A draft is never active, whatever its dates, until the office sets it Active.
// Every reader goes through here: the office list, the office summary count, the family portal's care plan and the
// caregiver app. The caller adds the company condition (carePlans.companyId) beside it.
import { and, eq, gte, isNull, lte, or, type SQL } from 'drizzle-orm'
import { carePlans } from '../../../db/schema/index.ts'

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
