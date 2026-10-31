// Per-client margin and caregiver turnover (item 10, docs/parity/homecare-margin-turnover.md). Raw SQL lives here (RULEBOOK).
import { sql } from 'drizzle-orm'
import { camelRows } from '@twomiah/tenant-backend'
import { inList, type Q } from './homecareCore.ts'

const quoted = (vals: readonly string[]) => sql.raw(vals.map((s) => `'${s.replace(/'/g, "''")}'`).join(', '))

/** The payable shift reviews in the range that name a client, in the order they were worked (date, then scheduled start). */
export async function payableReviewsWithClient(q: Q, companyId: string, start: string, end: string, payable: readonly string[]): Promise<any[]> {
  return camelRows(await q.execute(sql`
    SELECT psr.id, psr.caregiver_id, psr.client_id, to_char(psr.shift_date, 'YYYY-MM-DD') AS shift_date, psr.payable_minutes
      FROM payroll_shift_reviews psr
     WHERE psr.company_id = ${companyId} AND psr.shift_date BETWEEN ${start}::date AND ${end}::date
       AND psr.status IN (${quoted(payable)}) AND psr.payable_minutes > 0
     ORDER BY psr.caregiver_id, psr.shift_date, psr.scheduled_start NULLS LAST, psr.created_at, psr.id`))
}

/** Payable minutes in the range with no client on the review (so they cannot be put on a client's margin). */
export async function payableMinutesWithoutClient(q: Q, companyId: string, start: string, end: string, payable: readonly string[]): Promise<number> {
  const r = camelRows(await q.execute(sql`
    SELECT COALESCE(SUM(payable_minutes), 0)::int AS minutes FROM payroll_shift_reviews
     WHERE company_id = ${companyId} AND client_id IS NULL AND shift_date BETWEEN ${start}::date AND ${end}::date
       AND status IN (${quoted(payable)}) AND payable_minutes > 0`))
  return Number(r[0]?.minutes) || 0
}

/** Mileage paid per client in the range (trips recorded against a client). */
export async function mileagePaidByClient(q: Q, companyId: string, start: string, end: string): Promise<Record<string, number>> {
  const rows = camelRows(await q.execute(sql`
    SELECT client_id, COALESCE(SUM(amount), 0)::float AS paid FROM mileage_entries
     WHERE company_id = ${companyId} AND client_id IS NOT NULL AND date BETWEEN ${start}::date AND ${end}::date GROUP BY client_id`))
  return Object.fromEntries(rows.map((r: any) => [String(r.clientId), Number(r.paid) || 0]))
}

/** The companies' clients with what the billing rule reads, for these ids. */
export async function marginClients(q: Q, companyId: string, ids: string[]): Promise<any[]> {
  if (!ids.length) return []
  return camelRows(await q.execute(sql`
    SELECT c.id, c.first_name, c.last_name, c.referred_by_id, c.care_type_id, c.is_private_pay, c.private_pay_rate, c.private_pay_rate_type
      FROM clients c WHERE c.company_id = ${companyId} AND c.id IN (${inList(ids)})`))
}

/**
 * Every caregiver of the company, current or gone: when they were hired (hire date, else the day the record was made),
 * whether they are still active, and the last day they worked a visit. There is no separation date on file, so a caregiver
 * who is no longer active left on the last day they worked (or, if they never worked, the day their record last changed).
 */
export async function caregiverTenure(q: Q, companyId: string): Promise<any[]> {
  return camelRows(await q.execute(sql`
    SELECT u.id, u.first_name, u.last_name, u.is_active,
           to_char(COALESCE(u.hire_date, u.created_at::date), 'YYYY-MM-DD') AS hired,
           to_char((SELECT MAX(te.start_time)::date FROM time_entries te WHERE te.company_id = ${companyId} AND te.caregiver_id = u.id), 'YYYY-MM-DD') AS last_worked,
           to_char(u.updated_at::date, 'YYYY-MM-DD') AS record_changed
      FROM "user" u
     WHERE u.company_id = ${companyId} AND u.role IN ('caregiver', 'field')
     ORDER BY u.last_name, u.first_name`))
}
