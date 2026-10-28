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
import { gustoSyncLog } from '../../db/schema/index.ts'
import { OT_WEEKLY_HOURS } from '../homecare/core/payrollPay.ts'
import type { CrmDeps } from '../deps.ts'

export const GUSTO_HOURS_HEADER = ['First Name', 'Last Name', 'Email', 'Regular Hours', 'Overtime Hours', 'Total Hours'] as const

export interface GustoHoursRow {
  firstName: string | null
  lastName: string | null
  email: string | null
  regularHours: number | string
  overtimeHours: number | string
  totalHours: number | string
}

/** A text cell: quoted, and a leading = + - @ made harmless so a name can never run as a spreadsheet formula. */
const text = (v: unknown) => {
  const s = String(v ?? '')
  return `"${(/^[=+\-@\t\r]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`
}
const hours = (v: number | string) => Number(v || 0).toFixed(2)

export function gustoHoursCsv(rows: GustoHoursRow[]): string {
  const lines: string[] = [GUSTO_HOURS_HEADER.join(',')]
  for (const r of rows) lines.push([text(r.firstName), text(r.lastName), text(r.email), hours(r.regularHours), hours(r.overtimeHours), hours(r.totalHours)].join(','))
  return lines.join('\n')
}

export const gustoHoursFilename = (start: string, end: string) => `gusto-hours-${start}-to-${end}.csv`

/**
 * Each Sunday–Saturday week's decimal hours → regular and overtime hours, by the FLSA rule payroll uses: over 40 a week is
 * overtime. In hundredths of an hour (what the file carries), so 39.99 stays 39.99.
 */
export function splitWeeklyHours(weekHours: number[]) {
  const cap = OT_WEEKLY_HOURS * 100
  let regular = 0, overtime = 0
  for (const h of weekHours) {
    const n = Math.max(0, Math.round((Number(h) || 0) * 100))
    regular += Math.min(n, cap)
    overtime += Math.max(n - cap, 0)
  }
  return { regularHours: regular / 100, overtimeHours: overtime / 100, totalHours: (regular + overtime) / 100 }
}

/** Download the file, and record it: a gusto_sync_log row (what home care's screen lists) and an audit row (who took it). */
export async function sendGustoHoursCsv(c: any, d: CrmDeps, start: string, end: string, rows: GustoHoursRow[]) {
  const me = c.get('user') as { companyId: string; userId?: string }
  await d.db.insert(gustoSyncLog).values({
    companyId: me.companyId, syncType: 'csv_export', status: 'success', payPeriodStart: start, payPeriodEnd: end,
    recordsExported: rows.length, createdById: me.userId || null,
  }).catch(() => {})
  d.audit.log({
    req: c, action: d.audit.ACTIONS.EXPORT, entity: 'gusto-hours', entityName: `${rows.length} people, ${start} to ${end}`,
    metadata: { start, end, people: rows.length }, userId: me.userId, companyId: me.companyId,
  })
  return c.body(gustoHoursCsv(rows), 200, {
    'Content-Type': 'text/csv',
    'Content-Disposition': `attachment; filename="${gustoHoursFilename(start, end)}"`,
  })
}
