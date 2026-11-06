// Home care parity row 10 (docs/parity/homecare-import.md): assisted migration tooling — the agency sends its old system's export
// through the app, Twomiah staff run the SAME importer for it through the Factory's door (X-Factory-Key), a record-count comparison
// old vs new, and a sign-off checklist both sides tick. Behind care_migration (hidden). Staffing it is the owner's decision.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import fs from 'node:fs'
import path from 'node:path'
import { bootTenant, seedOwner } from './harness.ts'
import { SIGNOFF_ITEMS, COUNTED_KINDS } from '../server/crm/homecare/core/migration.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = ''
const tokens: Record<string, string> = {}
const ids: Record<string, string> = {}
const KEY = 'factory-key-for-migration-test'
const XLSX = fs.readFileSync(path.join(import.meta.dir, 'fixtures', 'homecare-import-clients.xlsx'))
const CLIENTS_CSV = 'First Name,Last Name,DOB,Zip\nMaria,Lopez,3/15/1948,54701\nWalt,Nye,1950-07-04,54703\nBad,Date,13/45/2020,\n'

const login = async (email: string, password: string) =>
  (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken as string
const as = (who: string) => (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tokens[who]}` } })
const json = async (r: Response) => ({ status: r.status, body: await r.json() as any })
const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
const setFeatures = async (list: string[]) => {
  await t.db.update(t.schema.company).set({ enabledFeatures: list } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
}
const BASE = ['contacts', 'scheduling', 'team', 'care_import', 'care_import_all', 'care_import_wizard']
const agency = async (method: string, p: string, body?: any, who = 'owner') => json(await as(who)(`/api/care-migration${p}`, body === undefined ? { method } : { method, json: body }))
const factory = async (method: string, p: string, body?: any, key = KEY) =>
  json(await t.call(`/api/internal/care-migration${p}`, { method, headers: { 'X-Factory-Key': key }, ...(body === undefined ? {} : { json: body }) }))
const send = async (files: Array<{ name: string; data: Buffer | string }>, fields: Record<string, string> = {}, who = 'owner') => {
  const form = new FormData()
  for (const f of files) form.append('files', new File([typeof f.data === 'string' ? f.data : new Uint8Array(f.data)], f.name))
  for (const [k, v] of Object.entries(fields)) form.set(k, v)
  return json(await as(who)('/api/care-migration/requests', { method: 'POST', body: form }))
}

beforeAll(async () => {
  process.env.FACTORY_SYNC_KEY = KEY
  t = await bootTenant({ vertical: 'homecare' })
  const seeded = await seedOwner(t)
  companyId = seeded.company.id
  tokens.owner = await login('owner@test.example', seeded.password)
  const hash = await Bun.password.hash('Caregiver-pass-1', 'bcrypt')
  ids.ann = (await ins(t.schema.user, { email: 'ann@test.example', passwordHash: hash, firstName: 'Ann', lastName: 'Carer', role: 'caregiver', companyId })).id
  tokens.ann = await login('ann@test.example', 'Caregiver-pass-1')
  await ins(t.schema.clients, { companyId, firstName: 'Ava', lastName: 'Existing', isActive: true })
  await setFeatures(BASE)
}, 90_000)

describe('the checklist and the counts (pure)', () => {
  test('the checklist names who signs each item; every import kind and both attach kinds are counted', () => {
    expect(SIGNOFF_ITEMS.map((i) => i.id)).toEqual(['files', 'dry_run', 'clients', 'caregivers', 'schedules', 'billing', 'hr', 'dates', 'counts', 'go_live'])
    expect(SIGNOFF_ITEMS.find((i) => i.id === 'go_live')?.who).toBe('agency')
    expect(COUNTED_KINDS.map((c) => c.kind)).toContain('billingHistory')
    expect(COUNTED_KINDS.map((c) => c.kind)).toContain('qualifications')
  })
})

describe('the gate', () => {
  test('without care_migration both doors are shut; the Factory door also needs the key', async () => {
    expect((await agency('GET', '/requests')).body).toMatchObject({ code: 'FEATURE_NOT_ENABLED', feature: 'care_migration' })
    expect((await factory('GET', '/requests')).body.code).toBe('FEATURE_NOT_ENABLED')
    await setFeatures([...BASE, 'care_migration'])
    expect((await factory('GET', '/requests', undefined, 'wrong-key')).status).toBe(401)
    expect((await factory('GET', '/requests')).status).toBe(200)
    expect((await agency('GET', '/requests', undefined, 'ann')).status).toBe(403)
  })
})

describe('the agency sends its export', () => {
  test('a request keeps the files, the note and the system it came from; a caregiver cannot send; an empty send is refused', async () => {
    expect((await send([{ name: 'clients.csv', data: CLIENTS_CSV }], {}, 'ann')).status).toBe(403)
    expect((await send([], { note: 'nothing attached' })).body.code).toBe('empty_file')
    const r = await send([{ name: 'clients.csv', data: CLIENTS_CSV }, { name: 'more-clients.xlsx', data: XLSX }], { fromSystem: 'AxisCare', note: 'Two files. Dates are US.' })
    expect(r.status).toBe(201)
    expect(r.body).toMatchObject({ status: 'sent', statusLabel: 'Sent to Twomiah', fromSystem: 'AxisCare', note: 'Two files. Dates are US.', batches: [] })
    expect(r.body.files.map((f: any) => [f.name, f.size])).toEqual([['clients.csv', CLIENTS_CSV.length], ['more-clients.xlsx', XLSX.length]])
    expect(r.body.files[0].data).toBeUndefined()
    expect(r.body.checklist.length).toBe(SIGNOFF_ITEMS.length)
    expect(r.body.checklist.every((c: any) => c.signoff === null)).toBe(true)
    ids.request = r.body.id
    ids.csvFile = r.body.files[0].id
    ids.xlsxFile = r.body.files[1].id
    const list = await agency('GET', '/requests')
    expect(list.body.data.map((x: any) => x.id)).toEqual([ids.request])
    expect((await agency('GET', '/requests/nope')).status).toBe(404)
  })

  test('the agency types the old system\'s counts; the comparison shows old, now and the difference per kind', async () => {
    expect((await agency('PUT', `/requests/${ids.request}/old-counts`, { counts: { clients: 'many' } })).status).toBe(400)
    expect((await agency('PUT', `/requests/${ids.request}/old-counts`, { counts: { horses: 1 } })).status).toBe(400)
    const r = await agency('PUT', `/requests/${ids.request}/old-counts`, { counts: { clients: 3, caregivers: 1, payers: '' } })
    expect(r.body.oldCounts).toEqual({ clients: 3, caregivers: 1 })
    const cmp = await agency('GET', `/requests/${ids.request}/comparison`)
    expect(cmp.status).toBe(200)
    const row = (k: string) => cmp.body.data.find((x: any) => x.kind === k)
    expect(row('clients')).toEqual({ kind: 'clients', label: 'Clients', old: 3, now: 1, difference: -2 })
    expect(row('caregivers')).toEqual({ kind: 'caregivers', label: 'Caregivers', old: 1, now: 1, difference: 0 })
    expect(row('payers')).toMatchObject({ old: null, now: 0, difference: null })
    expect(cmp.body.data.length).toBe(COUNTED_KINDS.length)
  })

  test('the agency signs off its own items with the person\'s name and time, not the staff items', async () => {
    const r = await agency('PUT', `/requests/${ids.request}/signoff`, { item: 'clients', done: true })
    expect(r.status).toBe(200)
    const item = r.body.checklist.find((c: any) => c.id === 'clients')
    expect(item.signoff).toMatchObject({ by: 'Olive Owner', side: 'agency' })
    expect(typeof item.signoff.at).toBe('string')
    expect((await agency('PUT', `/requests/${ids.request}/signoff`, { item: 'files', done: true })).status).toBe(403)
    expect((await agency('PUT', `/requests/${ids.request}/signoff`, { item: 'nope', done: true })).status).toBe(400)
    const off = await agency('PUT', `/requests/${ids.request}/signoff`, { item: 'clients', done: false })
    expect(off.body.checklist.find((c: any) => c.id === 'clients').signoff).toBeNull()
  })
})

describe('Twomiah staff run the same importer from the Factory', () => {
  test('staff see the request and its files, and get a file back whole', async () => {
    const list = await factory('GET', '/requests')
    expect(list.body.data[0]).toMatchObject({ id: ids.request, fromSystem: 'AxisCare' })
    const f = await factory('GET', `/files/${ids.csvFile}`)
    expect(f.status).toBe(200)
    expect(Buffer.from(f.body.data, 'base64').toString()).toBe(CLIENTS_CSV)
    expect((await factory('GET', '/files/nope')).status).toBe(404)
    expect((await factory('GET', '/kinds')).body.kinds.length).toBeGreaterThan(10)
  })

  test('a dry run previews the file; the real run creates the rows under the Factory\'s name and is listed on the request', async () => {
    const dry = await factory('POST', `/requests/${ids.request}/import`, { fileId: ids.csvFile, kind: 'clients', by: 'staff@twomiah.com', dryRun: true })
    expect(dry.status).toBe(200)
    expect(dry.body.counts).toMatchObject({ rows: 3, ok: 2, errors: 1 })
    expect((await t.db.select().from(t.schema.clients).where(eq(t.schema.clients.companyId, companyId))).length).toBe(1)
    expect((await factory('POST', `/requests/${ids.request}/import`, { fileId: 'nope', kind: 'clients', by: 'x' })).status).toBe(404)
    expect((await factory('POST', `/requests/${ids.request}/import`, { fileId: ids.csvFile, kind: 'horses', by: 'x' })).status).toBe(400)
    const r = await factory('POST', `/requests/${ids.request}/import`, { fileId: ids.csvFile, kind: 'clients', by: 'staff@twomiah.com' })
    expect(r.status).toBe(201)
    expect(r.body).toMatchObject({ created: 2, skippedBadRows: 1 })
    ids.batch = r.body.batchId
    const req = await factory('GET', `/requests/${ids.request}`)
    expect(req.body.status).toBe('in_progress')
    expect(req.body.batches.map((b: any) => b.id)).toEqual([ids.batch])
    expect(req.body.batches[0]).toMatchObject({ source: 'factory', createdBy: 'factory:staff@twomiah.com', kind: 'clients', created: 2, fileName: 'clients.csv' })
    // the agency sees the same batch in its own import history
    const agencyView = await json(await as('owner')('/api/care-import/batches'))
    expect(agencyView.body.data.find((b: any) => b.id === ids.batch)).toMatchObject({ source: 'factory' })
    // an Excel file on the request runs through the same reader
    const xl = await factory('POST', `/requests/${ids.request}/import`, { fileId: ids.xlsxFile, kind: 'clients', by: 'staff@twomiah.com', dryRun: true })
    expect(xl.body).toMatchObject({ sheet: 'Clients', counts: { ok: 3 } })
    const cmp = await factory('GET', `/requests/${ids.request}/comparison`)
    expect(cmp.body.data.find((x: any) => x.kind === 'clients')).toMatchObject({ old: 3, now: 3, difference: 0 })
  })

  test('staff sign off their items, set the status with a note, and can undo a batch they ran', async () => {
    const ok = await factory('PUT', `/requests/${ids.request}/signoff`, { item: 'files', done: true, by: 'staff@twomiah.com' })
    expect(ok.body.checklist.find((c: any) => c.id === 'files').signoff).toMatchObject({ by: 'staff@twomiah.com', side: 'staff' })
    expect((await factory('PUT', `/requests/${ids.request}/signoff`, { item: 'go_live', done: true, by: 'staff@twomiah.com' })).status).toBe(403)
    const both = await factory('PUT', `/requests/${ids.request}/signoff`, { item: 'dates', done: true, by: 'staff@twomiah.com' })
    expect(both.body.checklist.find((c: any) => c.id === 'dates').signoff.side).toBe('staff')
    const status = await factory('PUT', `/requests/${ids.request}/status`, { status: 'done', staffNote: 'Loaded clients; shifts next week.' })
    expect(status.body).toMatchObject({ status: 'done', statusLabel: 'Done', staffNote: 'Loaded clients; shifts next week.' })
    expect((await factory('PUT', `/requests/${ids.request}/status`, { status: 'lost' })).status).toBe(400)
    const undo = await factory('POST', `/batches/${ids.batch}/undo`, { by: 'staff@twomiah.com' })
    expect(undo.body).toMatchObject({ removed: 2, undone: true })
    expect((await t.db.select().from(t.schema.clients).where(eq(t.schema.clients.companyId, companyId))).length).toBe(1)
    // the agency can cancel its request
    expect((await agency('POST', `/requests/${ids.request}/cancel`)).body.status).toBe('cancelled')
  })
})
