// Home care parity row 16 (docs/parity/homecare-offline.md), the server half of what the phone now saves with no signal,
// behind care_offline_saves:
//   · a visit photo is uploaded from the phone's queue as a FILE under a name made from the save's id — a retry after a lost
//     reply replaces it, never adds a second photo — then /photos/saved records when it was taken (the phone's time, checked);
//   · vitals keep the time they were taken on the phone (savedAt), refused in plain words when it is in the future;
//   · without the feature the photo routes are not there and savedAt is ignored.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = ''
const tokens: Record<string, string> = {}
const ids: Record<string, string> = {}
const login = async (email: string, password: string) => (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken as string
const as = (who: string) => (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tokens[who]}` } })
const json = async (r: Response | Promise<Response>) => { const x = await r; return { status: x.status, body: (await x.json()) as any } }
const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
const setFeatures = async (list: string[]) => { await t.db.update(t.schema.company).set({ enabledFeatures: list } as any).where(eq(t.schema.company.id, companyId)); t.services.features.forgetFeatures() }
const BASE = ['contacts', 'scheduling', 'team']
const ago = (ms: number) => new Date(Date.now() - ms).toISOString()
// a 1×1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')
const upload = (who: string, visit: string, name: string) => {
  const form = new FormData()
  form.append('photo', new File([PNG], 'photo.png', { type: 'image/png' }))
  form.append('name', name)
  return as(who)(`/api/time-entries/${visit}/photos/file`, { method: 'POST', body: form })
}
const photosOf = async (visit: string) => (await t.db.select().from(t.schema.visitPhotos).where(eq(t.schema.visitPhotos.timeEntryId, visit))) as any[]

beforeAll(async () => {
  t = await bootTenant({ vertical: 'homecare' })
  const seeded = await seedOwner(t)
  companyId = seeded.company.id
  tokens.owner = await login('owner@test.example', seeded.password)
  const hash = await Bun.password.hash('Caregiver-pass-1', 'bcrypt')
  for (const who of ['ann', 'bea']) {
    ids[who] = (await ins(t.schema.user, { email: `${who}@test.example`, passwordHash: hash, firstName: who, lastName: 'Carer', role: 'caregiver', companyId })).id
    tokens[who] = await login(`${who}@test.example`, 'Caregiver-pass-1')
  }
  ids.pat = (await ins(t.schema.clients, { companyId, firstName: 'Pat', lastName: 'Client', isActive: true })).id
  for (const who of ['ann', 'bea']) await ins(t.schema.clientAssignments, { companyId, clientId: ids.pat, caregiverId: ids[who], assignmentDate: '2026-10-01', status: 'active' })
  ids.visit = (await ins(t.schema.timeEntries, { companyId, caregiverId: ids.ann, clientId: ids.pat, startTime: new Date(Date.now() - 3 * 3_600_000), isComplete: false })).id
  await setFeatures(BASE)
}, 90_000)

describe('without care_offline_saves', () => {
  test('the photo routes are not there, and vitals ignore the phone\'s savedAt', async () => {
    expect((await upload('ann', ids.visit, 'save-0001-0')).status).toBe(404)
    const v = await json(as('ann')('/api/medications/vitals', { method: 'POST', json: { clientId: ids.pat, timeEntryId: ids.visit, pulse: 70, savedAt: ago(2 * 3_600_000) } }))
    expect(v.status).toBe(201)
    expect(Date.now() - new Date(v.body.recordedAt).getTime()).toBeLessThan(60_000)
  })
})

describe('with care_offline_saves', () => {
  test('a photo is uploaded once under its name; a retry replaces it; saved records when it was taken', async () => {
    await setFeatures([...BASE, 'care_offline_saves'])
    const a = await json(upload('ann', ids.visit, 'save-0001-0'))
    expect(a).toEqual({ status: 201, body: { url: 'visit-photo:save-0001-0' } })
    expect((await json(upload('ann', ids.visit, 'save-0001-0'))).status).toBe(201)  // the reply was lost: sent again
    expect((await photosOf(ids.visit)).length).toBe(1)
    const taken = ago(90 * 60_000)
    const s = await json(as('ann')(`/api/time-entries/${ids.visit}/photos/saved`, { method: 'POST', json: { photos: ['visit-photo:save-0001-0'], takenAt: taken } }))
    expect(s.body.saved).toBe(1)
    const [row] = await photosOf(ids.visit)
    expect(new Date(row.takenAt).toISOString()).toBe(taken)
    expect(row.imageBase64.startsWith('data:image/png;base64,')).toBe(true)
    // the office reads it with the visit's other photos
    const list = await json(as('owner')(`/api/time-entries/${ids.visit}/photos`))
    expect(list.body.data.length).toBe(1)
  })

  test('refused in plain words: someone else\'s visit, no file, a bad name, a time in the future', async () => {
    expect((await upload('bea', ids.visit, 'save-0002-0')).status).toBe(403)
    expect((await json(as('ann')(`/api/time-entries/${ids.visit}/photos/file`, { method: 'POST', body: new FormData() }))).body.code).toBe('no_photo')
    expect((await json(as('ann')(`/api/time-entries/${ids.visit}/photos/saved`, { method: 'POST', json: { photos: ['https://elsewhere.example/x.png'] } }))).body.code).toBe('bad_photo')
    const future = new Date(Date.now() + 3_600_000).toISOString()
    expect((await json(as('ann')(`/api/time-entries/${ids.visit}/photos/saved`, { method: 'POST', json: { photos: ['visit-photo:save-0001-0'], takenAt: future } }))).body.code).toBe('bad_saved_time')
    expect((await upload('ann', 'no-such-visit', 'save-0003-0')).status).toBe(404)
  })

  test('vitals keep the time they were taken on the phone; a future time is refused', async () => {
    const taken = ago(45 * 60_000)
    const v = await json(as('ann')('/api/medications/vitals', { method: 'POST', json: { clientId: ids.pat, timeEntryId: ids.visit, pulse: 72, savedAt: taken } }))
    expect(v.status).toBe(201)
    expect(new Date(v.body.recordedAt).toISOString()).toBe(taken)
    const bad = await json(as('ann')('/api/medications/vitals', { method: 'POST', json: { clientId: ids.pat, timeEntryId: ids.visit, pulse: 72, savedAt: new Date(Date.now() + 3_600_000).toISOString() } }))
    expect([bad.status, bad.body.code]).toEqual([400, 'bad_saved_time'])
  })
})
