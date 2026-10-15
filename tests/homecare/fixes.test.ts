// crm-homecare — six loose ends after the catch-up merge, through the real routes.
//   1. a caregiver WRITES care (MAR, vitals, ADLs, checklist tasks, visit photos, visit notes, client
//      forms) only for the clients they serve — the read rule in helpers/caregiverAccess.ts; the
//      office's Smart Matching writes and caregiver pay-per-care-type are the office's
//   2. mileage is paid at the agency's rate (agencies.mileage_rate); a caregiver never sets their own
//   3. the caregiver's client card: GET /api/clients/:id/caregiver-view, GET/POST …/visit-notes
//   4. Edit Client's "Medical notes" / "Care preferences" save and reload
//   5. GET /api/emergency/my-shifts lists DATED visits from the one schedule engine
//   6. a View As session (and the portal preview) is read-only on the server
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import jwt from 'jsonwebtoken'
import { readFileSync } from 'node:fs'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { agencies, users, clients, referralSources, formTemplates, clientTaskTemplates } from './db/schema.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 500)) }
}
const q = async (s: any) => { const r: any = await db.execute(s); return (r?.rows ?? r) as any[] }
const q1 = async (s: any) => (await q(s))[0]
const n = async (s: any) => Number((await q1(s))?.n)

process.env.JWT_SECRET = process.env.JWT_SECRET || 'fixes-test-secret'
delete process.env.AGENCY_TIMEZONE
await setupSchema()

const ROOT = (process.env.FACTORY_ROOT || '') + 'templates/crm-homecare/'
const src = (p: string) => readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n')

const [ag] = await db.insert(agencies).values({ name: 'Fixes Care', slug: 'fixes', state: 'WI', timezone: 'UTC' } as any).returning()
const mkUser = async (role: string, tag: string) => (await db.insert(users).values({
  email: `${tag}-fix@test.local`, passwordHash: 'x', firstName: tag, lastName: 'Tester', role, phone: '7155550111',
} as any).returning())[0]
const admin = await mkUser('admin', 'admin')
const cg1 = await mkUser('caregiver', 'cgone')
const cg2 = await mkUser('caregiver', 'cgtwo')
const [payer] = await db.insert(referralSources).values({ name: 'State Medicaid', payerType: 'medicaid' } as any).returning()
const mkClient = async (first: string, extra: Record<string, unknown> = {}) => (await db.insert(clients).values({
  firstName: first, lastName: 'Client', referredById: payer.id, medicaidId: '1421146410', ...extra,
} as any).returning())[0]

const { refuseViewAsWrites, VIEW_AS_READ_ONLY } = await import('./src/middleware/viewAsReadOnly.ts')
const app = new Hono()
app.use('/api/*', refuseViewAsWrites) // as src/index.ts mounts it (asserted below)
for (const [mount, file] of [
  ['/api/auth', 'auth'],
  ['/api/medications', 'medications'],
  ['/api/adl', 'adl'],
  ['/api/care-tasks', 'careTasks'],
  ['/api/time-entries', 'timeTracking'],
  ['/api/forms', 'forms'],
  ['/api/clients', 'clients'],
  ['/api/mileage', 'mileage'],
  ['/api/company', 'company'],
  ['/api/emergency', 'emergency'],
  ['/api/matching', 'matching'],
  ['/api/caregiver-care-type-rates', 'caregiverCareTypeRates'],
  ['/api/payroll', 'payroll'],
] as const) {
  app.route(mount, (await import(`./src/routes/${file}.ts`)).default)
}
const { occurrencesCte } = await import('./src/services/scheduleOccurrences.ts')

const call = (headers: Record<string, string>) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method, headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text()
  let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}
const as = (who: any) => call({ 'x-test-user': who.id, 'x-test-company': ag.id, 'x-test-role': who.role, 'x-test-email': who.email })
const A = as(admin), CG1 = as(cg1), CG2 = as(cg2)
const bearer = (token: string) => call({ authorization: `Bearer ${token}` })

