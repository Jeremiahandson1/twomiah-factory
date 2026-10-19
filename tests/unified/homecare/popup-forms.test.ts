// ADAPTED COPY of tests/homecare/popup-forms.test.ts, for the unified app (tests/unified/harness/adapted.ts). Unchanged except the
// 6 read(s) marked "unified:", where the rulebook's reply shapes replaced the template's. The original keeps
// running against the template; tests/unified/harness/unified-divergences.ts names the assertions this copy stands in for.
// crm-homecare — the forms behind the pop-ups that never opened.
//
// E2E Run 3 (10/16): fourteen pop-ups were `modal-overlay > modal`, and index.css hides `.modal` until it is
// `.active`, so Add Payer, Edit Payer, Add Office User, Add Family Member, ⏸ Service and the SMS forms opened
// invisibly. No browser had ever submitted them, and reading their payloads against their routes found:
//   · Payers: the screen wrote `type` (insurance/medicaid/private…) while billing, claims, EVV and the punch rules
//     read `payer_type`, so every payer made on screen was 'other'. contactEmail / contactPhone / payerId are not
//     columns, so they were dropped. The route spread the body, so any column (id, is_active) was writable.
//   · Clients: neither client form had a Medicaid ID field, so a caregiver could never be shown one to copy.
//   · Office users: the body's `role` was honoured (an admin could make an owner); no password meant 'Welcome1!'.
//   · Caregivers: the same 'Welcome1!' fallback.
//   · SMS: Bulk Message posted to /api/sms/send-bulk, which did not exist.
// Each payload below is the shape the screen sends.
process.env.TWILIO_ACCOUNT_SID = 'ACtest-not-a-secret'
process.env.TWILIO_AUTH_TOKEN = 'test-not-a-secret'
process.env.TWILIO_PHONE_NUMBER = '+15005550006'

import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { agencies, users, clients, referralSources, clientAssignments, notificationPreferences } from './db/schema.ts'

let failed = 0, passed = 0
const snakeKey = (k: string) => k.replace(/[A-Z]/g, (m) => '_' + m.toLowerCase())
const templateShape = (v: any): any => Array.isArray(v) ? v.map(templateShape) : (v && typeof v === 'object') ? ((Array.isArray(v.data) && v.pagination) ? templateShape(v.data) : Object.fromEntries(Object.entries(v).flatMap(([k, x]) => { const s = templateShape(x); return snakeKey(k) === k ? [[k, s]] : [[k, s], [snakeKey(k), s]] }))) : v /* unified: templateShape reads a unified reply in the template's shape: a list reply ({ data, pagination }, RULEBOOK §3) as its rows, and every camelCase key (RULEBOOK §2) also under its snake_case name — the values are the server's, unchanged */
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 400)) }
}

await setupSchema()

const [ag] = await db.insert(agencies).values({ name: 'Popup Forms Agency', slug: 'popupforms' } as any).returning()
const mkUser = async (role: string, tag: string, phone: string | null = null) => (await db.insert(users).values({
  email: `${tag}-pf@test.local`, passwordHash: 'x', firstName: tag, lastName: 'U', role, phone,
} as any).returning())[0]
const owner = await mkUser('owner', 'owner')
const admin = await mkUser('admin', 'admin')
const caregiver = await mkUser('caregiver', 'cg', '(715) 555-0101')
const quietCg = await mkUser('caregiver', 'quiet', '715-555-0102')
const nophoneCg = await mkUser('caregiver', 'nophone')

const app = new Hono()
for (const [mount, file] of [
  ['/api/payers', 'payers'],
  ['/api/referral-sources', 'referralSources'],
  ['/api/clients', 'clients'],
  ['/api/sandata', 'sandata'],
  ['/api/users', 'caregivers'],
  ['/api/caregivers', 'caregivers'],
  ['/api/sms', 'sms'],
] as const) {
  app.route(mount, (await import(`./src/routes/${file}.ts`)).default)
}
const as = (who: any) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json', 'x-test-user': who.id, 'x-test-company': ag.id, 'x-test-role': who.role },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = templateShape(JSON.parse(t)) } catch {} /* unified: each reply read through templateShape */
  return { status: res.status, json: j }
}

