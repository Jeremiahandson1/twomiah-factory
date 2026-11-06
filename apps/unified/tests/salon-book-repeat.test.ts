// Repeat rules for blocked time (salon parity row 2; Square "Set repetition", Fresha blocked time). The arithmetic only:
// daily, every N weeks, chosen weekdays, until a date or for N times — on the company's own wall clock, so a 12:00 lunch stays 12:00
// across a daylight-saving change. server/crm/salon/bookRepeat.ts.
import { describe, test, expect } from 'bun:test'
import { zonedWallTimeToUtc, tzParts } from '@twomiah/tenant-backend'
import { expandRepeat, repeatRefusal, MAX_OCCURRENCES } from '../server/crm/salon/bookRepeat.ts'

const TZ = 'America/Chicago'
// Mon 2026-10-26 12:00–13:00 Chicago.
const first = { date: '2026-10-26', startHm: '12:00', endHm: '13:00' }
const dates = (r: ReturnType<typeof expandRepeat>) => r.map((o) => tzParts(o.start, TZ).date)
const hm = (d: Date) => { const p = tzParts(d, TZ); return `${String(Math.floor(p.minutes / 60)).padStart(2, '0')}:${String(p.minutes % 60).padStart(2, '0')}` }

describe('salon: blocked-time repeat rules', () => {
  test('no rule is one block, the first', () => {
    const r = expandRepeat(first, null, TZ)
    expect(dates(r)).toEqual(['2026-10-26'])
    expect(r[0].start.getTime()).toBe(zonedWallTimeToUtc('2026-10-26', '12:00', TZ).getTime())
  })

  test('daily for a count', () => {
    expect(dates(expandRepeat(first, { every: 'day', interval: 1, count: 4 }, TZ))).toEqual(['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29'])
  })

  test('every 3 days until a date, the date included', () => {
    expect(dates(expandRepeat(first, { every: 'day', interval: 3, until: '2026-11-04' }, TZ))).toEqual(['2026-10-26', '2026-10-29', '2026-11-01', '2026-11-04'])
  })

  test('every 2 weeks, 3 times', () => {
    expect(dates(expandRepeat(first, { every: 'week', interval: 2, count: 3 }, TZ))).toEqual(['2026-10-26', '2026-11-09', '2026-11-23'])
  })

  test('chosen weekdays: Mon and Thu every week, the first block counted', () => {
    expect(dates(expandRepeat(first, { every: 'week', interval: 1, weekdays: [1, 4], count: 5 }, TZ)))
      .toEqual(['2026-10-26', '2026-10-29', '2026-11-02', '2026-11-05', '2026-11-09'])
  })

  test('chosen weekdays every 2 weeks skip the odd week', () => {
    expect(dates(expandRepeat(first, { every: 'week', interval: 2, weekdays: [1, 3], count: 4 }, TZ)))
      .toEqual(['2026-10-26', '2026-10-28', '2026-11-09', '2026-11-11'])
  })

  test('a wall-clock time survives the end of daylight saving (Nov 1 2026)', () => {
    const r = expandRepeat(first, { every: 'day', interval: 1, count: 8 }, TZ)
    expect(dates(r)).toContain('2026-11-02')
    for (const o of r) { expect(hm(o.start)).toBe('12:00'); expect(hm(o.end)).toBe('13:00') }
    // 168 hours later is NOT the same wall time once the clocks change.
    expect(r[7].start.getTime() - r[0].start.getTime()).not.toBe(7 * 86_400_000)
  })

  test('a block that runs past midnight keeps its length on the wall clock', () => {
    const r = expandRepeat({ date: '2026-10-26', startHm: '22:00', endHm: '23:30' }, { every: 'day', interval: 1, count: 2 }, TZ)
    expect(hm(r[1].start)).toBe('22:00'); expect(hm(r[1].end)).toBe('23:30')
  })

  test('refused in words: no stop, both stops, a bad interval, a past until, too many', () => {
    expect(repeatRefusal({ every: 'day', interval: 1 }, '2026-10-26')).toMatch(/until|times/i)
    expect(repeatRefusal({ every: 'day', interval: 1, count: 3, until: '2026-12-01' }, '2026-10-26')).toMatch(/either|one of/i)
    expect(repeatRefusal({ every: 'day', interval: 0, count: 3 }, '2026-10-26')).toMatch(/interval|every/i)
    expect(repeatRefusal({ every: 'week', interval: 1, count: 3, weekdays: [9] }, '2026-10-26')).toMatch(/weekday/i)
    expect(repeatRefusal({ every: 'day', interval: 1, until: '2026-10-01' }, '2026-10-26')).toMatch(/after/i)
    expect(repeatRefusal({ every: 'day', interval: 1, count: MAX_OCCURRENCES + 1 }, '2026-10-26')).toMatch(/at most|no more than/i)
    expect(repeatRefusal({ every: 'day', interval: 1, until: '2030-01-01' }, '2026-10-26')).toMatch(/at most|no more than|too far|within/i)
    expect(repeatRefusal({ every: 'day', interval: 1, count: 3 }, '2026-10-26')).toBeNull()
  })
})
