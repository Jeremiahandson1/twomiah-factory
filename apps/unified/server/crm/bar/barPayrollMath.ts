/**
 * The pay file's arithmetic, pure and tested (tests/bar-payroll-export.test.ts). The database side is barPayroll.ts.
 *
 * OVERTIME RULE (the one stated on the Payroll screen and in the docs): hours worked beyond the venue's weekly threshold
 * (40 unless the venue sets another) in a work week are overtime. The work week starts on the company's work-week day
 * (company.work_week_start, Sunday unless set). Hours count in the order they were worked: a week that began before the
 * pay period brings its earlier hours along, so the 40 is reached on the right day; hours of a week still running past the
 * period's last day are not in this period. DAILY overtime (over 8 or 12 hours in a day, as California, Alaska, Nevada and
 * Colorado require) is NOT calculated, and the screen says so. Gusto and ADP apply the overtime pay rate (1.5x) themselves:
 * the file carries hours, never wages.
 */
import { storeDateString } from '@twomiah/tenant-backend'
import { workweekStartOn } from '../payrollExport/workWeek.ts'

export const DEFAULT_OVERTIME_AFTER = 40
export const MIN_OVERTIME_AFTER = 1
export const MAX_OVERTIME_AFTER = 80

export interface HourEntry { date: Date | string; hours: number | string | null }
export interface HourSplit { regularHours: number; overtimeHours: number; totalHours: number }

/**
 * `entries` must hold the work weeks' earlier hours too (from the start of the week the period begins in); only entries whose
 * company-clock date is inside from..to (YYYY-MM-DD, both included) are counted in the answer. Hundredths of an hour throughout.
 */
export function splitHours(entries: HourEntry[], tz: string, startDay: number, overtimeAfter: number, from: string, to: string): HourSplit {
  const cap = Math.round(overtimeAfter * 100)
  const dated = entries
    .map((e) => ({ at: new Date(e.date).getTime(), day: storeDateString(new Date(e.date), tz), n: Math.max(0, Math.round(Number(e.hours || 0) * 100)) }))
    .sort((a, b) => a.at - b.at)
  const weekTotal = new Map<string, number>()
  let regular = 0, overtime = 0
  for (const e of dated) {
    const week = workweekStartOn(e.day, startDay)
    const before = weekTotal.get(week) ?? 0
    weekTotal.set(week, before + e.n)
    if (e.day < from || e.day > to) continue
    const room = Math.max(0, cap - before)
    const reg = Math.min(e.n, room)
    regular += reg; overtime += e.n - reg
  }
  return { regularHours: regular / 100, overtimeHours: overtime / 100, totalHours: (regular + overtime) / 100 }
}

/** Is `v` a threshold a venue may set (whole or quarter hours, 1 to 80)? */
export function overtimeAfterRefusal(v: unknown): string | null {
  const n = Number(v)
  if (typeof v === 'boolean' || v === '' || v === null || !Number.isFinite(n)) return 'Overtime starts after a number of hours a week, like 40.'
  if (n < MIN_OVERTIME_AFTER || n > MAX_OVERTIME_AFTER) return `Overtime can start after ${MIN_OVERTIME_AFTER} to ${MAX_OVERTIME_AFTER} hours a week.`
  if (Math.round(n * 4) !== n * 4) return 'Overtime starts after whole or quarter hours, like 40 or 37.5.'
  return null
}

// ─── The three files ────────────────────────────────────────────────────────────────────────────────────────

export interface PayPerson {
  userId: string; name: string; firstName: string | null; lastName: string | null; email: string | null
  regularHours: number; overtimeHours: number; totalHours: number
  /** Everything the person earned in tips for the period, once: card and register cash tips, declared cash, tips from another register, after the pool and the tip-outs. */
  tipsTotalCents: number
  /** Of that, already in their hand as cash (register cash tips, declared cash). */
  cashInHandCents: number
  /** What is left to pay on the paycheck: tipsTotalCents - cashInHandCents. Negative: they hold more cash than their share. */
  paycheckTipsCents: number
  tipOutPaidCents: number; tipOutReceivedCents: number; poolShareCents: number
  /** The venue's number for the person in ADP (File #), when it has one. */
  adpFileNumber: string | null
}

/** A text cell: quoted, a leading = + - @ made harmless so a name can never run as a spreadsheet formula. */
export const cell = (v: unknown) => {
  const s = String(v ?? '')
  return `"${(/^[=+\-@\t\r]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`
}
export const dollars = (cents: number) => `${cents < 0 ? '-' : ''}${Math.floor(Math.abs(cents) / 100)}.${String(Math.abs(cents) % 100).padStart(2, '0')}`
const hrs = (n: number) => n.toFixed(2)

export const CSV_HEADER = ['Name', 'Email', 'Regular Hours', 'Overtime Hours', 'Total Hours', 'Total Tips', 'Cash Tips Already Received', 'Tips To Pay On Paycheck', 'Tipped Out', 'Tip-Out Received', 'Pool Share'] as const

/** The plain file: everything the screen shows, one row per person. */
export function plainCsv(people: PayPerson[]): string {
  const lines: string[] = [CSV_HEADER.join(',')]
  for (const p of people) {
    lines.push([cell(p.name), cell(p.email), hrs(p.regularHours), hrs(p.overtimeHours), hrs(p.totalHours), dollars(p.tipsTotalCents), dollars(p.cashInHandCents), dollars(p.paycheckTipsCents), dollars(p.tipOutPaidCents), dollars(p.tipOutReceivedCents), dollars(p.poolShareCents)].join(','))
  }
  return lines.join('\n')
}

export interface AdpSettings { companyCode: string; batchId: string; tipEarningsCode: string }
/** Column layout of ADP's "EPI" paydata import as the 7shifts help page lists it (ADP's own spec was not read). */
export const ADP_HEADER = ['Co Code', 'Batch ID', 'File #', 'Employee Name', 'Temp Dept', 'Temp Rate', 'Reg Hours', 'O/T Hours', 'Hours 3 Code', 'Hours 3 Amount', 'Hours 4 Code', 'Hours 4 Amount', 'Earnings 5 Code', 'Earnings 5 Amount'] as const

/** The ADP file: hours in Reg Hours / O/T Hours, the paycheck tips in Earnings 5 under the venue's tip earnings code. */
export function adpCsv(people: PayPerson[], s: AdpSettings): string {
  const lines: string[] = [ADP_HEADER.join(',')]
  for (const p of people) {
    const tips = p.paycheckTipsCents > 0
    lines.push([cell(s.companyCode), cell(s.batchId), cell(p.adpFileNumber), cell(p.name), '', '', hrs(p.regularHours), hrs(p.overtimeHours), '', '', '', '', tips ? cell(s.tipEarningsCode) : '', tips ? dollars(p.paycheckTipsCents) : ''].join(','))
  }
  return lines.join('\n')
}

/** ADP's file name as the help pages give it: EPI, the company code, then the batch. */
export const adpFilename = (s: AdpSettings) => `EPI${s.companyCode}${s.batchId}.csv`
export const plainFilename = (from: string, to: string) => `pay-period-${from}-to-${to}.csv`
