// Shared Agreements page — the contract between a template and the vendored page (crm, crm-fieldservice, crm-landscaping).
export interface AgreementsApi {
  get: (path: string) => Promise<any>
  post: (path: string, body?: any) => Promise<any>
  put: (path: string, body?: any) => Promise<any>
  delete: (path: string) => Promise<any>
}

export interface AgreementsConfig {
  /** Recurrence / auto-schedule fields on the agreement form (fs / landscaping maintenance contracts). Default false. */
  recurrence?: boolean
  /** The plan-name example, in the trade's words. Absent: a neutral one. (The page said "HVAC Maintenance Plan" to every
   *  trade — found sweeping the warranty form's landscaping example on a contractor, live test 2026-10-22.) */
  planNamePlaceholder?: string
}

export interface AgreementsPageProps { api: AgreementsApi; config?: AgreementsConfig }

/**
 * WHEN AN AGREEMENT NEXT BILLS — the rule the billing run itself follows (tenant-backend agreements.ts
 * getAgreementsDueForBilling): an ACTIVE agreement that has started and not ended is billed when its next bill date has
 * come, or at once if it has never been billed (no next bill date). The list showed only when it expires (live tests
 * 2026-10-22: "Agreements list has no next-bill-date column").
 *
 *   none  not billing: cancelled, expired or ended
 *   due   the run will bill it now (or the next time it runs)
 *   on    the day it will bill — its first bill on its start date, then each next bill date
 */
export type NextBill = { kind: 'none' } | { kind: 'due' } | { kind: 'on'; date: Date }
export function nextBillOf(a: { status?: string | null; startDate?: string | Date | null; endDate?: string | Date | null; nextBillDate?: string | Date | null }, now: Date = new Date()): NextBill {
  if (a.status !== 'active') return { kind: 'none' }
  const end = a.endDate ? new Date(a.endDate) : null
  if (end && !isNaN(end.getTime()) && end < now) return { kind: 'none' }
  const start = a.startDate ? new Date(a.startDate) : null
  const next = a.nextBillDate ? new Date(a.nextBillDate) : null
  const on = next && !isNaN(next.getTime()) ? next : start && !isNaN(start.getTime()) ? start : null
  // Started, and its next bill date (if any) has come: the run bills it now.
  if ((!start || start <= now) && (!next || next <= now)) return { kind: 'due' }
  // Not started yet (its first bill is its start), or billed and waiting for the next date.
  const when = next && start && start > next ? start : on
  if (!when) return { kind: 'due' }
  // Past its end by then: nothing more to bill.
  if (end && when > end) return { kind: 'none' }
  return { kind: 'on', date: when }
}
