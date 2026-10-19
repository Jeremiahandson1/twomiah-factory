// ADAPTED COPY of tests/homecare/r4-care.test.ts, for the unified app (tests/unified/harness/adapted.ts). Unchanged except the
// 7 read(s) marked "unified:", where the rulebook's reply shapes replaced the template's. The original keeps
// running against the template; tests/unified/harness/unified-divergences.ts names the assertions this copy stands in for.
// crm-homecare — Run 4 (tester's retest of 10/16), the care items, through the real routes on PGlite.
//   1. ONE rule for "active care plan": status Active AND inside its dates — the office list, its
//      count, the family portal and the caregiver app all read it (a template's draft is not active)
//   2. the office approves an ACCEPTED swap: that day moves to the coworker, both are told
//   3. a relative's permissions are edited after creation (the Edit pop-up's PUT) and the portal obeys
//   4. an office reply reaches the family portal ONCE, and the portal re-reads its messages
//   5. instants in the family/client portals: sent as UTC instants, printed on the agency's clock
//   6. the caregiver's medications: one source (the Medications list), the free-text note only when
//      the list is empty, labelled; the medication form's Route is saved
//   7. Portal Claim Days names the blank EVV field (and shows the total authorized beside it)
//   8. care-task minutes per week: a daily task counts once per scheduled visit
//   9. Client Hours by Week and Portal Claim Days open on THIS week — clock pinned to a Thursday
//  10. the overpayment refusal names no developer flag (r3-billing.test.ts) and the screen has no such control
// The clock is pinned (bun:test setSystemTime) to Thursday 2026-10-15, noon in Wisconsin.
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import jwt from 'jsonwebtoken'
import { readFileSync } from 'node:fs'
import { setSystemTime } from 'bun:test'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { agencies, users, clients, referralSources, carePlanTemplates, familyMembers } from './db/schema.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 600)) }
}
const q = async (s: any) => { const r: any = await db.execute(s); return (r?.rows ?? r) as any[] }
const snakeKey = (k: string) => k.replace(/[A-Z]/g, (m) => '_' + m.toLowerCase())
const templateShape = (v: any): any => Array.isArray(v) ? v.map(templateShape) : (v && typeof v === 'object') ? ((Array.isArray(v.data) && v.pagination) ? templateShape(v.data) : Object.fromEntries(Object.entries(v).flatMap(([k, x]) => { const s = templateShape(x); return snakeKey(k) === k ? [[k, s]] : [[k, s], [snakeKey(k), s]] }))) : v /* unified: templateShape reads a unified reply in the template's shape: a list reply ({ data, pagination }, RULEBOOK §3) as its rows, and every camelCase key (RULEBOOK §2) also under its snake_case name — the values are the server's, unchanged */

process.env.JWT_SECRET = process.env.JWT_SECRET || 'r4-care-secret'
delete process.env.AGENCY_TIMEZONE
await setupSchema()

const ROOT = (process.env.FACTORY_ROOT || '') + 'templates/crm-homecare/'
const src = (p: string) => readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n')

// Thursday, October 15 2026, 12:00 in America/Chicago. This week is Sun 10/11 – Sat 10/17.
const THURSDAY = '2026-10-15'
setSystemTime(new Date(`${THURSDAY}T17:00:00Z`))
const THIS_SUNDAY = '2026-10-11'

await db.insert(agencies).values({ name: 'Run Four Care', slug: 'r4care', state: 'WI', timezone: 'America/Chicago' } as any)
const mkUser = async (role: string, tag: string) => (await db.insert(users).values({
  email: `${tag}-r4@test.local`, passwordHash: 'x', firstName: tag, lastName: 'Tester', role,
} as any).returning())[0]
const admin = await mkUser('admin', 'admin')
const cgA = await mkUser('caregiver', 'Ann')
const cgB = await mkUser('caregiver', 'Ben')
const [payer] = await db.insert(referralSources).values({ name: 'My Choice', payerType: 'mco_family_care' } as any).returning()
const mkClient = async (first: string, extra: Record<string, unknown> = {}) => (await db.insert(clients).values({
  firstName: first, lastName: 'Client', isActive: true, referredById: payer.id, ...extra,
} as any).returning())[0]