const ymd = (d: Date) => d.toISOString().slice(0, 10)
const addDays = (s: string, k: number) => ymd(new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10) + k)))
const dow = (s: string) => new Date(`${s}T12:00:00Z`).getUTCDay()
const TODAY = ymd(new Date())

const insSched = async (v: Record<string, any>) => {
  const id = `sch_${Math.random().toString(36).slice(2, 10)}`
  const base = v.date || v.effective_date || '2026-01-01'
  await q(sql`INSERT INTO schedules (id, caregiver_id, client_id, day_of_week, date, start_time, end_time, frequency, effective_date,
      end_date, is_active, schedule_type, status, suspended_from, created_at, updated_at)
    VALUES (${id}, ${v.caregiver_id}, ${v.client_id}, ${v.day_of_week ?? null}, ${v.date ?? null}::date,
            ${`${base} ${v.start}`}::timestamp, ${`${base} ${v.end}`}::timestamp, 'weekly', ${v.effective_date ?? null}::date,
            ${v.end_date ?? null}::date, true, ${v.day_of_week != null ? 'recurring' : 'one-time'}, 'active', ${v.suspended_from ?? null}::date, NOW(), NOW())`)
  return id
}
const insEntry = async (id: string, caregiverId: string, clientId: string, notes: string | null = null) => q(sql`
  INSERT INTO time_entries (id, caregiver_id, client_id, start_time, end_time, duration_minutes, is_complete, notes)
  VALUES (${id}, ${caregiverId}, ${clientId}, NOW() - INTERVAL '2 hours', NOW() - INTERVAL '1 hour', 60, true, ${notes})`)

// cg1 serves `served` (an active assignment). `other` is cg2's (a recurring pattern) — cg1 does not serve them.
const served = await mkClient('Served'), other = await mkClient('Other')
await q(sql`INSERT INTO client_assignments (id, client_id, caregiver_id, assignment_date, status) VALUES ('ca_fx', ${served.id}, ${cg1.id}, '2026-01-01', 'active')`)
await insSched({ caregiver_id: cg2.id, client_id: other.id, day_of_week: 3, start: '09:00', end: '10:00', effective_date: '2026-01-01' })
await q(sql`INSERT INTO medications (id, client_id, name, status) VALUES ('med_s', ${served.id}, 'Lisinopril', 'active'), ('med_o', ${other.id}, 'Metformin', 'active')`)
// cg1's own (unscheduled) punch at the client they do not serve — clock-in never refuses one.
await insEntry('te_cg1_other', cg1.id, other.id)
await insEntry('te_cg1_served', cg1.id, served.id)

