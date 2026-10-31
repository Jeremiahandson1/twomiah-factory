// The hours file Twomiah hands to Gusto — ONE builder for every trade. Home care's shift-review hours
// (server/crm/homecare/payroll/gusto.ts) and every other trade's time entries (server/crm/field/payroll.ts) both end here,
// so the columns, the quoting, the sync-log row and the audit row cannot drift apart.
//
// The columns: Gusto's "Run payroll with CSV upload" (Smart Import) matches a file's columns to its own fields, so there
// is no fixed template to match: it reads a person's name (or email) and a regular-hours and an overtime-hours column,
// hours as decimals (1 h 15 min is 1.25), and an employee not eligible for overtime has none.
// Source: https://support.gusto.com/article/999914471000000/Run-payroll-or-pay-contractors-with-CSV-upload/
// (support.gusto.com answered 403 to a script on 2026-10-27, so the exact wording was read through search summaries,
// not the page: the owner should upload one real file in Gusto once and confirm the columns map.)
//
// Row 21 (home care with care_payroll_rules): a Workweeks column for non-exempt staff — each work week's date range, hours and
// earnings, so Gusto can compute the regular rate of pay — and Holiday Hours, Bonus and Reimbursement columns, each only when
// someone in the file has some. Gusto's own header names for these were not published where a script could read them (its
// page is blocked); the names here are ours for Smart Import to map, and the owner confirms them on the first upload.
import { gustoSyncLog } from '../../db/schema/index.ts'
import type { CrmDeps } from '../deps.ts'

export const GUSTO_HOURS_HEADER = ['First Name', 'Last Name', 'Email', 'Regular Hours', 'Overtime Hours', 'Total Hours'] as const

export interface GustoHoursRow {
  firstName: string | null
  lastName: string | null
  email: string | null
  regularHours: number | string
  overtimeHours: number | string
  totalHours: number | string
  /** Home care with care_payroll_rules only: hours at double time. The column appears only when someone has some. */
  doubleTimeHours?: number | string
  /** Row 21: regular hours worked on a holiday, pickup bonus dollars, mileage dollars, and each work week's range, hours and earnings. */
  holidayHours?: number | string
  bonusDollars?: number | string
  reimbursementDollars?: number | string
  workweeks?: Array<{ start: string; end: string; hours: number; earnings: number }>
}

/** A text cell: quoted, and a leading = + - @ made harmless so a name can never run as a spreadsheet formula. */
const text = (v: unknown) => {
  const s = String(v ?? '')
  return `"${(/^[=+\-@\t\r]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`
}
const hours = (v: number | string) => Number(v || 0).toFixed(2)
const mdy = (ymd: string) => `${ymd.slice(5, 7)}/${ymd.slice(8, 10)}/${ymd.slice(0, 4)}`

/** The Workweeks cell: "11/01/2026-11/07/2026: 28.50 hours, $650.00; ..." */
export const workweeksCell = (weeks: GustoHoursRow['workweeks']) => text((weeks ?? []).map((w) => `${mdy(w.start)}-${mdy(w.end)}: ${w.hours.toFixed(2)} hours, $${w.earnings.toFixed(2)}`).join('; '))

export function gustoHoursCsv(rows: GustoHoursRow[], opts: { workweeks?: boolean } = {}): string {
  const withDouble = rows.some((r) => Number(r.doubleTimeHours || 0) > 0)
  const withHoliday = rows.some((r) => Number(r.holidayHours || 0) > 0)
  const withBonus = rows.some((r) => Number(r.bonusDollars || 0) > 0)
  const withReimb = rows.some((r) => Number(r.reimbursementDollars || 0) > 0)
  const withWeeks = opts.workweeks === true && rows.some((r) => (r.workweeks ?? []).length > 0)
  const header = [...GUSTO_HOURS_HEADER, ...(withDouble ? ['Double Overtime Hours'] : []), ...(withHoliday ? ['Holiday Hours'] : []), ...(withBonus ? ['Bonus'] : []), ...(withReimb ? ['Reimbursement'] : []), ...(withWeeks ? ['Workweeks'] : [])]
  const lines: string[] = [header.join(',')]
  for (const r of rows) {
    const cells = [text(r.firstName), text(r.lastName), text(r.email), hours(r.regularHours), hours(r.overtimeHours), hours(r.totalHours)]
    if (withDouble) cells.push(hours(r.doubleTimeHours ?? 0))
    if (withHoliday) cells.push(hours(r.holidayHours ?? 0))
    if (withBonus) cells.push(hours(r.bonusDollars ?? 0))
    if (withReimb) cells.push(hours(r.reimbursementDollars ?? 0))
    if (withWeeks) cells.push(workweeksCell(r.workweeks))
    lines.push(cells.join(','))
  }
  return lines.join('\n')
}

export const gustoHoursFilename = (start: string, end: string) => `gusto-hours-${start}-to-${end}.csv`

/** Download the file, and record it: a gusto_sync_log row (what home care's screen lists) and an audit row (who took it). */
export async function sendGustoHoursCsv(c: any, d: CrmDeps, start: string, end: string, rows: GustoHoursRow[], opts: { workweeks?: boolean } = {}) {
  const me = c.get('user') as { companyId: string; userId?: string }
  await d.db.insert(gustoSyncLog).values({
    companyId: me.companyId, syncType: 'csv_export', status: 'success', payPeriodStart: start, payPeriodEnd: end,
    recordsExported: rows.length, createdById: me.userId || null,
  }).catch(() => {})
  d.audit.log({
    req: c, action: d.audit.ACTIONS.EXPORT, entity: 'gusto-hours', entityName: `${rows.length} people, ${start} to ${end}`,
    metadata: { start, end, people: rows.length }, userId: me.userId, companyId: me.companyId,
  })
  return c.body(gustoHoursCsv(rows, opts), 200, {
    'Content-Type': 'text/csv',
    'Content-Disposition': `attachment; filename="${gustoHoursFilename(start, end)}"`,
  })
}