const app = new Hono()
for (const [mount, file] of [
  ['/api/care-plans', 'carePlans'],
  ['/api/care-tasks', 'careTasks'],
  ['/api/family-portal', 'familyPortal'],
  ['/api/portal', 'portal'],
  ['/api/shift-swaps', 'shiftSwaps'],
  ['/api/medications', 'medications'],
  ['/api/clients', 'clients'],
  ['/api/reports', 'reports'],
  ['/api/billing', 'billing'],
] as const) {
  app.route(mount, (await import(`./src/routes/${file}.ts`)).default)
}
const { occurrencesCte } = await import('./src/services/scheduleOccurrences.ts')

const call = (headers: Record<string, string>) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) })
  const t = await res.text(); let j: any = t; try { j = templateShape(JSON.parse(t)) } catch {} /* unified: each reply read through templateShape */
  return { status: res.status, json: j }
}
const as = (u: any) => call({ 'x-test-user': u.id, 'x-test-role': u.role, 'x-test-email': u.email })
const A = as(admin), CGA = as(cgA), CGB = as(cgB)
const family = (memberId: string, clientId: string) => call({ authorization: `Bearer ${jwt.sign({ id: memberId, role: 'family', clientId, familyMemberId: memberId }, process.env.JWT_SECRET!)}` })

const insSched = async (v: Record<string, any>) => {
  const id = `sch_${Math.random().toString(36).slice(2, 10)}`
  const base = v.date || v.effective_date || '2026-01-01'
  await q(sql`INSERT INTO schedules (id, caregiver_id, client_id, day_of_week, date, start_time, end_time, frequency, effective_date,
      is_active, schedule_type, status, created_at, updated_at)
    VALUES (${id}, ${v.caregiver_id}, ${v.client_id}, ${v.day_of_week ?? null}, ${v.date ?? null}::date,
            ${`${base} ${v.start}`}::timestamp, ${`${base} ${v.end}`}::timestamp, 'weekly', ${v.effective_date ?? null}::date,
            true, ${v.day_of_week != null ? 'recurring' : 'one-time'}, 'active', NOW(), NOW())`)
  return id
}

// The pinned clock reaches the database's NOW() too (agencyToday reads it).
const [{ d: dbToday }] = await q(sql`SELECT to_char((NOW() AT TIME ZONE 'America/Chicago')::date, 'YYYY-MM-DD') AS d`)
check('0. the pinned Thursday is the database\'s today as well', dbToday === THURSDAY, dbToday)

