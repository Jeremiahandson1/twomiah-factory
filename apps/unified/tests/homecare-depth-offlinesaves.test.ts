// Home care depth, item 4 — the server's half of saving a task, a medicine entry or a photo on the phone without signal
// (docs/parity/homecare-offline-saves.md; the phone's queue is apps/mobile/src/offline, rebuilt by the field-service session).
// Through the real server. Off (as before) without care_offline_saves. With it:
//   · a save sent twice with the same Idempotency-Key is done once and the second try gets the first answer back;
//   · a refused save is not remembered, so it can be fixed and sent again under the same key;
//   · the time the caregiver tapped is the time recorded (a task's completion, a dose's time, a photo's time); a time in the
//     future or more than 30 days old is refused in plain words;
//   · a dose someone has already recorded as given is refused (409) saying who and when; a dose of a medicine that was
//     stopped is recorded and the office is told;
//   · a seat without visit access is refused.
import { describe, test, expect, beforeAll } from 'bun:test'
import { and, eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { savedTime } from '../server/crm/homecare/core/offlineSaves.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = ''
const tokens: Record<string, string> = {}
const ids: Record<string, string> = {}
const login = async (email: string, password: string) => (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken as string
const as = (who: string) => (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tokens[who]}` } })
const json = async (r: Response) => ({ status: r.status, body: (await r.json()) as any, headers: r.headers })
const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
const setFeatures = async (list: string[]) => { await t.db.update(t.schema.company).set({ enabledFeatures: list } as any).where(eq(t.schema.company.id, companyId)); t.services.features.forgetFeatures() }
const BASE = ['contacts', 'scheduling', 'team']
const logsFor = async (medicationId: string) => (await t.db.select().from(t.schema.medicationLogs).where(eq(t.schema.medicationLogs.medicationId, medicationId))) as any[]
const photo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
const ago = (ms: number) => new Date(Date.now() - ms).toISOString()

beforeAll(async () => {
  t = await bootTenant({ vertical: 'homecare' })
  const seeded = await seedOwner(t)
  companyId = seeded.company.id
  tokens.owner = await login('owner@test.example', seeded.password)
  const hash = await Bun.password.hash('Caregiver-pass-1', 'bcrypt')
  const mk = async (who: string, extra: any = {}) => { ids[who] = (await ins(t.schema.user, { email: `${who}@test.example`, passwordHash: hash, firstName: who[0]!.toUpperCase() + who.slice(1), lastName: 'Carer', companyId, ...extra })).id; tokens[who] = await login(`${who}@test.example`, 'Caregiver-pass-1') }
  await mk('ann', { role: 'caregiver' })
  await mk('bea', { role: 'caregiver' })
  await mk('vic', { role: 'viewer' }) // a seat with no visit permissions
  ids.pat = (await ins(t.schema.clients, { companyId, firstName: 'Pat', lastName: 'Client', isActive: true, isPrivatePay: true })).id
  for (const who of ['ann', 'bea']) await ins(t.schema.clientAssignments, { companyId, clientId: ids.pat, caregiverId: ids[who], assignmentDate: '2026-10-01', status: 'active' })
  ids.visit = (await ins(t.schema.timeEntries, { companyId, caregiverId: ids.ann, clientId: ids.pat, startTime: new Date(Date.now() - 3 * 3_600_000), isComplete: false })).id
  ids.visit2 = (await ins(t.schema.timeEntries, { companyId, caregiverId: ids.bea, clientId: ids.pat, startTime: new Date(Date.now() - 3 * 3_600_000), isComplete: false })).id
  ids.task = (await ins(t.schema.clientTaskTemplates, { companyId, clientId: ids.pat, taskName: 'Make lunch', category: 'iadl' })).id
  ids.med = (await ins(t.schema.medications, { companyId, clientId: ids.pat, name: 'Vitamin D', dosage: '1000 IU', frequency: 'daily', status: 'active' })).id
  ids.stopped = (await ins(t.schema.medications, { companyId, clientId: ids.pat, name: 'Old Pill', dosage: '5 mg', frequency: 'daily', status: 'discontinued', endDate: '2026-01-31' })).id
  await setFeatures(BASE)
}, 90_000)

const dose = (who: string, body: any, key?: string) => as(who)('/api/medications/log', { method: 'POST', json: { medicationId: ids.med, clientId: ids.pat, timeEntryId: who === 'bea' ? ids.visit2 : ids.visit, status: 'given', ...body }, headers: key ? { 'Idempotency-Key': key } : {} })

describe('without care_offline_saves nothing changes', () => {
  test('the key is ignored (two sends are two entries), the phone\'s time is not used, and no dose conflict is raised', async () => {
    const a = await json(await dose('ann', { savedAt: ago(3_600_000), scheduledTime: '2026-11-10T14:00:00Z' }, 'key-off-0001'))
    const b = await json(await dose('ann', { savedAt: ago(3_600_000), scheduledTime: '2026-11-10T14:00:00Z' }, 'key-off-0001'))
    expect([a.status, b.status]).toEqual([201, 201])
    expect(a.body.id).not.toBe(b.body.id)
    expect(Math.abs(new Date(a.body.administeredAt).getTime() - Date.now())).toBeLessThan(60_000) // arrival time, as ever
    const [row] = await t.db.select().from(t.schema.savedRequest)
    expect(row).toBeUndefined()
    const task = await json(await as('ann')(`/api/care-tasks/time-entry/${ids.visit}/${ids.task}`, { method: 'PUT', json: { status: 'completed', savedAt: ago(7_200_000) } }))
    expect(Math.abs(new Date(task.body.completedAt).getTime() - Date.now())).toBeLessThan(60_000)
  })
})

describe('savedTime (pure)', () => {
  const now = new Date('2026-11-10T12:00:00Z')
  test('none, a good time, a little ahead, far ahead, too old, nonsense', () => {
    expect(savedTime(undefined, now)).toEqual({ at: null })
    expect(savedTime('2026-11-10T09:00:00Z', now)).toEqual({ at: new Date('2026-11-10T09:00:00Z') })
    expect(savedTime('2026-11-10T12:03:00Z', now)).toEqual({ at: now }) // a phone clock a few minutes fast is not "the future"
    expect(savedTime('2026-11-10T14:00:00Z', now)).toMatchObject({ problem: expect.stringContaining('in the future') })
    expect(savedTime('2026-09-01T00:00:00Z', now)).toMatchObject({ problem: expect.stringContaining('more than 30 days ago') })
    expect(savedTime('not a time', now)).toMatchObject({ problem: expect.stringContaining('not a valid date and time') })
  })
})

describe('with care_offline_saves', () => {
  beforeAll(async () => { await setFeatures([...BASE, 'care_offline_saves']) })

  test('a dose sent twice under one key is recorded once, at the time it was given, and the second try gets the first answer', async () => {
    const given = ago(2 * 3_600_000)
    const first = await json(await dose('ann', { administeredAt: given, scheduledTime: '2026-11-11T14:00:00Z' }, 'dose-ann-0001'))
    expect(first.status).toBe(201)
    expect(new Date(first.body.administeredAt).toISOString()).toBe(given)
    const second = await json(await dose('ann', { administeredAt: given, scheduledTime: '2026-11-11T14:00:00Z' }, 'dose-ann-0001'))
    expect(second.status).toBe(201)
    expect(second.headers.get('Idempotent-Replay')).toBe('true')
    expect(second.body.id).toBe(first.body.id)
    expect((await logsFor(ids.med)).filter((l) => l.administeredAt.toISOString() === given)).toHaveLength(1)
  })

  test('the phone\'s savedAt is the dose time when no other time is sent; a future or ancient time is refused in plain words', async () => {
    const saved = ago(90 * 60_000)
    const ok = await json(await dose('ann', { savedAt: saved, scheduledTime: '2026-11-12T14:00:00Z' }, 'dose-ann-0002'))
    expect(ok.status).toBe(201)
    expect(new Date(ok.body.administeredAt).toISOString()).toBe(saved)
    const future = await json(await dose('ann', { savedAt: new Date(Date.now() + 3_600_000).toISOString() }, 'dose-ann-0003'))
    expect([future.status, future.body.code]).toEqual([400, 'bad_saved_time'])
    expect(future.body.error).toContain('in the future')
    const old = await json(await dose('ann', { savedAt: new Date(Date.now() - 40 * 86_400_000).toISOString() }, 'dose-ann-0004'))
    expect(old.body.error).toContain('more than 30 days ago')
  })

  test('a refused save is not remembered: fixed, it goes through under the same key', async () => {
    const bad = await json(await dose('ann', { savedAt: new Date(Date.now() + 3_600_000).toISOString() }, 'dose-ann-0005'))
    expect(bad.status).toBe(400)
    const fixed = await json(await dose('ann', { savedAt: ago(60_000), scheduledTime: '2026-11-13T14:00:00Z' }, 'dose-ann-0005'))
    expect(fixed.status).toBe(201)
    expect(fixed.headers.get('Idempotent-Replay')).toBeNull()
  })

  test('one dose, one record: a second caregiver\'s "given" for the same scheduled dose is refused, saying who and when', async () => {
    const r = await json(await dose('bea', { administeredAt: ago(30 * 60_000), scheduledTime: '2026-11-11T14:00:00Z' }, 'dose-bea-0001'))
    expect(r.status).toBe(409)
    expect(r.body.code).toBe('dose_already_recorded')
    expect(r.body.error).toMatch(/^Ann Carer already recorded this dose as given at \d{1,2}:\d{2} (AM|PM)\./)
    // A refusal, a hold or a different scheduled time is a different record.
    expect((await json(await dose('bea', { status: 'refused', scheduledTime: '2026-11-11T14:00:00Z', notes: 'said no' }, 'dose-bea-0002'))).status).toBe(201)
    expect((await json(await dose('bea', { scheduledTime: '2026-11-11T20:00:00Z', administeredAt: ago(60_000) }, 'dose-bea-0003'))).status).toBe(201)
    expect((await logsFor(ids.med)).filter((l) => l.scheduledTime?.toISOString() === '2026-11-11T14:00:00.000Z' && l.status === 'given')).toHaveLength(1)
  })

  test('a dose of a stopped medicine is recorded, with a warning, and the office is told', async () => {
    const r = await json(await as('ann')('/api/medications/log', { method: 'POST', json: { medicationId: ids.stopped, clientId: ids.pat, timeEntryId: ids.visit, status: 'given', administeredAt: ago(60_000) }, headers: { 'Idempotency-Key': 'dose-stop-0001' } }))
    expect(r.status).toBe(201)
    expect(r.body.warning).toContain('marked as stopped')
    const notes = await t.db.select().from(t.schema.notifications).where(and(eq(t.schema.notifications.companyId, companyId), eq(t.schema.notifications.type, 'dose_after_stop')))
    expect(notes.length).toBeGreaterThan(0)
    expect(notes[0]!.message).toContain('Old Pill')
  })

  test('a task done on the phone is completed at the time it was done', async () => {
    const done = ago(2 * 3_600_000)
    const r = await json(await as('ann')(`/api/care-tasks/time-entry/${ids.visit}/${ids.task}`, { method: 'PUT', json: { status: 'completed', savedAt: done } }))
    expect(r.status).toBe(200)
    expect(new Date(r.body.completedAt).toISOString()).toBe(done)
    const again = await json(await as('ann')(`/api/care-tasks/time-entry/${ids.visit}/${ids.task}`, { method: 'PUT', json: { status: 'completed', savedAt: done } }))
    expect(again.status).toBe(200) // the same whole-value save, sent again: still one row
    const rows = await t.db.select().from(t.schema.shiftTaskCompletions).where(eq(t.schema.shiftTaskCompletions.timeEntryId, ids.visit))
    expect(rows).toHaveLength(1)
    const bad = await json(await as('ann')(`/api/care-tasks/time-entry/${ids.visit}/${ids.task}`, { method: 'PUT', json: { status: 'completed', savedAt: 'yesterday-ish' } }))
    expect([bad.status, bad.body.code]).toEqual([400, 'bad_saved_time'])
  })

  test('a photo sent twice under one key is stored once, with the time it was taken', async () => {
    const taken = ago(45 * 60_000)
    const send = () => as('ann')(`/api/time-tracking/${ids.visit}/photos`, { method: 'POST', json: { imageBase64: photo, caption: 'Lunch', category: 'meal', takenAt: taken }, headers: { 'Idempotency-Key': 'photo-ann-0001' } })
    const a = await json(await send())
    const b = await json(await send())
    expect([a.status, b.status]).toEqual([201, 201])
    expect(b.body.id).toBe(a.body.id)
    const rows = await t.db.select().from(t.schema.visitPhotos).where(eq(t.schema.visitPhotos.timeEntryId, ids.visit))
    expect(rows).toHaveLength(1)
    expect(rows[0]!.takenAt.toISOString()).toBe(taken)
  })

  test('a key cannot be reused for another save, a malformed key is refused, and keys are per person', async () => {
    const reuse = await json(await as('ann')('/api/medications/log', { method: 'POST', json: { medicationId: ids.med, clientId: ids.pat, timeEntryId: ids.visit, status: 'refused', notes: 'x' }, headers: { 'Idempotency-Key': 'photo-ann-0001' } }))
    expect([reuse.status, reuse.body.code]).toEqual([422, 'key_reused']) // that key was kept for the photo save
    const clash = await json(await as('ann')(`/api/time-tracking/${ids.visit}/photos`, { method: 'POST', json: { imageBase64: photo }, headers: { 'Idempotency-Key': 'dose-ann-0001' } }))
    expect([clash.status, clash.body.code]).toEqual([422, 'key_reused'])
    const malformed = await json(await dose('ann', {}, 'x'))
    expect([malformed.status, malformed.body.code]).toEqual([400, 'bad_key'])
    // Bea sending Ann's key does her own save (keys belong to the person who made them).
    const bea = await json(await dose('bea', { scheduledTime: '2026-11-14T14:00:00Z', administeredAt: ago(60_000) }, 'dose-ann-0001'))
    expect(bea.status).toBe(201)
    expect(bea.headers.get('Idempotent-Replay')).toBeNull()
  })

  test('a save still being processed is answered "try again" (the phone retries it), never done twice', async () => {
    await t.db.insert(t.schema.savedRequest).values({ companyId, userId: ids.ann, key: 'inflight-0001', route: 'POST /api/medications/log' })
    const r = await json(await dose('ann', { scheduledTime: '2026-11-15T14:00:00Z' }, 'inflight-0001'))
    expect([r.status, r.body.code]).toEqual([503, 'in_progress'])
  })

  test('a seat without visit access is refused', async () => {
    const r = await json(await dose('vic', {}, 'dose-vic-0001'))
    expect(r.status).toBe(403)
    expect((await json(await as('vic')(`/api/time-tracking/${ids.visit}/photos`, { method: 'POST', json: { imageBase64: photo } }))).status).toBe(403)
    expect((await json(await as('vic')(`/api/care-tasks/time-entry/${ids.visit}/${ids.task}`, { method: 'PUT', json: { status: 'completed' } }))).status).toBe(403)
  })

  test('a caregiver cannot record a dose on a coworker\'s visit', async () => {
    const r = await json(await as('bea')('/api/medications/log', { method: 'POST', json: { medicationId: ids.med, clientId: ids.pat, timeEntryId: ids.visit, status: 'given', scheduledTime: '2026-11-16T14:00:00Z' }, headers: { 'Idempotency-Key': 'dose-bea-0009' } }))
    expect(r.status).toBe(403)
    // ...and the refusal is not kept: nothing stored under that key.
    const kept = await t.db.select().from(t.schema.savedRequest).where(eq(t.schema.savedRequest.key, 'dose-bea-0009'))
    expect(kept).toHaveLength(0)
  })
})
