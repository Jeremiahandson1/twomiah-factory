/**
 * Unit tests for booking slot generation.
 *
 * Run with: bun test lib/booking-slots.test.ts
 *
 * These exercise the algorithm in isolation — no DB, no timezones, no
 * I/O. Anything subtle about slot correctness should land here as a
 * regression test before it lands in production.
 */
import { test, expect, describe } from 'bun:test'
import { generateSlots, pickCrewForSlot, type AvailabilityRule, type ServiceConfig } from './booking-slots'

const HOUR = 60
const MON_9_TO_5: AvailabilityRule = {
  userId: 'crew-1', dayOfWeek: 1, startMinute: 9 * HOUR, endMinute: 17 * HOUR, isActive: true,
}
const SERVICE_2HR: ServiceConfig = {
  durationMinutes: 120, bufferBeforeMinutes: 0, bufferAfterMinutes: 0, slotGranularityMinutes: 30,
}

describe('generateSlots — basic happy path', () => {
  test('9-5 availability with 2hr service @ 30min grid → first slot 9:00, last 15:00', () => {
    const slots = generateSlots({
      dayOfWeek: 1,
      service: SERVICE_2HR,
      rules: [MON_9_TO_5],
      blackouts: [], existingBookings: [],
    })
    expect(slots[0].startMinute).toBe(9 * HOUR)
    expect(slots[slots.length - 1].startMinute).toBe(15 * HOUR)
    expect(slots[slots.length - 1].endMinute).toBe(17 * HOUR)
    // 9:00, 9:30, 10:00, ..., 15:00 → 13 slots
    expect(slots.length).toBe(13)
  })

  test('wrong day of week → empty', () => {
    const slots = generateSlots({
      dayOfWeek: 2,  // Tue, rule is Mon
      service: SERVICE_2HR,
      rules: [MON_9_TO_5],
      blackouts: [], existingBookings: [],
    })
    expect(slots).toEqual([])
  })

  test('inactive rule → empty', () => {
    const slots = generateSlots({
      dayOfWeek: 1,
      service: SERVICE_2HR,
      rules: [{ ...MON_9_TO_5, isActive: false }],
      blackouts: [], existingBookings: [],
    })
    expect(slots).toEqual([])
  })

  test('service longer than window → empty', () => {
    const slots = generateSlots({
      dayOfWeek: 1,
      service: { ...SERVICE_2HR, durationMinutes: 600 },
      rules: [MON_9_TO_5],
      blackouts: [], existingBookings: [],
    })
    expect(slots).toEqual([])
  })
})

describe('generateSlots — buffers', () => {
  test('30min buffers before AND after shrink usable window', () => {
    const slots = generateSlots({
      dayOfWeek: 1,
      service: { ...SERVICE_2HR, bufferBeforeMinutes: 30, bufferAfterMinutes: 30 },
      rules: [MON_9_TO_5],
      blackouts: [], existingBookings: [],
    })
    // First slot can't start until 9:30, last service end at 16:30
    expect(slots[0].startMinute).toBe(9.5 * HOUR)
    expect(slots[slots.length - 1].endMinute).toBe(16.5 * HOUR)
  })
})

describe('generateSlots — blackouts', () => {
  test('full-day tenant-wide blackout → empty', () => {
    const slots = generateSlots({
      dayOfWeek: 1,
      service: SERVICE_2HR,
      rules: [MON_9_TO_5],
      blackouts: [{ userId: null, date: '2026-06-08', startMinute: null, endMinute: null }],
      existingBookings: [],
    })
    expect(slots).toEqual([])
  })

  test('partial blackout 12-1pm cuts window into two', () => {
    const slots = generateSlots({
      dayOfWeek: 1,
      service: SERVICE_2HR,
      rules: [MON_9_TO_5],
      blackouts: [{ userId: null, date: '2026-06-08', startMinute: 12 * HOUR, endMinute: 13 * HOUR }],
      existingBookings: [],
    })
    // Morning window 9-12 fits 2hr from 9:00 and 9:30 and 10:00 only
    // Afternoon window 13-17 fits from 13:00 to 15:00
    const starts = slots.map(s => s.startMinute / HOUR)
    expect(starts).toEqual([9, 9.5, 10, 13, 13.5, 14, 14.5, 15])
  })

  test('per-crew blackout only blocks that crew, other crews still bookable', () => {
    const crew1Rule: AvailabilityRule = { userId: 'crew-1', dayOfWeek: 1, startMinute: 9*HOUR, endMinute: 17*HOUR, isActive: true }
    const crew2Rule: AvailabilityRule = { userId: 'crew-2', dayOfWeek: 1, startMinute: 9*HOUR, endMinute: 17*HOUR, isActive: true }
    const slots = generateSlots({
      dayOfWeek: 1,
      service: SERVICE_2HR,
      rules: [crew1Rule, crew2Rule],
      blackouts: [{ userId: 'crew-1', date: '2026-06-08', startMinute: null, endMinute: null }],
      existingBookings: [],
    })
    // crew-1 blacked out all day; crew-2 still fully available
    // → every slot should be available, qualified only by crew-2
    expect(slots[0].qualifyingUserIds).toEqual(['crew-2'])
  })
})