// ══ 1. Payers ═══════════════════════════════════════════════════════════════════════════════
// PayersServiceCodes.tsx EMPTY_PAYER, filled in as the tester would, with the My Choice preset applied.
const SCREEN_PAYER = {
  name: 'Test MCO', payerType: 'MCO', contactName: 'Pat Billing', email: 'billing@testmco.local', phone: '608-555-0100',
  address: '', city: '', state: '', zip: '', payerIdNumber: 'MCFC-CW', isActivePayer: true, notes: '',
  sandataEvvRequired: true, sandataPayerId: 'MCFC-CW', sandataPayerProgram: 'WIMCO',
}
let payerId = ''
{
  // The screen's own form object, read from the source: every key it sends is a field the route writes, and
  // every type it offers is one the route accepts. (The original fault was the SCREEN's names.)
  const { readFileSync } = await import('fs')
  const tsx = readFileSync(`${process.env.FACTORY_ROOT}apps/unified/web/src/crm/pages/homecare/billing/PayersServiceCodes.tsx`, 'utf8') /* unified: Payers & Service Codes is billing/PayersServiceCodes.tsx */
  const empty = tsx.match(/const EMPTY_PAYER = \{([\s\S]*?)\n\}/ /* unified: the moved file has no semicolons: the object ends at the } at the start of a line */)?.[1] || ''
  const keys = [...empty.replace(/\/\/.*$/gm, '').matchAll(/(\w+)\s*:/g)].map((m) => m[1])
  const offered = [...(tsx.match(/const PAYER_TYPE_OPTIONS = \[([\s\S]*?)\n\]/ /* unified: no semicolons: the list ends at the ] at the start of a line */)?.[1] || '').matchAll(/value: '([^']+)'/g)].map((m) => m[1])
  const route = await import('./src/routes/payers.ts')
  check('the Payers form sends only fields the route writes', keys.length >= 10 && keys.every((k) => (route.PAYER_FIELDS as readonly string[]).includes(k)), { keys, notWritten: keys.filter((k) => !(route.PAYER_FIELDS as readonly string[]).includes(k)) })
  check('…and offers only payer types the route accepts', offered.length >= 5 && offered.every((v) => (route.PAYER_TYPES as readonly string[]).includes(v)), offered)
  check('…and the test payload is the screen\'s shape', keys.every((k) => k in SCREEN_PAYER) && Object.keys(SCREEN_PAYER).every((k) => keys.includes(k)), { keys, test: Object.keys(SCREEN_PAYER) })
}
{
  const r = await as(admin)('POST', '/api/payers', { ...SCREEN_PAYER, id: 'hijacked-id', isActive: false, claimPortal: { name: 'X' } })
  payerId = r.json?.id
  check('the Add Payer payload creates a payer', r.status === 201 && !!payerId, r.json)
  const [row] = await db.select().from(referralSources).where(eq(referralSources.id, payerId))
  check('…classified by payer_type (what billing and claims read)', row?.payerType === 'MCO', row?.payerType)
  check('…email, phone and payer ID land on their columns', row?.email === 'billing@testmco.local' && row?.phone === '608-555-0100' && row?.payerIdNumber === 'MCFC-CW', row)
  check('…the Sandata codes are saved', row?.sandataEvvRequired === true && row?.sandataPayerId === 'MCFC-CW' && row?.sandataPayerProgram === 'WIMCO', row)
  check('…its referral kind follows the seed (insurance)', row?.type === 'insurance', row?.type)
  check('…and the body cannot set the id, deactivate it or set the claim portal', payerId !== 'hijacked-id' && row?.isActive === true && row?.claimPortal == null, row)
  check('…blank optional fields are stored as null, not ""', row?.address === null && row?.notes === null, row)

  const pp = await as(admin)('POST', '/api/payers', { ...SCREEN_PAYER, name: 'Family pays', payerType: 'private_pay', sandataEvvRequired: false })
  check('a private-pay payer is payer_type private_pay, referral kind private_pay', pp.status === 201 && pp.json.payerType === 'private_pay' && pp.json.type === 'private_pay', pp.json)

  const bad = await as(admin)('POST', '/api/payers', { ...SCREEN_PAYER, payerType: 'insurance' })
  check('an unknown payer type is refused with a reason', bad.status === 400 && /payer type/i.test(bad.json?.error || ''), bad.json)
  const noName = await as(admin)('POST', '/api/payers', { ...SCREEN_PAYER, name: '  ' })
  check('a blank name is refused', noName.status === 400 && /name/i.test(noName.json?.error || ''), noName.json)

  // Edit Payer: openEditPayer fills the form from the row, then sends the whole form back.
  const edited = await as(admin)('PUT', `/api/payers/${payerId}`, { ...SCREEN_PAYER, phone: '608-555-0199', payerType: 'IRIS' })
  check('Edit Payer saves', edited.status === 200 && edited.json?.phone === '608-555-0199' && edited.json?.payerType === 'IRIS', edited.json)
  await as(admin)('PUT', `/api/payers/${payerId}`, { payerType: 'MCO' })
  const missing = await as(admin)('PUT', '/api/payers/nope000', SCREEN_PAYER)
  check('editing a payer that does not exist is a 404', missing.status === 404, missing)

  const cg = await as(caregiver)('POST', '/api/payers', SCREEN_PAYER)
  check('a caregiver cannot add a payer', cg.status === 403, cg.json)
  const list = await as(caregiver)('GET', '/api/payers')
  check('the list returns the payer with the names the screen reads', list.status === 200 && list.json.some((p: any) => p.id === payerId && p.payerIdNumber === 'MCFC-CW' && p.phone), list.json)
}

