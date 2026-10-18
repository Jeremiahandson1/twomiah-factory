// The free times on one day (server/booking/slots.ts): the premium site's cases (lib/booking-slots.test.ts), moved,
// plus the three faults fixed in the move — a deposit hold blocks, a class counts only its own bookings and is still
// blocked by others, and a booking's own clean-up is kept whichever service is asked about.
import { describe, test, expect } from 'bun:test'
import { freeSlots, pickWho, type HoursWindow, type ServiceRules } from '../server/booking/slots.ts'

const H = 60
const MON = 1
const ANNA_9_TO_5: HoursWindow = { userId: 'anna', dayOfWeek: MON, startMinute: 9 * H, endMinute: 17 * H }
const TWO_HOURS: ServiceRules = { id: 'svc', durationMinutes: 120, bufferBeforeMinutes: 0, bufferAfterMinutes: 0, slotStepMinutes: 30, capacity: 1, driveTimeMinutes: 0 }
const starts = (s: ReturnType<typeof freeSlots>) => s.map((x) => x.startMinute / H)

describe('the grid', () => {
  test('9–5 with a two-hour visit on a half-hour step: 9:00 to 15:00, thirteen times', () => {
    const s = freeSlots({ dayOfWeek: MON, service: TWO_HOURS, hours: [ANNA_9_TO_5], daysOff: [], busy: [] })
    expect(s.length).toBe(13)
    expect(s[0].startMinute).toBe(9 * H)
    expect(s.at(-1)!.startMinute).toBe(15 * H)
    expect(s.at(-1)!.endMinute).toBe(17 * H)
  })

  test('another weekday, or a visit longer than the day: nothing', () => {
    expect(freeSlots({ dayOfWeek: 2, service: TWO_HOURS, hours: [ANNA_9_TO_5], daysOff: [], busy: [] })).toEqual([])
    expect(freeSlots({ dayOfWeek: MON, service: { ...TWO_HOURS, durationMinutes: 600 }, hours: [ANNA_9_TO_5], daysOff: [], busy: [] })).toEqual([])
  })

  test('two windows a day (a lunch break): no time spans the break', () => {
    const hours = [{ ...ANNA_9_TO_5, endMinute: 12 * H }, { ...ANNA_9_TO_5, startMinute: 13 * H }]
    const s = starts(freeSlots({ dayOfWeek: MON, service: { ...TWO_HOURS, durationMinutes: 60 }, hours, daysOff: [], busy: [] }))
    expect(s).toContain(11)
    expect(s).not.toContain(11.5)
    expect(s).not.toContain(12)
    expect(s).toContain(13)
  })

  test('the visit\'s own buffers must fit inside the hours', () => {
    const s = freeSlots({ dayOfWeek: MON, service: { ...TWO_HOURS, bufferBeforeMinutes: 30, bufferAfterMinutes: 30 }, hours: [ANNA_9_TO_5], daysOff: [], busy: [] })
    expect(s[0].startMinute).toBe(9.5 * H)
    expect(s.at(-1)!.startMinute).toBe(14.5 * H)
  })
})

describe('days off', () => {
  test('the whole day, for the business or the person', () => {
    expect(freeSlots({ dayOfWeek: MON, service: TWO_HOURS, hours: [ANNA_9_TO_5], daysOff: [{ userId: null, startMinute: null, endMinute: null }], busy: [] })).toEqual([])
    expect(freeSlots({ dayOfWeek: MON, service: TWO_HOURS, hours: [ANNA_9_TO_5], daysOff: [{ userId: 'anna', startMinute: null, endMinute: null }], busy: [] })).toEqual([])
  })

  test('part of the day', () => {
    const s = starts(freeSlots({ dayOfWeek: MON, service: TWO_HOURS, hours: [ANNA_9_TO_5], daysOff: [{ userId: null, startMinute: 12 * H, endMinute: 13 * H }], busy: [] }))
    expect(s).toEqual([9, 9.5, 10, 13, 13.5, 14, 14.5, 15])
  })

  test("someone else's day off doesn't touch Anna", () => {
    expect(freeSlots({ dayOfWeek: MON, service: TWO_HOURS, hours: [ANNA_9_TO_5], daysOff: [{ userId: 'ben', startMinute: null, endMinute: null }], busy: [] }).length).toBe(13)
  })
})

