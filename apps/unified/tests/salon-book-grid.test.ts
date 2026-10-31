// The Book's time grid arithmetic (web/src/crm/pages/salon/bookGridMath.ts): what a card is made of (work / processing / work), where a
// dragged card lands, and how overlapping cards share a column. The server's side of the grid — blocked time, clashes — is
// tests/salon-book-blocks.test.ts and salon-processing-time.test.ts.
import { describe, test, expect } from 'bun:test'
import { piecesFor, snap, gridRange, lanes, movedStart, resizedEnd, columnAt, hhmm, serviceHue, PX_PER_MIN } from '../web/src/crm/pages/salon/bookGridMath.ts'

describe('the Book as a time grid', () => {
  test('a card with processing time is hands-on work, the gap, then work again; without one it is a single piece', () => {
    expect(piecesFor(600, 720)).toEqual([{ start: 600, end: 720, kind: 'work' }])
    expect(piecesFor(600, 720, { afterMin: 30, min: 60 })).toEqual([
      { start: 600, end: 630, kind: 'work' }, { start: 630, end: 690, kind: 'processing' }, { start: 690, end: 720, kind: 'work' }])
    // processing from the very start; a gap that runs to the end leaves no trailing work
    expect(piecesFor(600, 660, { afterMin: 0, min: 60 })).toEqual([{ start: 600, end: 660, kind: 'processing' }])
    // a gap that starts after the card ends is ignored
    expect(piecesFor(600, 630, { afterMin: 45, min: 10 })).toEqual([{ start: 600, end: 630, kind: 'work' }])
    expect(piecesFor(600, 630, { afterMin: null, min: null })).toEqual([{ start: 600, end: 630, kind: 'work' }])
  })

  test('a drag lands on the nearest quarter hour, inside the day', () => {
    expect(snap(607)).toBe(600)
    expect(snap(608)).toBe(615)
    // 66px down at 1.1 px/min is an hour
    expect(movedStart(600, 60, 66)).toBe(660)
    expect(movedStart(600, 60, 66 + 3)).toBe(660)                // 3px is under a snap step
    expect(movedStart(600, 60, -100000)).toBe(0)
    expect(movedStart(600, 60, 100000)).toBe(24 * 60 - 60)       // the card still ends inside the day
    expect(resizedEnd(600, 660, 33)).toBe(690)
    expect(resizedEnd(600, 660, -1000)).toBe(615)                // never shorter than a quarter hour
    expect(PX_PER_MIN).toBeGreaterThan(0.5)
  })

  test('the grid shows the working hours and stretches for an early or late card; the column under a pointer is found', () => {
    expect(gridRange([])).toEqual({ from: 480, to: 1140 })
    expect(gridRange([{ start: 7 * 60 + 30, end: 21 * 60 + 10 }])).toEqual({ from: 420, to: 22 * 60 })
    expect(columnAt(150, [{ left: 0, right: 100 }, { left: 100, right: 200 }])).toBe(1)
    expect(columnAt(-5, [{ left: 0, right: 100 }, { left: 100, right: 200 }])).toBe(0)
    expect(columnAt(900, [{ left: 0, right: 100 }, { left: 100, right: 200 }])).toBe(1)
    expect(columnAt(5, [])).toBe(-1)
    expect(hhmm(605)).toBe('10:05')
  })

  test('overlapping cards in one column sit side by side; separate ones keep the whole width', () => {
    const out = lanes([{ id: 'a', start: 600, end: 720 }, { id: 'b', start: 630, end: 660 }, { id: 'c', start: 720, end: 750 }, { id: 'd', start: 640, end: 700 }])
    const by = Object.fromEntries(out.map((o) => [o.id, o]))
    expect([by.a.lane, by.a.lanes]).toEqual([0, 3])
    expect([by.b.lane, by.b.lanes]).toEqual([1, 3])
    expect([by.d.lane, by.d.lanes]).toEqual([2, 3])
    expect([by.c.lane, by.c.lanes]).toEqual([0, 1])
  })

  test('a service keeps its colour', () => {
    expect(serviceHue('Full Colour')).toBe(serviceHue('Full Colour'))
    expect(serviceHue('Full Colour')).not.toBe(serviceHue('Cut'))
    expect(serviceHue(null)).toBe(0)
  })
})
