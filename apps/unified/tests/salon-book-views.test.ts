// The Book's spans and slots (web/src/crm/pages/salon/bookViews.ts, bookGridMath.ts; salon parity row 1): 3 days, a month, stepping by
// each, the window each fetches on the company's clock, the slot zoom, and drag steps that follow the slot.
import { describe, test, expect, afterAll } from 'bun:test'
import { setCompanyTimeZone } from '../../../packages/tenant-ui/src/time/companyClock.ts'
import { spanDays, shiftSpan, spanBounds, spanHeading, monthCells, monthStart, sameMonth, asSlot, pxPerMinFor, SLOT_CHOICES, DEFAULT_SLOT_MIN } from '../web/src/crm/pages/salon/bookViews.ts'
import { movedStart, resizedEnd, snap, PX_PER_MIN } from '../web/src/crm/pages/salon/bookGridMath.ts'
import { SLOT_CHOICES as SERVER_SLOTS, DEFAULT_SLOT_MIN as SERVER_DEFAULT } from '../server/crm/salon/bookLayout.ts'

afterAll(() => setCompanyTimeZone(undefined))

describe('the Book by three days and by the month', () => {
  test('three days start at the chosen day and cross a month end', () => {
    expect(spanDays('three', '2026-10-30')).toEqual(['2026-10-30', '2026-10-31', '2026-11-01'])
    expect(spanDays('day', '2026-10-30')).toEqual(['2026-10-30'])
    expect(spanDays('week', '2026-10-28')).toHaveLength(7)
  })

  test('a month is whole weeks, Sunday first, holding every day of it', () => {
    const oct = monthCells('2026-10-15')
    expect(oct[0]).toBe('2026-09-27')                 // 1 Oct 2026 is a Thursday
    expect(oct[oct.length - 1]).toBe('2026-10-31')    // the 31st is a Saturday
    expect(oct).toHaveLength(35)
    expect(oct.filter((d) => sameMonth('2026-10-15', d))).toHaveLength(31)
    // six weeks when the month starts late: 1 Aug 2026 is a Saturday, 31 Aug a Monday
    const aug = monthCells('2026-08-10')
    expect([aug[0], aug[aug.length - 1], aug.length]).toEqual(['2026-07-26', '2026-09-05', 42])
    // February of a common year that starts on a Sunday is exactly four weeks (1 Feb 2026 is a Sunday)
    expect(monthCells('2026-02-14')).toHaveLength(28)
    expect(monthStart('2026-10-15')).toBe('2026-10-01')
  })

  test('the buttons step three days, a week, or a month — a month keeping the day number, or the last day when it is shorter', () => {
    expect(shiftSpan('three', '2026-10-30', 1)).toBe('2026-11-02')
    expect(shiftSpan('three', '2026-10-30', -1)).toBe('2026-10-27')
    expect(shiftSpan('week', '2026-10-30', 1)).toBe('2026-11-06')
    expect(shiftSpan('day', '2026-12-31', 1)).toBe('2027-01-01')
    expect(shiftSpan('month', '2026-10-15', 1)).toBe('2026-11-15')
    expect(shiftSpan('month', '2026-01-31', 1)).toBe('2026-02-28')
    expect(shiftSpan('month', '2026-03-31', -1)).toBe('2026-02-28')
    expect(shiftSpan('month', '2024-03-31', -1)).toBe('2024-02-29')
    expect(shiftSpan('month', '2026-12-10', 1)).toBe('2027-01-10')
    expect(shiftSpan('month', '2026-01-10', -1)).toBe('2025-12-10')
  })

  test("each span fetches the company's own days, over a clock change", () => {
    setCompanyTimeZone('America/Chicago')
    // three days from Sat 31 Oct: Chicago leaves daylight time at 2am on Sun 1 Nov, so the window is 73 hours, not 72
    const three = spanBounds('three', '2026-10-31')
    expect(three).toEqual({ from: '2026-10-31T05:00:00.000Z', to: '2026-11-03T05:59:59.999Z' })
    // the October month window starts on the Sunday before the 1st and ends the end of Sat 31 Oct
    expect(spanBounds('month', '2026-10-15')).toEqual({ from: '2026-09-27T05:00:00.000Z', to: '2026-11-01T04:59:59.999Z' })
    setCompanyTimeZone(undefined)
  })

  test('headings: three days and the month; nothing while a date is half typed', () => {
    expect(spanHeading('month', '2026-10-15')).toBe('October 2026')
    expect(spanHeading('three', '2026-10-30')).toBe('Oct 30 – Nov 1, 2026')
    expect(spanHeading('month', '2026-1')).toBeNull()
    expect(spanHeading('day', '2026-10-30')).toBeNull()
  })
})