describe('bookings already made', () => {
  test('a booking takes its time from its person only', () => {
    const hours = [ANNA_9_TO_5, { ...ANNA_9_TO_5, userId: 'ben' }]
    const s = freeSlots({ dayOfWeek: MON, service: TWO_HOURS, hours, daysOff: [], busy: [{ userId: 'anna', startMinute: 10 * H, endMinute: 12 * H }] })
    const at11 = s.find((x) => x.startMinute === 11 * H)!
    expect(at11.who).toEqual(['ben'])
  })

  test('an unassigned booking takes the time from everybody', () => {
    const hours = [ANNA_9_TO_5, { ...ANNA_9_TO_5, userId: 'ben' }]
    const s = starts(freeSlots({ dayOfWeek: MON, service: TWO_HOURS, hours, daysOff: [], busy: [{ userId: null, startMinute: 10 * H, endMinute: 12 * H }] }))
    expect(s).not.toContain(11)
  })

  test("the booking's own clean-up is kept, whichever service is asked about", () => {
    // A two-hour visit 10–12 with an hour's clean-up after it: nothing may start before 13:00.
    const s = starts(freeSlots({ dayOfWeek: MON, service: { ...TWO_HOURS, durationMinutes: 60 }, hours: [ANNA_9_TO_5], daysOff: [], busy: [{ userId: 'anna', startMinute: 10 * H, endMinute: 12 * H, padAfter: 60 }] }))
    expect(s).toContain(9)
    expect(s).not.toContain(12)
    expect(s).not.toContain(12.5)
    expect(s).toContain(13)
  })

  test('the new visit\'s buffers are counted once, not twice', () => {
    // Setup 30 before the new visit; a booking ends at 12. The new visit may start at 12:30, not 13:00.
    const s = starts(freeSlots({ dayOfWeek: MON, service: { ...TWO_HOURS, durationMinutes: 60, bufferBeforeMinutes: 30 }, hours: [ANNA_9_TO_5], daysOff: [], busy: [{ userId: 'anna', startMinute: 10 * H, endMinute: 12 * H }] }))
    expect(s).toContain(12.5)
    expect(s).not.toContain(12)
  })

  test('travel time clears either side', () => {
    const s = starts(freeSlots({ dayOfWeek: MON, service: { ...TWO_HOURS, durationMinutes: 60, driveTimeMinutes: 30 }, hours: [ANNA_9_TO_5], daysOff: [], busy: [{ userId: 'anna', startMinute: 12 * H, endMinute: 13 * H }] }))
    expect(s).toContain(10.5)
    expect(s).not.toContain(11)
    expect(s).not.toContain(13)
    expect(s).toContain(13.5)
  })

  test("the owner's own calendar blocks a business that books \"anyone\"", () => {
    const anyone: HoursWindow = { ...ANNA_9_TO_5, userId: null }
    const s = starts(freeSlots({ dayOfWeek: MON, service: TWO_HOURS, hours: [anyone], daysOff: [], busy: [{ userId: 'owner', startMinute: 10 * H, endMinute: 11 * H }] }))
    expect(s).not.toContain(10)
    expect(s).toContain(11)
  })
})

describe('group services (a class)', () => {
  const CLASS: ServiceRules = { ...TWO_HOURS, id: 'class', durationMinutes: 60, capacity: 3 }
  test('open until full', () => {
    const two = [1, 2].map(() => ({ userId: 'anna', startMinute: 10 * H, endMinute: 11 * H, serviceId: 'class' }))
    expect(starts(freeSlots({ dayOfWeek: MON, service: CLASS, hours: [ANNA_9_TO_5], daysOff: [], busy: two }))).toContain(10)
    const three = [...two, { ...two[0] }]
    expect(starts(freeSlots({ dayOfWeek: MON, service: CLASS, hours: [ANNA_9_TO_5], daysOff: [], busy: three }))).not.toContain(10)
  })

  test("another service's booking still blocks the class's person", () => {
    const s = starts(freeSlots({ dayOfWeek: MON, service: CLASS, hours: [ANNA_9_TO_5], daysOff: [], busy: [{ userId: 'anna', startMinute: 10 * H, endMinute: 11 * H, serviceId: 'other' }] }))
    expect(s).not.toContain(10)
  })
})

describe('service area', () => {
  const hours = [ANNA_9_TO_5, { ...ANNA_9_TO_5, userId: 'ben' }]
  test('someone whose ZIPs don\'t include the customer\'s is left out; no zone serves everywhere', () => {
    const s = freeSlots({ dayOfWeek: MON, service: TWO_HOURS, hours, daysOff: [], busy: [], zones: [{ userId: 'anna', zips: ['53593'] }], customerZip: '53711' })
    expect(s[0].who).toEqual(['ben'])
    const t = freeSlots({ dayOfWeek: MON, service: TWO_HOURS, hours, daysOff: [], busy: [], zones: [{ userId: 'anna', zips: ['53593'] }], customerZip: '53593' })
    expect(t[0].who.sort()).toEqual(['anna', 'ben'])
  })
})

test('a named person is picked before "anyone"', () => {
  expect(pickWho([null, 'anna'])).toBe('anna')
  expect(pickWho([null])).toBe(null)
  expect(pickWho([])).toBe(null)
})
