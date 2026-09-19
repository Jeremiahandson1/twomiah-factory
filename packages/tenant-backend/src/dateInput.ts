// What a typed date is allowed to be — ONE set of rules for every CRM.
//
// A date box takes four digits for the year, so 2099 and 9999 are one keystroke away from 2026, and nothing
// downstream ever questions them. The damage is quiet: a 2099 time entry dropped out of the 30-day Reports
// figure entirely, so a month with 22.5 hours in it read 7.5 (T29 L1). The same four digits go into an expense,
// a job's schedule and a quote's expiry (T30 L1).
//
// There are exactly two kinds of typed date here, and they need opposite rules:
//
//   hasHappened  — the record is of something already done: hours worked, money spent. A date in the future is
//                  always a typo. One day of slack, because a date-only string is read at UTC midnight and a
//                  caller whose local day already runs ahead of UTC would otherwise be refused their own today.
//
//   withinHorizon — the record is a PLAN: a job's schedule, a quote's expiry, an invoice's due date. The future
//                  is the whole point, so the only question is whether the year is plausible. Ten years is well
//                  beyond any real schedule or payment term and still catches every mistyped century.
//
// Anything free-form (a document's type, a note) is not a date and is not governed here.

export const DAY_MS = 24 * 60 * 60 * 1000
/** A date-only string is read at UTC midnight; UTC+14 is the furthest a caller's own day can run ahead. */
export const FUTURE_SLACK_MS = DAY_MS
export const MAX_PLAN_YEARS = 10

const ms = (v: unknown) => new Date(String(v)).getTime()

/** True unless the date is in the future. An unparseable value is left to whatever validates the format. */
export function hasHappened(v: unknown): boolean {
  if (!v) return true
  const t = ms(v)
  return isNaN(t) || t <= Date.now() + FUTURE_SLACK_MS
}

/** True unless the date is further ahead than any real plan. Past dates are none of this rule's business. */
export function withinHorizon(v: unknown, years = MAX_PLAN_YEARS): boolean {
  if (!v) return true
  const t = ms(v)
  if (isNaN(t)) return true
  const limit = new Date()
  limit.setFullYear(limit.getFullYear() + years)
  return t <= limit.getTime()
}

/** The one sentence a person reads when a plan date is centuries out. */
export const horizonMessage = (field: string, years = MAX_PLAN_YEARS) =>
  `${field} is too far ahead — pick a date within ${years} years. Check the year.`
