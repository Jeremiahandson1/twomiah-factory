// Home care parity row 9 (docs/parity/homecare-import.md): the import wizard to the reference vendors' standard — Excel (.xlsx)
// and pasted data, saved column mappings reused next time, a date-format choice, a bad cell fixed inline on the preview, re-imports
// that UPDATE matched records (the owner's overwritable fields, with an "updated" count and undo of the edits), matching by reference
// code / our id / name + zip, custom fields as "custom:" columns, several payers in one cell, bulk attach of documents and
// qualifications from a zip with its own summary, the plan-seat prediction, the 2000-row / 2 MB limits and undo across two companies.
// Behind care_import_wizard (on top of care_import).
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import fs from 'node:fs'
import path from 'node:path'
import { bootTenant, seedOwner } from './harness.ts'
import { cleanDate, detectDelimiter, applyEdits, guessMapping, MAX_IMPORT_ROWS } from '../server/crm/homecare/core/importRows.ts'
import { readXlsx, isDateFormat, serialToDate, columnIndex } from '../server/crm/homecare/core/importXlsx.ts'
import { readZip } from '../server/crm/homecare/core/importZip.ts'
import { planFromZip } from '../server/crm/homecare/core/importAttach.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = ''
let companyB = ''
const tokens: Record<string, string> = {}
const ids: Record<string, string> = {}
const XLSX = fs.readFileSync(path.join(import.meta.dir, 'fixtures', 'homecare-import-clients.xlsx'))

