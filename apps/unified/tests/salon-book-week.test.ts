// The Book's week view (web/src/crm/pages/salon/bookWeek.ts). Salon live test, 2026-10-25: "The Book shows one day at a
// time". The week is seven calendar days, Sunday first; it is fetched as one window from the first day's midnight to the
// last day's end ON THE COMPANY'S CLOCK, and each appointment is placed on the company's day it starts on — an evening
// booking in Chicago is stored past midnight UTC and must not land on the next day's column.
import { describe, test, expect, afterAll } from 'bun:test'
import { setCompanyTimeZone } from '../../../packages/tenant-ui/src/time/companyClock.ts'
import { weekOf, weekHeading, viewBounds, byDay, isDayComplete } from '../web/src/crm/pages/salon/bookWeek.ts'

afterAll(() => setCompanyTimeZone(undefined))

describe('the book by the week', () => {
  test('a week is the seven days holding the day, Sunday first, across a month end', () => {
    expect(weekOf('2026-10-28')).toEqual(['2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31'])
    expect(weekOf('2026-10-25')[0]).toBe('2026-10-25')
    expect(weekOf('2026-12-31')).toEqual(['2026-12-27', '2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02'])
    expect(weekHeading('2026-10-28')).toBe('Week of Oct 25 – Oct 31, 2026')
    // a half-typed date is not a week (the day view's rule, T20 M5)
    expect(weekHeading('2026-1')).toBeNull()
    expect(isDayComplete('2026-1')).toBe(false)
  })

  test("the window is the company's week, not the browser's or UTC's — over a clock change", () => {
    setCompanyTimeZone('America/Chicago')
    // Sunday 25 Oct starts at 05:00 UTC (CDT); the week ends the instant before Sunday 1 Nov begins — still CDT then.
    expect(viewBounds('week', '2026-10-28')).toEqual({ from: '2026-10-25T05:00:00.000Z', to: '2026-11-01T04:59:59.999Z' })
    // the day view is still one day
    expect(viewBounds('day', '2026-10-28')).toEqual({ from: '2026-10-28T05:00:00.000Z', to: '2026-10-29T04:59:59.999Z' })
    // the week after the change: CST, six hours
    expect(viewBounds('week', '2026-11-04').from).toBe('2026-11-01T05:00:00.000Z')
    expect(viewBounds('week', '2026-11-04').to).toBe('2026-11-08T05:59:59.999Z')
  })

  test("each appointment is on the company's day it starts, in time order; every day is present", () => {
    setCompanyTimeZone('America/Chicago')
    const days = weekOf('2026-10-28')
    const rows = [
      { id: 'late-tue', startTime: '2026-10-28T03:30:00.000Z' }, // Tue 27 Oct, 10:30 PM in Chicago
      { id: 'wed-2pm', startTime: '2026-10-28T19:00:00.000Z' },
      { id: 'wed-9am', startTime: '2026-10-28T14:00:00.000Z' },
      { id: 'next-week', startTime: '2026-11-02T15:00:00.000Z' },
    ]
    const week = byDay(rows, days)
    expect(Object.keys(week)).toEqual(days)
    expect(week['2026-10-27'].map((r) => r.id)).toEqual(['late-tue'])
    expect(week['2026-10-28'].map((r) => r.id)).toEqual(['wed-9am', 'wed-2pm'])
    expect(Object.values(week).flat().some((r) => r.id === 'next-week')).toBe(false)
    expect(week['2026-10-25']).toEqual([])
  })
})