// ══ 1. caregiver care writes: only for a client they serve ═══════════════════════════════════════
{
  const REFUSAL = 'You can only record care for the clients you care for.'
  const cases: { what: string; table: string; path: string; method?: string; body: (clientId: string, te: string) => any }[] = [
    { what: 'a MAR dose', table: 'medication_logs', path: '/api/medications/log', body: (cl, te) => ({ medicationId: cl === served.id ? 'med_s' : 'med_o', clientId: cl, status: 'given' }) },
    { what: 'vitals', table: 'client_vitals', path: '/api/medications/vitals', body: (cl) => ({ clientId: cl, pulse: '72' }) },
    { what: 'an ADL', table: 'adl_logs', path: '/api/adl/log', body: (cl) => ({ clientId: cl, adlCategory: 'bathing', status: 'completed' }) },
    { what: 'a visit note', table: 'client_visit_notes', path: '/api/clients/:id/visit-notes', body: () => ({ note: 'Ate well, walked to the mailbox.' }) },
    { what: 'a visit photo', table: 'visit_photos', path: '/api/time-entries/:te/photos', body: () => ({ imageBase64: 'data:image/png;base64,iVBORw0KGgo=', caption: 'meal' }) },
  ]
  for (const k of cases) {
    const path = (cl: string, te: string) => k.path.replace(':id', cl).replace(':te', te)
    const before = await n(sql.raw(`SELECT COUNT(*)::int AS n FROM ${k.table}`))
    const not = await CG1(k.method || 'POST', path(other.id, 'te_cg1_other'), k.body(other.id, 'te_cg1_other'))
    check(`1. a caregiver cannot record ${k.what} for a client they do not serve (403, nothing written)`,
      not.status === 403 && not.json?.error === REFUSAL && (await n(sql.raw(`SELECT COUNT(*)::int AS n FROM ${k.table}`))) === before, { status: not.status, json: not.json })
    const mine = await CG1(k.method || 'POST', path(served.id, 'te_cg1_served'), k.body(served.id, 'te_cg1_served'))
    check(`1. …for a client they serve it is recorded`, mine.status === 201, { status: mine.status, json: mine.json })
  }
  const adminVitals = await A('POST', '/api/medications/vitals', { clientId: other.id, pulse: '80', caregiverId: cg2.id })
  check('1. the office records for any client (vitals for a client nobody assigned to the admin)', adminVitals.status === 201, adminVitals.json)
  const adminDose = await A('POST', '/api/medications/log', { medicationId: 'med_o', clientId: other.id, status: 'given' })
  check('1. …and a MAR dose', adminDose.status === 201, adminDose.json)
  const adminNote = await A('POST', `/api/clients/${other.id}/visit-notes`, { note: 'Office call: daughter visiting Friday.' })
  check('1. …and a visit note', adminNote.status === 201, adminNote.json)

  // checklist task on the caregiver's own (unscheduled) visit at a client they do not serve
  const [tOther] = await db.insert(clientTaskTemplates).values({ clientId: other.id, taskName: 'Meal prep' } as any).returning()
  const [tServed] = await db.insert(clientTaskTemplates).values({ clientId: served.id, taskName: 'Bathing' } as any).returning()
  const tk = await CG1('PUT', `/api/care-tasks/time-entry/te_cg1_other/${tOther.id}`, { status: 'completed' })
  check('1. a caregiver cannot tick a checklist task for a client they do not serve, even on their own punch',
    tk.status === 403 && (await n(sql`SELECT COUNT(*)::int AS n FROM shift_task_completions WHERE time_entry_id = 'te_cg1_other'`)) === 0, tk)
  check('1. …on a client they serve they can', (await CG1('PUT', `/api/care-tasks/time-entry/te_cg1_served/${tServed.id}`, { status: 'completed' })).status === 200)
  check("1. …and cannot read another client's checklist", (await CG1('GET', `/api/care-tasks/client/${other.id}`)).status === 403
    && (await CG1('GET', `/api/care-tasks/client/${served.id}`)).status === 200)

  // ADL reads follow the same rule
  for (const p of ['/api/adl/client/:id/requirements', '/api/adl/client/:id/logs', '/api/adl/reports/completion/:id']) {
    check(`1. GET ${p}: a served client 200, another 403`, (await CG1('GET', p.replace(':id', served.id))).status === 200 && (await CG1('GET', p.replace(':id', other.id))).status === 403)
  }
  await insEntry('te_cg2_other', cg2.id, other.id)
  check("1. a caregiver cannot read the ADLs of a colleague's visit at a client they do not serve; that visit's caregiver can",
    (await CG1('GET', '/api/adl/logs/time-entry/te_cg2_other')).status === 403 && (await CG2('GET', '/api/adl/logs/time-entry/te_cg2_other')).status === 200)

  // client forms
  const [tpl] = await db.insert(formTemplates).values({ name: 'Visit check', fields: [] } as any).returning()
  const fNot = await CG1('POST', '/api/forms/submissions', { templateId: tpl.id, entityType: 'client', entityId: other.id, data: {} })
  check("1. a caregiver cannot file a form on a client they do not serve", fNot.status === 403 && fNot.json?.error === REFUSAL, fNot)
  const fMine = await CG1('POST', '/api/forms/submissions', { templateId: tpl.id, entityType: 'client', entityId: served.id, data: {} })
  check('1. …on a client they serve they can', fMine.status === 201, fMine.json)
  check('1. …an HR form only about themselves', (await CG1('POST', '/api/forms/submissions', { templateId: tpl.id, entityType: 'caregiver', entityId: cg2.id, data: {} })).status === 403
    && (await CG1('POST', '/api/forms/submissions', { templateId: tpl.id, entityType: 'caregiver', entityId: cg1.id, data: {} })).status === 201)
  await A('POST', '/api/forms/submissions', { templateId: tpl.id, entityType: 'client', entityId: other.id, data: {} })
  const listed = await CG1('GET', '/api/forms/submissions')
  check("1. a caregiver's form list holds only what they filled in", listed.status === 200 && listed.json.length === 2 && listed.json.every((s: any) => s.submitted_by_id === cg1.id), listed.json?.map?.((s: any) => s.submitted_by_id))
  check('1. …the office lists every submission', (await A('GET', '/api/forms/submissions')).json.length === 3)

  // the office's Smart Matching writes: they edit clients' care needs and create schedules
  const needs = await CG1('PUT', `/api/matching/client/${other.id}/needs`, { needs: 'x' })
  const apply = await CG1('POST', '/api/matching/apply-schedule', { assignments: [{ clientId: other.id, caregiverId: cg1.id, dayOfWeek: 1, startTime: '09:00', endTime: '10:00' }] })
  check("1. a caregiver cannot change a client's matching needs or apply a matching schedule (that would make them 'serve' anyone)",
    needs.status === 403 && apply.status === 403 && (await n(sql`SELECT COUNT(*)::int AS n FROM schedules WHERE caregiver_id = ${cg1.id} AND client_id = ${other.id}`)) === 0, { needs: needs.status, apply: apply.status })
  check('1. a caregiver cannot set a pay rate per care type', (await CG1('POST', '/api/caregiver-care-type-rates', { caregiverId: cg1.id, careTypeId: 'x', hourlyRate: '40' })).status === 403)
}