const login = async (email: string, password: string) =>
  (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken as string
const as = (who: string) => (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tokens[who]}` } })
const json = async (r: Response) => ({ status: r.status, body: await r.json() as any })
const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
const setFeatures = async (list: string[], co = companyId) => {
  await t.db.update(t.schema.company).set({ enabledFeatures: list } as any).where(eq(t.schema.company.id, co))
  t.services.features.forgetFeatures()
}
const BASE = ['contacts', 'scheduling', 'team', 'care_import', 'care_import_all']
const ON = [...BASE, 'care_import_wizard']
const post = async (path: string, body: any, who = 'owner') => json(await as(who)(`/api/care-import${path}`, { method: 'POST', json: body }))
const put = async (path: string, body: any, who = 'owner') => json(await as(who)(`/api/care-import${path}`, { method: 'PUT', json: body }))
const get = async (path: string, who = 'owner') => json(await as(who)(`/api/care-import${path}`))
const del = async (path: string, who = 'owner') => json(await as(who)(`/api/care-import${path}`, { method: 'DELETE' }))
const clientsOf = (co = companyId) => t.db.select().from(t.schema.clients).where(eq(t.schema.clients.companyId, co))

// ---- a zip, written the plain way (stored entries), so the attach test needs no library either ----
const CRC = (() => { const tb = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; tb[n] = c >>> 0 } return tb })()
const crc32 = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
function makeZip(files: Array<{ name: string; data: string | Buffer }>): Buffer {
  const locals: Buffer[] = [], centrals: Buffer[] = []
  let offset = 0
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8'), data = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data, 'utf8')
    const crc = crc32(data)
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x800, 6); lh.writeUInt16LE(0, 8); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(name.length, 26)
    locals.push(lh, name, data)
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x800, 8); ch.writeUInt16LE(0, 10); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(offset, 42)
    centrals.push(ch, name)
    offset += 30 + name.length + data.length
  }
  const cd = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(files.length, 8); eocd.writeUInt16LE(files.length, 10); eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, cd, eocd])
}
const attach = async (kind: string, zip: Buffer, extra: Record<string, string> = {}, who = 'owner') => {
  const form = new FormData()
  form.set('kind', kind); form.set('file', new File([new Uint8Array(zip)], 'files.zip', { type: 'application/zip' }))
  for (const [k, v] of Object.entries(extra)) form.set(k, v)
  return json(await as(who)('/api/care-import/attach', { method: 'POST', body: form }))
}

beforeAll(async () => {
  t = await bootTenant({ vertical: 'homecare' })
  const seeded = await seedOwner(t)
  companyId = seeded.company.id
  tokens.owner = await login('owner@test.example', seeded.password)
  const hash = await Bun.password.hash('Caregiver-pass-1', 'bcrypt')
  ids.ann = (await ins(t.schema.user, { email: 'ann@test.example', passwordHash: hash, firstName: 'Ann', lastName: 'Carer', role: 'caregiver', companyId })).id
  tokens.ann = await login('ann@test.example', 'Caregiver-pass-1')
  ids.sam = (await ins(t.schema.user, { email: 'sam.reed@x.com', passwordHash: hash, firstName: 'Sam', lastName: 'Reed', role: 'caregiver', companyId })).id
  ids.maria = (await ins(t.schema.clients, { companyId, firstName: 'Maria', lastName: 'Lopez', isActive: true, zip: '54701', phone: '(715) 555-0100' })).id
  ids.medicaid = (await ins(t.schema.referralSources, { companyId, name: 'Medicaid', payerType: 'medicaid', isActivePayer: true })).id
  ids.blueCross = (await ins(t.schema.referralSources, { companyId, name: 'Blue Cross', payerType: 'private_insurance', isActivePayer: true })).id
  // a second company in the same database, for the undo-across-companies test
  companyB = (await ins(t.schema.company, { name: 'Other Agency', slug: 'other-agency' })).id
  await ins(t.schema.user, { email: 'owner@other.example', passwordHash: await Bun.password.hash('Other-owner-1', 'bcrypt'), firstName: 'Otto', lastName: 'Other', role: 'owner', companyId: companyB })
  tokens.otto = await login('owner@other.example', 'Other-owner-1')
  await setFeatures(ON, companyB)
  await setFeatures(BASE)
}, 90_000)

describe('reading (pure)', () => {
  test('a date is read in the chosen format; the US default says so when a day/month date fails', () => {
    expect(cleanDate('15/3/1948', 'dmy')).toEqual({ value: '1948-03-15' })
    expect(cleanDate('3/15/1948', 'mdy')).toEqual({ value: '1948-03-15' })
    expect(cleanDate('1948/03/15', 'ymd')).toEqual({ value: '1948-03-15' })
    expect(cleanDate('15.03.1948', 'dmy')).toEqual({ value: '1948-03-15' })
    expect(cleanDate('15 Mar 2026')).toEqual({ value: '2026-03-15' })
    expect(cleanDate('March 15, 2026', 'dmy')).toEqual({ value: '2026-03-15' })
    const wrong = cleanDate('15/3/1948', 'mdy') as any
    expect(wrong.problem).toContain('choose day/month/year')
    expect(cleanDate('3/15/1948', 'dmy')).toHaveProperty('problem')
  })
  test('pasted sheet data is tab-separated; edits land on the right cell; a "custom:" heading maps itself', () => {
    expect(detectDelimiter('First\tLast\nA\tB')).toBe('\t')
    expect(detectDelimiter('First,Last\nA,B')).toBe(',')
    expect(applyEdits(['a', 'b'], [['1', '2'], ['3']], [{ line: 3, header: 'b', value: 'x' }, { line: 9, header: 'a', value: 'no' }])).toEqual([['1', '2'], ['3', 'x']])
    expect(guessMapping('clients', ['custom: Favourite meal', 'custom:Pet'])).toEqual([{ header: 'custom: Favourite meal', field: 'custom:Favourite meal', confidence: 'exact' }, { header: 'custom:Pet', field: 'custom:Pet', confidence: 'exact' }])
    expect(guessMapping('schedules', ['custom: x'])[0].field).toBeNull()
  })
  test('an Excel workbook: shared strings, booleans, numbers, and date cells as year-month-day', () => {
    const wb = readXlsx(XLSX) as any
    expect(wb.sheets.map((s: any) => s.name)).toEqual(['Clients', 'Notes'])
    expect(wb.sheets[0].rows[0]).toEqual(['First Name', 'Last Name', 'DOB', 'Phone', 'Zip', 'Private Pay', 'Rate', 'custom: Favourite meal'])
    expect(wb.sheets[0].rows[1]).toEqual(['Nora', 'Quinn', '1941-02-03', '715-555-0150', '54701', 'yes', '32.5', 'Soup'])
    expect(wb.sheets[0].rows[2].slice(2, 6)).toEqual(['1950-12-31', '(715) 555-0151', '54703', 'no'])
    expect(readXlsx(Buffer.from('First,Last\nA,B'))).toHaveProperty('code', 'bad_xlsx')
    expect(isDateFormat('mm/dd/yyyy')).toEqual({ date: true, timeOnly: false })
    expect(isDateFormat('#,##0.00')).toEqual({ date: false, timeOnly: false })
    expect(isDateFormat('h:mm AM/PM')).toEqual({ date: true, timeOnly: true })
    expect(serialToDate(45658, false)).toBe('2025-01-01')
    expect(columnIndex('AB7')).toBe(27)
  })
  test('a zip is read without a library, and files are matched to people by folder, name or index.csv', () => {
    const zip = makeZip([{ name: 'Maria Lopez/care plan.pdf', data: '%PDF-1' }, { name: 'C-1001__consent.txt', data: 'ok' }, { name: 'loose.pdf', data: 'x' }, { name: 'notes.exe', data: 'x' }, { name: 'index.csv', data: 'file,person,name,expires\nloose.pdf,Sam Reed,CPR,3/1/2027\n' }])
    const entries = readZip(zip) as any[]
    expect(entries.map((e) => e.name)).toContain('Maria Lopez/care plan.pdf')
    expect(entries.find((e) => e.name === 'C-1001__consent.txt').data().toString()).toBe('ok')
    const plan = planFromZip(entries)
    expect(plan.items).toEqual([
      { file: 'Maria Lopez/care plan.pdf', person: 'Maria Lopez', name: 'care plan' },
      { file: 'C-1001__consent.txt', person: 'C-1001', name: 'consent' },
      { file: 'loose.pdf', person: 'Sam Reed', name: 'CPR', type: undefined, number: undefined, expires: '2027-03-01' },
    ])
    expect(plan.problems[0].why).toContain('not a file type we keep')
    expect(readZip(Buffer.from('not a zip at all, honestly'))).toHaveProperty('code', 'bad_zip')
  })
})

describe('the gate', () => {
  test('without care_import_wizard the wizard options are refused; plain CSV still works', async () => {
    expect((await post('/preview', { kind: 'clients', xlsx: XLSX.toString('base64') })).body.code).toBe('FEATURE_NOT_ENABLED')
    expect((await post('/preview', { kind: 'clients', csv: 'First Name,Last Name,DOB\nA,B,15/3/1948\n', dateFormat: 'dmy' })).body.code).toBe('FEATURE_NOT_ENABLED')
    expect((await post('/preview', { kind: 'clients', csv: 'First Name,Last Name\nA,B\n', updateMatches: true })).body.code).toBe('FEATURE_NOT_ENABLED')
    expect((await post('/preview', { kind: 'clients', csv: 'First Name\tLast Name\nA\tB\n' })).body.code).toBe('FEATURE_NOT_ENABLED')
    expect((await get('/mappings/clients')).body.code).toBe('FEATURE_NOT_ENABLED')
    expect((await attach('documents', makeZip([{ name: 'Maria Lopez/a.pdf', data: 'x' }]))).body.code).toBe('FEATURE_NOT_ENABLED')
    expect((await post('/preview', { kind: 'clients', csv: 'First Name,Last Name\nA,B\n' })).status).toBe(200)
    expect((await get('/kinds')).body.kinds.some((k: any) => k.attach)).toBe(false)
    await setFeatures(ON)
    expect((await get('/kinds')).body.kinds.filter((k: any) => k.attach).map((k: any) => k.kind)).toEqual(['documents', 'qualifications'])
  })
})

describe('Excel, pasted data, the date format and fixing a cell', () => {
  test('an .xlsx previews like a CSV: dates, yes/no and a custom column read from the sheet', async () => {
    const r = await post('/preview', { kind: 'clients', xlsx: XLSX.toString('base64') })
    expect(r.status).toBe(200)
    expect(r.body.sheets).toEqual(['Clients', 'Notes'])
    expect(r.body.sheet).toBe('Clients')
    expect(r.body.counts).toMatchObject({ rows: 3, ok: 3 })
    expect(r.body.mapping.find((m: any) => m.header === 'custom: Favourite meal')).toMatchObject({ field: 'custom:Favourite meal', confidence: 'exact' })
    expect(r.body.fields.some((f: any) => f.key === 'custom:Favourite meal')).toBe(true)
    expect((await post('/preview', { kind: 'clients', xlsx: XLSX.toString('base64'), sheet: 'Notes' })).body.code).toBe('empty_file')
    expect((await post('/preview', { kind: 'clients', xlsx: XLSX.toString('base64'), sheet: 'Missing' })).body.code).toBe('bad_sheet')
    expect((await post('/preview', { kind: 'clients', xlsx: Buffer.from('nope').toString('base64') })).body.code).toBe('bad_xlsx')
  })

  test('pasted tab-separated rows are read; a day/month/year file reads with the choice and fails without it', async () => {
    const pasted = 'First Name\tLast Name\tDOB\nKai\tBrand\t15/03/1950\n'
    const us = await post('/preview', { kind: 'clients', csv: pasted })
    expect(us.body.counts).toMatchObject({ rows: 1, errors: 1 })
    expect(us.body.rows[0].problems[0]).toContain('choose day/month/year')
    const uk = await post('/preview', { kind: 'clients', csv: pasted, dateFormat: 'dmy' })
    expect(uk.body).toMatchObject({ dateFormat: 'dmy', counts: { ok: 1 } })
    expect(uk.body.rows[0].label).toBe('Kai Brand')
  })

  test('a bad cell comes back with the row and can be fixed in place; the fix is what gets saved', async () => {
    const csv = 'First Name,Last Name,Phone,Zip\nIda,Wolf,12345,54701\n'
    const bad = await post('/preview', { kind: 'clients', csv })
    expect(bad.body.rows[0]).toMatchObject({ status: 'error', cells: { 'First Name': 'Ida', Phone: '12345' } })
    const fixed = await post('/preview', { kind: 'clients', csv, edits: [{ line: 2, header: 'Phone', value: '715-555-0199' }] })
    expect(fixed.body.rows[0]).toMatchObject({ status: 'ok' })
    expect(fixed.body.rows[0].cells).toBeUndefined()
    const r = await post('/commit', { kind: 'clients', csv, edits: [{ line: 2, header: 'Phone', value: '715-555-0199' }] })
    expect(r.body).toMatchObject({ created: 1 })
    const ida = (await clientsOf() as any[]).find((c) => c.firstName === 'Ida')
    expect(ida.phone).toBe('(715) 555-0199')
    ids.ida = ida.id
  })
})

describe('saved mappings', () => {
  test('a mapping saved for a set of headings is reused next time without asking, and can be removed', async () => {
    const csv = 'Given,Family,Mobile\nUna,Voss,715-555-0123\n'
    const first = await post('/preview', { kind: 'clients', csv })
    expect(first.body.ready).toBe(false)
    expect(first.body.savedMapping).toBeNull()
    const save = await post('/mappings', { kind: 'clients', name: 'Old system export', headers: ['Given', 'Family', 'Mobile'], mapping: { Given: 'firstName', Family: 'lastName', Mobile: 'phone' } })
    expect(save.status).toBe(201)
    ids.mapping = save.body.id
    const again = await post('/preview', { kind: 'clients', csv })
    expect(again.body).toMatchObject({ ready: true, savedMapping: { id: ids.mapping, name: 'Old system export' }, counts: { ok: 1 } })
    expect(again.body.mapping.map((m: any) => m.field)).toEqual(['firstName', 'lastName', 'phone'])
    // the same name again replaces it
    expect((await post('/mappings', { kind: 'clients', name: 'Old system export', headers: ['Given', 'Family', 'Mobile'], mapping: { Given: 'firstName', Family: 'lastName', Mobile: null } })).status).toBe(200)
    expect((await post('/preview', { kind: 'clients', csv })).body.mapping.map((m: any) => m.field)).toEqual(['firstName', 'lastName', null])
    expect((await get('/mappings/clients')).body.data.map((m: any) => m.name)).toEqual(['Old system export'])
    expect((await post('/mappings', { kind: 'clients', name: '', headers: ['a'], mapping: {} })).status).toBe(400)
    expect((await del(`/mappings/${ids.mapping}`)).status).toBe(200)
    expect((await post('/preview', { kind: 'clients', csv })).body.ready).toBe(false)
    expect((await del(`/mappings/${ids.mapping}`)).status).toBe(404)
  })
})

describe('re-import updates matched records', () => {
  test('the owner picks which fields a re-import may overwrite; an admin may, a caregiver may not, a name never', async () => {
    const choices = await get('/overwrite/clients')
    expect(choices.body.fields).toEqual([])
    expect(choices.body.choices.map((c: any) => c.key)).toContain('phone')
    expect(choices.body.choices.map((c: any) => c.key)).not.toContain('firstName')
    expect((await put('/overwrite/clients', { fields: ['phone', 'zip'] }, 'ann')).status).toBe(403)
    expect((await put('/overwrite/clients', { fields: ['firstName'] })).status).toBe(400)
    const set = await put('/overwrite/clients', { fields: ['phone', 'zip', 'notes'] })
    expect(set.body.fields).toEqual(['phone', 'zip', 'notes'])
    expect((await get('/overwrite/clients')).body.fields).toEqual(['phone', 'zip', 'notes'])
  })

  test('a matched row is an "update" only when asked; the commit counts it, keeps what it was, and undo puts it back', async () => {
    const csv = 'First Name,Last Name,Phone,Zip,Notes,Email\nMaria,Lopez,715-555-0177,54703,Prefers mornings,maria@x.com\n'
    const plain = await post('/preview', { kind: 'clients', csv })
    expect(plain.body.rows[0].status).toBe('duplicate')
    const asked = await post('/preview', { kind: 'clients', csv, updateMatches: true })
    expect(asked.body.rows[0]).toMatchObject({ status: 'update', changes: ['Phone', 'Zip', 'Notes'] })
    expect(asked.body.counts).toMatchObject({ ok: 0, duplicates: 0, updates: 1 })
    const dry = await post('/commit', { kind: 'clients', csv, updateMatches: true, dryRun: true })
    expect(dry.body).toMatchObject({ wouldCreate: 0, wouldUpdate: 1 })
    const r = await post('/commit', { kind: 'clients', csv, updateMatches: true, fileName: 'again.csv' })
    expect(r.status).toBe(201)
    expect(r.body).toMatchObject({ created: 0, updated: 1 })
    ids.updateBatch = r.body.batchId
    let maria = (await clientsOf() as any[]).find((c) => c.id === ids.maria)
    // email is not on the owner's list, so it was not touched
    expect(maria).toMatchObject({ phone: '(715) 555-0177', zip: '54703', notes: 'Prefers mornings', email: null })
    const batches = await get('/batches')
    expect(batches.body.data.find((b: any) => b.id === ids.updateBatch)).toMatchObject({ created: 0, updated: 1, fileName: 'again.csv' })
    // the same file again changes nothing, so no batch is kept
    expect((await post('/commit', { kind: 'clients', csv, updateMatches: true })).body).toMatchObject({ batchId: null, updated: 0 })
    const undo = await post(`/batches/${ids.updateBatch}/undo`, {})
    expect(undo.body).toMatchObject({ removed: 0, restored: 1, undone: true })
    maria = (await clientsOf() as any[]).find((c) => c.id === ids.maria)
    expect(maria).toMatchObject({ phone: '(715) 555-0100', zip: '54701', notes: null })
  })
})

describe('reference codes, name + zip, custom fields and payers in one cell', () => {
  test('a reference code is kept and finds the record next time whatever the name; name + zip is the surest name match', async () => {
    const csv = 'Reference code,First Name,Last Name,Zip,custom: Favourite meal,Payers\nC-1001,Nils,Berg,54701,Soup,Medicaid; Blue Cross\nC-1002,Maria,Lopez,54701,,\nC-1003,Maria,Lopez,99999,,Nowhere Mutual\n'
    const pre = await post('/preview', { kind: 'clients', csv })
    expect(pre.body.rows[0].status).toBe('ok')
    expect(pre.body.rows[1]).toMatchObject({ status: 'duplicate', duplicateOf: 'Already a client with this name and zip' })
    expect(pre.body.rows[2].problems[0]).toContain('no payer named "Nowhere Mutual"')
    const r = await post('/commit', { kind: 'clients', csv })
    expect(r.body).toMatchObject({ created: 1, skippedDuplicates: 1, skippedBadRows: 1 })
    ids.nilsBatch = r.body.batchId
    const nils = (await clientsOf() as any[]).find((c) => c.firstName === 'Nils')
    ids.nils = nils.id
    expect(nils.referredById).toBe(ids.medicaid)
    const ext = await t.db.select().from(t.schema.importExternalId).where(eq(t.schema.importExternalId.recordId, nils.id))
    expect(ext[0]).toMatchObject({ entity: 'client', externalId: 'C-1001' })
    const custom = await get(`/custom-fields/client/${nils.id}`)
    expect(custom.body.data).toEqual([{ name: 'Favourite meal', value: 'Soup' }])
    const splits = await t.db.select().from(t.schema.clientBillingSplits).where(eq(t.schema.clientBillingSplits.clientId, nils.id))
    expect(splits.map((s: any) => [s.payerId, s.priority, s.kind, s.value])).toEqual([[ids.medicaid, 1, 'percent', '100.00'], [ids.blueCross, 2, 'percent', '100.00']])
    // the same code with a new spelling of the name is the same client
    const renamed = await post('/preview', { kind: 'clients', csv: 'Reference code,First Name,Last Name\nc-1001,Nils,Bergstrom\n' })
    expect(renamed.body.rows[0]).toMatchObject({ status: 'duplicate', duplicateOf: 'Already a client with this reference code' })
    // a child file names the client by the code
    const med = await post('/preview', { kind: 'medications', csv: 'Client,Medicine\nC-1001,Aspirin\n' })
    expect(med.body.rows[0].status).toBe('ok')
    // and by our own id
    expect((await post('/preview', { kind: 'medications', csv: `Client,Medicine\n${nils.id},Aspirin\n` })).body.rows[0].status).toBe('ok')
    // undo removes the code, the custom fields and the payer rows with the client
    expect((await post(`/batches/${ids.nilsBatch}/undo`, {})).body).toMatchObject({ removed: 1, undone: true })
    expect((await t.db.select().from(t.schema.importExternalId).where(eq(t.schema.importExternalId.recordId, nils.id))).length).toBe(0)
    expect((await t.db.select().from(t.schema.customFieldValue).where(eq(t.schema.customFieldValue.recordId, nils.id))).length).toBe(0)
    expect((await t.db.select().from(t.schema.clientBillingSplits).where(eq(t.schema.clientBillingSplits.clientId, nils.id))).length).toBe(0)
  })

  test('a caregiver file with a reference code; a payer file with one too', async () => {
    const r = await post('/commit', { kind: 'caregivers', csv: 'Employee ID,Name,Email\nE-7,Tess Young,tess@x.com\n' })
    expect(r.body.created).toBe(1)
    const tess = (await t.db.select().from(t.schema.user).where(eq(t.schema.user.email, 'tess@x.com')))[0] as any
    expect((await t.db.select().from(t.schema.importExternalId).where(eq(t.schema.importExternalId.recordId, tess.id)))[0]).toMatchObject({ entity: 'caregiver', externalId: 'E-7' })
    expect((await post('/preview', { kind: 'caregivers', csv: 'Employee ID,Name,Email\nE-7,Tess Young-Smith,tess2@x.com\n' })).body.rows[0].duplicateOf).toBe('Already a caregiver with this reference code')
    expect((await post('/preview', { kind: 'payRates', csv: 'Caregiver,Hourly rate,Effective from\nE-7,20,1/1/2026\n' })).body.rows[0].status).toBe('ok')
    ids.tess = tess.id
    const p = await post('/commit', { kind: 'payers', csv: 'Name,Reference code\nAetna,P-9\n' })
    expect(p.body.created).toBe(1)
    expect((await post('/preview', { kind: 'payers', csv: 'Name,Reference code\nAetna Better Health,P-9\n' })).body.rows[0].duplicateOf).toBe('Already a payer with this reference code')
  })
})

describe('bulk attach from a zip', () => {
  test('documents go to the client each file names; a stranger and a repeat are skipped; the summary says which; undo removes them', async () => {
    await post('/commit', { kind: 'clients', csv: 'Reference code,First Name,Last Name\nC-2001,Olga,Reyes\n' })
    const zip = makeZip([{ name: 'Maria Lopez/care plan.pdf', data: '%PDF-1 care plan' }, { name: 'C-2001__consent.txt', data: 'consent' }, { name: 'Nobody Here/x.pdf', data: 'x' }, { name: 'Maria Lopez/photo.exe', data: 'x' }])
    const dry = await attach('documents', zip, { dryRun: 'true' })
    expect(dry.status).toBe(200)
    expect(dry.body).toMatchObject({ dryRun: true, attached: 2, skipped: 2, failed: 0, batchId: null })
    expect((await t.db.select().from(t.schema.documents).where(eq(t.schema.documents.companyId, companyId))).length).toBe(0)
    const r = await attach('documents', zip)
    expect(r.status).toBe(201)
    expect(r.body).toMatchObject({ attached: 2, skipped: 2, failed: 0 })
    expect(r.body.skippedFiles.map((s: any) => s.file).sort()).toEqual(['Maria Lopez/photo.exe', 'Nobody Here/x.pdf'])
    ids.docBatch = r.body.batchId
    const docs = await t.db.select().from(t.schema.documents).where(eq(t.schema.documents.companyId, companyId)) as any[]
    expect(docs.length).toBe(2)
    const plan = docs.find((d) => d.fileName === 'care plan.pdf')
    expect(plan).toMatchObject({ entityType: 'client', entityId: ids.maria, name: 'care plan', fileType: 'application/pdf', fileSize: 16 })
    expect(Buffer.from(plan.fileData, 'base64').toString()).toBe('%PDF-1 care plan')
    // the same zip again attaches nothing
    expect((await attach('documents', zip)).body).toMatchObject({ attached: 0, skipped: 4, batchId: null })
    expect((await get('/batches')).body.data.find((b: any) => b.id === ids.docBatch)).toMatchObject({ kind: 'documents', attached: 2, kindLabel: 'Client documents (zip)' })
    expect((await post(`/batches/${ids.docBatch}/undo`, {})).body).toMatchObject({ removed: 2, undone: true })
    expect((await t.db.select().from(t.schema.documents).where(eq(t.schema.documents.companyId, companyId))).length).toBe(0)
    // a caregiver may not attach client documents
    expect((await attach('documents', zip, {}, 'ann')).status).toBe(403)
    expect((await attach('horses', zip)).body.code).toBe('bad_kind')
  })

  test('qualifications make a certification record with its certificate; index.csv gives the type and expiry', async () => {
    const zip = makeZip([{ name: 'index.csv', data: 'file,person,name,expires,number\ncpr.pdf,sam.reed@x.com,CPR,3/1/2027,C-9\nE-7/first-aid.pdf,E-7,,,\n' }, { name: 'cpr.pdf', data: '%PDF cpr' }, { name: 'E-7/first-aid.pdf', data: '%PDF first aid' }])
    const r = await attach('qualifications', zip)
    expect(r.body).toMatchObject({ attached: 2, skipped: 0, failed: 0 })
    ids.qualBatch = r.body.batchId
    const certs = await t.db.select().from(t.schema.certificationRecords).where(eq(t.schema.certificationRecords.companyId, companyId)) as any[]
    const cpr = certs.find((c) => c.certificationType === 'CPR')
    expect(cpr).toMatchObject({ caregiverId: ids.sam, expiryDate: '2027-03-01', certificationNumber: 'C-9', status: 'active' })
    expect(cpr.documentUrl).toMatch(/^\/api\/documents\/[a-z0-9]+\/download$/)
    expect(certs.find((c) => c.certificationType === 'first-aid').caregiverId).toBe(ids.tess)
    const docs = await t.db.select().from(t.schema.documents).where(eq(t.schema.documents.companyId, companyId)) as any[]
    expect(docs.map((d) => [d.entityType, d.documentType]).sort()).toEqual([['caregiver', 'certification'], ['caregiver', 'certification']])
    expect((await post(`/batches/${ids.qualBatch}/undo`, {})).body).toMatchObject({ removed: 2, undone: true })
    expect((await t.db.select().from(t.schema.certificationRecords).where(eq(t.schema.certificationRecords.companyId, companyId))).length).toBe(0)
    expect((await t.db.select().from(t.schema.documents).where(eq(t.schema.documents.companyId, companyId))).length).toBe(0)
  })
})

describe('the plan\'s seats, the limits, and two companies', () => {
  test('the preview and the dry run count the seats left, so a full plan is predicted before the real run refuses it', async () => {
    const active = (await t.db.select().from(t.schema.user).where(eq(t.schema.user.companyId, companyId))).length
    await t.db.update(t.schema.company).set({ settings: { seatLimit: active + 1 } } as any).where(eq(t.schema.company.id, companyId))
    const csv = 'Name,Email\nPam One,pam1@x.com\nPam Two,pam2@x.com\n'
    const pre = await post('/preview', { kind: 'caregivers', csv })
    expect(pre.body.counts).toMatchObject({ ok: 1, errors: 1 })
    expect(pre.body.rows[1].problems[0]).toContain('No seat left on the plan')
    const dry = await post('/commit', { kind: 'caregivers', csv, dryRun: true })
    expect(dry.body).toMatchObject({ wouldCreate: 1, wouldSkipBadRows: 1 })
    const r = await post('/commit', { kind: 'caregivers', csv })
    expect(r.body).toMatchObject({ created: 1, skippedBadRows: 1, failures: [] })
    // the plan is full now: the real insert's own refusal agrees with the prediction
    const full = await post('/commit', { kind: 'caregivers', csv: 'Name,Email\nPam Three,pam3@x.com\n' })
    expect(full.body).toMatchObject({ created: 0, skippedBadRows: 1 })
    expect((await t.db.select().from(t.schema.user).where(eq(t.schema.user.email, 'pam3@x.com'))).length).toBe(0)
    await t.db.update(t.schema.company).set({ settings: {} } as any).where(eq(t.schema.company.id, companyId))
  })

  test('more than 2000 rows, or more than 2 MB, is refused before anything is read', async () => {
    const many = 'First Name,Last Name\n' + Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => `P${i},Q`).join('\n') + '\n'
    const r = await post('/preview', { kind: 'clients', csv: many })
    expect(r.status).toBe(400)
    expect(r.body.code).toBe('too_many_rows')
    expect(r.body.error).toContain('2001 rows')
    const big = 'First Name,Last Name,Notes\nA,B,' + 'x'.repeat(2_000_001) + '\n'
    expect((await post('/preview', { kind: 'clients', csv: big })).body.code).toBe('file_too_big')
    expect((await post('/preview', { kind: 'clients', xlsx: Buffer.alloc(8_000_001).toString('base64') })).body.code).toBe('file_too_big')
    expect((await post('/preview', { kind: 'clients', csv: 'First Name,Last Name\n' + Array.from({ length: MAX_IMPORT_ROWS }, (_, i) => `P${i},Q`).join('\n') + '\n' })).status).toBe(200)
  }, 30_000)

  test('undo reaches only the company that ran the import; another company cannot see or undo it', async () => {
    const csv = 'First Name,Last Name\nSame,Name\n'
    const a = await post('/commit', { kind: 'clients', csv })
    const b = await post('/commit', { kind: 'clients', csv }, 'otto')
    expect(a.body.created).toBe(1)
    expect(b.body.created).toBe(1)
    expect((await post(`/batches/${a.body.batchId}/undo`, {}, 'otto')).status).toBe(404)
    expect((await get('/batches', 'otto')).body.data.map((x: any) => x.id)).toEqual([b.body.batchId])
    expect((await post(`/batches/${b.body.batchId}/undo`, {}, 'otto')).body).toMatchObject({ removed: 1, undone: true })
    expect((await clientsOf(companyB)).length).toBe(0)
    expect((await clientsOf() as any[]).some((c) => c.firstName === 'Same')).toBe(true)
    expect((await post(`/batches/${a.body.batchId}/undo`, {})).body).toMatchObject({ removed: 1, undone: true })
  })
})