describe('the time-slot interval', () => {
  test('5, 10, 15 and 30 minutes; anything else is 15; the screen and the server offer the same', () => {
    expect([...SLOT_CHOICES]).toEqual([5, 10, 15, 30])
    expect([...SERVER_SLOTS]).toEqual([...SLOT_CHOICES])
    expect(SERVER_DEFAULT).toBe(DEFAULT_SLOT_MIN)
    expect([asSlot(10), asSlot('30'), asSlot(7), asSlot(null), asSlot(undefined)]).toEqual([10, 30, 15, 15, 15])
  })

  test('a finer slot is drawn taller per minute, and the default keeps the grid as it was', () => {
    expect(pxPerMinFor(15)).toBe(PX_PER_MIN)
    expect(pxPerMinFor(5)).toBeGreaterThan(pxPerMinFor(10))
    expect(pxPerMinFor(10)).toBeGreaterThan(pxPerMinFor(15))
    expect(pxPerMinFor(15)).toBeGreaterThan(pxPerMinFor(30))
    // each slot is a row 15-25px tall whatever the interval
    for (const s of SLOT_CHOICES) { const h = s * pxPerMinFor(s); expect(h).toBeGreaterThanOrEqual(15); expect(h).toBeLessThanOrEqual(25) }
  })

  test('a drag steps by the slot: 5-minute steps move a card 5 minutes, 30-minute steps 30', () => {
    const ppm5 = pxPerMinFor(5), ppm30 = pxPerMinFor(30)
    // 9:00 card dragged down by about 12 minutes of screen
    expect(movedStart(9 * 60, 60, 12 * ppm5, ppm5, 5)).toBe(9 * 60 + 10)
    expect(movedStart(9 * 60, 60, 12 * ppm30, ppm30, 30)).toBe(9 * 60)       // 12 minutes is under half a 30-minute slot
    expect(movedStart(9 * 60, 60, 20 * ppm30, ppm30, 30)).toBe(9 * 60 + 30)
    expect(movedStart(9 * 60, 60, 12 * PX_PER_MIN)).toBe(9 * 60 + 15)        // the old default is unchanged
    // the bottom edge steps the same way and never makes a card shorter than the slot (up to 15 minutes)
    expect(resizedEnd(9 * 60, 10 * 60, 7 * ppm5, ppm5, 5)).toBe(10 * 60 + 5)
    expect(resizedEnd(9 * 60, 10 * 60, -200, ppm5, 5)).toBe(9 * 60 + 5)
    expect(resizedEnd(9 * 60, 10 * 60, -500, PX_PER_MIN)).toBe(9 * 60 + 15)
    expect(snap(9 * 60 + 7, 5)).toBe(9 * 60 + 5)
  })
})

describe('dragging the team into order', () => {
  test('moveItem moves one item and leaves the list alone', async () => {
    const { moveItem } = await import('../web/src/crm/pages/salon/bookViews.ts')
    const list = ['a', 'b', 'c', 'd']
    expect(moveItem(list, 0, 2)).toEqual(['b', 'c', 'a', 'd'])
    expect(moveItem(list, 3, 0)).toEqual(['d', 'a', 'b', 'c'])
    expect(moveItem(list, 1, 99)).toEqual(['a', 'c', 'd', 'b'])
    expect(moveItem(list, 9, 0)).toEqual(list)
    expect(list).toEqual(['a', 'b', 'c', 'd'])
  })
})