// ══ 2. mileage: the agency's rate ═══════════════════════════════════════════════════════════════
{
  const co = await A('GET', '/api/company')
  check('2. the agency rate defaults to $0.67', Number(co.json.mileageRate) === 0.67, co.json?.mileageRate)
  const t1 = await CG1('POST', '/api/mileage', { date: TODAY, miles: '10', ratePerMile: '4.00' })
  check('2. a caregiver who sends their own rate is paid the agency rate (10 mi × $0.67 = $6.70)',
    t1.status === 201 && Number(t1.json.ratePerMile) === 0.67 && Number(t1.json.amount) === 6.7, t1.json)
  const t1b = await CG1('POST', '/api/mileage', { date: TODAY, miles: '10', rate: '4.00' })
  check('2. …whatever the field is called (rate)', Number(t1b.json.ratePerMile) === 0.67, t1b.json)
  check('2. a caregiver cannot change the agency rate', (await CG1('PUT', '/api/company', { mileageRate: '2.00' })).status === 403)
  const set = await A('PUT', '/api/company', { mileageRate: '0.725' })
  check('2. the office sets the agency rate (Payroll → Settings)', set.status === 200 && Number(set.json.mileageRate) === 0.725, set.json?.mileageRate)
  check("2. …it doesn't touch the agency's other settings", (await q1(sql`SELECT name FROM agencies WHERE id = ${ag.id}`)).name === 'Fixes Care')
  for (const bad of ['abc', '', '-1', '9']) {
    check(`2. …a rate of "${bad}" is refused`, (await A('PUT', '/api/company', { mileageRate: bad })).status === 400)
  }
  const t2 = await CG1('POST', '/api/mileage', { date: TODAY, miles: '20' })
  check('2. a caregiver trip now pays the new agency rate (20 mi × $0.725 = $14.50)', Number(t2.json.ratePerMile) === 0.725 && Number(t2.json.amount) === 14.5, t2.json)
  const t3 = await A('POST', '/api/mileage', { caregiverId: cg2.id, date: TODAY, miles: '10', ratePerMile: '0.50' })
  check('2. the office may still record a trip at another rate', t3.status === 201 && Number(t3.json.ratePerMile) === 0.5 && Number(t3.json.amount) === 5 && t3.json.caregiverId === cg2.id, t3.json)
  check("2. …but not a rate that isn't one", (await A('POST', '/api/mileage', { date: TODAY, miles: '1', ratePerMile: 'lots' })).status === 400)
  const t4 = await A('POST', '/api/mileage', { caregiverId: cg2.id, date: TODAY, miles: '10' })
  check('2. the office, sending no rate, gets the agency rate', Number(t4.json.ratePerMile) === 0.725, t4.json)
  const pr = await A('POST', '/api/payroll/calculate', { startDate: TODAY, endDate: TODAY })
  check("2. payroll's mileage, with no rate asked for, is the agency rate (not a fixed $0.67)", pr.status === 200 && Number(pr.json.mileageRate) === 0.725, pr.json?.mileageRate)
  const pp = src('frontend/src/components/admin/PayrollProcessing.tsx')
  check("2. Payroll → Settings loads and saves the agency rate (GET/PUT /api/company { mileageRate })",
    /a\?\.mileageRate \?\? a\?\.mileage_rate/.test(pp) && /JSON\.stringify\(\{ mileageRate: s \}\)/.test(pp) && /onClick=\{saveSettings\}/.test(pp))
}

