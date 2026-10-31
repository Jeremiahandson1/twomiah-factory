// Home care depth, item 1 (docs/parity/homecare-import.md): CSV import of clients, caregivers and recurring shifts, with column
// matching, a row-by-row preview, duplicate detection, a dry run and undo of a whole batch. Off (refused) without care_import.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { guessMapping, cleanDate, cleanTime, cleanWeekday, cleanPhone, splitName } from '../server/crm/homecare/core/importRows.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = ''
const tokens: Record<string, string> = {}
const ids: Record<string, string> = {}

const login = async (email: string, password: string) =>
  (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken as string
const as = (who: string) => (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tokens[who]}` } })
const json = async (r: Response) => ({ status: r.status, body: await r.json() as any })
const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
const setFeatures = async (list: string[]) => {
  await t.db.update(t.schema.company).set({ enabledFeatures: list } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
}
const BASE = ['contacts', 'scheduling', 'team']
const post = async (path: string, body: any, who = 'owner') => json(await as(who)(`/api/care-import${path}`, { method: 'POST', json: body }))
const get = async (path: string, who = 'owner') => json(await as(who)(`/api/care-import${path}`))
const allClients = () => t.db.select().from(t.schema.clients).where(eq(t.schema.clients.companyId, companyId))
const allBatches = () => t.db.select().from(t.schema.importBatch).where(eq(t.schema.importBatch.companyId, companyId))
const allSchedules = () => t.db.select().from(t.schema.schedules).where(eq(t.schema.schedules.companyId, companyId))

const CLIENTS_CSV = `First Name,Last Name,DOB,Phone,Email,Zip,Private Pay,Rate
Maria,Lopez,3/15/1948,715-555-0100,maria@x.com,54701,yes,$32.50
Walt,Nye,1950-07-04,(715) 555-0111,,54703,,
Maria,Lopez,3/15/1948,,,,,
Bad,Date,13/45/2020,,,,,
Bad,Phone,,12345,,,,
Ava,Existing,,,,,,
`
const CAREGIVERS_CSV = `Name,Email,Phone,Hire Date,Pay Rate
Sam Reed,sam.reed@x.com,715-555-0122,2025-06-01,18.5
"Park, Lee",lee.park@x.com,,2026-02-01,17
Owner Twin,owner@test.example,,,
`
const SCHEDULES_CSV = `Client,Caregiver,Day,Start,End,Repeats
Maria Lopez,sam.reed@x.com,Monday,9:00 AM,1:00 PM,weekly
Maria Lopez,Lee Park,Tue,14:00,16:30,every other week
Walt Nye,sam.reed@x.com,Monday,9:00 AM,1:00 PM,monthly
Nobody Here,sam.reed@x.com,Friday,9am,11am,weekly
Walt Nye,sam.reed@x.com,Wed,3pm,2pm,weekly
`

beforeAll(async () => {
  t = await bootTenant({ vertical: 'homecare' })
  const seeded = await seedOwner(t)
  companyId = seeded.company.id
  tokens.owner = await login('owner@test.example', seeded.password)
  const hash = await Bun.password.hash('Caregiver-pass-1', 'bcrypt')
  ids.ann = (await ins(t.schema.user, { email: 'ann@test.example', passwordHash: hash, firstName: 'Ann', lastName: 'Carer', role: 'caregiver', companyId })).id
  tokens.ann = await login('ann@test.example', 'Caregiver-pass-1')
  ids.ava = (await ins(t.schema.clients, { companyId, firstName: 'Ava', lastName: 'Existing', isActive: true })).id
  await setFeatures(BASE)
}, 90_000)

describe('home care — import: the reading rules (pure)', () => {
  test('headers are matched to fields, exact before likely, each field once', () => {
    const g = guessMapping('clients', ['First Name', 'Surname', 'DOB', 'Mobile', 'Whatever'])
    expect(g.map((x) => [x.field, x.confidence])).toEqual([['firstName', 'exact'], ['lastName', 'likely'], ['dateOfBirth', 'likely'], ['phone', 'likely'], [null, 'none']])
    expect(guessMapping('clients', ['Phone', 'Mobile']).map((x) => x.field)).toEqual(['phone', null])
  })
  test('dates, times, weekdays, phones and names', () => {
    expect(cleanDate('3/15/1948')).toEqual({ value: '1948-03-15' })
    expect(cleanDate('2/30/2026')).toHaveProperty('problem')
    expect(cleanTime('9:00 AM')).toEqual({ value: '09:00' })
    expect(cleanTime('12am')).toEqual({ value: '00:00' })
    expect(cleanTime('3pm')).toEqual({ value: '15:00' })
    expect(cleanWeekday('Tue')).toEqual({ value: 2 })
    expect(cleanWeekday('0')).toEqual({ value: 0 })
    expect(cleanWeekday('7')).toHaveProperty('problem')
    expect(cleanPhone('1-715-555-0100')).toEqual({ value: '(715) 555-0100' })
    expect(splitName('Lopez, Maria')).toEqual({ first: 'Maria', last: 'Lopez' })
    expect(splitName('Madonna')).toBeNull()
  })
})

describe('home care — import: clients', () => {
  test('without the feature it is refused', async () => {
    const r = await post('/preview', { kind: 'clients', csv: CLIENTS_CSV })
    expect(r.status).toBe(403)
    expect(r.body).toMatchObject({ code: 'FEATURE_NOT_ENABLED', feature: 'care_import' })
    await setFeatures([...BASE, 'care_import'])
  })

  test('a seat without the permission is refused on every route', async () => {
    expect((await post('/preview', { kind: 'clients', csv: CLIENTS_CSV }, 'ann')).status).toBe(403)
    expect((await post('/commit', { kind: 'clients', csv: CLIENTS_CSV }, 'ann')).status).toBe(403)
    expect((await get('/batches', 'ann')).status).toBe(403)
    expect((await get('/template/clients', 'ann')).status).toBe(403)
  })

  test('the template is a header row and an example', async () => {
    const r = await get('/template/clients')
    expect(r.status).toBe(200)
    expect(r.body.csv.split('\n')[0]).toStartWith('First name,Last name,Date of birth')
    expect((await get('/template/horses')).body.code).toBe('bad_kind')
  })

  test('preview checks every row and writes nothing', async () => {
    const before = (await allClients()).length
    const r = await post('/preview', { kind: 'clients', csv: CLIENTS_CSV })
    expect(r.status).toBe(200)
    expect(r.body.counts).toEqual({ rows: 6, ok: 2, duplicates: 2, errors: 2 })
    const by = (line: number) => r.body.rows.find((x: any) => x.line === line)
    expect(by(2)).toMatchObject({ status: 'ok', label: 'Maria Lopez' })
    expect(by(4)).toMatchObject({ status: 'duplicate', duplicateOf: 'Same client appears earlier in this file' })
    expect(by(5)).toMatchObject({ status: 'error' })
    expect(by(5).problems[0]).toContain('not a real date')
    expect(by(6).problems[0]).toContain('10-digit phone')
    expect(by(7)).toMatchObject({ status: 'duplicate', duplicateOf: 'Already a client with this name' })
    expect(r.body.mapping.find((m: any) => m.header === 'DOB')).toMatchObject({ field: 'dateOfBirth', confidence: 'likely' })
    expect((await allClients()).length).toBe(before)
    expect((await allBatches()).length).toBe(0)
  })

  test('a required column that is not matched stops it, and a column can be re-pointed', async () => {
    const noLast = await post('/preview', { kind: 'clients', csv: 'Given,Phone\nMaria,715-555-0100\n', mapping: { Given: 'firstName' } })
    expect(noLast.body.ready).toBe(false)
    expect(noLast.body.missingRequired).toEqual(['Last name'])
    const fixed = await post('/preview', { kind: 'clients', csv: 'Given,Family\nMaria,Lopez\n', mapping: { Given: 'firstName', Family: 'lastName' } })
    expect(fixed.body).toMatchObject({ ready: true, counts: { ok: 1 } })
    expect((await post('/preview', { kind: 'clients', csv: 'a,b\n1,2\n', mapping: { a: 'firstName', b: 'firstName' } })).body.code).toBe('bad_mapping')
    expect((await post('/preview', { kind: 'clients', csv: 'a,b\n1,2\n', mapping: { a: 'shoeSize' } })).body.code).toBe('bad_mapping')
    expect((await post('/preview', { kind: 'clients', csv: '' })).body.code).toBe('empty_file')
    expect((await post('/preview', { kind: 'clients', csv: 'First Name,Last Name\n' })).body.code).toBe('empty_file')
  })

  test('a dry run says what it would do and changes nothing', async () => {
    const r = await post('/commit', { kind: 'clients', csv: CLIENTS_CSV, dryRun: true })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ dryRun: true, wouldCreate: 2, wouldSkipDuplicates: 2, wouldSkipBadRows: 2 })
    expect((await allClients()).length).toBe(1)
    expect((await allBatches()).length).toBe(0)
  })

  test('the real run creates the good rows, skips the rest with a reason, and keeps a batch', async () => {
    const r = await post('/commit', { kind: 'clients', csv: CLIENTS_CSV, fileName: 'clients.csv' })
    expect(r.status).toBe(201)
    expect(r.body).toMatchObject({ created: 2, skippedDuplicates: 2, skippedBadRows: 2, failures: [] })
    expect(r.body.skipped.map((s: any) => s.line)).toEqual([4, 5, 6, 7])
    ids.clientsBatch = r.body.batchId
    const rows = await allClients()
    expect(rows.map((c: any) => c.firstName).sort()).toEqual(['Ava', 'Maria', 'Walt'])
    const maria = rows.find((c: any) => c.firstName === 'Maria') as any
    expect(maria).toMatchObject({ dateOfBirth: '1948-03-15', phone: '(715) 555-0100', zip: '54701', isPrivatePay: true, privatePayRate: '32.50', privatePayRateType: 'hourly' })
    ids.maria = maria.id
    ids.walt = (rows.find((c: any) => c.firstName === 'Walt') as any).id
    const onboarding = await t.db.select().from(t.schema.clientOnboarding).where(eq(t.schema.clientOnboarding.clientId, ids.maria))
    expect(onboarding.length).toBe(1)
    const [batch] = await allBatches()
    expect(batch).toMatchObject({ kind: 'clients', status: 'done', created: 2, skippedDuplicates: 2, failed: 2, fileName: 'clients.csv' })
  })

  test('running the same file again creates nothing', async () => {
    const r = await post('/commit', { kind: 'clients', csv: CLIENTS_CSV })
    expect(r.body).toMatchObject({ batchId: null, created: 0, skippedDuplicates: 4, skippedBadRows: 2 })
    expect((await allBatches()).length).toBe(1)
    expect((await allClients()).length).toBe(3)
  })
})

describe('home care — import: caregivers and recurring shifts', () => {
  test('caregivers get a login, a profile and a seat; an email already in use is skipped', async () => {
    const pre = await post('/preview', { kind: 'caregivers', csv: CAREGIVERS_CSV })
    expect(pre.body.counts).toEqual({ rows: 3, ok: 2, duplicates: 1, errors: 0 })
    expect(pre.body.rows[1]).toMatchObject({ label: 'Lee Park' })
    const r = await post('/commit', { kind: 'caregivers', csv: CAREGIVERS_CSV })
    expect(r.body).toMatchObject({ created: 2, skippedDuplicates: 1 })
    ids.caregiversBatch = r.body.batchId
    const sam = (await t.db.select().from(t.schema.user).where(eq(t.schema.user.email, 'sam.reed@x.com')))[0] as any
    expect(sam).toMatchObject({ role: 'field', firstName: 'Sam', lastName: 'Reed', companyId, isActive: true, defaultPayRate: '18.50' })
    ids.sam = sam.id
    ids.lee = ((await t.db.select().from(t.schema.user).where(eq(t.schema.user.email, 'lee.park@x.com')))[0] as any).id
    expect((await t.db.select().from(t.schema.caregiverProfiles).where(eq(t.schema.caregiverProfiles.caregiverId, ids.sam))).length).toBe(1)
    // nobody can sign in with a password they were never given
    expect((await t.call('/api/auth/login', { method: 'POST', json: { email: 'sam.reed@x.com', password: 'password' } })).status).toBeGreaterThanOrEqual(400)
  })

  test('shifts need clients and caregivers that exist, a real time range, and a repeat the agency has', async () => {
    const pre = await post('/preview', { kind: 'schedules', csv: SCHEDULES_CSV })
    expect(pre.body.counts).toEqual({ rows: 5, ok: 2, duplicates: 0, errors: 3 })
    const by = (line: number) => pre.body.rows.find((x: any) => x.line === line)
    expect(by(4).problems.join(' ')).toContain('has not turned on')
    expect(by(5).problems.join(' ')).toContain('nobody named "Nobody Here"')
    expect(by(6).problems.join(' ')).toContain('End time is before the start time')
    expect(by(3).problems).toEqual([])
  })

  test('the monthly repeat is accepted once the agency has shift repeats', async () => {
    await setFeatures([...BASE, 'care_import', 'care_shift_repeats'])
    const pre = await post('/preview', { kind: 'schedules', csv: SCHEDULES_CSV })
    expect(pre.body.counts).toMatchObject({ ok: 3, errors: 2 })
    await setFeatures([...BASE, 'care_import'])
  })

  test('the shifts are created as recurring patterns, never back-dated, and a repeat is a duplicate', async () => {
    const r = await post('/commit', { kind: 'schedules', csv: SCHEDULES_CSV })
    expect(r.body).toMatchObject({ created: 2, skippedBadRows: 3 })
    ids.schedulesBatch = r.body.batchId
    const rows = await allSchedules() as any[]
    expect(rows.length).toBe(2)
    const mon = rows.find((s) => s.dayOfWeek === 1)
    expect(mon).toMatchObject({ scheduleType: 'recurring', frequency: 'weekly', clientId: ids.maria, caregiverId: ids.sam, isActive: true })
    expect(rows.find((s) => s.dayOfWeek === 2)).toMatchObject({ frequency: 'biweekly', caregiverId: ids.lee })
    const today = new Date().toISOString().slice(0, 10)
    for (const s of rows) expect(String(s.effectiveDate) >= today.slice(0, 8)).toBe(true)
    const again = await post('/commit', { kind: 'schedules', csv: SCHEDULES_CSV })
    expect(again.body).toMatchObject({ created: 0, skippedDuplicates: 2 })
    expect((await allSchedules()).length).toBe(2)
  })
})

describe('home care — import: undo', () => {
  test('undo removes what the import made but keeps anything already in use', async () => {
    // Maria has shifts from the schedules batch, so she is kept; Walt has nothing and goes. Ava was never part of the import.
    const first = await post(`/batches/${ids.clientsBatch}/undo`, {})
    expect(first.status).toBe(200)
    expect(first.body).toMatchObject({ removed: 1, undone: false })
    expect(first.body.kept).toHaveLength(1)
    expect(first.body.kept[0].reason).toContain('Already in use (schedules)')
    expect((await allClients()).map((c: any) => c.firstName).sort()).toEqual(['Ava', 'Maria'])
    expect((await allBatches()).find((b: any) => b.id === ids.clientsBatch)).toMatchObject({ status: 'done' })

    // undo the shifts, then the rest of the clients can go
    const shifts = await post(`/batches/${ids.schedulesBatch}/undo`, {})
    expect(shifts.body).toMatchObject({ removed: 2, kept: [], undone: true })
    expect((await allSchedules()).length).toBe(0)
    const second = await post(`/batches/${ids.clientsBatch}/undo`, {})
    expect(second.body).toMatchObject({ removed: 1, kept: [], undone: true })
    expect((await allClients()).map((c: any) => c.firstName)).toEqual(['Ava'])
    const onboarding = await t.db.select().from(t.schema.clientOnboarding).where(eq(t.schema.clientOnboarding.clientId, ids.maria))
    expect(onboarding.length).toBe(0)
    expect((await post(`/batches/${ids.clientsBatch}/undo`, {})).body.code).toBe('already_undone')
  })

  test('a caregiver who has worked is kept; one who has not is removed with their login', async () => {
    await ins(t.schema.timeEntries, { companyId, caregiverId: ids.lee, clientId: ids.ava, startTime: new Date('2026-10-10T14:00:00Z'), endTime: new Date('2026-10-10T16:00:00Z'), isComplete: true, durationMinutes: 120, allottedMinutes: 120 })
    const r = await post(`/batches/${ids.caregiversBatch}/undo`, {})
    expect(r.body).toMatchObject({ removed: 1, undone: false })
    expect(r.body.kept[0].reason).toContain('Already in use')
    expect((await t.db.select().from(t.schema.user).where(eq(t.schema.user.email, 'sam.reed@x.com'))).length).toBe(0)
    expect((await t.db.select().from(t.schema.user).where(eq(t.schema.user.email, 'lee.park@x.com'))).length).toBe(1)
  })

  test('undo needs the delete permission, and an unknown batch is not found', async () => {
    expect((await post(`/batches/${ids.caregiversBatch}/undo`, {}, 'ann')).status).toBe(403)
    expect((await post('/batches/nope/undo', {})).status).toBe(404)
  })

  test('the list shows past imports', async () => {
    const r = await get('/batches')
    expect(r.status).toBe(200)
    expect(r.body.data.map((b: any) => b.kind).sort()).toEqual(['caregivers', 'clients', 'schedules'])
  })
})
