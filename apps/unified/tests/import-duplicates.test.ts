// Settings › Import's two duplicate choices, the same for every type (live bistro check, 2026-10-25): "Skip duplicate
// records" is ticked by default, yet re-running a file added every space, menu package and event again (only invoices
// read it). Contacts keep their own rule: never added twice, blanks filled in.
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { bootFood } from './foodKit.ts'

let k: Awaited<ReturnType<typeof bootFood>>
const FEATURES = ['contacts', 'invoices', 'dashboard', 'projects', 'jobs', 'event_bookings', 'event_spaces', 'catering_menus']

beforeAll(async () => { k = await bootFood({ vertical: 'restaurant', features: FEATURES }) }, 60_000)
afterAll(() => k.restore())

async function upload(type: string, csv: string, options: Record<string, string> = {}) {
  const fd = new FormData()
  fd.append('file', new File([csv], type + '.csv', { type: 'text/csv' }))
  for (const [key, v] of Object.entries(options)) fd.append(key, v)
  const res = await k.t.call('/api/import/' + type, { method: 'POST', body: fd, headers: { Authorization: `Bearer ${k.tokens.owner}`, host: 'bar.test' } })
  expect(res.status).toBe(200)
  return (await res.json()) as any
}
const count = async (path: string, name: string) => {
  const r = await k.O('GET', path)
  const rows = Array.isArray(r.json) ? r.json : r.json.data
  return rows.filter((x: any) => (x.name ?? x.title) === name).length
}

const FILES: Array<[string, string, string, string, number]> = [
  // a room's name is one live room's (the space form's rule), so unticking never adds a second Terrace
  ['spaces', 'Name,Seated\nDup Terrace,30', '/api/event-spaces', 'Dup Terrace', 1],
  ['menus', 'Name,Price Per Person\nDup Canapes,32', '/api/menu-packages', 'Dup Canapes', 2],
  ['events', 'Name,Type,Status,Date,Guests\nDup Birthday,birthday,enquiry,2026-12-19,40', '/api/events?limit=200', 'Dup Birthday', 2],
  ['projects', 'Name,Status\nDup Kitchen,active', '/api/projects?limit=200', 'Dup Kitchen', 2],
  ['jobs', 'Title,Scheduled Date\nDup Tasting,2026-12-01', '/api/jobs?limit=200', 'Dup Tasting', 2],
]

describe('a second run of the same file', () => {
  for (const [type, csv, list, name, afterUntick] of FILES) {
    test(`${type}: skipped by default, named as already here; unticked, ${afterUntick === 2 ? 'added again' : 'refused'}`, async () => {
      expect((await upload(type, csv)).imported).toBe(1)
      const again = await upload(type, csv)
      expect({ imported: again.imported, skipped: again.skipped }).toEqual({ imported: 0, skipped: 1 })
      expect(again.records).toEqual([expect.objectContaining({ line: 2, name, action: 'skipped_duplicate' })])
      // The preview (dry run) says the same and writes nothing
      expect((await upload(type, csv, { dryRun: 'true' })).skipped).toBe(1)
      expect(await count(list, name)).toBe(1)
      const unticked = await upload(type, csv, { skipDuplicates: 'false' })
      expect(unticked.imported).toBe(afterUntick - 1)
      if (afterUntick === 1) expect(unticked.errors).toEqual([{ line: 2, error: `A space named "${name}" already exists.` }])
      expect(await count(list, name)).toBe(afterUntick)
    })
  }

  test('a cancelled event is history: the same event booked again is imported', async () => {
    const csv = 'Name,Type,Status,Date\nRebooked Party,birthday,enquiry,2026-12-20'
    await upload('events', csv)
    const ev = (await k.O('GET', '/api/events?limit=200')).json
    const id = (Array.isArray(ev) ? ev : ev.data).find((e: any) => e.name === 'Rebooked Party').id
    expect((await k.O('DELETE', '/api/events/' + id)).status).toBe(200)
    expect((await upload('events', csv)).imported).toBe(1)
  })

  test('contacts: a person is never added twice — only the blanks are filled in, nothing overwritten', async () => {
    await upload('contacts', 'Name,Email,City\nDup Dana,dana@example.com,Eau Claire')
    const filled = await upload('contacts', 'Name,Email,Phone,City\nDup Dana,dana@example.com,715-555-0101,Madison', { skipDuplicates: 'false' })
    expect(filled.records[0]).toEqual(expect.objectContaining({ action: 'updated', fieldsUpdated: ['phone'] }))
    const r = (await k.O('GET', '/api/contacts?search=Dup%20Dana')).json
    const dana = (Array.isArray(r) ? r : r.data).filter((c: any) => c.name === 'Dup Dana')
    expect(dana.map((c: any) => [c.phone, c.city])).toEqual([['715-555-0101', 'Eau Claire']])
  })
})