// ══ 3. the caregiver's client card ═══════════════════════════════════════════════════════════════
{
  await q(sql`UPDATE clients SET medical_conditions = '["CHF","Diabetes"]'::json, allergies = '["Penicillin"]'::json, medications = '[]'::json,
      medical_notes = 'Low-salt diet', care_preferences = 'Coffee first, then shower', assistance_needs = 'Walker',
      insurance_id = 'INS-999', insurance_group = 'GRP-1', ssn_encrypted = 'enc:ssn', mco_member_id = 'MCO-7', private_pay_rate = '31.00'
    WHERE id = ${served.id}`)
  await q(sql`INSERT INTO client_emergency_contacts (id, client_id, name, relationship, phone, is_primary) VALUES ('ec_fx', ${served.id}, 'Dana Client', 'Daughter', '7155550123', true)`)
  const v = await CG1('GET', `/api/clients/${served.id}/caregiver-view`)
  check('3. a caregiver opens the card of a client they serve', v.status === 200 && v.json.first_name === 'Served' && v.json.id === served.id, v)
  const leaked = ['ssn_encrypted', 'ssnEncrypted', 'medicaid_id', 'medicaidId', 'insurance_id', 'insuranceId', 'insurance_group', 'insurance_provider', 'mco_member_id', 'evv_client_id',
    'private_pay_rate', 'portal_password_hash', 'portal_token', 'billing_notes'].filter((k) => k in (v.json || {}))
  const values = JSON.stringify(v.json)
  check('3. …with no SSN, Medicaid id, insurance numbers, pay or portal fields', leaked.length === 0 && !/1421146410|INS-999|GRP-1|enc:ssn|MCO-7/.test(values), leaked)
  check('3. …the emergency contact from the client\'s contacts', v.json.emergency_contact_name === 'Dana Client' && v.json.emergency_contact_phone === '7155550123' && v.json.emergency_contact_relationship === 'Daughter', v.json)
  check('3. …the lists as text the card prints, one per line (none = null)', v.json.medical_conditions === 'CHF\nDiabetes' && v.json.allergies === 'Penicillin' && v.json.medications === null, v.json)
  check('3. …the medical notes, care preferences and mobility needs', v.json.medical_notes === 'Low-salt diet' && v.json.care_preferences === 'Coffee first, then shower' && v.json.mobility_assistance_needs === 'Walker', v.json)
  const vo = await CG1('GET', `/api/clients/${other.id}/caregiver-view`)
  check('3. a client they do not serve is refused', vo.status === 403, vo)
  check('3. the office opens any card; an unknown client is a 404', (await A('GET', `/api/clients/${other.id}/caregiver-view`)).status === 200 && (await A('GET', '/api/clients/nope/caregiver-view')).status === 404)

  await insEntry('te_note', cg1.id, served.id, 'Client was tired today.')
  await insEntry('te_auto', cg1.id, served.id, '(Auto-closed: caregiver clocked into new client)')
  const vn = await CG1('GET', `/api/clients/${served.id}/visit-notes`)
  const sources = (vn.json || []).map((x: any) => x.source).sort().join()
  check('3. visit notes: the card\'s notes AND the clock-out notes, not the auto-close marker',
    vn.status === 200 && sources === 'clock_out,manual' && vn.json.some((x: any) => x.note === 'Client was tired today.' && x.caregiver_name === 'cgone Tester')
      && !vn.json.some((x: any) => /Auto-closed/.test(x.note)), vn.json)
  check('3. …a client they do not serve is refused', (await CG1('GET', `/api/clients/${other.id}/visit-notes`)).status === 403)
  check('3. …the office reads any client\'s', (await A('GET', `/api/clients/${other.id}/visit-notes`)).json.some((x: any) => /daughter visiting/.test(x.note)))
  check('3. an empty note is refused', (await CG1('POST', `/api/clients/${served.id}/visit-notes`, { note: '   ' })).status === 400)
  const saved = await q1(sql`SELECT caregiver_id FROM client_visit_notes WHERE client_id = ${served.id}`)
  check('3. a note is the caller\'s', saved?.caregiver_id === cg1.id, saved)
  const modal = src('frontend/src/components/CaregiverClientModal.tsx')
  check('3. CaregiverClientModal calls these two paths', /\/api\/clients\/\$\{clientId\}\/caregiver-view/.test(modal) && /\/api\/clients\/\$\{clientId\}\/visit-notes/.test(modal))
}

