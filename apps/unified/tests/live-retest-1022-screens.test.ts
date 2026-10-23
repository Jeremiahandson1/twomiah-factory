// The live retest's screen rules (2026-10-22) that are plain functions — no DOM, no database (live-retest-1022.test.ts is
// the server; the screens were clicked in a browser too):
//   8 a moment on the customer's quote page is printed as the COMPANY's day and time, whatever the reader's clock says
//   4 the expense totals' periods are the company's months
import { describe, test, expect, setSystemTime } from 'bun:test'
// Path strings, as the screen tests import the shared .tsx (the server's tsconfig has no JSX).
const COMMON = '@twomiah/tenant-ui/src/portal/common'
const EXPENSES = '@twomiah/tenant-ui/src/people/ExpensesPage'
const { formatWhen, formatWhenTime } = await import(COMMON) as any
const { periodRange } = await import(EXPENSES) as any

// 8:30pm on 22 October in Chicago is 01:30 on the 23rd in UTC — the reader below is wherever the test runs.
const EVENING = '2026-10-23T01:30:00.000Z'

describe('8 · a moment, on the company’s clock', () => {
  test('approved at 8:30pm in Chicago reads the 22nd, not UTC’s 23rd', () => {
    expect(formatWhen(EVENING, 'America/Chicago')).toBe(new Date(Date.UTC(2026, 9, 22, 12)).toLocaleDateString(undefined, { timeZone: 'UTC' }))
    expect(formatWhen(EVENING, 'Europe/Berlin')).toBe(new Date(Date.UTC(2026, 9, 23, 12)).toLocaleDateString(undefined, { timeZone: 'UTC' }))
  })
  test('a midnight-UTC calendar day keeps its own day in any zone (a typed payment date)', () => {
    expect(formatWhen('2026-10-22T00:00:00.000Z', 'America/Chicago')).toBe(new Date(2026, 9, 22).toLocaleDateString())
  })
  test('the signature time names the company’s zone, and does not fall back to the reader’s clock', () => {
    const s = formatWhenTime(EVENING, 'America/Chicago')
    expect(s).toContain('8:30')
    expect(s).toContain('CDT')
    expect(s).toContain('22')
  })
  test('nothing in, nothing out', () => {
    expect([formatWhen(null), formatWhen(''), formatWhenTime(undefined), formatWhen('not a date')]).toEqual(['', '', '', ''])
  })
})

describe('4 · the expense periods', () => {
  test('this month, last month (across a year), this year, all time', () => {
    expect(periodRange('month', undefined, '2026-10-22')).toEqual({ startDate: '2026-10-01', endDate: '2026-10-31' })
    expect(periodRange('last_month', undefined, '2026-01-15')).toEqual({ startDate: '2025-12-01', endDate: '2025-12-31' })
    expect(periodRange('month', undefined, '2028-02-10')).toEqual({ startDate: '2028-02-01', endDate: '2028-02-29' })
    expect(periodRange('year', undefined, '2026-10-22')).toEqual({ startDate: '2026-01-01', endDate: '2026-12-31' })
    expect(periodRange('all', undefined, '2026-10-22')).toEqual({})
  })
})

// ── The admin screens' clock (packages/tenant-ui time/companyClock.ts, fed by the auth provider) ─────────────────────
const CLOCK = '@twomiah/tenant-ui/src/time/companyClock'
const UI = '@twomiah/tenant-ui/src/invoicing/ui'
const clock = await import(CLOCK) as any
const ui = await import(UI) as any
const usDay = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString(undefined, { timeZone: 'UTC' })

describe('1 · admin screens print a stored moment on the company’s clock', () => {
  test('the quote timeline’s "Approved" (dateTime) and a document’s day (instantDay) read the company’s 22nd', () => {
    clock.setCompanyTimeZone('America/Chicago')
    expect(ui.dateTime(EVENING)).toContain('8:30')
    expect(ui.dateTime(EVENING)).toContain(usDay(2026, 10, 22))
    expect(ui.instantDay(EVENING)).toBe(usDay(2026, 10, 22))
    // A calendar day is still the day it names (a due date), whatever the zone.
    expect(ui.dateOnly('2026-10-22T00:00:00.000Z')).toBe(new Date(2026, 9, 22).toLocaleDateString())
    expect(clock.whenDate('2026-10-22T00:00:00.000Z')).toBe(usDay(2026, 10, 22))
  })
  test('no zone named (signed out): the browser’s, as before; a made-up zone is ignored', () => {
    clock.setCompanyTimeZone('Not/AZone')
    expect(clock.companyTimeZone()).toBeUndefined()
    clock.setCompanyTimeZone(undefined)
    expect(ui.dateTime(EVENING)).toBe(new Date(EVENING).toLocaleString())
  })
})

describe('2 · "past due" on the screens is the company’s day too (isPastDay)', () => {
  test('10pm on the due day in Chicago: not past; 1am the next day: past', () => {
    clock.setCompanyTimeZone('America/Chicago')
    setSystemTime(new Date('2026-10-23T03:00:00Z'))
    expect(ui.isPastDay('2026-10-22')).toBe(false)
    expect(ui.isPastDay('2026-10-21T00:00:00.000Z')).toBe(true)
    setSystemTime(new Date('2026-10-23T06:00:00Z'))
    expect(ui.isPastDay('2026-10-22')).toBe(true)
    setSystemTime()
    clock.setCompanyTimeZone(undefined)
  })
})
