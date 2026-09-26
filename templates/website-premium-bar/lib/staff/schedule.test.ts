import { describe, expect, test } from 'bun:test'
import { closeOn, coverageGaps, formatClock, hoursOf, overlaps, weekPlan } from './schedule'
import type { HoursConfig } from '../hours'

const TZ = 'America/Chicago'
// Tue–Sat 10:30 AM to 1 AM; closed Sunday and Monday; closed Thanksgiving.
const R = [{ open: '10:30', close: '01:00' }]
const cfg: HoursConfig = { timezone: TZ, bar: { tue: R, wed: R, thu: R, fri: R, sat: R }, kitchen: {}, holidays: [{ date: '2026-11-26', label: 'Thanksgiving', bar: null, kitchen: null }] }
const s = (pinId: string, day: string, start: string, end: string) => ({ pinId, day, start, end })

describe('shifts', () => {
  test('a close past midnight: 4 PM to 1 AM is 9 hours', () => { expect(hoursOf(s('a', '2026-09-29', '16:00', '01:00'), TZ)).toBe(9) })
  test('"close" is that day\'s bar close; a closed day has none', () => {
    expect(closeOn(cfg, '2026-09-29')).toBe('01:00')
    expect(closeOn(cfg, '2026-09-28')).toBeNull()             // Monday
    expect(closeOn(cfg, '2026-11-26')).toBeNull()             // Thanksgiving
  })
  test('times read like a person says them', () => {
    expect(formatClock('16:00')).toBe('4 PM'); expect(formatClock('10:30')).toBe('10:30 AM'); expect(formatClock('00:00')).toBe('12 AM'); expect(formatClock('12:15')).toBe('12:15 PM')
  })
})

describe('coverage against the bar hours', () => {
  test('open to 4 and 4 to close covers Tuesday; nothing covers Wednesday', () => {
    const gaps = coverageGaps(cfg, ['2026-09-29', '2026-09-30'], [s('a', '2026-09-29', '10:30', '16:00'), s('b', '2026-09-29', '16:00', '01:00')], TZ)
    expect(gaps).toEqual([{ day: '2026-09-30', from: '10:30', to: '01:00', minutes: 870 }])
  })
  test('a half hour late start and an early leave both show', () => {
    const gaps = coverageGaps(cfg, ['2026-09-29'], [s('a', '2026-09-29', '11:00', '16:00'), s('b', '2026-09-29', '16:00', '00:00')], TZ)
    expect(gaps).toEqual([{ day: '2026-09-29', from: '10:30', to: '11:00', minutes: 30 }, { day: '2026-09-29', from: '00:00', to: '01:00', minutes: 60 }])
  })
  test('overlapping shifts count once; closed days need nobody', () => {
    const gaps = coverageGaps(cfg, ['2026-09-28', '2026-09-29'], [s('a', '2026-09-29', '10:00', '18:00'), s('b', '2026-09-29', '12:00', '20:00'), s('c', '2026-09-29', '19:00', '02:00')], TZ)
    expect(gaps).toEqual([])
  })
})

describe('the week plan', () => {
  test('hours, projected overtime and wages', () => {
    const week = ['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03'].map(d => s('jess', d, '16:00', '01:00'))   // 5 × 9 = 45
    const plan = weekPlan([...week, s('sam', '2026-09-29', '10:30', '16:00')], TZ, new Map([['jess', 1500], ['sam', null]]))
    const j = plan.people.find(p => p.pinId === 'jess')!, m = plan.people.find(p => p.pinId === 'sam')!
    expect(j).toEqual({ pinId: 'jess', hours: 45, overtime: 5, wagesCents: 40 * 1500 + 5 * 2250 })
    expect(m).toMatchObject({ hours: 5.5, overtime: 0, wagesCents: null })
    expect(plan.wagesCents).toBeNull()
  })
  test('double-booking is caught', () => {
    const o = overlaps([s('a', '2026-09-29', '10:30', '16:00'), s('a', '2026-09-29', '15:00', '20:00'), s('b', '2026-09-29', '10:30', '16:00')], TZ)
    expect(o).toHaveLength(1)
    expect(o[0][1].start).toBe('15:00')
  })
})