// ══ 4. Edit Client: medical notes, care preferences ══════════════════════════════════════════════
{
  const c4 = await mkClient('Notes')
  const put = await A('PUT', `/api/clients/${c4.id}`, { firstName: 'Notes', lastName: 'Client', medicalNotes: 'Insulin at 8am', carePreferences: 'Prefers female caregivers' })
  check('4. Edit Client saves medical notes and care preferences', put.status === 200 && put.json.medicalNotes === 'Insulin at 8am' && put.json.carePreferences === 'Prefers female caregivers', put.json)
  const got = await A('GET', `/api/clients/${c4.id}`)
  check('4. …and they reload', got.json.medicalNotes === 'Insulin at 8am' && got.json.carePreferences === 'Prefers female caregivers', got.json)
  await A('PUT', `/api/clients/${c4.id}`, { medicalNotes: null, carePreferences: null })
  const cleared = await q1(sql`SELECT medical_notes, care_preferences FROM clients WHERE id = ${c4.id}`)
  check('4. …and clear', cleared.medical_notes === null && cleared.care_preferences === null, cleared)
  const created = await A('POST', '/api/clients', { firstName: 'New', lastName: 'Client', medicalNotes: 'Hard of hearing' })
  check('4. a new client keeps its medical notes too', created.status === 201 && created.json.medicalNotes === 'Hard of hearing', created.json)
  const m = src('frontend/src/components/admin/EditClientModal.tsx')
  check('4. the modal opens with what is on file and sends both fields',
    /medicalNotes: v\('medicalNotes', 'medical_notes'\)/.test(m) && /carePreferences: v\('carePreferences', 'care_preferences'\)/.test(m)
      && /medicalNotes: formData\.medicalNotes \|\| null/.test(m) && /carePreferences: formData\.carePreferences \|\| null/.test(m))
  check('4. the columns are in schema.ts and the 0023 migration (journal idx 22, after 0022)',
    /medicalNotes: text\('medical_notes'\)/.test(src('backend/db/schema.ts')) && /care_preferences/.test(src('backend/db/migrations/0023_fixes.sql'))
      && JSON.parse(src('backend/db/migrations/meta/_journal.json')).entries.slice(-2).map((e: any) => `${e.idx}:${e.tag}`).join() === '21:0022_integration,22:0023_fixes')
}

