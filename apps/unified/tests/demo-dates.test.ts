// The demo's dates against the visitor's clock (CI 10/30, 03:30 UTC): the restaurant's Reports page said "not available" because
// the recorded data moved by the VISITOR's day (already the 30th in UTC) while the screens asked for the sample business's day
// (still the 29th in Chicago) — and a report's "this week" starts on a Monday, which a whole-day shift lands on one day in seven.
// Read from the committed restaurant & bar data, with no browser: the store is the demo's whole backend for a read.
import fs from 'node:fs'
import path from 'node:path'
import { describe, test, expect } from 'bun:test'
import { DemoStore } from '../web/demo/store.ts'
import { addDays } from '../web/demo/shift.ts'

const data = JSON.parse(fs.readFileSync(path.join(import.meta.dir, '../demo/public/demo-data/restaurant-bar.json'), 'utf8'))
const REC = data.recordedOn as string
/** A moment on a Chicago calendar day, at a Chicago wall hour (CDT/CST offsets are both covered by -05/-06 here: 10/29 is CDT). */
const chicago = (day: string, hour: number) => new Date(`${day}T${String(hour).padStart(2, '0')}:00:00-05:00`)
const stats = (s: DemoStore, from: string, to: string) => s.read('/api/dashboard/stats', new URLSearchParams({ startDate: from, endDate: to }))

describe('the demo counts its days on the sample business\'s calendar', () => {
  test('the recorded data names its zone, and the recording has the dated reads this test reads', () => {
    expect(data.responses['GET /api/auth/me'].body.company.timeZone).toBe('America/Chicago')
    expect(Object.keys(data.responses).some((k) => k.startsWith('GET /api/register/report?'))).toBe(true)
  })
  test('late evening in Chicago (already tomorrow in UTC): no shift, and the screens\' own dates are answered', () => {
    const s = new DemoStore(data, chicago(REC, 22))
    expect(s.delta).toBe(0)
    expect(stats(s, addDays(REC, -30), REC)?.status).toBe(200)
  })
  test('a later day: every date moves by the days since, and the 30-day stats are still answered', () => {
    const s = new DemoStore(data, chicago(addDays(REC, 5), 12))
    expect(s.delta).toBe(5)
    expect(stats(s, addDays(REC, -25), addDays(REC, 5))?.status).toBe(200)
  })
  test('"this week" from a Monday the shift does not land on is answered with the recorded week', () => {
    const s = new DemoStore(data, chicago(addDays(REC, 5), 12))
    const r = s.read('/api/register/report', new URLSearchParams({ from: addDays(REC, 1), to: addDays(REC, 5) }))
    expect(r?.status).toBe(200)
    expect(r?.body).toBeTruthy()
  })
  test('a read with no dates still needs its own recording: nothing is made up for a path never recorded', () => {
    const s = new DemoStore(data, chicago(REC, 12))
    expect(s.read('/api/never-recorded', new URLSearchParams({ from: REC }))).toBeNull()
    expect(s.read('/api/register/report', new URLSearchParams({ from: REC, location: 'nowhere' }))).toBeNull()
  })
})
