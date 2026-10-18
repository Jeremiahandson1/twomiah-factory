// Repeating bookings (server/booking/recurrence.ts): the site's cases (lib/booking-recurrence.test.ts), moved, plus
// what it got wrong — a visit keeps its local time across a clock change, and months step in the business's zone.
import { describe, test, expect } from 'bun:test'
import { expandSeries, describeSeries, MAX_VISITS } from '../server/booking/recurrence.ts'
import { zonedWallTimeToUtc, tzParts } from '@twomiah/tenant-backend'

const TZ = 'America/Chicago'
const at = (date: string, time: string) => zonedWallTimeToUtc(date, time, TZ)
const local = (d: Date) => { const p = tzParts(d, TZ); return `${p.date} ${String(Math.floor(p.minutes / 60)).padStart(2, '0')}:${String(p.minutes % 60).padStart(2, '0')}` }

describe('weekly', () => {
  test('every week, four times; every other week; every third week', () => {
    const base = { frequency: 'weekly' as const, firstStartAt: at('2026-03-03', '10:00'), durationMinutes: 60, timezone: TZ }
    expect(expandSeries({ ...base, intervalCount: 1, occurrencesCount: 4 }).map((v) => v.date)).toEqual(['2026-03-03', '2026-03-10', '2026-03-17', '2026-03-24'])
    expect(expandSeries({ ...base, intervalCount: 2, occurrencesCount: 3 }).map((v) => v.date)).toEqual(['2026-03-03', '2026-03-17', '2026-03-31'])
    expect(expandSeries({ ...base, intervalCount: 3, occurrencesCount: 2 }).map((v) => v.date)).toEqual(['2026-03-03', '2026-03-24'])
  })

  test('10:00 stays 10:00 across the spring and autumn clock changes', () => {
    const spring = expandSeries({ frequency: 'weekly', intervalCount: 1, firstStartAt: at('2026-03-03', '10:00'), durationMinutes: 60, timezone: TZ, occurrencesCount: 3 })
    expect(spring.map((v) => local(v.startAt))).toEqual(['2026-03-03 10:00', '2026-03-10 10:00', '2026-03-17 10:00'])
    const autumn = expandSeries({ frequency: 'weekly', intervalCount: 1, firstStartAt: at('2026-10-27', '10:00'), durationMinutes: 60, timezone: TZ, occurrencesCount: 2 })
    expect(autumn.map((v) => local(v.startAt))).toEqual(['2026-10-27 10:00', '2026-11-03 10:00'])
  })

  test('each visit lasts the service\'s length and is numbered from 1', () => {
    const v = expandSeries({ frequency: 'weekly', intervalCount: 1, firstStartAt: at('2026-03-03', '10:00'), durationMinutes: 90, timezone: TZ, occurrencesCount: 2 })
    expect(v[1].endAt.getTime() - v[1].startAt.getTime()).toBe(90 * 60_000)
    expect(v.map((x) => x.index)).toEqual([1, 2])
  })
})

describe('monthly', () => {
  test('the same day of the month; the 31st falls back to the month\'s last day', () => {
    const v = expandSeries({ frequency: 'monthly', intervalCount: 1, firstStartAt: at('2026-01-31', '09:30'), durationMinutes: 60, timezone: TZ, occurrencesCount: 4 })
    expect(v.map((x) => x.date)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30'])
    expect(v.map((x) => local(x.startAt).slice(11))).toEqual(['09:30', '09:30', '09:30', '09:30'])
  })

  test('a late-evening visit stays on its own date in the business\'s zone (UTC is already the next day)', () => {
    const v = expandSeries({ frequency: 'monthly', intervalCount: 1, firstStartAt: at('2026-05-15', '21:00'), durationMinutes: 60, timezone: TZ, occurrencesCount: 2 })
    expect(v.map((x) => local(x.startAt))).toEqual(['2026-05-15 21:00', '2026-06-15 21:00'])
  })
})

describe('where it stops', () => {
  test('an end date, inclusive', () => {
    const v = expandSeries({ frequency: 'weekly', intervalCount: 1, firstStartAt: at('2026-03-03', '10:00'), durationMinutes: 60, timezone: TZ, untilDate: '2026-03-17' })
    expect(v.map((x) => x.date)).toEqual(['2026-03-03', '2026-03-10', '2026-03-17'])
  })

  test('with neither a count nor an end date, a year of weekly visits', () => {
    expect(expandSeries({ frequency: 'weekly', intervalCount: 1, firstStartAt: at('2026-03-03', '10:00'), durationMinutes: 60, timezone: TZ }).length).toBe(MAX_VISITS)
  })
})

test('the summary reads in the business\'s zone', () => {
  const base = { firstStartAt: at('2026-03-03', '21:30'), durationMinutes: 60, timezone: TZ }
  expect(describeSeries({ ...base, frequency: 'weekly', intervalCount: 2, occurrencesCount: 8 })).toBe('Every other Tuesday, 8 times')
  expect(describeSeries({ ...base, frequency: 'weekly', intervalCount: 1, untilDate: '2026-06-30' })).toBe('Every Tuesday until June 30, 2026')
  expect(describeSeries({ ...base, frequency: 'monthly', intervalCount: 3, occurrencesCount: 1 })).toBe('Every 3 months, 1 time')
})