// ══ 5. my-shifts: dated visits from the one engine ═══════════════════════════════════════════════
{
  const c5 = await mkClient('Shifts')
  const c5b = await mkClient('Covered')
  const weekly = await insSched({ caregiver_id: cg1.id, client_id: c5.id, day_of_week: dow(TODAY), start: '07:00', end: '08:00', effective_date: addDays(TODAY, -21) })
  await q(sql`INSERT INTO schedule_exceptions (id, schedule_id, exception_date, exception_type) VALUES ('ex_fx1', ${weekly}, ${addDays(TODAY, 7)}::date, 'cancelled')`)
  const oneOff = await insSched({ caregiver_id: cg1.id, client_id: c5.id, date: addDays(TODAY, 3), start: '13:00', end: '14:00' })
  await insSched({ caregiver_id: cg1.id, client_id: c5.id, day_of_week: dow(addDays(TODAY, 1)), start: '10:00', end: '11:00', effective_date: addDays(TODAY, -21), suspended_from: TODAY })
  await insSched({ caregiver_id: cg1.id, client_id: c5.id, date: addDays(TODAY, -2), start: '09:00', end: '10:00' })
  // cg2's pattern, covered by cg1 on one day
  const cg2s = await insSched({ caregiver_id: cg2.id, client_id: c5b.id, day_of_week: dow(addDays(TODAY, 2)), start: '15:00', end: '16:00', effective_date: addDays(TODAY, -21) })
  await q(sql`INSERT INTO schedule_exceptions (id, schedule_id, exception_date, exception_type, override_caregiver_id) VALUES ('ex_fx2', ${cg2s}, ${addDays(TODAY, 2)}::date, 'modified', ${cg1.id})`)

  const r = await CG1('GET', '/api/emergency/my-shifts')
  const mine = (r.json || []).filter((s: any) => s.client_id === c5.id || s.client_id === c5b.id)
  const got = mine.map((s: any) => `${s.date}|${s.id}`)
  const want = [`${TODAY}|${weekly}`, `${addDays(TODAY, 2)}|${cg2s}`, `${addDays(TODAY, 3)}|${oneOff}`]
  check('5. my-shifts: dated visits — the weekly pattern today, the day covered for a colleague, the one-time visit; not the cancelled week, the suspended pattern or a past visit',
    r.status === 200 && JSON.stringify(got) === JSON.stringify(want), { got, want })
  check('5. …each with its date, times and client', mine[0]?.date === TODAY && mine[0]?.start_time === '07:00:00' && mine[0]?.end_time === '08:00:00' && mine[0]?.client_first_name === 'Shifts', mine[0])
  const eng = await q(sql`WITH ${occurrencesCte(TODAY, addDays(TODAY, 13))} SELECT COUNT(*)::int AS n FROM occ WHERE caregiver_id = ${cg1.id}`)
  check('5. …the same visits the engine gives for the next 14 days', (r.json || []).length === Math.min(14, Number(eng[0].n)), { route: r.json?.length, engine: eng[0].n })
  const c2 = await CG2('GET', '/api/emergency/my-shifts')
  check("5. the colleague's covered day is not on the colleague's list", !(c2.json || []).some((s: any) => s.id === cg2s && s.date === addDays(TODAY, 2)), c2.json)
  const miss = await CG1('POST', '/api/emergency/miss-report', { scheduleId: mine[1].id, date: mine[1].date, reason: 'Car broke down', alternativeContact: '' })
  check('5. the picked row (pattern id + date) is what the miss report accepts', miss.status === 201, miss.json)
  const form = src('frontend/src/components/caregiver/ShiftMissReport.tsx')
  check('5. the miss-report form keys and selects a row by pattern AND date', /key=\{`\$\{shift\.id\}:\$\{shift\.date\}`\}/.test(form) && /form\.scheduleId === shift\.id && form\.date ===/.test(form))
}