// Referral Sources writes the same table, and must not reach the payer settings.
{
  const r = await as(admin)('POST', '/api/referral-sources', { name: 'St. Joseph Hospital', type: 'hospital', email: 'dc@stj.local', payerType: 'private_pay', sandataEvvRequired: true, isActivePayer: true, id: 'x' })
  check('a referral source saves its own fields', r.status === 201 && r.json.type === 'hospital' && r.json.email === 'dc@stj.local', r.json)
  check('…and none of the payer settings in its body', r.json.payerType === 'other' && r.json.sandataEvvRequired === false && r.json.isActivePayer === false && r.json.id !== 'x', r.json)
  const up = await as(admin)('PUT', `/api/referral-sources/${payerId}`, { name: 'Test MCO', payerType: 'private_pay', sandataEvvRequired: false })
  const [row] = await db.select().from(referralSources).where(eq(referralSources.id, payerId))
  check('editing a payer through Referral Sources leaves its billing settings alone', up.status === 200 && row.payerType === 'MCO' && row.sandataEvvRequired === true, row)
}

// ══ 2. Clients: the Medicaid ID reaches the caregiver (blocker 1, end to end) ═════════════════
let patId = ''
{
  // ClientsManagement.tsx Add Client, not private pay.
  const add = await as(admin)('POST', '/api/clients', {
    firstName: 'Pat', lastName: 'Example', dateOfBirth: null, gender: null, phone: null, email: null,
    address: '123 Test Street', city: 'Eau Claire', state: 'WI', zip: '54701',
    referralSourceId: payerId, medicaidId: '1234567890', mcoMemberId: null, careTypeId: null, isPrivatePay: false,
    privatePayRate: null, privatePayRateType: 'hourly', weeklyAuthorizedUnits: null,
    emergencyContactName: null, emergencyContactPhone: null, emergencyContactRelationship: null, notes: null,
  })
  patId = add.json?.id
  check('Add Client stores the payer and the Medicaid ID', add.status === 201 && add.json.referredById === payerId && add.json.medicaidId === '1234567890', add.json)

  // EditClientModal.tsx sends the IDs on every save.
  const ed = await as(admin)('PUT', `/api/clients/${patId}`, { firstName: 'Pat', lastName: 'Example', referralSourceId: payerId, medicaidId: '1234567891', mcoMemberId: 'M-77', isPrivatePay: false })
  check('Edit Client updates the Medicaid ID and MCO member ID', ed.status === 200 && ed.json.medicaidId === '1234567891' && ed.json.mcoMemberId === 'M-77', ed.json)

  await db.insert(clientAssignments).values({ clientId: patId, caregiverId: caregiver.id, assignmentDate: '2026-10-01', status: 'active' } as any)
  const ctx = await as(caregiver)('GET', '/api/sandata/caregiver-context')
  const pat = (ctx.json?.clients || []).find((c: any) => c.id === patId)
  check('the caregiver app sees Pat in Sandata with the Medicaid ID to copy', ctx.status === 200 && pat?.in_sandata === true && pat?.medicaid_id === '1234567891', ctx.json)
}

