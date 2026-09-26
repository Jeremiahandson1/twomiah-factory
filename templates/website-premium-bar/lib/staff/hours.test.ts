import { describe, expect, test } from 'bun:test'
import { estimatedWagesCents, payrollConfig, payrollCsv, periodFor, summarizeHours, workweekStart } from './hours'
import { localToUtc } from '../hours'

const TZ = 'America/Chicago'
const at = (d: string, t: string) => localToUtc(d, t, TZ)
const cfg = payrollConfig({ weekStart: 1, periodDays: 14, anchor: '2026-09-14' })   // Mondays, every two weeks
const shift = (id: string, pinId: string, d1: string, t1: string, d2: string, t2: string) => ({ id, pinId, startAt: at(d1, t1), endAt: at(d2, t2) })
const NOW = at('2026-10-10', '12:00')

describe('workweeks and pay periods', () => {
  test('a Monday workweek', () => {
    expect(workweekStart('2026-09-27', 1)).toBe('2026-09-21')   // Sunday → the Monday before
    expect(workweekStart('2026-09-21', 1)).toBe('2026-09-21')
    expect(workweekStart('2026-09-27', 0)).toBe('2026-09-27')   // Sunday weeks
  })
  test('two-week periods from the anchor', () => {
    expect(periodFor('2026-09-25', cfg)).toEqual({ start: '2026-09-14', end: '2026-09-28' })
    expect(periodFor('2026-09-28', cfg)).toEqual({ start: '2026-09-28', end: '2026-10-12' })
    expect(periodFor('2026-09-01', cfg)).toEqual({ start: '2026-08-31', end: '2026-09-14' })
  })
  test('a bad anchor falls back to a real week start', () => {
    const c = payrollConfig({ weekStart: 0, anchor: '2026-09-23' })   // a Wednesday, not a Sunday
    expect(new Date(c.anchor + 'T12:00:00Z').getUTCDay()).toBe(0)
  })
})

describe('overtime is weekly, over 40', () => {
  test('45 hours in one week: 40 regular, 5 overtime; the next week starts fresh', () => {
    const s = [
      // Week of Sep 14: five 9-hour shifts = 45 h
      ...['14', '15', '16', '17', '18'].map((d, i) => shift('a' + i, 'jess', `2026-09-${d}`, '14:00', `2026-09-${d}`, '23:00')),
      // Week of Sep 21: 20 h
      shift('b1', 'jess', '2026-09-21', '12:00', '2026-09-21', '22:00'), shift('b2', 'jess', '2026-09-22', '12:00', '2026-09-22', '22:00'),
    ]
    const [p] = summarizeHours(s, TZ, cfg, '2026-09-14', '2026-09-28', NOW)
    expect(p).toMatchObject({ regular: 60, overtime: 5, total: 65, shifts: 7, openShifts: 0 })
    expect(p.weeks).toEqual([{ week: '2026-09-14', regular: 40, overtime: 5 }, { week: '2026-09-21', regular: 20, overtime: 0 }])
  })
  test('no daily overtime: one 14-hour day is 14 regular', () => {
    const [p] = summarizeHours([shift('x', 'sam', '2026-09-15', '10:00', '2026-09-16', '00:00')], TZ, cfg, '2026-09-14', '2026-09-28', NOW)
    expect(p).toMatchObject({ regular: 14, overtime: 0 })
  })
  test('a close that runs past Sunday midnight is split into the next workweek', () => {
    const s = [
      ...['14', '15', '16', '17'].map((d, i) => shift('a' + i, 'dana', `2026-09-${d}`, '14:00', `2026-09-${d}`, '23:30')),   // 38 h
      shift('late', 'dana', '2026-09-20', '20:00', '2026-09-21', '02:00'),   // Sun 8 PM → Mon 2 AM: 4 h this week, 2 h next
    ]
    const [p] = summarizeHours(s, TZ, cfg, '2026-09-14', '2026-09-28', NOW)
    expect(p.weeks).toEqual([{ week: '2026-09-14', regular: 40, overtime: 2 }, { week: '2026-09-21', regular: 2, overtime: 0 }])
  })
  test('people are counted separately', () => {
    const r = summarizeHours([shift('1', 'a', '2026-09-15', '10:00', '2026-09-15', '15:00'), shift('2', 'b', '2026-09-15', '10:00', '2026-09-15', '12:30')], TZ, cfg, '2026-09-14', '2026-09-28', NOW)
    expect(Object.fromEntries(r.map(p => [p.pinId, p.total]))).toEqual({ a: 5, b: 2.5 })
  })
  test('an open shift counts to now and is flagged', () => {
    const [p] = summarizeHours([{ id: 'o', pinId: 'jess', startAt: at('2026-10-10', '08:00'), endAt: null }], TZ, cfg, '2026-09-28', '2026-10-12', NOW)
    expect(p).toMatchObject({ total: 4, openShifts: 1 })
  })
  test('the fall-back night: 1 AM to 3 AM on Nov 1 is three real hours', () => {
    const c7 = payrollConfig({ weekStart: 1, periodDays: 7, anchor: '2026-10-26' })
    const [p] = summarizeHours([shift('dst', 'jess', '2026-11-01', '00:00', '2026-11-01', '02:00')], TZ, c7, '2026-10-26', '2026-11-02', NOW)
    expect(p.total).toBe(3)
  })
})

describe('money and the export', () => {
  test('estimated wages with time and a half', () => {
    expect(estimatedWagesCents({ regular: 40, overtime: 5 }, 1500)).toBe(40 * 1500 + 5 * 2250)
    expect(estimatedWagesCents({ regular: 40, overtime: 5 }, null)).toBeNull()
  })
  test('CSV: one row per person, period end inclusive, formula-safe names', () => {
    const csv = payrollCsv([
      { name: 'Jess Olson', regular: 40, overtime: 5, total: 45, cashTipsCents: 12050, cardTipsCents: 30000, hourlyCents: 725 },
      { name: '=SUM(A1)', regular: 2, overtime: 0, total: 2, cashTipsCents: 0, cardTipsCents: 0, hourlyCents: null },
    ], { start: '2026-09-14', end: '2026-09-28' })
    const lines = csv.trim().split('\n')
    expect(lines[0]).toBe('name,period_start,period_end,regular_hours,overtime_hours,total_hours,cash_tips,card_tips,hourly_rate')
    expect(lines[1]).toBe('Jess Olson,2026-09-14,2026-09-27,40.00,5.00,45.00,120.50,300.00,7.25')
    expect(lines[2].startsWith(`"'=SUM(A1)"`)).toBe(true)
  })
})