// ══ 6. View As is read-only on the server ════════════════════════════════════════════════════════
{
  const r = await A('POST', `/api/auth/impersonate/${cg1.id}`)
  check('6. View As issues a token', r.status === 200 && !!r.json.token, r.json)
  const VA = bearer(r.json.token)
  const before = await n(sql`SELECT COUNT(*)::int AS n FROM client_vitals`)
  const w = await VA('POST', '/api/medications/vitals', { clientId: served.id, pulse: '70' })
  check('6. a write made with the View As token is refused 403, with the reason', w.status === 403 && w.json?.error === VIEW_AS_READ_ONLY && w.json?.code === 'view_as_read_only', w)
  check('6. …and nothing is written', (await n(sql`SELECT COUNT(*)::int AS n FROM client_vitals`)) === before)
  for (const [m, p, b] of [['PUT', `/api/clients/${served.id}`, { notes: 'x' }], ['DELETE', `/api/clients/${served.id}`, undefined], ['PATCH', `/api/clients/${served.id}/onboarding`, {}],
    ['POST', '/api/time-entries/clock-in', { clientId: served.id }], ['POST', '/api/mileage', { date: TODAY, miles: '3' }]] as const) {
    check(`6. …${m} ${p}: refused`, (await VA(m, p, b)).status === 403)
  }
  check('6. …no clock-in was made as the viewed caregiver', (await n(sql`SELECT COUNT(*)::int AS n FROM time_entries WHERE caregiver_id = ${cg1.id} AND end_time IS NULL`)) === 0)
  const read = await VA('GET', '/api/clients')
  check('6. a read with the View As token works (the viewed caregiver\'s clients)', read.status === 200 && Array.isArray(read.json) && read.json.some((x: any) => x.id === served.id) && !read.json.some((x: any) => x.id === other.id), read.json)
  check('6. signing out of View As is allowed', (await VA('POST', '/api/auth/logout')).status === 200)
  const own = jwt.sign({ userId: cg1.id, email: cg1.email, role: 'caregiver' }, process.env.JWT_SECRET!, { expiresIn: '1h' })
  check("6. the caregiver's own session still writes", (await bearer(own)('POST', '/api/medications/vitals', { clientId: served.id, pulse: '71' })).status === 201)
  const preview = jwt.sign({ role: 'client', clientId: served.id, impersonation: true }, process.env.JWT_SECRET!, { expiresIn: '1h' })
  const pw = await bearer(preview)('POST', '/api/portal/visit-requests', { note: 'x' })
  check('6. the portal preview token is read-only the same way', pw.status === 403 && pw.json?.error === 'Portal preview is read-only', pw)
  const idx = src('backend/src/index.ts')
  const at = idx.indexOf("app.use('/api/*', refuseViewAsWrites)")
  const firstRoute = idx.indexOf('app.route(')
  const firstApiHandler = idx.search(/app\.(get|post|put|patch|delete|all)\('\/api\//)
  check('6. src/index.ts mounts it on /api/* above every route', at > 0 && at < firstRoute && at < firstApiHandler, { at, firstRoute, firstApiHandler })
}

console.log(`\nhomecare-fixes: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