// ══ 3. Office users and caregivers ═══════════════════════════════════════════════════════════
{
  // UserManagement.tsx AddOfficeUserModal sends { firstName, lastName, email, phone, password }.
  const r = await as(admin)('POST', '/api/users/admins', { firstName: 'Office', lastName: 'Admin', email: 'Office@Agency.local', phone: '', password: 'office-pass-1' })
  check('Add Office User creates an admin', r.status === 201 && r.json.role === 'admin' && r.json.email === 'office@agency.local', r.json)
  const esc = await as(admin)('POST', '/api/users/admins', { firstName: 'Sneaky', lastName: 'Owner', email: 'sneaky@agency.local', password: 'office-pass-1', role: 'owner' })
  check('…and a body asking for an owner still gets an admin', esc.status === 201 && esc.json.role === 'admin', esc.json)
  const nopw = await as(admin)('POST', '/api/users/admins', { firstName: 'No', lastName: 'Pw', email: 'nopw@agency.local' })
  check('…no password is refused, not defaulted', nopw.status === 400 && /password/i.test(nopw.json?.error || ''), nopw.json)
  const cgTry = await as(caregiver)('POST', '/api/users/admins', { firstName: 'C', lastName: 'G', email: 'cg2@agency.local', password: 'office-pass-1' })
  check('…a caregiver cannot add an office user', cgTry.status === 403, cgTry.json)

  const cgNoPw = await as(admin)('POST', '/api/caregivers', { firstName: 'New', lastName: 'Cg', email: 'newcg@agency.local' })
  check('a caregiver with no password is refused, not given Welcome1!', cgNoPw.status === 400 && /password/i.test(cgNoPw.json?.error || ''), cgNoPw.json)
  const cgOk = await as(admin)('POST', '/api/caregivers', { firstName: 'New', lastName: 'Cg', email: 'newcg@agency.local', password: 'caregiver-1', role: 'owner', id: 'chosen' })
  check('…with one, the caregiver is created as a caregiver with a generated id', cgOk.status === 201 && cgOk.json.role === 'field' /* unified: a new caregiver's seat is the unified role field (the hr group's caregivers route; moved tenants keep caregiver; both read as a caregiver) */ && cgOk.json.id !== 'chosen', cgOk.json)
}

// ══ 4. Bulk SMS ═════════════════════════════════════════════════════════════════════════════
{
  const notify = await import('./src/services/visitNotify.ts')
  const sent: Array<{ to: string; body: string }> = []
  notify._setSmsSender(async (to: string, body: string) => { sent.push({ to, body }); return { status: 'sent', sid: 'SMtest', error: null } })
  await db.insert(notificationPreferences).values({ userId: quietCg.id, smsEnabled: false } as any)

  const r = await as(admin)('POST', '/api/sms/send-bulk', { recipientType: 'caregiver', recipientIds: [caregiver.id, quietCg.id, nophoneCg.id, admin.id], body: 'Office closed Friday.' })
  check('Bulk Message to caregivers answers with counts', r.status === 200 && r.json.sent === 1, r.json)
  check('…texts the caregiver in E.164', sent.length === 1 && sent[0].to === '+17155550101' && sent[0].body === 'Office closed Friday.', sent)
  check('…skips the one who switched texts off and the one with no phone', r.json.skipped === 2, r.json)
  check('…and never texts a non-caregiver id passed as a caregiver', r.json.unknown === 1 && !sent.some((s) => s.to.endsWith('0100')), r.json)

  await db.update(clients).set({ phone: '7155550199' }).where(eq(clients.id, patId))
  const rc = await as(admin)('POST', '/api/sms/send-bulk', { recipientType: 'client', recipientIds: [patId], body: 'Reminder' })
  check('Bulk Message to clients texts the client phone', rc.status === 200 && rc.json.sent === 1 && sent[1]?.to === '+17155550199', { r: rc.json, sent })

  const empty = await as(admin)('POST', '/api/sms/send-bulk', { recipientType: 'caregiver', recipientIds: [], body: 'x' })
  check('no recipients is a 400 with the screen\'s wording', empty.status === 400 && /recipients/.test(empty.json?.error || ''), empty.json)
  const wrongType = await as(admin)('POST', '/api/sms/send-bulk', { recipientType: 'everyone', recipientIds: [caregiver.id], body: 'x' })
  check('an unknown recipient type is a 400', wrongType.status === 400, wrongType.json)
  const cgTry = await as(caregiver)('POST', '/api/sms/send-bulk', { recipientType: 'caregiver', recipientIds: [caregiver.id], body: 'x' })
  check('a caregiver cannot bulk-text', cgTry.status === 403, cgTry.json)

  const saved = { ...process.env }
  delete process.env.TWILIO_ACCOUNT_SID
  const off = await as(admin)('POST', '/api/sms/send-bulk', { recipientType: 'caregiver', recipientIds: [caregiver.id], body: 'x' })
  check('without Twilio it says SMS is not configured (503)', off.status === 503 && /not configured/i.test(off.json?.error || ''), off.json)
  process.env.TWILIO_ACCOUNT_SID = saved.TWILIO_ACCOUNT_SID
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
