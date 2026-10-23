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

describe('2 · a booking sits on the company’s day and hour (companyDayKey / companyMinutes)', () => {
  test('8pm in Honolulu (06:00 UTC the next day) is the 22nd at 20:00 there', () => {
    clock.setCompanyTimeZone('Pacific/Honolulu')
    expect(clock.companyDayKey('2026-10-23T06:00:00Z')).toBe('2026-10-22')
    expect(clock.companyMinutes('2026-10-23T06:00:00Z')).toBe(20 * 60)
    clock.setCompanyTimeZone(undefined)
  })
  test('the schedule fetches a day from the company’s midnight to the next (companyDayStart) — the 8pm booking is inside', () => {
    clock.setCompanyTimeZone('Pacific/Honolulu')
    const from = clock.companyDayStart('2026-10-22'), to = clock.companyDayStart('2026-10-23')
    expect([from.toISOString(), to.toISOString()]).toEqual(['2026-10-22T10:00:00.000Z', '2026-10-23T10:00:00.000Z'])
    const at = Date.parse('2026-10-23T06:00:00Z')
    expect(at >= from.getTime() && at < to.getTime()).toBe(true)
    // A clock-change day: Chicago's 1 November 2026 begins at 05:00Z (CDT), the 2nd at 06:00Z (CST).
    clock.setCompanyTimeZone('America/Chicago')
    expect([clock.companyDayStart('2026-11-01').toISOString(), clock.companyDayStart('2026-11-02').toISOString()]).toEqual(['2026-11-01T05:00:00.000Z', '2026-11-02T06:00:00.000Z'])
    // Ahead of UTC: Auckland's 5 April 2026 begins at 00:00 NZDT (11:00Z on the 4th), though by UTC's midnight the clock had gone back.
    clock.setCompanyTimeZone('Pacific/Auckland')
    expect(clock.companyDayStart('2026-04-05').toISOString()).toBe('2026-04-04T11:00:00.000Z')
    clock.setCompanyTimeZone(undefined)
  })
})

describe('2026-10-23 sweep · a typed day and time, today, and a day window are the company\'s (and the agency\'s)', () => {
  const DAY = '@twomiah/tenant-ui/src/time/day'
  const AGENCY = '../web/src/crm/pages/homecare/lib/agencyClock.ts'
  test('8:00 PM typed in Honolulu is 06:00Z the next day; the box reads it back as 20:00 on the 22nd', () => {
    clock.setCompanyTimeZone('Pacific/Honolulu')
    expect(clock.companyMoment('2026-10-22', '20:00').toISOString()).toBe('2026-10-23T06:00:00.000Z')
    expect(clock.companyFromLocalInput('2026-10-22T20:00').toISOString()).toBe('2026-10-23T06:00:00.000Z')
    expect(clock.companyWall('2026-10-23T06:00:00Z')).toEqual({ date: '2026-10-22', time: '20:00' })
    expect(clock.companyLocalInput('2026-10-23T06:00:00Z')).toBe('2026-10-22T20:00')
    expect(clock.companyHHMM('2026-10-23T06:00:00Z')).toBe('20:00')
    expect(clock.companyDayBounds('2026-10-22')).toEqual({ from: '2026-10-22T10:00:00.000Z', to: '2026-10-23T09:59:59.999Z' })
    clock.setCompanyTimeZone(undefined)
  })
  test('today is the company\'s: 10pm on the 22nd in Chicago is the 22nd, though UTC\'s day is the 23rd', async () => {
    const day = await import(DAY) as any
    setSystemTime(new Date('2026-10-23T03:00:00Z'))
    clock.setCompanyTimeZone('America/Chicago')
    expect(day.todayKey()).toBe('2026-10-22')
    const d = clock.companyTodayDate()
    expect([d.getFullYear(), d.getMonth() + 1, d.getDate()]).toEqual([2026, 10, 22])
    clock.setCompanyTimeZone(undefined)
    setSystemTime()
  })
  test('home care: the agency\'s today, its typed times, and an expiry day reached at its midnight', async () => {
    const ag = await import(AGENCY) as any
    setSystemTime(new Date('2026-10-23T03:00:00Z'))
    ag.setAgencyTimezone('America/Chicago')
    expect(ag.agencyToday()).toBe('2026-10-22')
    expect(ag.agencyDayHasBegun('2026-10-22')).toBe(true)
    expect(ag.agencyDayHasBegun('2026-10-23')).toBe(false)
    expect(ag.agencyDaysUntil('2026-10-23')).toBe(1)
    expect(ag.agencyFromLocalInput('2026-10-22T21:30').toISOString()).toBe('2026-10-23T02:30:00.000Z')
    expect(ag.agencyLocalInput('2026-10-23T02:30:00Z')).toBe('2026-10-22T21:30')
    setSystemTime(new Date('2026-10-23T06:00:00Z'))
    expect(ag.agencyToday()).toBe('2026-10-23')
    expect(ag.agencyDayHasBegun('2026-10-23')).toBe(true)
    setSystemTime()
  })
})
