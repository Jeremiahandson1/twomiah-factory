// The pay week, for every trade: the day it starts is a company setting (company.work_week_start, 0 Sunday … 6 Saturday,
// default Sunday), and overtime is hours over 40 in each such week — the pay run's regular/overtime columns and the Gusto
// file read the SAME rule from here, so they cannot disagree. Daily overtime (hours over 8 or 12 in a day) is not
// calculated; a business in a state that has it is told so, on the pay run, rather than shown a guess.
import { eq } from 'drizzle-orm'
import { storeDateString } from '@twomiah/tenant-backend'
import { company } from '../../db/schema/index.ts'

/** FLSA: hours over this in a work week are overtime. */
export const OT_WEEKLY_HOURS = 40

export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const

/** A day 0–6 (Sunday … Saturday), or null when it is not one. */
export const asWeekday = (v: unknown): number | null => { const n = Number(v); return Number.isInteger(n) && n >= 0 && n <= 6 ? n : null }

/** The date (YYYY-MM-DD) that starts the work week holding `ymd`, a week starting on `startDay`. */
export function workweekStartOn(ymd: string, startDay = 0): string {
  const d = new Date(`${ymd}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() - startDay + 7) % 7))
  return d.toISOString().slice(0, 10)
}

/** States whose law pays overtime by the DAY as well as the week (CA, AK, NV, CO). */
export const DAILY_OVERTIME_STATES: Record<string, string> = { CA: 'California', AK: 'Alaska', NV: 'Nevada', CO: 'Colorado' }

/** The state's two-letter code from what a business typed ("CA", "ca", "California"), or null. */
export function stateCode(state: unknown): string | null {
  const s = String(state ?? '').trim()
  if (!s) return null
  const up = s.toUpperCase()
  if (DAILY_OVERTIME_STATES[up]) return up
  const hit = Object.entries(DAILY_OVERTIME_STATES).find(([, name]) => name.toUpperCase() === up)
  return hit ? hit[0] : up.length === 2 ? up : null
}

/** The notice for the pay run, or null where the state has no daily overtime rule. */
export function dailyOvertimeNotice(state: unknown): string | null {
  const code = stateCode(state)
  const name = code && DAILY_OVERTIME_STATES[code]
  return name
    ? `${name} also requires overtime by the day, not only the week. Twomiah does not calculate daily overtime: the regular and overtime hours here are by the week only (over ${OT_WEEKLY_HOURS} hours), so check them against ${name}'s daily rules before you pay.`
    : null
}

/** The company's work-week start day and state. */
export async function companyWorkWeek(db: any, companyId: string): Promise<{ startDay: number; state: string | null }> {
  const [row] = await db.select({ startDay: company.workWeekStart, state: company.state }).from(company).where(eq(company.id, companyId)).limit(1)
  return { startDay: asWeekday(row?.startDay) ?? 0, state: row?.state ?? null }
}

/**
 * One person's entries → regular, overtime and total hours: each work week's hours over 40 are overtime. Hundredths of
 * an hour, so 39.99 stays 39.99. A week that straddles the period counts only the days inside it.
 */
export function splitByWorkWeek(entries: Array<{ date: Date | string; hours: number | string | null }>, tz: string, startDay: number) {
  const weeks = new Map<string, number>()
  for (const e of entries) {
    const week = workweekStartOn(storeDateString(new Date(e.date), tz), startDay)
    weeks.set(week, (weeks.get(week) ?? 0) + Number(e.hours || 0))
  }
  const cap = OT_WEEKLY_HOURS * 100
  let regular = 0, overtime = 0
  for (const h of weeks.values()) {
    const n = Math.max(0, Math.round(h * 100))
    regular += Math.min(n, cap)
    overtime += Math.max(n - cap, 0)
  }
  return { regularHours: regular / 100, overtimeHours: overtime / 100, totalHours: (regular + overtime) / 100 }
}