describe('generateSlots — existing bookings', () => {
  test('crew-specific booking blocks that crew at that time', () => {
    const slots = generateSlots({
      dayOfWeek: 1,
      service: SERVICE_2HR,
      rules: [MON_9_TO_5],
      blackouts: [],
      existingBookings: [{
        assignedUserId: 'crew-1',
        startMinute: 11 * HOUR, endMinute: 13 * HOUR,
        status: 'confirmed',
      }],
    })
    // 2hr service. 9:00+2hr=11:00 touches but doesn't overlap booking → OK.
    // 9:30+2hr=11:30 overlaps → blocked. 10:00+2hr=12:00 overlaps → blocked.
    // 13:00+2hr=15:00 — booking ends 13:00, no overlap → OK.
    const starts = slots.map(s => s.startMinute / HOUR)
    expect(starts).toContain(9)
    expect(starts).not.toContain(9.5)
    expect(starts).not.toContain(10)
    expect(starts).not.toContain(11)
    expect(starts).not.toContain(12)
    expect(starts).toContain(13)
  })

  test('booking with buffer eats more time', () => {
    const slots = generateSlots({
      dayOfWeek: 1,
      service: { ...SERVICE_2HR, bufferBeforeMinutes: 30, bufferAfterMinutes: 30 },
      rules: [MON_9_TO_5],
      blackouts: [],
      existingBookings: [{
        assignedUserId: 'crew-1',
        startMinute: 11 * HOUR, endMinute: 13 * HOUR,
        status: 'confirmed',
      }],
    })
    // 30min buffer before+after the booking → 10:30-13:30 fully blocked
    const starts = slots.map(s => s.startMinute / HOUR)
    // Booking 11-13 with 30min buffers becomes blocked window 10:30-13:30.
    // 10:00+2hr=12:00 overlaps blocked window → blocked.
    // 13:30 itself can't be a slot start because buffer-before (30min) would
    //   reach into 13:00-13:30 which is still inside the blocked window.
    // First usable slot post-block is 14:00. Last usable is 14:30 (15:30 end
    //   + 30min after-buffer = 16:00, fits inside 17:00 window).
    expect(starts).not.toContain(10)
    expect(starts).not.toContain(13.5)
    expect(starts).toContain(14)
    expect(starts).toContain(14.5)
  })

  test('cancelled booking does not block slot', () => {
    const slots = generateSlots({
      dayOfWeek: 1,
      service: SERVICE_2HR,
      rules: [MON_9_TO_5],
      blackouts: [],
      existingBookings: [{
        assignedUserId: 'crew-1',
        startMinute: 11 * HOUR, endMinute: 13 * HOUR,
        status: 'cancelled',
      }],
    })
    const starts = slots.map(s => s.startMinute / HOUR)
    expect(starts).toContain(10)  // would have been blocked if confirmed
    expect(starts).toContain(11)
  })
})

