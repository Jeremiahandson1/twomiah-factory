import { test, expect, describe } from 'bun:test'
import { expandSeries, summarizeSeries } from './booking-recurrence'

describe('expandSeries', () => {
  test('weekly × 4 produces 4 occurrences spaced 7 days apart', () => {
    const out = expandSeries({
      frequency: 'weekly',
      firstStartAt: new Date('2026-06-09T14:00:00Z'),  // Tue 9am Madison
      durationMinutes: 120,
      occurrencesCount: 4,
    })
    expect(out.length).toBe(4)
    expect(out[0].index).toBe(1)
    expect(out[3].index).toBe(4)
    expect(out[1].startAt.getTime() - out[0].startAt.getTime()).toBe(7 * 86_400_000)
  })

  test('biweekly × 6 spaces 14 days apart', () => {
    const out = expandSeries({
      frequency: 'biweekly',
      firstStartAt: new Date('2026-06-09T14:00:00Z'),
      durationMinutes: 60,
      occurrencesCount: 6,
    })
    expect(out.length).toBe(6)
    expect(out[1].startAt.getTime() - out[0].startAt.getTime()).toBe(14 * 86_400_000)
  })

  test('weekly with intervalCount=3 spaces 21 days apart', () => {
    const out = expandSeries({
      frequency: 'weekly', intervalCount: 3,
      firstStartAt: new Date('2026-06-09T14:00:00Z'),
      durationMinutes: 60,
      occurrencesCount: 3,
    })
    expect(out[1].startAt.getTime() - out[0].startAt.getTime()).toBe(21 * 86_400_000)
  })

  test('monthly preserves day-of-month when possible', () => {
    const out = expandSeries({
      frequency: 'monthly',
      firstStartAt: new Date('2026-06-15T14:00:00Z'),
      durationMinutes: 60,
      occurrencesCount: 3,
    })
    expect(out[0].startAt.getUTCDate()).toBe(15)
    expect(out[1].startAt.getMonth()).toBe(6)  // July
    expect(out[2].startAt.getMonth()).toBe(7)  // Aug
  })

  test('monthly clamps to last day of shorter month (Jan 31 → Feb 28)', () => {
    const out = expandSeries({
      frequency: 'monthly',
      firstStartAt: new Date(2026, 0, 31, 9, 0),  // Jan 31 9am LOCAL
      durationMinutes: 60,
      occurrencesCount: 3,
    })
    expect(out[0].startAt.getDate()).toBe(31)
    expect(out[1].startAt.getMonth()).toBe(1)  // Feb
    // Feb 2026 has 28 days; clamp keeps within month
    expect(out[1].startAt.getDate()).toBeLessThanOrEqual(28)
  })

  test('untilDate caps the series', () => {
    const out = expandSeries({
      frequency: 'weekly',
      firstStartAt: new Date('2026-06-09T14:00:00Z'),
      durationMinutes: 60,
      occurrencesCount: 100,
      untilDate: new Date('2026-07-01T00:00:00Z'),
    })
    // First on Jun 9, next Jun 16, Jun 23, Jun 30; Jul 7 past cap
    expect(out.length).toBeLessThanOrEqual(4)
    for (const o of out) expect(o.startAt.getTime()).toBeLessThanOrEqual(new Date('2026-07-01T00:00:00Z').getTime())
  })

  test('hard cap at 52 when no occurrencesCount / untilDate', () => {
    const out = expandSeries({
      frequency: 'weekly',
      firstStartAt: new Date('2026-06-09T14:00:00Z'),
      durationMinutes: 60,
    })
    expect(out.length).toBe(52)
  })
})

describe('summarizeSeries', () => {
  test('weekly is "Every <day>"', () => {
    const s = summarizeSeries({
      frequency: 'weekly',
      firstStartAt: new Date('2026-06-09T14:00:00Z'),  // Tuesday
      durationMinutes: 60,
      occurrencesCount: 4,
    })
    expect(s).toContain('Every Tuesday')
    expect(s).toContain('4 time')
  })

  test('biweekly is "Every other <day>"', () => {
    const s = summarizeSeries({
      frequency: 'biweekly',
      firstStartAt: new Date('2026-06-09T14:00:00Z'),
      durationMinutes: 60,
      occurrencesCount: 6,
    })
    expect(s).toContain('Every other Tuesday')
  })

  test('monthly with intervalCount=2', () => {
    const s = summarizeSeries({
      frequency: 'monthly', intervalCount: 2,
      firstStartAt: new Date('2026-06-09T14:00:00Z'),
      durationMinutes: 60,
      occurrencesCount: 6,
    })
    expect(s).toContain('Every 2 months')
  })

  test('untilDate variant', () => {
    const s = summarizeSeries({
      frequency: 'weekly',
      firstStartAt: new Date('2026-06-09T14:00:00Z'),
      durationMinutes: 60,
      untilDate: new Date('2026-12-31T00:00:00Z'),
    })
    expect(s).toContain('until December')
  })
})
