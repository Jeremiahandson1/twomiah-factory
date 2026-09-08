import { describe, expect, test } from 'bun:test'
import {
  evaluate, localToUtc, localDateString, formatTime, formatCountdown, describe as describeStatus,
  openingHoursSpecification, specialOpeningHours, addDays, dayKeyOf, type HoursConfig,
} from './index'

const TZ = 'America/Chicago'

// Bar: Tue–Fri 11 AM – 2 AM, Sat noon – 2 AM, Sun noon – 8 PM, Mon closed.
// Kitchen: Tue–Sat 11 AM – 9 PM (Sat from noon), Sun noon – 7 PM, Mon closed.
const config: HoursConfig = {
  timezone: TZ,
  bar: {
    tue: [{ open: '11:00', close: '02:00' }], wed: [{ open: '11:00', close: '02:00' }],
    thu: [{ open: '11:00', close: '02:00' }], fri: [{ open: '11:00', close: '02:00' }],
    sat: [{ open: '12:00', close: '02:00' }], sun: [{ open: '12:00', close: '20:00' }],
  },
  kitchen: {
    tue: [{ open: '11:00', close: '21:00' }], wed: [{ open: '11:00', close: '21:00' }],
    thu: [{ open: '11:00', close: '21:00' }], fri: [{ open: '11:00', close: '21:00' }],
    sat: [{ open: '12:00', close: '21:00' }], sun: [{ open: '12:00', close: '19:00' }],
  },
  holidays: [
    { date: '2026-12-25', label: 'Christmas', bar: null, kitchen: null },
    { date: '2026-12-31', label: "New Year's Eve", bar: [{ open: '11:00', close: '03:00' }], kitchen: [{ open: '11:00', close: '23:00' }] },
  ],
}

const at = (date: string, time: string) => localToUtc(date, time, TZ)

describe('timezone primitives', () => {
  test('localToUtc respects CDT (-5) and CST (-6)', () => {
    expect(at('2026-07-04', '12:00').toISOString()).toBe('2026-07-04T17:00:00.000Z')
    expect(at('2026-01-15', '12:00').toISOString()).toBe('2026-01-15T18:00:00.000Z')
  })
  test('spring-forward gap (2026-03-08 02:30 does not exist) still yields a sane instant', () => {
    const d = at('2026-03-08', '02:30')
    // Resolves to the same wall-clock hour after the jump (3:30 CDT) or 1:30 CST; either is monotonic with neighbors.
    expect(d.getTime()).toBeGreaterThan(at('2026-03-08', '01:00').getTime())
    expect(d.getTime()).toBeLessThan(at('2026-03-08', '04:00').getTime())
  })
  test('fall-back day (2026-11-01) has 25 hours', () => {
    const start = at('2026-11-01', '00:00'), end = at('2026-11-02', '00:00')
    expect((end.getTime() - start.getTime()) / 3600000).toBe(25)
  })
  test('addDays + dayKeyOf', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(dayKeyOf('2026-09-07')).toBe('mon')
    expect(dayKeyOf('2026-09-11')).toBe('fri')
  })
})

describe('regular hours', () => {
  test('Friday 7:15 PM — bar and kitchen open, different close times', () => {
    const s = evaluate(config, { now: at('2026-09-11', '19:15') })
    expect(s.bar.isOpen).toBe(true)
    expect(s.kitchen.isOpen).toBe(true)
    expect(formatTime(s.bar.closesAt!, TZ)).toBe('2 AM')
    expect(formatTime(s.kitchen.closesAt!, TZ)).toBe('9 PM')
    expect(formatCountdown(s.kitchen.msUntilChange!)).toBe('1h 45m')
    expect(describeStatus(s.kitchen, s.now, TZ)).toBe('Kitchen open — closes 9 PM (1h 45m)')
  })
  test('Friday 10 PM — kitchen closed, bar open till 2', () => {
    const s = evaluate(config, { now: at('2026-09-11', '22:00') })
    expect(s.kitchen.isOpen).toBe(false)
    expect(s.bar.isOpen).toBe(true)
    expect(describeStatus(s.kitchen, s.now, TZ)).toBe('Kitchen closed — opens tomorrow at 12 PM')
  })
  test('midnight crossing: Saturday 1 AM belongs to Friday night', () => {
    const s = evaluate(config, { now: at('2026-09-12', '01:00') })
    expect(s.bar.isOpen).toBe(true)
    expect(s.bar.closesAt!.toISOString()).toBe(at('2026-09-12', '02:00').toISOString())
    expect(s.kitchen.isOpen).toBe(false)
    expect(s.localDate).toBe('2026-09-12')
  })
  test('Saturday 2:00 AM exactly — bar closed, next open is Saturday noon', () => {
    const s = evaluate(config, { now: at('2026-09-12', '02:00') })
    expect(s.bar.isOpen).toBe(false)
    expect(s.bar.opensAt!.toISOString()).toBe(at('2026-09-12', '12:00').toISOString())
  })
  test('Monday (closed all day) — next open is Tuesday 11 AM', () => {
    const s = evaluate(config, { now: at('2026-09-07', '15:00') })
    expect(s.bar.isOpen).toBe(false)
    expect(s.bar.today).toEqual([])
    expect(describeStatus(s.bar, s.now, TZ)).toBe('Bar closed — opens tomorrow at 11 AM')
  })
  test('Sunday 8 PM close is same-day, not next-day', () => {
    const s = evaluate(config, { now: at('2026-09-13', '19:30') })
    expect(s.bar.isOpen).toBe(true)
    expect(s.bar.closesAt!.toISOString()).toBe(at('2026-09-13', '20:00').toISOString())
    expect(evaluate(config, { now: at('2026-09-13', '20:00') }).bar.isOpen).toBe(false)
  })
})

