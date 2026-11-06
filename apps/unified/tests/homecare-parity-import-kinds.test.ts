// Home care parity row 8 (docs/parity/homecare-import.md): import every record kind — authorizations, certifications and client
// credentials, medicine lists, pay rates, payers, important contacts, billing history, training, leave, journal entries, reviews and
// expenses — each with a template, a duplicate rule and undo, through the same importer as clients. Behind care_import_all (on top of care_import).
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { FIELDS, IMPORT_KINDS, BASE_KINDS, cleanCents, cleanChoice, cleanTimes, templateCsv } from '../server/crm/homecare/core/importRows.ts'
import { CHILD_KINDS } from '../server/crm/homecare/core/importKinds.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = ''
const tokens: Record<string, string> = {}
const ids: Record<string, string> = {}
const TZ = 'America/Chicago'

const login = async (email: string, password: string) =>
  (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken as string
const as = (who: string) => (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tokens[who]}` } })
const json = async (r: Response) => ({ status: r.status, body: await r.json() as any })
const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
const setFeatures = async (list: string[]) => {
  await t.db.update(t.schema.company).set({ enabledFeatures: list } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
}
const BASE = ['contacts', 'scheduling', 'team', 'care_import']
const post = async (path: string, body: any, who = 'owner') => json(await as(who)(`/api/care-import${path}`, { method: 'POST', json: body }))
const get = async (path: string, who = 'owner') => json(await as(who)(`/api/care-import${path}`))
const rowsOf = (table: any) => t.db.select().from(table).where(eq(table.companyId, companyId))

beforeAll(async () => {
  t = await bootTenant({ vertical: 'homecare' })
  const seeded = await seedOwner(t)
  companyId = seeded.company.id
  await t.db.update(t.schema.company).set({ timezone: TZ } as any).where(eq(t.schema.company.id, companyId))
  tokens.owner = await login('owner@test.example', seeded.password)
  const hash = await Bun.password.hash('Caregiver-pass-1', 'bcrypt')
  ids.ann = (await ins(t.schema.user, { email: 'ann@test.example', passwordHash: hash, firstName: 'Ann', lastName: 'Carer', role: 'caregiver', companyId })).id
  tokens.ann = await login('ann@test.example', 'Caregiver-pass-1')
  ids.sam = (await ins(t.schema.user, { email: 'sam.reed@x.com', passwordHash: hash, firstName: 'Sam', lastName: 'Reed', role: 'caregiver', companyId })).id
  ids.maria = (await ins(t.schema.clients, { companyId, firstName: 'Maria', lastName: 'Lopez', isActive: true, zip: '54701' })).id
  ids.walt = (await ins(t.schema.clients, { companyId, firstName: 'Walt', lastName: 'Nye', isActive: true })).id
  // two clients with the same name: a row naming "Pat Client" cannot tell which
  await ins(t.schema.clients, { companyId, firstName: 'Pat', lastName: 'Client', isActive: true })
  await ins(t.schema.clients, { companyId, firstName: 'Pat', lastName: 'Client', isActive: true })
  ids.medicaid = (await ins(t.schema.referralSources, { companyId, name: 'Medicaid', type: 'medicaid', payerType: 'medicaid', isActivePayer: true })).id
  await setFeatures(BASE)
}, 90_000)

describe('the record kinds (pure)', () => {
  test('every kind of the brief has a layout, a template with an example row, and a permission', () => {
    const want: string[] = ['authorizations', 'certifications', 'clientCredentials', 'medications', 'payRates', 'payers', 'contacts', 'billingHistory', 'training', 'leave', 'journals', 'reviews', 'expenses']
    for (const k of want) expect(IMPORT_KINDS as readonly string[]).toContain(k)
    expect(CHILD_KINDS.map((s) => String(s.kind)).sort()).toEqual([...want].sort())
    for (const s of CHILD_KINDS) {
      const tpl = templateCsv(s.kind)
      expect(tpl.csv.split('\n').length).toBe(3)
      expect(FIELDS[s.kind].some((f) => f.required)).toBe(true)
      expect(s.keyColumns.length).toBeGreaterThan(0)
      expect(s.permission.create).toMatch(/^care-/)
    }
    expect(BASE_KINDS).toEqual(['clients', 'caregivers', 'schedules'])
  })
  test('money is read as integer cents; choices by code or label; several times in one cell', () => {
    expect(cleanCents('$1,250.00')).toEqual({ value: 125000 })
    expect(cleanCents('(42.17)')).toEqual({ value: -4217 })
    expect(cleanCents('twelve')).toHaveProperty('problem')
    expect(cleanChoice('Private insurance', { private_insurance: 'Private insurance', medicaid: 'Medicaid' })).toEqual({ value: 'private_insurance' })
    expect(cleanChoice('MEDICAID', { private_insurance: 'Private insurance', medicaid: 'Medicaid' })).toEqual({ value: 'medicaid' })
    expect(cleanChoice('HMO', { medicaid: 'Medicaid' })).toHaveProperty('problem')
    expect(cleanTimes('8:00 AM; 8pm')).toEqual({ value: ['08:00', '20:00'] })
  })
})

describe('the gate', () => {
  test('without care_import_all a child kind is refused while clients still import; a caregiver is refused on every kind', async () => {
    const r = await post('/preview', { kind: 'medications', csv: 'Client,Medicine\nMaria Lopez,Metformin\n' })
    expect(r.status).toBe(403)
    expect(r.body.code).toBe('FEATURE_NOT_ENABLED')
    expect((await get('/template/medications')).status).toBe(403)
    expect((await post('/preview', { kind: 'clients', csv: 'First Name,Last Name\nNew,Person\n' })).status).toBe(200)
    expect((await get('/kinds')).body.kinds.map((k: any) => k.kind)).toEqual(['clients', 'caregivers', 'schedules'])
    await setFeatures([...BASE, 'care_import_all'])
    expect((await get('/kinds')).body.kinds.length).toBe(3 + CHILD_KINDS.length)
    for (const k of ['authorizations', 'payRates', 'medications']) expect((await post('/preview', { kind: k, csv: 'a,b\n1,2\n' }, 'ann')).status).toBe(403)
    expect((await get('/template/horses')).body.code).toBe('bad_kind')
  })
})

describe('authorizations, payers and billing history (care-billing)', () => {
  test('an authorization finds its client and payer by name; a name two clients share is refused; the duplicate rule is the number', async () => {
    const csv = `Client,Payer,Auth #,Procedure code,Units,Unit type,Start,End,Status
Maria Lopez,Medicaid,A-100,T1019,480,15 minutes,1/1/2026,12/31/2026,Active
Maria Lopez,Medicaid,A-100,T1019,480,15 minutes,1/1/2026,12/31/2026,Active
Walt Nye,,,S5125,20,Hour,2026-02-01,2026-01-01,
Pat Client,Medicaid,A-200,T1019,10,,1/1/2026,6/30/2026,
Maria Lopez,Blue Cross,A-300,T1019,10,,1/1/2026,6/30/2026,
`
    const pre = await post('/preview', { kind: 'authorizations', csv })
    expect(pre.status).toBe(200)
    expect(pre.body.counts).toMatchObject({ rows: 5, ok: 1, duplicates: 1, errors: 3 })
    const by = (line: number) => pre.body.rows.find((x: any) => x.line === line)
    expect(by(3).duplicateOf).toBe('Same record appears earlier in this file')
    expect(by(4).problems.join(' ')).toContain('Ends on is before starts on')
    expect(by(5).problems.join(' ')).toContain('more than one client is named "Pat Client"')
    expect(by(6).problems.join(' ')).toContain('no payer named "Blue Cross"')
    const r = await post('/commit', { kind: 'authorizations', csv, fileName: 'auths.csv' })
    expect(r.status).toBe(201)
    expect(r.body).toMatchObject({ created: 1, updated: 0, skippedDuplicates: 1, skippedBadRows: 3 })
    ids.authBatch = r.body.batchId
    const [auth] = await rowsOf(t.schema.authorizations) as any[]
    expect(auth).toMatchObject({ clientId: ids.maria, payerId: ids.medicaid, authNumber: 'A-100', procedureCode: 'T1019', authorizedUnits: '480.00', unitType: '15min', startDate: '2026-01-01', endDate: '2026-12-31', status: 'active', importedFrom: 'import' })
    expect((await post('/commit', { kind: 'authorizations', csv })).body).toMatchObject({ created: 0, skippedDuplicates: 2 })
    expect((await rowsOf(t.schema.authorizations)).length).toBe(1)
  })

  test('payers import by name, once; the type reads a label; a zip is checked', async () => {
    const csv = `Name,Type,Payer ID,Phone,Expected days to pay,Zip
Blue Cross,Private insurance,BC-1,608-555-0100,45,53703
Medicaid,Medicaid,,,,
VA,VA,,,,ABC
`
    const pre = await post('/preview', { kind: 'payers', csv })
    expect(pre.body.counts).toMatchObject({ ok: 1, duplicates: 1, errors: 1 })
    expect(pre.body.rows[1].duplicateOf).toBe('Already here (same name)')
    expect(pre.body.rows[2].problems[0]).toContain('not a zip code')
    const r = await post('/commit', { kind: 'payers', csv })
    expect(r.body).toMatchObject({ created: 1 })
    ids.payerBatch = r.body.batchId
    const bc = (await rowsOf(t.schema.referralSources) as any[]).find((p) => p.name === 'Blue Cross')
    expect(bc).toMatchObject({ payerType: 'private_insurance', payerIdNumber: 'BC-1', phone: '(608) 555-0100', expectedPayDays: 45, zip: '53703', isActivePayer: true })
    ids.blueCross = bc.id
  })

  test('billing history: money in cents, the status derived from what was paid, the invoice number the duplicate rule, billed to a payer or the family', async () => {
    const csv = `Client,Invoice #,Period from,Period to,Total,Amount paid,Due,Paid on,Billed to
Maria Lopez,INV-1,11/1/2025,11/30/2025,"$1,250.00","$1,250.00",12/30/2025,12/15/2025,Medicaid
Walt Nye,INV-2,11/1/2025,11/30/2025,300.50,100,12/30/2025,,
Walt Nye,INV-2,12/1/2025,12/31/2025,300.50,,,,
Walt Nye,INV-3,12/1/2025,11/30/2025,-5,,,,
`
    const pre = await post('/preview', { kind: 'billingHistory', csv })
    expect(pre.body.counts).toMatchObject({ ok: 2, duplicates: 1, errors: 1 })
    expect(pre.body.rows[3].problems.join(' ')).toContain('Period to is before period from')
    expect(pre.body.rows[3].problems.join(' ')).toContain('cannot be negative')
    const r = await post('/commit', { kind: 'billingHistory', csv })
    expect(r.body).toMatchObject({ created: 2 })
    ids.invoiceBatch = r.body.batchId
    const inv = await rowsOf(t.schema.invoices) as any[]
    const one = inv.find((i) => i.invoiceNumber === 'INV-1'), two = inv.find((i) => i.invoiceNumber === 'INV-2')
    expect(one).toMatchObject({ clientId: ids.maria, total: '1250.00', subtotal: '1250.00', tax: '0.00', amountPaid: '1250.00', paymentStatus: 'paid', paymentDate: '2025-12-15', billTo: 'payer', referralSourceId: ids.medicaid, invoiceType: 'imported' })
    expect(one.sentAt).not.toBeNull()
    expect(two).toMatchObject({ total: '300.50', amountPaid: '100.00', paymentStatus: 'partial', billTo: 'family', referralSourceId: null })
  })
})

describe('caregiver records (care-hr, care-payroll)', () => {
  test('certifications find the caregiver by email or name; the duplicate rule is type + expiry', async () => {
    const csv = `Caregiver,Certification,Issued by,Issued,Expires,Number
sam.reed@x.com,CPR,Red Cross,3/1/2025,3/1/2027,C-1
Sam Reed,CPR,,,3/1/2027,
Ann Carer,First aid,,,,
nobody@x.com,CPR,,,,
`
    const pre = await post('/preview', { kind: 'certifications', csv })
    expect(pre.body.counts).toMatchObject({ ok: 2, duplicates: 1, errors: 1 })
    expect(pre.body.rows[3].problems[0]).toContain('nobody with the email')
    const r = await post('/commit', { kind: 'certifications', csv })
    expect(r.body).toMatchObject({ created: 2 })
    ids.certBatch = r.body.batchId
    const certs = await rowsOf(t.schema.certificationRecords) as any[]
    expect(certs.find((c) => c.certificationType === 'CPR')).toMatchObject({ caregiverId: ids.sam, issuingBody: 'Red Cross', issueDate: '2025-03-01', expiryDate: '2027-03-01', certificationNumber: 'C-1', status: 'active' })
    expect(certs.find((c) => c.certificationType === 'First aid').caregiverId).toBe(ids.ann)
  })

  test('pay rates: cents in, a decimal rate out; a rate must be more than $0; the duplicate rule is type + effective date', async () => {
    const csv = `Caregiver,Rate type,Hourly rate,Effective from,Ends on
sam.reed@x.com,Base,$18.50,1/1/2026,
sam.reed@x.com,Overtime,27.75,1/1/2026,
sam.reed@x.com,base,19,1/1/2026,
sam.reed@x.com,Base,0,2/1/2026,
`
    const pre = await post('/preview', { kind: 'payRates', csv })
    expect(pre.body.counts).toMatchObject({ ok: 2, duplicates: 1, errors: 1 })
    expect(pre.body.rows[3].problems[0]).toContain('more than $0')
    // a caregiver may not import pay rates (care-payroll:create)
    expect((await post('/preview', { kind: 'payRates', csv }, 'ann')).status).toBe(403)
    const r = await post('/commit', { kind: 'payRates', csv })
    expect(r.body).toMatchObject({ created: 2 })
    const rates = await rowsOf(t.schema.caregiverRates) as any[]
    expect(rates.find((x) => x.rateType === 'base')).toMatchObject({ caregiverId: ids.sam, hourlyRate: '18.50', effectiveDate: '2026-01-01' })
    expect(rates.find((x) => x.rateType === 'overtime').hourlyRate).toBe('27.75')
  })

  test('training, leave, reviews and expenses', async () => {
    const training = await post('/commit', { kind: 'training', csv: 'Caregiver,Training,Provider,Completed,Expires,Hours,Status\nSam Reed,Dementia care,Relias,2/10/2026,2/10/2027,2.5,Completed\nSam Reed,Dementia care,Relias,2/10/2026,,,\n' })
    expect(training.body).toMatchObject({ created: 1, skippedDuplicates: 1 })
    expect((await rowsOf(t.schema.trainingRecords) as any[])[0]).toMatchObject({ caregiverId: ids.sam, trainingName: 'Dementia care', hoursCompleted: '2.5', expiryDate: '2027-02-10', status: 'completed' })

    const leavePre = await post('/preview', { kind: 'leave', csv: 'Caregiver,From,To,Type,Status\nSam Reed,7/1/2026,7/5/2026,Vacation,Approved\nSam Reed,7/9/2026,7/8/2026,Sick,\nSam Reed,8/1/2026,8/2/2026,Sabbatical,\n' })
    expect(leavePre.body.counts).toMatchObject({ ok: 1, errors: 2 })
    expect(leavePre.body.rows[1].problems[0]).toContain('To is before from')
    expect(leavePre.body.rows[2].problems[0]).toContain('not one of: Vacation')
    const leave = await post('/commit', { kind: 'leave', csv: 'Caregiver,From,To,Type,Status\nSam Reed,7/1/2026,7/5/2026,Vacation,Approved\n' })
    expect(leave.body.created).toBe(1)
    expect((await rowsOf(t.schema.caregiverTimeOff) as any[])[0]).toMatchObject({ caregiverId: ids.sam, startDate: '2026-07-01', endDate: '2026-07-05', type: 'vacation', status: 'approved' })

    const reviewPre = await post('/preview', { kind: 'reviews', csv: 'Caregiver,Client,Date,Satisfaction,Punctuality,Comments\nSam Reed,Maria Lopez,3/31/2026,5,4,Kind\nSam Reed,Maria Lopez,4/30/2026,6,,\n' })
    expect(reviewPre.body.counts).toMatchObject({ ok: 1, errors: 1 })
    expect(reviewPre.body.rows[1].problems[0]).toContain('score from 1 to 5')
    const review = await post('/commit', { kind: 'reviews', csv: 'Caregiver,Client,Date,Satisfaction,Punctuality,Comments\nSam Reed,Maria Lopez,3/31/2026,5,4,Kind\n' })
    expect(review.body.created).toBe(1)
    expect((await rowsOf(t.schema.performanceRatings) as any[])[0]).toMatchObject({ caregiverId: ids.sam, clientId: ids.maria, ratingDate: '2026-03-31', satisfactionScore: 5, punctualityScore: 4, comments: 'Kind' })

    const expense = await post('/commit', { kind: 'expenses', csv: 'Caregiver,Date,Description,Amount,Category,Status,Reimbursable\nSam Reed,3/4/2026,Groceries for client,$42.17,Supplies,Reimbursed,yes\nSam Reed,3/4/2026,Groceries for client,42.17,,,\n' })
    expect(expense.body).toMatchObject({ created: 1, skippedDuplicates: 1 })
    expect((await rowsOf(t.schema.expenses) as any[])[0]).toMatchObject({ userId: ids.sam, date: '2026-03-04', amount: '42.17', category: 'Supplies', status: 'reimbursed', reimbursable: true })
  })
})

describe('client records (care-clients)', () => {
  test('medicines with dose times and an as-needed flag; the duplicate rule is name + dose', async () => {
    const csv = `Client,Medicine,Dose,How often,As needed,Dose times,Status
Maria Lopez,Metformin,500 mg,Twice daily,no,8:00 AM; 8:00 PM,Active
Maria Lopez,Metformin,500 mg,,,,
Maria Lopez,Metformin,1000 mg,,,,
Maria Lopez,Tylenol,,As needed,yes,9 o'clock,
`
    const pre = await post('/preview', { kind: 'medications', csv })
    expect(pre.body.counts).toMatchObject({ ok: 2, duplicates: 1, errors: 1 })
    expect(pre.body.rows[3].problems[0]).toContain('not a time')
    const r = await post('/commit', { kind: 'medications', csv })
    expect(r.body).toMatchObject({ created: 2 })
    ids.medBatch = r.body.batchId
    const meds = await rowsOf(t.schema.medications) as any[]
    expect(meds.find((m) => m.dosage === '500 mg')).toMatchObject({ clientId: ids.maria, name: 'Metformin', frequency: 'Twice daily', isPrn: false, doseTimes: ['08:00', '20:00'], status: 'active' })
  })

  test('client credentials, important contacts and journal entries (dated on the agency\'s clock)', async () => {
    const cred = await post('/commit', { kind: 'clientCredentials', csv: 'Client,Credential,Issued by,Expires\nMaria Lopez,Physician order,Dr Hale,1/10/2027\nMaria Lopez,Physician order,,1/10/2027\n' })
    expect(cred.body).toMatchObject({ created: 1, skippedDuplicates: 1 })
    expect((await rowsOf(t.schema.clientCredential) as any[])[0]).toMatchObject({ clientId: ids.maria, credentialType: 'Physician order', issuingBody: 'Dr Hale', expiryDate: '2027-01-10' })

    const contacts = await post('/commit', { kind: 'contacts', csv: 'Client,Name,Relationship,Phone,Email,Primary\nMaria Lopez,Rosa Lopez,Daughter,715-555-0122,rosa@x.com,yes\nMaria Lopez,Rosa Lopez,,(715) 555-0122,,\nWalt Nye,Kim Nye,Son,12345,,\n' })
    expect(contacts.body).toMatchObject({ created: 1, skippedDuplicates: 1, skippedBadRows: 1 })
    expect((await rowsOf(t.schema.clientEmergencyContacts) as any[])[0]).toMatchObject({ clientId: ids.maria, name: 'Rosa Lopez', relationship: 'Daughter', phone: '(715) 555-0122', email: 'rosa@x.com', isPrimary: true })

    const journal = await post('/commit', { kind: 'journals', csv: 'Client,Date,Note,Written by\nMaria Lopez,3/2/2026,Enjoyed a walk.,Sam Reed\nMaria Lopez,3/2/2026,Enjoyed a walk.,\n' })
    expect(journal.body).toMatchObject({ created: 1, skippedDuplicates: 1 })
    const [note] = await rowsOf(t.schema.clientVisitNotes) as any[]
    expect(note).toMatchObject({ clientId: ids.maria, caregiverId: ids.sam, note: 'Enjoyed a walk.' })
    // noon on the agency's clock (Central), so the entry is the 2nd whatever zone reads it
    expect(new Date(note.createdAt).toISOString()).toBe('2026-03-02T18:00:00.000Z')
  })
})

describe('undo of a child batch', () => {
  test('undo removes the rows the batch made; a payer something points at is kept and says so', async () => {
    const r = await post(`/batches/${ids.medBatch}/undo`, {})
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ removed: 2, kept: [], undone: true })
    expect((await rowsOf(t.schema.medications)).length).toBe(0)
    // point an authorization at Blue Cross, then undo the payer batch: Blue Cross is in use, so it stays
    await t.db.update(t.schema.authorizations).set({ payerId: ids.blueCross } as any).where(eq(t.schema.authorizations.companyId, companyId))
    const p = await post(`/batches/${ids.payerBatch}/undo`, {})
    expect(p.body).toMatchObject({ removed: 0, undone: false })
    expect(p.body.kept[0].reason).toContain('Already in use (authorizations)')
    expect((await rowsOf(t.schema.referralSources) as any[]).some((x) => x.name === 'Blue Cross')).toBe(true)
    // the authorization batch itself can go
    expect((await post(`/batches/${ids.authBatch}/undo`, {})).body).toMatchObject({ removed: 1, undone: true })
    expect((await rowsOf(t.schema.authorizations)).length).toBe(0)
    // a caregiver may not undo (care-billing:delete)
    expect((await post(`/batches/${ids.invoiceBatch}/undo`, {}, 'ann')).status).toBe(403)
  })

  test('the list shows every kind with its label', async () => {
    const r = await get('/batches')
    expect(r.status).toBe(200)
    const kinds = r.body.data.map((b: any) => b.kind)
    for (const k of ['authorizations', 'payers', 'billingHistory', 'certifications', 'payRates', 'training', 'leave', 'reviews', 'expenses', 'medications', 'clientCredentials', 'contacts', 'journals']) expect(kinds).toContain(k)
    expect(r.body.data.find((b: any) => b.kind === 'billingHistory').kindLabel).toBe('Billing history (past invoices)')
  })
})
