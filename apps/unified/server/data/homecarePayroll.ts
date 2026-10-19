// Home care's payroll SQL: the payable minutes of shift reviews, per caregiver per Sun–Sat workweek, and the rates in
// force. Moved from templates/crm-homecare/backend/src/services/payrollPay.ts (raw SQL lives in server/data/, RULEBOOK
// §2). Every query is the company's; the reads return camelCase.
import { sql } from 'drizzle-orm'
import { camelRows, rowsOf } from '@twomiah/tenant-backend'
import { inList, type Q } from './homecareCore.ts'

const quoted = (vals: readonly string[]) => sql.raw(vals.map((s) => `'${s.replace(/'/g, "''")}'`).join(', '))

/**
 * Payable minutes per caregiver per Sun–Sat workweek between startDate and endDate (inclusive), with weekend minutes
 * and shift counts, for reviews whose status is one of `payable` and whose payable minutes are positive. Optionally
 * one caregiver's. Sorted by caregiver, week.
 */
export async function payableReviewWeeks(q: Q, companyId: string, startDate: string, endDate: string, payable: readonly string[], caregiverId: string | null): Promise<{
  caregiverId: string; weekStart: string; minutes: number; weekendMinutes: number; shifts: number
}[]> {
  return camelRows(await q.execute(sql`
    SELECT psr.caregiver_id,
           to_char(psr.shift_date - EXTRACT(DOW FROM psr.shift_date)::int, 'YYYY-MM-DD') AS week_start,
           SUM(psr.payable_minutes)::int AS minutes,
           COALESCE(SUM(psr.payable_minutes) FILTER (WHERE EXTRACT(DOW FROM psr.shift_date) IN (0, 6)), 0)::int AS weekend_minutes,
           COUNT(*)::int AS shifts
      FROM payroll_shift_reviews psr
     WHERE psr.company_id = ${companyId}
       AND psr.shift_date BETWEEN ${startDate}::date AND ${endDate}::date
       AND psr.status IN (${quoted(payable)})
       AND psr.payable_minutes > 0
       AND (${caregiverId}::text IS NULL OR psr.caregiver_id = ${caregiverId})
     GROUP BY 1, 2
     ORDER BY 1, 2`))
}

/** The named caregivers of the company with their default pay rate and the base / overtime caregiver_rates in force on `onDate`. */
export async function caregiverPayRates(q: Q, companyId: string, caregiverIds: string[], onDate: string): Promise<{
  id: string; firstName: string | null; lastName: string | null; email: string | null; defaultPayRate: string | null; baseRate: string | null; overtimeRate: string | null
}[]> {
  if (!caregiverIds.length) return []
  return camelRows(await q.execute(sql`
    SELECT u.id, u.first_name, u.last_name, u.email, u.default_pay_rate,
           (SELECT r.hourly_rate FROM caregiver_rates r WHERE r.company_id = ${companyId} AND r.caregiver_id = u.id AND r.rate_type = 'base'
               AND r.effective_date <= ${onDate}::date AND (r.end_date IS NULL OR r.end_date >= ${onDate}::date)
             ORDER BY r.effective_date DESC LIMIT 1) AS base_rate,
           (SELECT r.hourly_rate FROM caregiver_rates r WHERE r.company_id = ${companyId} AND r.caregiver_id = u.id AND r.rate_type = 'overtime'
               AND r.effective_date <= ${onDate}::date AND (r.end_date IS NULL OR r.end_date >= ${onDate}::date)
             ORDER BY r.effective_date DESC LIMIT 1) AS overtime_rate
      FROM "user" u WHERE u.company_id = ${companyId} AND u.id IN (${inList(caregiverIds)})`))
}

/** How many of the company's reviews in the range have one of the `statuses`, optionally one caregiver's. */
export async function reviewCountWithStatus(q: Q, companyId: string, startDate: string, endDate: string, statuses: readonly string[], caregiverId: string | null): Promise<number> {
  const r = rowsOf(await q.execute(sql`SELECT COUNT(*)::int AS n FROM payroll_shift_reviews
    WHERE company_id = ${companyId} AND shift_date BETWEEN ${startDate}::date AND ${endDate}::date AND status IN (${quoted(statuses)})
      AND (${caregiverId}::text IS NULL OR caregiver_id = ${caregiverId})`))
  return Number(r[0]?.n) || 0
}