describe('DST', () => {
  test('fall-back night: bar closing 2 AM on 2026-11-01 stays open through the repeated 1 AM hour', () => {
    // Saturday Oct 31 → Sunday Nov 1. 1:30 AM happens twice; both instants are open.
    const firstOneThirty = new Date(at('2026-11-01', '01:30').getTime())
    const s1 = evaluate(config, { now: firstOneThirty })
    expect(s1.bar.isOpen).toBe(true)
    const secondOneThirty = new Date(firstOneThirty.getTime() + 3600000)
    const s2 = evaluate(config, { now: secondOneThirty })
    expect(s2.bar.isOpen).toBe(true)
    // 2:00 AM CST (after fall-back) is closed.
    const twoAmCst = new Date(at('2026-11-01', '00:00').getTime() + 3 * 3600000)
    expect(evaluate(config, { now: twoAmCst }).bar.isOpen).toBe(false)
  })
  test('spring-forward night: Sunday 2026-03-08 03:00 CDT is after the 2 AM close', () => {
    const s = evaluate(config, { now: new Date(at('2026-03-08', '01:59').getTime() + 2 * 60000) })
    expect(s.bar.isOpen).toBe(false)
  })
})

describe('holidays and game days', () => {
  test('Christmas closed, with the next opening after it', () => {
    const s = evaluate(config, { now: at('2026-12-25', '18:00') })
    expect(s.bar.isOpen).toBe(false)
    expect(s.bar.source).toBe('holiday')
    expect(s.bar.label).toBe('Christmas')
    expect(localDateString(s.bar.opensAt!, TZ)).toBe('2026-12-26')
  })
  test("New Year's Eve extended hours (3 AM close) win over regular", () => {
    const s = evaluate(config, { now: at('2027-01-01', '02:30') })
    expect(s.bar.isOpen).toBe(true)
    expect(s.bar.source).toBe('holiday')
    expect(formatTime(s.bar.closesAt!, TZ)).toBe('3 AM')
  })
  test('game-day override beats holiday and regular', () => {
    const s = evaluate(config, {
      now: at('2026-09-13', '10:30'),
      gameDays: [{ date: '2026-09-13', label: 'Packers at noon — doors at 11', bar: [{ open: '11:00', close: '22:00' }] }],
    })
    expect(s.bar.isOpen).toBe(false)
    expect(s.bar.source).toBe('game')
    expect(formatTime(s.bar.opensAt!, TZ)).toBe('11 AM')
    // Kitchen not mentioned in the override → regular Sunday hours.
    expect(s.kitchen.source).toBe('regular')
  })
})

describe('manual overrides from the console', () => {
  test('kitchen closed early tonight — closed now, opens tomorrow, override expires', () => {
    const now = at('2026-09-11', '20:00')
    const s = evaluate(config, { now, manual: { kitchen: { closed: true, note: 'Grill down', until: at('2026-09-12', '06:00') } } })
    expect(s.kitchen.isOpen).toBe(false)
    expect(s.kitchen.source).toBe('manual')
    expect(s.kitchen.note).toBe('Grill down')
    expect(localDateString(s.kitchen.opensAt!, TZ)).toBe('2026-09-12')
    expect(s.bar.isOpen).toBe(true)
  })
  test('closing early at 11 PM — bar shows the earlier close', () => {
    const now = at('2026-09-11', '21:00')
    const s = evaluate(config, { now, manual: { bar: { closesAt: at('2026-09-11', '23:00'), until: at('2026-09-12', '06:00') } } })
    expect(s.bar.isOpen).toBe(true)
    expect(s.bar.source).toBe('manual')
    expect(formatTime(s.bar.closesAt!, TZ)).toBe('11 PM')
    expect(evaluate(config, { now: at('2026-09-11', '23:30'), manual: { bar: { closesAt: at('2026-09-11', '23:00'), until: at('2026-09-12', '06:00') } } }).bar.isOpen).toBe(false)
  })
  test('a stale override (until in the past) is ignored', () => {
    const s = evaluate(config, { now: at('2026-09-12', '13:00'), manual: { kitchen: { closed: true, until: at('2026-09-12', '06:00') } } })
    expect(s.kitchen.isOpen).toBe(true)
    expect(s.kitchen.source).toBe('regular')
  })
})

describe('schema.org', () => {
  test('groups identical days and states closed days explicitly', () => {
    const spec = openingHoursSpecification(config.bar) as any[]
    const tueFri = spec.find(s => s.opens === '11:00' && s.closes === '02:00')
    expect(tueFri.dayOfWeek).toEqual(['https://schema.org/Tuesday', 'https://schema.org/Wednesday', 'https://schema.org/Thursday', 'https://schema.org/Friday'])
    const closed = spec.find(s => s.opens === '00:00' && s.closes === '00:00')
    expect(closed.dayOfWeek).toEqual(['https://schema.org/Monday'])
  })
  test('special hours for holidays', () => {
    const sp = specialOpeningHours(config.holidays!, 'bar') as any[]
    expect(sp).toHaveLength(2)
    expect(sp[0]).toMatchObject({ validFrom: '2026-12-25', opens: '00:00', closes: '00:00' })
    expect(sp[1]).toMatchObject({ validFrom: '2026-12-31', opens: '11:00', closes: '03:00' })
  })
})

describe('formatting', () => {
  test('countdown', () => {
    expect(formatCountdown(30000)).toBe('under a minute')
    expect(formatCountdown(45 * 60000)).toBe('45m')
    expect(formatCountdown(2 * 3600000)).toBe('2h')
    expect(formatCountdown(2 * 3600000 + 14 * 60000)).toBe('2h 14m')
  })
})