// ══ 1. one rule for an active care plan ══════════════════════════════════════════════════════════
{
  const pat = await mkClient('Pat')
  await insSched({ caregiver_id: cgA.id, client_id: pat.id, day_of_week: 4, start: '09:00', end: '11:00', effective_date: '2026-09-01' })
  const [famPat] = await db.insert(familyMembers).values({ clientId: pat.id, name: 'Pat Kid', email: 'kid@r4.local', passwordHash: 'x', isActive: true, canViewCarePlan: true } as any).returning()
  const F = family(famPat.id, pat.id)
  const [tpl] = await db.insert(carePlanTemplates).values({ templateName: 'Personal care basics', serviceType: 'personal_care', careGoals: 'Stay at home safely', isActive: true } as any).returning()

  // The screen's payload: Use Template → { clientId, startDate: today }.
  const made = await A('POST', `/api/care-plans/from-template/${tpl.id}`, { clientId: pat.id, startDate: THURSDAY })
  check('1. a plan from a template is a DRAFT', made.status === 201 && made.json.carePlan?.status === 'draft', made.json)
  const list1 = await A('GET', `/api/care-plans?clientId=${pat.id}`)
  check('1. the office list says the draft is NOT active (no Active tag, not counted) — dates alone do not make it active',
    list1.status === 200 && list1.json.length === 1 && list1.json[0].isActive === false, list1.json)
  check('1. …the office summary counts no active plan', (await A('GET', '/api/care-plans/summary')).json.active === 0)
  const famNone = await F('GET', '/api/family-portal/portal/care-plan')
  check('1. …and the family portal agrees: no active care plan', famNone.status === 200 && !!famNone.json && Object.keys(famNone.json).length === 0, famNone.json) /* unified: a reply is an object (RULEBOOK §3): the family portal's "no active care plan" is {} (server/crm/homecare/portals/familyPortal.ts), not a bare null */
  const cgNone = await CGA('GET', `/api/care-plans?clientId=${pat.id}`)
  check('1. …and the caregiver\'s list carries the same answer (the app shows only isActive)', cgNone.status === 200 && cgNone.json[0]?.isActive === false, cgNone.json)

  // The screen's ✓ Activate (and Edit → Status) is PUT { status: 'active' }.
  const act = await A('PUT', `/api/care-plans/${made.json.carePlan.id}`, { status: 'active' })
  check('1. ✓ Activate: the plan is active, and the answer says so', act.status === 200 && act.json.status === 'active' && act.json.isActive === true, act.json)
  check('1. …the office list and count follow', (await A('GET', `/api/care-plans?clientId=${pat.id}`)).json[0]?.isActive === true && (await A('GET', '/api/care-plans/summary')).json.active === 1)
  const famPlan = await F('GET', '/api/family-portal/portal/care-plan')
  check('1. …and the family portal shows it', famPlan.status === 200 && famPlan.json?.id === made.json.carePlan.id && famPlan.json?.careGoals === 'Stay at home safely', famPlan.json)
  check('1. …and the caregiver sees it as the current plan', (await CGA('GET', `/api/care-plans?clientId=${pat.id}`)).json[0]?.isActive === true)

  // Active status but not started yet: not active anywhere, and never shadows the current plan.
  const later = await A('POST', '/api/care-plans', { clientId: pat.id, serviceType: 'companionship', startDate: '2026-11-01', status: 'active' })
  const list2 = await A('GET', `/api/care-plans?clientId=${pat.id}`)
  check('1. an Active plan that starts next month is not active yet', list2.json.find((p: any) => p.id === later.json.id)?.isActive === false, list2.json)
  check('1. …the family portal keeps showing the current plan, not the newer future one', (await F('GET', '/api/family-portal/portal/care-plan')).json?.id === made.json.carePlan.id)
  const ended = await A('PUT', `/api/care-plans/${made.json.carePlan.id}`, { endDate: '2026-10-14' })
  check('1. a plan whose end date has passed is not active (office and family)', ended.json.isActive === false && Object.keys((await F('GET', '/api/family-portal/portal/care-plan')).json || { x: 1 }).length === 0, ended.json) /* unified: no active care plan is {} */

  const cp = src('frontend/src/components/admin/CarePlans.tsx')
  check('1. the office screen takes "active" from the server, never from the dates alone',
    /const isActivePlan = \(plan: any\) => plan\.is_active === true \|\| plan\.isActive === true;/.test(cp) && !/String\(plan\.start_date\)\.slice\(0, 10\) <= t\) && \(!plan\.end_date/.test(cp))
  check('1. …a draft wears ONE tag ("Draft — not active") and an Activate button; the form can set the status',
    /if \(plan\.status === 'draft'\) return \['Draft — not active'/.test(cp) && /onClick=\{\(\) => activatePlan\(plan\)\}/.test(cp) && /id="cp-status"/.test(cp) && /status: plan\.status \|\| 'active'/.test(cp))
  const mobile = readFileSync((process.env.FACTORY_ROOT || '') + 'apps/mobile/app/(care)/client/[id].tsx', 'utf8')
  check('1. the caregiver app shows the plan the CRM calls active — no fallback to a draft', /plans\.find\(\(x: any\) => x\.isActive === true\) \|\| null/.test(mobile) && !/\|\| plans\[0\]/.test(mobile))
}

// ══ 2. the office approves an accepted swap ══════════════════════════════════════════════════════
{
  const cl = await mkClient('Swap')
  const day = '2026-10-20' // the next Tuesday
  const s = await insSched({ caregiver_id: cgA.id, client_id: cl.id, day_of_week: 2, start: '13:00', end: '15:00', effective_date: '2026-09-01' })
  const req = await CGA('POST', '/api/shift-swaps', { scheduleId: s, shiftDate: day, targetCaregiverId: cgB.id, reason: 'Doctor' })
  check('2. Ann asks Ben to take Tuesday', req.status === 201 && req.json.status === 'pending', req.json)
  const acc = await CGB('PUT', `/api/shift-swaps/${req.json.id}/respond`, { accepted: true })
  check('2. Ben accepts', acc.status === 200)
  const listed = await A('GET', '/api/shift-swaps?status=accepted')
  check('2. the office sees it ACCEPTED (the ✓ shows only then)', listed.json.some((x: any) => x.id === req.json.id && x.status === 'accepted'), listed.json)
  // The screen's call: PUT /api/shift-swaps/:id/approve with no body.
  const ok = await A('PUT', `/api/shift-swaps/${req.json.id}/approve`)
  check('2. the office approves it', ok.status === 200 && ok.json.success === true, ok.json)
  const occ = await q(sql`WITH ${occurrencesCte(day, '2026-10-27')} SELECT to_char(occ.occ_date, 'YYYY-MM-DD') AS d, occ.caregiver_id FROM occ WHERE occ.schedule_id = ${s} ORDER BY occ.occ_date`)
  check('2. Tuesday is Ben\'s on the schedule; the next Tuesday is still Ann\'s', occ[0]?.d === day && occ[0]?.caregiver_id === cgB.id && occ[1]?.caregiver_id === cgA.id, occ)
  const told = await q(sql`SELECT user_id FROM notifications WHERE type = 'shift_swap_approved' ORDER BY user_id`)
  check('2. both caregivers are told', told.length === 2 && told.some((t) => t.user_id === cgA.id) && told.some((t) => t.user_id === cgB.id), told)
  check('2. the swap reads approved', (await A('GET', '/api/shift-swaps?status=approved')).json.some((x: any) => x.id === req.json.id))
  const hub = src('frontend/src/components/admin/SchedulingHub.tsx')
  check('2. the screen\'s ✓ asks "Approve swap" (not a red bin-icon "Confirm Action"), calls the route, and says what happened',
    /onClick=\{\(\) => approveSwap\(sw\)\}>✓<\/button>/.test(hub) && /title: 'Approve shift swap', confirmLabel: 'Approve swap'/.test(hub)
    && /await api\(`\/api\/shift-swaps\/\$\{sw\.id\}\/approve`, \{ method: 'PUT' \}\); showMsg\(`Swap approved/.test(hub))
}

// ══ 3. a relative's permissions, edited after creation ═══════════════════════════════════════════
{
  const cl = await mkClient('Fam')
  const created = await A('POST', '/api/family-portal/admin/members', { clientId: cl.id, firstName: 'Dana', lastName: 'Daughter', email: 'dana@r4.local', password: 'danapass1', relationship: 'child', canViewMedications: true })
  check('3. a relative is added with medications on', created.status === 201 && created.json.canViewMedications === true, created.json)
  await q(sql`INSERT INTO medications (id, client_id, name, status) VALUES ('m_fam', ${cl.id}, 'Metformin', 'active')`)
  const F = family(created.json.id, cl.id)
  check('3. …and sees the medications', (await F('GET', '/api/family-portal/portal/medications')).status === 200)
  // EditMemberForm's payload, exactly.
  const edit = await A('PUT', `/api/family-portal/admin/members/${created.json.id}`, {
    name: 'Dana Daughter', phone: '7155550199', relationship: 'child',
    canViewSchedule: true, canViewCarePlan: true, canViewMedications: false, canMessage: true, isPrimaryContact: true,
  })
  check('3. Edit saves the switches and details', edit.status === 200 && edit.json.canViewMedications === false && edit.json.isPrimaryContact === true && edit.json.phone === '7155550199', edit.json)
  check('3. …the family portal hides medications (and vitals) on the very next request', (await F('GET', '/api/family-portal/portal/medications')).status === 403 && (await F('GET', '/api/family-portal/portal/vitals')).status === 403)
  const me = await F('GET', '/api/family-portal/portal/me')
  check('3. …and the portal\'s own permissions say so (its tabs are built from them)', me.json.canViewMedications === false && me.json.canViewSchedule === true, me.json)
  const fpa = src('frontend/src/components/admin/FamilyPortalAdmin.tsx')
  const modal = fpa.slice(fpa.indexOf('{/* Edit Family Member Modal */}'), fpa.indexOf('{/* Add Family Member Modal */}'))
  check('3. each member row has ✏️ Edit, opening the house pop-up', /onClick=\{\(\) => setEditingMember\(member\)\}/.test(fpa)
    && /<div className="modal active" onClick=\{\(\) => setEditingMember\(null\)\}>\n\s*<div className="modal-content"/.test(modal) && /<EditMemberForm/.test(modal))
  const form = fpa.slice(fpa.indexOf('const EditMemberForm'), fpa.indexOf('// Reply Form Component'))
  check('3. …whose form sends every switch the PUT reads, and primary contact', ['canViewSchedule', 'canViewCarePlan', 'canViewMedications', 'canMessage'].every((k) => fpa.includes(`['${k}',`))
    && /isPrimaryContact: flag\('isPrimaryContact', 'is_primary_contact'\)/.test(form) && /onSubmit\(\{ \.\.\.form, name: form\.name\.trim\(\), phone: form\.phone\.trim\(\) \}\)/.test(form))
}

// ══ 4. an office reply, once ═════════════════════════════════════════════════════════════════════
{
  const cl = await mkClient('Msg')
  const [m] = await db.insert(familyMembers).values({ clientId: cl.id, name: 'Rae', email: 'rae@r4.local', passwordHash: 'x', isActive: true, canMessage: true } as any).returning()
  const F = family(m.id, cl.id)
  const sent = await F('POST', '/api/family-portal/portal/messages', { subject: 'Mom', message: 'How was today?' })
  const inbox = await A('GET', '/api/family-portal/admin/messages')
  const msg = inbox.json.find((x: any) => x.id === sent.json.id)
  await A('POST', `/api/family-portal/admin/messages/${msg.id}/reply`, { reply: 'A good day.' })
  await A('POST', `/api/family-portal/admin/messages/${msg.id}/reply`, { reply: 'She also walked.' })
  const mine = await F('GET', '/api/family-portal/portal/messages')
  const texts = mine.json.map((x: any) => x.message)
  check('4. each office reply is in the history once, both replies kept', texts.filter((t: string) => t === 'A good day.').length === 1 && texts.filter((t: string) => t === 'She also walked.').length === 1 && texts.length === 3, mine.json)
  check('4. …the family\'s message carries no second copy of a reply', mine.json.every((x: any) => !('reply' in x)), mine.json)
  check('4. …the office still sees its message answered', (await A('GET', '/api/family-portal/admin/messages')).json.find((x: any) => x.id === msg.id)?.reply === 'She also walked.')
  const fp = src('frontend/src/components/portal/FamilyPortal.tsx')
  check('4. the portal prints no nested reply, and re-reads its messages (every 30s and on focus)', !/m\.reply/.test(fp)
    && /setInterval\(fetchMessages, 30000\)/.test(fp) && /addEventListener\('focus', onFocus\)/.test(fp))
}

// ══ 5. instants in the portals ═══════════════════════════════════════════════════════════════════
{
  const cl = await mkClient('Vit', { portalToken: 'r4-vit-token', portalEnabled: true })
  const [m] = await db.insert(familyMembers).values({ clientId: cl.id, name: 'Lee', email: 'lee@r4.local', passwordHash: 'x', isActive: true, canViewMedications: true } as any).returning()
  const F = family(m.id, cl.id)
  // 11:10 AM Central on 10/16 is 16:10 UTC — stored as the UTC wall clock, as every write stores it.
  await q(sql`INSERT INTO client_vitals (id, client_id, caregiver_id, recorded_at, pulse) VALUES ('cv_r4', ${cl.id}, ${cgA.id}, '2026-10-16 16:10:00', 72)`)
  const v = await F('GET', '/api/family-portal/portal/vitals')
  check('5. the family portal sends the reading as a UTC instant (not bare "2026-10-16 16:10:00")', v.status === 200 && v.json[0]?.recorded_at === '2026-10-16T16:10:00.000Z', v.json) /* unified: the reading leaves as the same UTC instant, in JSON's own Date form with milliseconds (core/vitals.ts reads it through the query builder; the template formatted the string by hand) */
  check('5. …so does the staff vitals history (the same service)', (await A('GET', `/api/medications/vitals/client/${cl.id}`)).json[0]?.recorded_at === '2026-10-16T16:10:00.000Z') /* unified: the same instant, JSON Date form */
  const c1 = await F('GET', '/api/family-portal/portal/client')
  check('5. the family portal is told the agency\'s zone', c1.json.timezone === 'America/Chicago', c1.json)
  const me = await call({ 'x-portal-token': 'r4-vit-token' })('GET', '/api/portal/me')
  check('5. …and so is the client portal', me.status === 200 && me.json.agency_timezone === 'America/Chicago', me.json)
  const clock = await import(ROOT + 'frontend/src/utils/agencyClock.ts')
  clock.setAgencyTimezone('America/Chicago')
  check('5. printed on the agency\'s clock: 11:10 AM, not 4:10 PM', clock.formatAgencyDateTime(v.json[0].recorded_at) === 'Oct 16, 11:10 AM', clock.formatAgencyDateTime(v.json[0].recorded_at))
  check('5. …an evening instant keeps its own day (not the UTC date)', clock.formatAgencyDate('2026-10-17T02:30:00Z', { month: 'short', day: 'numeric' }) === 'Oct 16')
  const fp = src('frontend/src/components/portal/FamilyPortal.tsx')
  const cp = src('frontend/src/components/portal/ClientPortal.tsx')
  check('5. both portals adopt the zone the server names', /setAgencyTimezone\(data\.timezone\)/.test(fp) && /setAgencyTimezone\(data\.agency_timezone\)/.test(cp))
  const portalFiles = ['FamilyPortal', 'PortalHistory', 'PortalDocuments', 'PortalMessages', 'PortalNotifications'].map((f) => [f, src(`frontend/src/components/portal/${f}.tsx`)] as const)
  const browserClock = portalFiles.filter(([, s]) => /new Date\([^)]*\)\.toLocale(String|TimeString)\(|parseLocalDate\(isoStr\)|const dt = new Date\(d\);\n\s*return isNaN\(dt\.getTime\(\)\) \? '' : dt\.toLocaleString/.test(s)).map(([f]) => f)
  check('5. no portal screen prints an instant on the browser\'s clock any more', browserClock.length === 0, browserClock)
}

// ══ 6. the caregiver's medications ═══════════════════════════════════════════════════════════════
{
  const cl = await mkClient('Med', { medications: JSON.stringify(['Lisinopril 10mg daily']), portalToken: 'r4-med-token', portalEnabled: true })
  await insSched({ caregiver_id: cgA.id, client_id: cl.id, day_of_week: 4, start: '08:00', end: '09:00', effective_date: '2026-09-01' })
  // MedicationForm's payload on Add, exactly (Route left on its default, Oral).
  const add = await A('POST', '/api/medications', {
    medicationName: 'Lisinopril', dosage: '10mg', frequency: 'daily', route: 'oral', prescriber: '', pharmacy: '', rxNumber: '',
    startDate: '', endDate: '', instructions: '', sideEffects: '', isPrn: false, isActive: true, clientId: cl.id,
  })
  check('6. the medication form\'s Route is saved', add.status === 201 && add.json.route === 'oral', add.json)
  const listed = await A('GET', `/api/medications/client/${cl.id}`)
  check('6. …and read back on the Medications list', listed.json[0]?.route === 'oral', listed.json)
  const edit = await A('PUT', `/api/medications/${add.json.id}`, { medicationName: 'Lisinopril', dosage: '20mg', frequency: 'daily', route: 'oral', prescriber: '', pharmacy: '', rxNumber: '', startDate: '', endDate: '', instructions: '', sideEffects: '', isPrn: false, isActive: true, clientId: cl.id })
  check('6. …and kept by Edit', edit.status === 200 && edit.json.route === 'oral' && edit.json.dosage === '20mg', edit.json)
  const card = await CGA('GET', `/api/clients/${cl.id}/caregiver-view`)
  check('6. the caregiver\'s Medical tab lists the medication ONCE, from the Medications list (route included)',
    card.status === 200 && card.json.medications === 'Lisinopril · 20mg · oral · daily' && card.json.medications_source === 'medications', card.json)
  const care = await call({ 'x-portal-token': 'r4-med-token' })('GET', '/api/portal/care-plan')
  check('6. the client portal\'s care plan reads the same one source', care.status === 200 && JSON.stringify(care.json.client.medications) === JSON.stringify(['Lisinopril · 20mg · oral · daily']) && care.json.client.medicationsSource === 'medications', care.json.client)
  const legacy = await mkClient('Note', { medications: JSON.stringify(['Aspirin 81mg']) })
  await insSched({ caregiver_id: cgA.id, client_id: legacy.id, day_of_week: 4, start: '10:00', end: '11:00', effective_date: '2026-09-01' })
  const lv = await CGA('GET', `/api/clients/${legacy.id}/caregiver-view`)
  check('6. a client with no Medications list rows: the record\'s free-text note, labelled as such', lv.json.medications === 'Aspirin 81mg' && lv.json.medications_source === 'client_record', lv.json)
  const modal = src('frontend/src/components/CaregiverClientModal.tsx')
  check('6. …the Medical tab says where that note comes from', /client\.medications_source === 'client_record'/.test(modal) && /Notes from the client record — not on the office's Medications list yet\./.test(modal))
}

// ══ 7 + 9. Portal Claim Days: the blank field by name; this week ═════════════════════════════════
{
  await A('PUT', `/api/billing/claim-portals/${payer.id}`, { claimPortal: { name: 'MIDAS', evvCode: 'S5125', evvLabel: 'Attendant care (EVV)', otherCode: 'S5130', otherLabel: 'Homemaker' } })
  const cl = await mkClient('Claim', { medicaidId: '1234567890', weeklyAuthorizedUnits: '40' })
  await q(sql`INSERT INTO time_entries (id, caregiver_id, client_id, start_time, end_time, duration_minutes, billable_minutes, is_complete)
    VALUES ('te_r4c', ${cgA.id}, ${cl.id}, '2026-10-13 14:00:00', '2026-10-13 16:00:00', 120, 120, true)`)
  const w = await A('GET', `/api/billing/portal-claim-days?payerId=${payer.id}`)
  check('9. Portal Claim Days with no week asked: THIS week (Sun 10/11 – Sat 10/17), not last week', w.status === 200 && w.json.week_start === THIS_SUNDAY && w.json.week_end === '2026-10-17', w.json)
  const c = w.json.clients?.find((x: any) => x.client_id === cl.id)
  check('7. the client\'s blank EVV share and its 40 authorized units are both reported, apart', c?.evv_weekly_units === null && c?.weekly_authorized_units === 40 && c?.totals?.evvAuthorizedUnits === null, c)
  check('7. …the authorized total is NOT used as the EVV cap (all 120 EVV minutes stay EVV: 8 units)', c?.totals?.evvUnits === 8 && c?.totals?.homemakerUnits === 0, c?.totals)
  const pcd = src('frontend/src/components/admin/PortalClaimDays.tsx')
  check('7. the warning names the field and the total, and opens that field', /"EVV \(Sandata\) units per week" is blank for \{c\.client_name\}/.test(pcd)
    && /weekly authorized units are the total for both codes, not the EVV share/.test(pcd) && /onClick=\{\(\) => setEvvFor\(c\)\}>Set EVV units<\/button>/.test(pcd)
    && /<EvvWeeklyUnits clientId=\{evvFor\.client_id\}/.test(pcd) && /export const EvvWeeklyUnits/.test(src('frontend/src/components/admin/EditClientModal.tsx')))
  check('9. the screen sends no week of its own on first load (the server\'s agency week)', !/lastFullWeekSunday/.test(pcd) && /const \[weekStart, setWeekStart\] = useState\(''\);/.test(pcd) && /const qs = weekStart \? `&weekStart=\$\{weekStart\}` : '';/.test(pcd))
  const cw = await A('GET', '/api/reports/client-week')
  check('9. Client Hours by Week with no week asked: THIS week on the agency\'s clock', cw.status === 200 && cw.json.weekStart === THIS_SUNDAY && cw.json.weekEnd === '2026-10-17', cw.json?.weekStart)
  const cwh = src('frontend/src/components/admin/ClientWeekHours.tsx')
  check('9. …and its screen asks without a week, adopting the server\'s', /const qs = weekStart \? `\?weekStart=\$\{weekStart\}` : '';/.test(cwh) && /if \(!weekStart && body\.weekStart\) \{ adopted\.current = body\.weekStart; setWeekStart\(body\.weekStart\); \}/.test(cwh))
  // Late Saturday night in Wisconsin is already Sunday in UTC: the week is still this one.
  setSystemTime(new Date('2026-10-18T04:30:00Z'))
  check('9. Saturday 11:30 PM Central is still this week (the agency\'s clock, not UTC)', (await A('GET', '/api/reports/client-week')).json.weekStart === THIS_SUNDAY && (await A('GET', `/api/billing/portal-claim-days?payerId=${payer.id}`)).json.week_start === THIS_SUNDAY)
  setSystemTime(new Date(`${THURSDAY}T17:00:00Z`))
}

// ══ 8. care-task minutes per week ════════════════════════════════════════════════════════════════
{
  const cl = await mkClient('Tasks')
  for (const dow of [1, 2, 3, 4, 5]) await insSched({ caregiver_id: cgA.id, client_id: cl.id, day_of_week: dow, start: '09:00', end: '12:00', effective_date: '2026-09-01' })
  // The Add Task form's payloads (Times per week left at its default 1 for the daily ones).
  for (const [taskName, category, allottedMinutes, weeklyFrequency, cadence] of [
    ['Bathing', 'adl', 30, 1, 'daily'], ['Medication reminder', 'medication', 5, 1, 'daily'], ['Laundry', 'iadl', 20, 3, 'weekly'],
  ] as const) {
    const r = await A('POST', `/api/care-tasks/client/${cl.id}`, { taskName, description: '', category, allottedMinutes, weeklyFrequency, daysOfWeek: '', timeOfDay: 'any', cadence })
    if (r.status !== 200) check(`8. add ${taskName}`, false, r.json)
  }
  const t = await A('GET', `/api/care-tasks/client/${cl.id}`)
  const by = Object.fromEntries((t.json || []).map((x: any) => [x.task_name, x]))
  check('8. a daily task counts once per scheduled visit (5 a week): 30 → 150, 5 → 25', by.Bathing?.times_per_week === 5 && by.Bathing?.minutes_per_week === 150 && by['Medication reminder']?.minutes_per_week === 25 && by.Bathing?.every_visit === true, t.json)
  check('8. a weekly task counts its own times per week: 3 × 20 → 60', by.Laundry?.times_per_week === 3 && by.Laundry?.minutes_per_week === 60 && by.Laundry?.every_visit === false, by.Laundry)
  const total = (t.json || []).reduce((s: number, x: any) => s + x.minutes_per_week, 0)
  check('8. the client\'s total is 235 min/week (was 95: daily tasks counted once)', total === 235, total)
  await q(sql`INSERT INTO client_task_templates (id, client_id, task_name, category, allotted_minutes, weekly_frequency, cadence, assessment_source, is_active)
    VALUES ('t_imp', ${cl.id}, 'Assessment bathing', 'adl', 15, 2, 'daily', 'midas_shc_pc_summary', true)`)
  const imp = (await A('GET', `/api/care-tasks/client/${cl.id}`)).json.find((x: any) => x.id === 't_imp')
  check('8. a task imported from an assessment keeps the assessment\'s count (2 × 15 = 30)', imp?.times_per_week === 2 && imp?.minutes_per_week === 30, imp)
  const bare = await mkClient('NoVisits')
  await A('POST', `/api/care-tasks/client/${bare.id}`, { taskName: 'Check in', category: 'safety', allottedMinutes: 10, weeklyFrequency: 2, cadence: 'daily' })
  const b1 = (await A('GET', `/api/care-tasks/client/${bare.id}`)).json[0]
  check('8. a daily task for a client with nothing scheduled falls back to its own times per week', b1?.times_per_week === 2 && b1?.minutes_per_week === 20 && b1?.every_visit === false, b1)
  const cp = src('frontend/src/components/admin/CarePlans.tsx'), ctm = src('frontend/src/components/admin/CareTasksManager.tsx')
  check('8. both screens print the server\'s minutes (the care-plan panel and the Care Tasks screen)',
    /const mins = \(t: any\) => Number\(t\.minutes_per_week\) \|\| 0;/.test(cp) && /sum \+ \(Number\(t\.minutes_per_week\) \|\| 0\)/.test(ctm)
    && !/\(t\.weekly_frequency \|\| 1\) \* \(t\.allotted_minutes \|\| 0\)/.test(cp + ctm))
  const pdf = await import('../../server/crm/homecare/core/carePdf.ts') /* unified: the care plan PDF's text is the foundation's (server/crm/homecare/core/carePdf.ts); it reads the camelCase task rows the list now answers */
  const text = pdf.careTasksSection((t.json || []) as any, false)
  check('8. the care plan PDF prints the same numbers', /Bathing: 5x\/week × 30 min = 150 min\/week/.test(text) && /Total: 235 min\/week/.test(text), text)
}

// ══ 10. the overpayment refusal ══════════════════════════════════════════════════════════════════
{
  const bd = src('frontend/src/components/admin/BillingDashboard.tsx')
  check('10. Record Payment has no overpayment control, so the refusal offers none', !/allowOverpayment|overpay/i.test(bd))
  check('10. …and the refusal names no developer flag', !/allowOverpayment: true/.test(src('backend/src/services/invoiceEngine.ts')))
}

setSystemTime()
console.log(`\nhomecare-r4-care: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