describe('generateSlots — multi-crew zone filtering', () => {
  const crew1Rule: AvailabilityRule = { userId: 'crew-1', dayOfWeek: 1, startMinute: 9*HOUR, endMinute: 17*HOUR, isActive: true }
  const crew2Rule: AvailabilityRule = { userId: 'crew-2', dayOfWeek: 1, startMinute: 9*HOUR, endMinute: 17*HOUR, isActive: true }

  test('customer ZIP in crew-1 zone but not crew-2 → only crew-1 qualifies', () => {
    const slots = generateSlots({
      dayOfWeek: 1,
      service: SERVICE_2HR,
      rules: [crew1Rule, crew2Rule],
      blackouts: [], existingBookings: [],
      zone: {
        customerZip: '53703',
        serviceZones: [
          { userId: 'crew-1', zipList: '53703,53704,53705' },
          { userId: 'crew-2', zipList: '53711,53713' },
        ],
      },
    })
    expect(slots[0].qualifyingUserIds).toEqual(['crew-1'])
  })

  test('crew without zone record serves everywhere', () => {
    const slots = generateSlots({
      dayOfWeek: 1,
      service: SERVICE_2HR,
      rules: [crew1Rule, crew2Rule],
      blackouts: [], existingBookings: [],
      zone: {
        customerZip: '99999',
        serviceZones: [
          { userId: 'crew-1', zipList: '53703' },  // crew-2 has no zone — wildcards
        ],
      },
    })
    expect(slots[0].qualifyingUserIds.sort()).toEqual(['crew-2'])
  })
})

describe('generateSlots — concurrency edge: same booking time, different crews', () => {
  test('crew-1 booked but crew-2 free → slot still available, qualified by crew-2 only', () => {
    const crew1Rule: AvailabilityRule = { userId: 'crew-1', dayOfWeek: 1, startMinute: 9*HOUR, endMinute: 17*HOUR, isActive: true }
    const crew2Rule: AvailabilityRule = { userId: 'crew-2', dayOfWeek: 1, startMinute: 9*HOUR, endMinute: 17*HOUR, isActive: true }
    const slots = generateSlots({
      dayOfWeek: 1,
      service: SERVICE_2HR,
      rules: [crew1Rule, crew2Rule],
      blackouts: [],
      existingBookings: [{
        assignedUserId: 'crew-1',
        startMinute: 11 * HOUR, endMinute: 13 * HOUR,
        status: 'confirmed',
      }],
    })
    const slot11 = slots.find(s => s.startMinute === 11 * HOUR)
    expect(slot11?.qualifyingUserIds).toEqual(['crew-2'])
  })
})

describe('generateSlots — group services (capacity > 1)', () => {
  const GROUP_SVC: ServiceConfig = { durationMinutes: 60, bufferBeforeMinutes: 0, bufferAfterMinutes: 0, slotGranularityMinutes: 60, capacityPerSlot: 3 }

  test('slot stays open when bookings < capacity', () => {
    const slots = generateSlots({
      dayOfWeek: 1,
      service: GROUP_SVC,
      rules: [MON_9_TO_5],
      blackouts: [],
      existingBookings: [
        { assignedUserId: 'crew-1', startMinute: 10 * HOUR, endMinute: 11 * HOUR, status: 'confirmed' },
        { assignedUserId: 'crew-1', startMinute: 10 * HOUR, endMinute: 11 * HOUR, status: 'confirmed' },
      ],
    })
    const starts = slots.map(s => s.startMinute / HOUR)
    expect(starts).toContain(10)  // 2 < capacity 3, still open
  })

  test('slot blocks when bookings == capacity', () => {
    const slots = generateSlots({
      dayOfWeek: 1,
      service: GROUP_SVC,
      rules: [MON_9_TO_5],
      blackouts: [],
      existingBookings: [
        { assignedUserId: 'crew-1', startMinute: 10 * HOUR, endMinute: 11 * HOUR, status: 'confirmed' },
        { assignedUserId: 'crew-1', startMinute: 10 * HOUR, endMinute: 11 * HOUR, status: 'confirmed' },
        { assignedUserId: 'crew-1', startMinute: 10 * HOUR, endMinute: 11 * HOUR, status: 'confirmed' },
      ],
    })
    const starts = slots.map(s => s.startMinute / HOUR)
    expect(starts).not.toContain(10)
    expect(starts).toContain(11)  // adjacent slot still open
  })
})

describe('pickCrewForSlot', () => {
  test('prefers real crew over null wildcard', () => {
    expect(pickCrewForSlot(['crew-1', null])).toBe('crew-1')
    expect(pickCrewForSlot([null, 'crew-1'])).toBe('crew-1')
  })
  test('null when no real crew available', () => {
    expect(pickCrewForSlot([null])).toBe(null)
  })
  test('empty list returns null', () => {
    expect(pickCrewForSlot([])).toBe(null)
  })
})
