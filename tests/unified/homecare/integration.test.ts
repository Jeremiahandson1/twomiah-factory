// ADAPTED COPY of tests/homecare/integration.test.ts, for the unified app (tests/unified/harness/adapted.ts). Unchanged except the
// 35 read(s) marked "unified:", where the rulebook's reply shapes replaced the template's. The original keeps
// running against the template; tests/unified/harness/unified-divergences.ts names the assertions this copy stands in for.
// crm-homecare — the home care catch-up's cross-area wiring, through the real routes.
//
// Eight areas (evv, care, staff, incidents, portal, visits, billing, reports) were ported on their own
// branches; this file pins the places where one area's code must use another's:
//   1. every path that closes a visit builds evv's EVV record (once), and a forced clock-out also
//      writes evv's visit_time_changes with an EVV reason code — on the path the Live Board calls
//   2. visits' caregiver alerts ask portal's notification preferences
//   3. the family portal's schedule and the client portal's count come from the one schedule engine
//   4. the family portal shows care's vitals on the medications permission
//   5. a draft invoice never reaches the client portal (list, balance, PDF, pay)
//   6. a training shift never bills (picker, claims)
//   7. a claim made from an invoice is not counted twice in the reports
//   8. incidents' remove-caregiver posts coverage that visits' assignShift schedules
//   9. the dashboard's action items include incident responses due
//  10. billing no longer probes for other areas' columns
//  11. Visit Documentation invoices picked visits through billing's endpoint
//  13. the pre-existing breaks: View As (impersonate), Report Miss, Edit Client fields
// plus: one schedule engine (no second expander, the merged rules) and one agency clock.
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import jwt from 'jsonwebtoken'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { agencies, users, clients, referralSources, familyMembers } from './db/schema.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 500)) }
}
const q = async (s: any) => { const r: any = await db.execute(s); return (r?.rows ?? r) as any[] }
const q1 = async (s: any) => (await q(s))[0]

process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-secret'
delete process.env.AGENCY_TIMEZONE
delete process.env.ENABLE_SANDATA_EVV
await setupSchema()

const ROOT = (process.env.FACTORY_ROOT || '') + 'templates/crm-homecare/'
const src = (p: string) => readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n')
const UNI = (process.env.FACTORY_ROOT || '') + 'apps/unified/'
const usrc = (p: string) => readFileSync(UNI + p, 'utf8').replace(/\r\n/g, '\n') /* unified: the screens moved to apps/unified/web/src/crm/pages/homecare/<group>/ and the server to apps/unified/server/crm/homecare/<group>/ and server/data/homecare*.ts (docs/UNIFIED_HOMECARE_SCREENS.md): usrc reads the moved files, so these checks hold the code that ships */

const [ag] = await db.insert(agencies).values({ name: 'Integration Care', slug: 'integration', state: 'WI', timezone: 'UTC', enabledFeatures: ['documents', 'reports', 'two_way_texting'] } as any).returning()
const mkUser = async (role: string, tag: string) => (await db.insert(users).values({
  email: `${tag}-int@test.local`, passwordHash: 'x', firstName: tag, lastName: 'Tester', role, phone: '7155550199',
} as any).returning())[0]
const owner = await mkUser('owner', 'owner')
const admin = await mkUser('admin', 'admin')
const cg1 = await mkUser('caregiver', 'cgone')
const cg2 = await mkUser('caregiver', 'cgtwo')
const [medicaid] = await db.insert(referralSources).values({ name: 'State Medicaid', payerType: 'medicaid' } as any).returning()
const mkClient = async (first: string, extra: Record<string, unknown> = {}) => (await db.insert(clients).values({
  firstName: first, lastName: 'Client', referredById: medicaid.id, medicaidId: '1421146410', portalEnabled: true, ...extra,
} as any).returning())[0]

const app = new Hono()
for (const [mount, file] of [
  ['/api/time-entries', 'timeTracking'],
  ['/api/open-shifts', 'openShifts'],
  ['/api/emergency', 'emergency'],
  ['/api/visit-docs', 'visitDocumentation'],
  ['/api/portal', 'portal'],
  ['/api/portal', 'portalVisits'],
  ['/api/family-portal', 'familyPortal'],
  ['/api/billing', 'billing'],
  ['/api/claims', 'claims'],
  ['/api/reports', 'reports'],
  ['/api/dashboard', 'dashboard'],
  ['/api/incidents', 'incidents'],
  ['/api/sandata', 'sandata'],
  ['/api/company', 'company'],
  ['/api/clients', 'clients'],
  ['/api/payroll-shift-reviews', 'payrollShiftReviews'],
  ['/api/auth', 'auth'],
  ['/api/medications', 'medications'],
  ['/api/care-plans', 'carePlans'],
  ['/api/messages', 'messages'],
  ['/api/caregivers', 'caregivers'],
  ['/api/scheduling', 'schedulingHub'],
  ['/api/mileage', 'mileage'],
  ['/api/schedules', 'schedules'],
  ['/api/push', 'push'],
] as const) {
  app.route(mount, (await import(`./src/routes/${file}.ts`)).default)
}
const { occurrencesCte } = await import('./src/services/scheduleOccurrences.ts')
const notify = await import('./src/services/visitNotify.ts')
const pushes: { userId: string; payload: any }[] = []
const texts: { to: string; body: string }[] = []
notify._setSmsSender(async (to: string, body: string) => { texts.push({ to, body }); return { status: 'sent', sid: 'SMtest', error: null } })
notify._setPushSender(async (userId: string, payload: any) => { pushes.push({ userId, payload }); return 1 })

const call = (headers: Record<string, string>) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method, headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const ct = res.headers.get('content-type') || ''
  const t = ct.includes('pdf') ? '' : await res.text()
  let j: any = t; try { const snakeKey = (k: string) => k.replace(/[A-Z]/g, (m) => '_' + m.toLowerCase()); const templateShape = (v: any): any => Array.isArray(v) ? v.map(templateShape) : (v && typeof v === 'object') ? ((Array.isArray(v.data) && v.pagination) ? templateShape(v.data) : Object.fromEntries(Object.entries(v).flatMap(([k, x]) => { const s = templateShape(x); return snakeKey(k) === k ? [[k, s]] : [[k, s], [snakeKey(k), s]] }))) : v; j = templateShape(JSON.parse(t)) } catch {} /* unified: each reply read in the template's shape: a list reply ({ data, pagination }, RULEBOOK §3) as its rows, and every camelCase key (RULEBOOK §2) also under its snake_case name — the values are the server's, unchanged */
  return { status: res.status, json: j, type: ct }
}
const as = (who: any) => call({ 'x-test-user': who.id, 'x-test-company': ag.id, 'x-test-role': who.role, 'x-test-email': who.email })
const A = as(admin), O = as(owner), CG1 = as(cg1), CG2 = as(cg2)
const bearer = (token: string) => call({ authorization: `Bearer ${token}` })

const ymd = (d: Date) => d.toISOString().slice(0, 10)
const addDays = (s: string, n: number) => ymd(new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10) + n)))
const dow = (s: string) => new Date(`${s}T12:00:00Z`).getUTCDay()
const TODAY = ymd(new Date())

const insSched = async (v: Record<string, any>) => {
  const id = `sch_${Math.random().toString(36).slice(2, 10)}`
  const base = v.date || v.effective_date || '2026-01-01'
  await q(sql`INSERT INTO schedules (id, caregiver_id, client_id, day_of_week, date, start_time, end_time, frequency, effective_date,
      anchor_date, end_date, is_active, schedule_type, status, is_training, suspended_from, created_at, updated_at)
    VALUES (${id}, ${v.caregiver_id}, ${v.client_id}, ${v.day_of_week ?? null}, ${v.date ?? null}::date,
            ${v.start === null ? null : `${base} ${v.start}`}::timestamp, ${v.end === null ? null : `${base} ${v.end}`}::timestamp,
            ${v.frequency || 'weekly'}, ${v.effective_date ?? null}::date, ${v.anchor_date ?? null}::date, ${v.end_date ?? null}::date, true,
            ${v.day_of_week != null ? 'recurring' : 'one-time'}, 'active', ${!!v.is_training}, ${v.suspended_from ?? null}::date, NOW(), NOW())`)
  return id
}
const occOf = (from: string, to: string, where: any) => q(sql`WITH ${occurrencesCte(from, to)}
  SELECT to_char(occ_date, 'YYYY-MM-DD') AS d, caregiver_id, client_id, minutes, schedule_id FROM occ WHERE ${where} ORDER BY occ_date, start_time`)
const backdate = (id: string, minutes: number) => q(sql`UPDATE time_entries SET start_time = start_time - (${minutes} * INTERVAL '1 minute') WHERE id = ${id}`)
const evvCount = async (teId: string) => Number((await q1(sql`SELECT COUNT(*)::int AS n FROM evv_visits WHERE time_entry_id = ${teId}`)).n)

// ══ 1. EVV on every close path ═══════════════════════════════════════════════════════════════════
{
  const cA = await mkClient('Evva'), cB = await mkClient('Evvb')
  const inA = await CG1('POST', '/api/time-entries/clock-in', { clientId: cA.id, latitude: 44.81, longitude: -91.5 })
  check('clock-in answers with the Sandata decision (evv) on visits\' punch', inA.status === 201 && 'sandata_required' in inA.json, inA.json)
  check('…and makes no EVV record while the visit is open', (await evvCount(inA.json.id)) === 0)
  await backdate(inA.json.id, 60)
  const out = await CG1('POST', `/api/time-entries/${inA.json.id}/clock-out`, { latitude: 44.82, longitude: -91.51, notes: 'ok' })
  check('clock-out closes the visit', out.status === 200 && !!out.json.endTime, out.json)
  check('clock-out builds the EVV record — exactly one', (await evvCount(inA.json.id)) === 1)
  const ev = await q1(sql`SELECT units_of_service, evv_method, gps_in_lat FROM evv_visits WHERE time_entry_id = ${inA.json.id}`)
  check("it is evv's record (GPS method, 4 units for an hour)", ev?.evv_method === 'gps' && Number(ev.units_of_service) === 4, ev)
  const again = await CG1('POST', `/api/time-entries/${inA.json.id}/clock-out`, {})
  check('a second clock-out changes nothing and makes no second record', again.json.already_complete === true && (await evvCount(inA.json.id)) === 1, again.json)

  // auto-close: clocking into the next client closes the open visit
  const in2 = await CG1('POST', '/api/time-entries/clock-in', { clientId: cA.id })
  await backdate(in2.json.id, 45)
  const in3 = await CG1('POST', '/api/time-entries/clock-in', { clientId: cB.id })
  const closed = await q1(sql`SELECT end_time FROM time_entries WHERE id = ${in2.json.id}`)
  check('clocking into the next client auto-closes the open visit', in3.status === 201 && !!closed?.end_time, { in3: in3.json, closed })
  check('…and the auto-close builds its EVV record', (await evvCount(in2.json.id)) === 1)

  // force clock-out, on the path the Live Board calls
  await backdate(in3.json.id, 30)
  const refused = await CG2('POST', `/api/time-entries/${in3.json.id}/admin-force-clockout`, { reason: 'x' })
  check('a caregiver may not force a clock-out', refused.status === 403, refused)
  const forced = await A('POST', `/api/time-entries/${in3.json.id}/admin-force-clockout`, { reason: 'Phone died' })
  check('the office forces the clock-out', forced.status === 200 && forced.json.success === true, forced.json)
  check('…which builds the EVV record too', (await evvCount(in3.json.id)) === 1)
  const vtc = await q(sql`SELECT reason_code, memo, new_end, changed_by_id FROM visit_time_changes WHERE time_entry_id = ${in3.json.id}`)
  check('…and records the time change for Sandata: reason code 1 (caregiver did not clock out), the reason as memo, who did it',
    vtc.length === 1 && vtc[0].reason_code === '1' && vtc[0].memo === 'Phone died' && !!vtc[0].new_end && vtc[0].changed_by_id === admin.id, vtc)
  const in4 = await CG2('POST', '/api/time-entries/clock-in', { clientId: cB.id })
  await backdate(in4.json.id, 30)
  await A('POST', `/api/time-entries/${in4.json.id}/admin-force-clockout`, { reason: 'Left early', evvReasonCode: '3', evvReasonMemo: 'Office corrected the end' })
  const vtc4 = await q1(sql`SELECT reason_code, memo FROM visit_time_changes WHERE time_entry_id = ${in4.json.id}`)
  check('an EVV reason code the office picks is kept, with its memo', vtc4?.reason_code === '3' && vtc4.memo === 'Office corrected the end', vtc4)
  const bogus = await CG1('POST', '/api/time-entries/clock-in', { clientId: cA.id })
  await backdate(bogus.json.id, 20)
  await A('POST', `/api/time-entries/${bogus.json.id}/admin-force-clockout`, { evvReasonCode: '6' })
  check('a code that is not an EVV code falls back to 1', (await q1(sql`SELECT reason_code FROM visit_time_changes WHERE time_entry_id = ${bogus.json.id}`))?.reason_code === '1')

  const tt = usrc('server/crm/homecare/visits/timeTracking.ts') /* unified: the punch router is server/crm/homecare/visits/timeTracking.ts */
  check('timeTracking builds EVV in one place: createEVVFromTimeEntry is called once, inside onVisitClosed',
    (tt.match(/createEVVFromTimeEntry\(/g) || []).length === 1 && /const onVisitClosed = [\s\S]{0,200}createEVVFromTimeEntry\(/.test(tt) /* unified: onVisitClosed is a const inside createTimeTrackingRoutes, calling core.evvVisits.createEVVFromTimeEntry */)
  check('…and every close path calls onVisitClosed (clock-out, auto-close, force)', (tt.match(/await onVisitClosed\(/g) || []).length === 3)
  check("the Live Board's Force Clock Out posts to /api/time-entries/:id/admin-force-clockout",
    /\/api\/time-entries\/\$\{[^}]+\}\/admin-force-clockout/.test(usrc('web/src/crm/pages/homecare/shifts/LiveBoard.tsx')) /* unified: the Live Board is shifts/LiveBoard.tsx */
    && /\{ path: '\/api\/time-entries', access: 'user', router: createTimeTrackingRoutes\(core, d\) \}/.test(usrc('server/crm/homecare/visits/index.ts')) /* unified: the mount is the visits group's (server/crm/homecare/visits/index.ts visitsMounts) */
    && /app\.post\('\/:id\/admin-force-clockout'/.test(tt))
}

// ══ 2. caregiver alerts respect the person's notification preferences ════════════════════════════
{
  const mk = async (tag: string) => mkUser('caregiver', tag)
  const free = await mk('nopref'), off = await mk('pushoff'), noRem = await mk('noreminder'), quiet = await mk('quiet')
  await q(sql`INSERT INTO notification_preferences (id, user_id, push_enabled, sms_enabled) VALUES ('np1', ${off.id}, false, true)`)
  await q(sql`INSERT INTO notification_preferences (id, user_id, push_enabled, shift_reminder_alerts) VALUES ('np2', ${noRem.id}, true, false)`)
  await q(sql`INSERT INTO notification_preferences (id, user_id, push_enabled, sms_enabled, quiet_hours_start, quiet_hours_end)
    VALUES ('np3', ${quiet.id}, true, true, '00:01', '00:00')`) // quiet all day but one minute (wraps midnight)
  const send = (u: any, extra: any = {}) => notify.sendCaregiverAlert({ userId: u.id, alertType: 'shift_reminder', channel: 'push', body: 'Shift in 1 hour', ...extra })
  const before = pushes.length
  check('no preferences on file: the reminder goes out', (await send(free)) === true && pushes.length === before + 1)
  check('push switched off: no push', (await send(off)) === false && pushes.length === before + 1)
  check('shift reminders switched off: no reminder', (await send(noRem)) === false && pushes.length === before + 1)
  check('inside quiet hours: a routine reminder waits', (await send(quiet)) === false && pushes.length === before + 1)
  const t0 = texts.length
  const urgent = await notify.sendCaregiverAlert({ userId: quiet.id, alertType: 'overtime_alert', channel: 'sms', urgent: true, phone: '7155550100', body: 'Still clocked in' })
  check('…but an urgent over-visit text still goes (still send urgent alerts is on by default)', urgent === true && texts.length === t0 + 1)
  const smsOff = await notify.sendCaregiverAlert({ userId: off.id, alertType: 'overtime_alert', channel: 'sms', urgent: true, phone: '7155550100', body: 'x' })
  check('SMS stays allowed where only push was switched off', smsOff === true)
}

// ══ 3 + 4. family portal: schedule from the engine, vitals on the medications switch ════════════
const famClient = await mkClient('Fam')
{
  await insSched({ caregiver_id: cg1.id, client_id: famClient.id, day_of_week: dow(TODAY), start: '09:00', end: '11:00', effective_date: addDays(TODAY, -7) })
  const weekly = (await q1(sql`SELECT id FROM schedules WHERE client_id = ${famClient.id} AND day_of_week IS NOT NULL`)).id
  await q(sql`INSERT INTO schedule_exceptions (id, schedule_id, exception_date, exception_type) VALUES ('ex_fam', ${weekly}, ${addDays(TODAY, 7)}::date, 'cancelled')`)
  await insSched({ caregiver_id: cg2.id, client_id: famClient.id, date: addDays(TODAY, 3), start: '13:00', end: '14:00' })
  await insSched({ caregiver_id: cg2.id, client_id: famClient.id, date: addDays(TODAY, -2), start: '13:00', end: '14:00' }) // past

  const [memberA] = await db.insert(familyMembers).values({ clientId: famClient.id, name: 'Rel A', email: 'rela@fam.local', passwordHash: 'x', isActive: true, canViewSchedule: true, canViewMedications: false } as any).returning()
  const [memberB] = await db.insert(familyMembers).values({ clientId: famClient.id, name: 'Rel B', email: 'relb@fam.local', passwordHash: 'x', isActive: true, canViewSchedule: false, canViewMedications: true } as any).returning()
  const famA = bearer(jwt.sign({ role: 'family', familyMemberId: memberA.id }, process.env.JWT_SECRET!))
  const famB = bearer(jwt.sign({ role: 'family', familyMemberId: memberB.id }, process.env.JWT_SECRET!))

  const s = await famA('GET', '/api/family-portal/portal/schedule')
  const dates = (s.json || []).map((v: any) => v.date)
  const expected = [TODAY, addDays(TODAY, 3), addDays(TODAY, 14), addDays(TODAY, 21)]
  check('the family schedule is the next four weeks of real visits: the weekly pattern, the one-time visit, not the cancelled day, not the past',
    s.status === 200 && JSON.stringify(dates) === JSON.stringify(expected), { dates, expected })
  const eng = await occOf(TODAY, addDays(TODAY, 27), sql`client_id = ${famClient.id}`)
  check('…the same visits the engine gives everyone else', eng.length === expected.length)
  check('…with the covering caregiver on the day they cover', s.json.find((v: any) => v.date === addDays(TODAY, 3))?.caregiverFirst === 'cgtwo', s.json)
  check('a relative without the schedule switch is refused', (await famB('GET', '/api/family-portal/portal/schedule')).status === 403)

  const me = await bearer(jwt.sign({ role: 'client', clientId: famClient.id }, process.env.JWT_SECRET!))('GET', '/api/portal/me')
  check("the client portal's upcoming-visit count is the engine's", me.status === 200 && me.json.summary?.upcomingSchedules === expected.length, me)

  await q(sql`INSERT INTO client_vitals (id, client_id, caregiver_id, recorded_at, pulse, systolic_bp, diastolic_bp, notes)
    VALUES ('cv1', ${famClient.id}, ${cg1.id}, NOW(), 72, 120, 80, 'Resting')`)
  check('vitals sit behind the medications switch: a relative without it is refused', (await famA('GET', '/api/family-portal/portal/vitals')).status === 403)
  const vit = await famB('GET', '/api/family-portal/portal/vitals')
  check("…a relative with it sees care's vitals, with who took them", vit.status === 200 && vit.json.length === 1 && vit.json[0].pulse === 72 && vit.json[0].caregiver_first === 'cgone', vit.json)
  check('the family portal screen has the Vitals tab, on the medications switch', /\/api\/family-portal\/portal\/vitals/.test(usrc('web/src/crm/pages/homecare/portals/FamilyPortal.tsx')) /* unified: the family portal is portals/FamilyPortal.tsx */
    && /canViewMedications\) tabs\.push\(\{ key: 'vitals'/.test(usrc('web/src/crm/pages/homecare/portals/FamilyPortal.tsx')) /* unified: the family portal is portals/FamilyPortal.tsx */)
}

// ══ 5. a draft invoice never reaches the client portal ═══════════════════════════════════════════
{
  const cl = await mkClient('Inv')
  const ins = (n: string, total: string, sent: boolean) => q(sql`INSERT INTO invoices (id, invoice_number, client_id, billing_period_start, billing_period_end, subtotal, total, payment_status, sent_at)
    VALUES (${n}, ${n}, ${cl.id}, '2026-09-01', '2026-09-07', ${total}, ${total}, 'pending', ${sent ? new Date().toISOString() : null}::timestamp)`)
  await ins('INV-DRAFT', '40', false)
  await ins('INV-SENT', '60', true)
  const tok = bearer(jwt.sign({ role: 'client', clientId: cl.id }, process.env.JWT_SECRET!))
  const list = await tok('GET', '/api/portal/invoices')
  check('the invoice list shows the sent invoice only', list.status === 200 && list.json.length === 1 && list.json[0].invoiceNumber === 'INV-SENT', list.json)
  const me = await tok('GET', '/api/portal/me')
  check('the balance counts the sent invoice only', me.json.summary?.outstandingBalance === 60, me.json?.summary)
  check('a draft has no PDF', (await tok('GET', '/api/portal/invoices/INV-DRAFT/pdf')).status === 404)
  const prev = process.env.STRIPE_SECRET_KEY
  process.env.STRIPE_SECRET_KEY = 'sk_test_never_called'
  check('a draft cannot be paid', (await tok('POST', '/api/portal/invoices/INV-DRAFT/pay')).status === 404)
  if (prev === undefined) delete process.env.STRIPE_SECRET_KEY; else process.env.STRIPE_SECRET_KEY = prev
}

// ══ 6. training shifts never bill ═══════════════════════════════════════════════════════════════
{
  const cl = await mkClient('Train')
  const mon = '2026-08-03' // a Monday
  await insSched({ caregiver_id: cg1.id, client_id: cl.id, date: mon, start: '09:00', end: '11:00' })
  await insSched({ caregiver_id: cg2.id, client_id: cl.id, date: mon, start: '12:00', end: '13:00', is_training: true })
  const vis = await A('GET', `/api/billing/scheduled-visits?clientId=${cl.id}&from=2026-08-01&to=2026-08-07`)
  check('the invoice-from-visits picker lists the real visit, not the training shift',
    vis.status === 200 && vis.json.length === 1 && vis.json[0].caregiver_id === cg1.id, vis.json)

  // claims: an EVV record on a training punch makes no claim
  const trainSched = (await q1(sql`SELECT id FROM schedules WHERE client_id = ${cl.id} AND is_training = true`)).id
  const realSched = (await q1(sql`SELECT id FROM schedules WHERE client_id = ${cl.id} AND is_training = false`)).id
  const te = async (id: string, sched: string, cg: string, h: number) => q(sql`INSERT INTO time_entries (id, caregiver_id, client_id, schedule_id, start_time, end_time, duration_minutes, billable_minutes, is_complete)
    VALUES (${id}, ${cg}, ${cl.id}, ${sched}, ${`${mon} ${String(h).padStart(2, '0')}:00:00`}::timestamp, ${`${mon} ${String(h + 1).padStart(2, '0')}:00:00`}::timestamp, 60, 60, true)`)
  await te('te_real', realSched, cg1.id, 9)
  await te('te_train', trainSched, cg2.id, 12)
  const ev = async (id: string, teId: string, cg: string) => q(sql`INSERT INTO evv_visits (id, time_entry_id, client_id, caregiver_id, service_date, actual_start, actual_end, units_of_service, sandata_status)
    VALUES (${id}, ${teId}, ${cl.id}, ${cg}, ${mon}::date, NOW(), NOW(), 4, 'accepted')`)
  await ev('ev_real', 'te_real', cg1.id)
  await ev('ev_train', 'te_train', cg2.id)
  const one = await A('POST', '/api/claims/from-evv', { evvVisitId: 'ev_train' })
  check('a claim from a training visit is refused, saying why', one.status === 400 && /training/i.test(one.json.error), one.json)
  const batch = await A('POST', '/api/claims/batch-generate', { startDate: '2026-08-01', endDate: '2026-08-07' })
  const made = await q(sql`SELECT evv_visit_id FROM claims WHERE evv_visit_id IN ('ev_real', 'ev_train')`)
  check('batch claims bill the real visit and never pick up the training one', batch.status === 200 && batch.json.generated === 1 && batch.json.skipped === 0 && made.length === 1 && made[0].evv_visit_id === 'ev_real', { batch: batch.json, made })
}

// ══ 7. a claim made from an invoice is not counted twice ═════════════════════════════════════════
{
  const cl = await mkClient('Rev')
  await q(sql`INSERT INTO invoices (id, invoice_number, client_id, billing_period_start, billing_period_end, subtotal, total, payment_status, sent_at)
    VALUES ('inv_rev', 'INV-REV', ${cl.id}, '2026-09-01', '2026-09-14', 100, 100, 'pending', NOW())`)
  await q(sql`INSERT INTO claims (id, client_id, payer_id, invoice_id, claim_number, service_date, billed_amount, status)
    VALUES ('clm_inv', ${cl.id}, ${medicaid.id}, 'inv_rev', 'CLM-INV', '2026-09-10', 100, 'submitted')`)
  await q(sql`INSERT INTO claims (id, client_id, payer_id, claim_number, service_date, billed_amount, status)
    VALUES ('clm_evv', ${cl.id}, ${medicaid.id}, 'CLM-EVV', '2026-09-20', 50, 'submitted')`)
  const range = { startDate: '2026-09-01', endDate: '2026-09-30', clientId: cl.id }
  const rev = await A('POST', '/api/reports/revenue', range)
  check('revenue = the invoice + the EVV claim (150), not + the claim made from that invoice (250)', rev.status === 200 && rev.json.revenue?.total === 150, rev.json?.revenue)
  check('…the outstanding and the count follow', rev.json.revenue?.outstanding === 150 && rev.json.revenue?.invoiceCount === 2, rev.json?.revenue)
  check('…AR aging holds 150', Number(rev.json.ar?.total_outstanding) === 150, rev.json?.ar)
  check('…by payer and by client too', rev.json.byPayer.reduce((s: number, r: any) => s + Number(r.billed), 0) === 150
    && Number(rev.json.byClient.find((r: any) => r.id === cl.id)?.revenue) === 150, { byPayer: rev.json.byPayer, byClient: rev.json.byClient })
  const ov = await A('POST', '/api/reports/overview', range)
  check('the overview revenue tile agrees (150)', ov.status === 200 && Number(ov.json.totalRevenue ?? ov.json.summary?.totalRevenue ?? ov.json.revenue?.totalRevenue) === 150, ov.json)
  const rep = usrc('server/data/homecarePlanning.ts') /* unified: the reports' SQL is server/data/homecarePlanning.ts */
  const claimSites = (rep.match(/(FROM|JOIN) claims cl/g) || []).length
  const guarded = (rep.match(/cl\.invoice_id IS NULL/g) || []).length + (rep.match(/\$\{claimsIn\(/g) || []).length /* unified: the guarded claims filter is the function claimsIn(companyId, start, end, clientId), not the template's clmIn fragment */
  check('every place reports.ts counts claims beside invoices leaves invoice-made claims out', claimSites === 8 && guarded >= 8, { claimSites, guarded })
}

// ══ 8. incidents: removing a caregiver posts coverage that visits' assignShift schedules ═══════════
{
  const cl = await mkClient('Inc')
  const day = addDays(TODAY, 2)
  await insSched({ caregiver_id: cg1.id, client_id: cl.id, day_of_week: dow(day), start: '08:00', end: '10:00', effective_date: addDays(TODAY, -14) })
  const inc = await A('POST', '/api/incidents', {
    clientId: cl.id, caregiverId: cg1.id, incidentType: 'missing_medication', severity: 'moderate', incidentDate: TODAY,
    incidentTime: '10:15', description: 'Payer reports missing medication.', reportedBy: 'Health Plan', reportedDate: TODAY,
  })
  check('the incident is filed', inc.status === 201 || inc.status === 200, inc.json)
  const incId = inc.json.id || inc.json.incident?.id
  const rm = await A('POST', `/api/incidents/${incId}/remove-caregiver`, { fromDate: TODAY, postOpenShifts: true, coverageWeeks: 1 })
  check("removing the caregiver posts the week's visit as an open shift", rm.status === 200 && rm.json.openShiftsPosted === 1, rm.json)
  const os = await q1(sql`SELECT id, schedule_id, to_char(date, 'YYYY-MM-DD') AS d FROM open_shifts WHERE client_id = ${cl.id} AND status = 'open'`)
  check('…for that day, with no schedule of its own (the pattern is paused)', os?.d === day && os.schedule_id === null, os)
  const cg1Left = await occOf(TODAY, addDays(TODAY, 27), sql`client_id = ${cl.id} AND caregiver_id = ${cg1.id}`)
  check('the removed caregiver has no visits there any more (by the one engine)', cg1Left.length === 0, cg1Left)
  const fill = await A('POST', `/api/open-shifts/${os.id}/smart-fill`, { caregiverId: cg2.id })
  check('the office fills the open shift with another caregiver', fill.status === 200 && fill.json.success === true, fill.json)
  const covered = await occOf(day, day, sql`client_id = ${cl.id}`)
  check('…and that visit is now on the schedule — a one-time visit for the new caregiver', covered.length === 1 && covered[0].caregiver_id === cg2.id, covered)
  check('…the open shift is filled', (await q1(sql`SELECT status FROM open_shifts WHERE id = ${os.id}`))?.status === 'filled')
}

// ══ 9. the dashboard's action items include incident responses due ═══════════════════════════════
{
  const cl = await mkClient('Due')
  const inc = await A('POST', '/api/incidents', {
    clientId: cl.id, caregiverId: cg2.id, incidentType: 'missing_medication', severity: 'moderate', incidentDate: TODAY,
    incidentTime: '09:00', description: 'Response due soon.', reportedBy: 'Health Plan', reportedDate: TODAY, responseDueDate: addDays(TODAY, 1),
  })
  const incId = inc.json.id || inc.json.incident?.id
  const item = (r: any) => (r.json.items || []).find((i: any) => i.key === 'incident_responses_due')
  const ai = await A('GET', '/api/dashboard/action-items')
  check('an incident response due tomorrow is on the action items, pointing at Incidents', ai.status === 200 && item(ai)?.count === 1 && item(ai)?.page === 'incidents', ai.json)
  const viaIncidents = await A('GET', '/api/incidents/responses-due')
  check("…the same count as the incidents area's own list", viaIncidents.json.count === item(ai)?.count, viaIncidents.json)
  await q(sql`UPDATE incidents SET response_sent_date = ${TODAY}::date WHERE id = ${incId}`)
  check('…and it leaves once the response is sent', !item(await A('GET', '/api/dashboard/action-items')))
  check('a caregiver cannot read the action items', (await CG1('GET', '/api/dashboard/action-items')).status === 403)
}

// ══ 10. billing no longer probes for other areas' columns ════════════════════════════════════════
for (const f of ['server/crm/homecare/core/invoiceEngine.ts', 'server/crm/homecare/billing/invoices.ts', 'server/crm/homecare/core/portalClaimDays.ts', 'server/data/homecareBilling.ts', 'server/data/homecareBillingRoutes.ts']) { /* unified: the invoice engine, the billing routes (billing/invoices.ts), portal claim days and their SQL (server/data/homecareBilling.ts, homecareBillingRoutes.ts) */
  const s = usrc(f) /* unified: read from the unified server */
  check(`${f}: no information_schema / columnExists / tableExists probe`, !/information_schema|columnExists|tableExists|to_regclass/.test(s))
}

// ══ 11. Visit Documentation invoices picked visits through billing's endpoint ═══════════════════
{
  const cl = await mkClient('Docs', { referredById: null, medicaidId: null, isPrivatePay: true, privatePayRate: '30.00', privatePayRateType: 'hourly' })
  await insSched({ caregiver_id: cg1.id, client_id: cl.id, date: '2026-08-10', start: '09:00', end: '11:00' })
  await insSched({ caregiver_id: cg1.id, client_id: cl.id, date: '2026-08-11', start: '09:00', end: '10:00' })
  const docs = await A('GET', `/api/visit-docs/clients/${cl.id}?from=2026-08-01&to=2026-08-31`)
  check('Visit Documentation lists the scheduled visits', docs.status === 200 && docs.json.visits?.length === 2, docs.json)
  const v = docs.json.visits[0]
  // the screen's own payload (VisitDocumentation.tsx createInvoice)
  const made = await A('POST', '/api/billing/invoices/from-visits', { clientId: cl.id, visits: [{ visitDate: v.visit_date, startTime: v.start_time, caregiverId: v.caregiver_id }] })
  check("the screen's payload builds a draft invoice through billing: 2 h × $30", made.status === 201 && Number(made.json.total) === 60 && !made.json.sent_at, made.json)
  const after = await A('GET', `/api/visit-docs/clients/${cl.id}?from=2026-08-01&to=2026-08-31`)
  const marked = after.json.visits.find((x: any) => x.visit_date === v.visit_date)
  check('…and the visit now shows as invoiced, the other not', !!marked?.invoiced && !after.json.visits.find((x: any) => x.visit_date !== v.visit_date)?.invoiced, after.json.visits)
  const again = await A('POST', '/api/billing/invoices/from-visits', { clientId: cl.id, visits: [{ visitDate: v.visit_date, startTime: v.start_time, caregiverId: v.caregiver_id }] })
  check('…and cannot be billed twice', again.status === 409, again.json)
  const screen = usrc('web/src/crm/pages/homecare/visits/VisitDocumentation.tsx') /* unified: Visit Documentation is visits/VisitDocumentation.tsx */
  check('the Visit Documentation screen posts to /api/billing/invoices/from-visits with visitDate/startTime/caregiverId',
    /\/api\/billing\/invoices\/from-visits/.test(screen) && /visitDate: v\.visitDate, startTime: v\.startTime, caregiverId: v\.caregiverId/.test(screen) /* unified: the screen's visits are the camelCase reply (RULEBOOK §2): it sends the same three keys from v.visitDate, v.startTime, v.caregiverId */)
  check('a caregiver cannot build an invoice', (await CG1('POST', '/api/billing/invoices/from-visits', { clientId: cl.id, visits: [] })).status === 403)
}

// ══ 13a. View As: POST /api/auth/impersonate/:userId ═════════════════════════════════════════════
{
  const r = await A('POST', `/api/auth/impersonate/${cg1.id}`)
  const dec: any = r.status === 200 ? jwt.verify(r.json.token, process.env.JWT_SECRET!) : null
  check('an admin views as a caregiver: a token for that caregiver, marked as View As', r.status === 200 && dec?.userId === cg1.id && dec.role === 'caregiver' && dec.impersonation === true && dec.impersonatedBy === admin.email, { r: r.json, dec })
  check('…short-lived (2 hours)', dec && dec.exp - dec.iat === 2 * 3600, dec)
  check('…returning the user the screen shows', r.json.user?.id === cg1.id && r.json.user?.name === 'cgone Tester' && r.json.user?.role === 'caregiver', r.json.user)
  const audit = await q(sql`SELECT user_id, record_id, new_data FROM audit_logs WHERE action = 'ADMIN_IMPERSONATE'`)
  check('…and it is audited: who viewed whom', audit.length === 1 && audit[0].user_id === admin.id && audit[0].record_id === cg1.id, audit)
  check('a caregiver cannot view as anyone', (await CG1('POST', `/api/auth/impersonate/${cg2.id}`)).status === 403)
  check('an admin cannot view as an owner (that token would carry more than the admin has)', (await A('POST', `/api/auth/impersonate/${owner.id}`)).status === 403)
  check('an owner may view as an admin', (await O('POST', `/api/auth/impersonate/${admin.id}`)).status === 200)
  check('an unknown user is a 404', (await A('POST', '/api/auth/impersonate/nope')).status === 404)
  check('the View As modal calls that path', /\/api\/auth\/impersonate\/\$\{userId\}/.test(usrc('web/src/crm/pages/homecare/office/ImpersonationModal.tsx') /* unified: the View As picker is office/ImpersonationModal.tsx */))
  check("the viewed user's screens get that user's session (AuthContext override with the View As token)",
    /api\.post\(\x60\/api\/auth\/impersonate\/\$\{userId\}\x60, \{\}\);\s*onStaff\(data\.user\)/.test(usrc('web/src/crm/pages/homecare/office/ImpersonationModal.tsx')) && /onStaff=\{\(\) => reloadAsSession\(\)\}/.test(usrc('web/src/crm/pages/homecare/office/ViewAsPanel.tsx')) && /export const reloadAsSession = \(\) => window\.location\.assign\('\/crm\/dashboard'\)/.test(usrc('web/src/crm/pages/homecare/office/ViewAs.tsx')) /* unified: the session is the server's cookies: POST /api/auth/impersonate sets the httpOnly View As cookie and the page loads afresh as that person (office/ViewAs.tsx reloadAsSession); no script holds the token. The server half (/me is the viewed person, writes refused) is apps/unified/tests/homecare-office.test.ts */)
}

// ══ 13b/13c. Report Miss page and Edit Client fields ═════════════════════════════════════════════
{
  const dash = usrc('web/src/crm/pages/homecare/visits/CaregiverDashboard.tsx') /* unified: the caregiver's app is visits/CaregiverDashboard.tsx */
  check('Report Miss renders the miss-report form (renderMissReportPage never existed)', !/renderMissReportPage/.test(dash) && /currentPage === 'miss-report' && <ShiftMissReport/.test(dash))
  check('…which posts to the miss-report route visits ported', /\/api\/emergency\/miss-report/.test(usrc('web/src/crm/pages/homecare/visits/caregiver/ShiftMissReport.tsx') /* unified: the miss-report form is visits/caregiver/ShiftMissReport.tsx */))
  const shift = await insSched({ caregiver_id: cg1.id, client_id: famClient.id, date: addDays(TODAY, 5), start: '15:00', end: '16:00' })
  const miss = await CG1('POST', '/api/emergency/miss-report', { scheduleId: shift, date: addDays(TODAY, 5), reason: 'Illness - not feeling well', alternativeContact: '' })
  check("…and the form's payload is accepted", miss.status === 201 && miss.json.openShiftCreated === true, miss.json)

  const modal = usrc('web/src/crm/pages/homecare/clients/EditClientModal.tsx') /* unified: Edit Client is clients/EditClientModal.tsx */
  check('Edit Client reads the camelCase client it is given (falling back to snake_case)', /firstName: client\.firstName \|\| ''/.test(modal) && /careTypeId: client\.careTypeId \|\| ''/.test(modal) && /isPrivatePay: !!client\.isPrivatePay/.test(modal) && !/client\.(first_name|care_type_id|is_private_pay)\b/.test(modal) /* unified: every reply is camelCase (RULEBOOK §2), so the modal reads the camelCase client directly; no snake_case fallback is needed or left */)
  const cl = await mkClient('Edit', { allergies: ['Penicillin'], preferredCaregivers: [cg1.id] })
  const listed = await A('GET', '/api/clients')
  const row = (listed.json.clients || listed.json.data || listed.json).find?.((x: any) => x.id === cl.id)
  check('the office client list is camelCase — what the modal now reads', !!row && row.firstName === 'Edit' && 'isPrivatePay' in row, row) /* unified: this copy reads every reply with each camelCase key also under its snake_case name, so the absence of first_name is not asked; that the list is camelCase is firstName and isPrivatePay being there */
  // the modal's real save payload: lists as arrays (never null), caregiver preferences as ids
  const put = await A('PUT', `/api/clients/${cl.id}`, {
    firstName: 'Edit', lastName: 'Client', dateOfBirth: null, gender: null, phone: null, email: null, address: null, city: null, state: 'WI', zip: null,
    referralSourceId: medicaid.id, careTypeId: null, isPrivatePay: false, privatePayRate: null, privatePayRateType: 'hourly', billingNotes: null,
    weeklyAuthorizedUnits: null, medicalConditions: [], medications: [], allergies: ['Penicillin', 'Latex'], assistanceNeeds: null,
    insuranceProvider: null, insuranceId: null, insuranceGroup: null, preferredCaregivers: [cg1.id], doNotUseCaregivers: [cg2.id], notes: null,
  })
  check("the modal's save payload is accepted and keeps lists as lists", put.status === 200 && Array.isArray(put.json.allergies) && put.json.allergies.length === 2
    && put.json.doNotUseCaregivers?.[0] === cg2.id, put.json)
}

// ══ one schedule engine ═══════════════════════════════════════════════════════════════════════════
{
  const be = UNI + 'server/' /* unified: the server is apps/unified/server */
  for (const gone of ['services/incidentSchedule.ts', 'helpers/shiftHours.ts', 'utils/agencyTimezone.ts', 'helpers/agencyTime.ts']) {
    check(`${gone} is gone (folded into the shared one)`, !readdirSync(be, { recursive: true } as any).map((p: any) => String(p).replace(/\\/g, '/')).some((p: string) => p.endsWith('/' + gone.split('/').pop()) && p !== 'crm/homecare/core/agencyTime.ts')) /* unified: no file of that name anywhere in the unified server (the shared agency clock is crm/homecare/core/agencyTime.ts) */
  }
  const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(`${d}/${e.name}`) : e.name.endsWith('.ts') ? [`${d}/${e.name}`] : [])
  const expanders = walk(be.replace(/\/$/, '')).filter((f) => {
    const s = readFileSync(f, 'utf8')
    return /EXTRACT\(DOW FROM d\.dt\)|getDay\(\) === sched\.dayOfWeek/.test(s)
  }).map((f) => f.slice(be.length - 1))
  check('only services/scheduleOccurrences.ts expands a schedule pattern', JSON.stringify(expanders) === JSON.stringify(['/data/homecareCore.ts']) /* unified: the one schedule engine is SQL in server/data/homecareCore.ts (occurrencesCte) */, expanders)

  const c = await mkClient('Eng')
  const anchor = '2026-09-07' // Monday
  const biA = await insSched({ caregiver_id: cg1.id, client_id: c.id, day_of_week: 1, start: '09:00', end: '10:00', effective_date: anchor, anchor_date: anchor, frequency: 'bi-weekly' })
  const bi = await occOf('2026-09-01', '2026-10-05', sql`schedule_id = ${biA}`)
  check("'bi-weekly' (the spelling some writers stored) runs every other week on its anchor fortnight", JSON.stringify(bi.map((x) => x.d)) === JSON.stringify(['2026-09-07', '2026-09-21', '2026-10-05']), bi)
  const noDate = `sch_nodate`
  await q(sql`INSERT INTO schedules (id, caregiver_id, client_id, start_time, end_time, is_active, schedule_type, created_at, updated_at)
    VALUES (${noDate}, ${cg1.id}, ${c.id}, '2026-09-15 13:00:00'::timestamp, '2026-09-15 14:00:00'::timestamp, true, 'one-time', NOW(), NOW())`)
  check('a one-time visit written without `date` occurs on its start_time date', (await occOf('2026-09-01', '2026-09-30', sql`schedule_id = ${noDate}`)).map((x) => x.d).join() === '2026-09-15')
  const noEnd = await insSched({ caregiver_id: cg1.id, client_id: c.id, date: '2026-09-16', start: '13:00', end: null })
  check('a row without an end time is not a visit', (await occOf('2026-09-01', '2026-09-30', sql`schedule_id = ${noEnd}`)).length === 0)
  const night = await insSched({ caregiver_id: cg1.id, client_id: c.id, date: '2026-09-17', start: '22:00', end: '06:00' })
  check('an overnight visit is 8 hours (480 minutes)', Number((await occOf('2026-09-17', '2026-09-17', sql`schedule_id = ${night}`))[0]?.minutes) === 480)
  const train = await insSched({ caregiver_id: cg1.id, client_id: c.id, date: '2026-09-18', start: '09:00', end: '10:00', is_training: true })
  const tr = await q1(sql`WITH ${occurrencesCte('2026-09-18', '2026-09-18')} SELECT is_training FROM occ WHERE schedule_id = ${train}`)
  check('the engine marks a training occurrence (is_training)', tr?.is_training === true)

  // payroll's shift review now expands through the engine and matches punches on the agency's day
  const p = await mkClient('Pay')
  const wk = await insSched({ caregiver_id: cg2.id, client_id: p.id, day_of_week: 2, start: '09:00', end: '11:00', effective_date: '2026-06-01' }) // Tuesdays
  await q(sql`INSERT INTO schedule_exceptions (id, schedule_id, exception_date, exception_type) VALUES ('ex_pay', ${wk}, '2026-06-09'::date, 'cancelled')`)
  await q(sql`UPDATE schedules SET suspended_from = '2026-06-23' WHERE id = ${wk}`)
  await q(sql`INSERT INTO time_entries (id, caregiver_id, client_id, start_time, end_time, duration_minutes, billable_minutes, is_complete)
    VALUES ('te_pay', ${cg2.id}, ${p.id}, '2026-06-02 09:02:00'::timestamp, '2026-06-02 11:00:00'::timestamp, 118, 120, true)`)
  const gen = await A('POST', '/api/payroll-shift-reviews/generate-shifts', { startDate: '2026-06-01', endDate: '2026-06-30' })
  const rv = await q(sql`SELECT to_char(shift_date, 'YYYY-MM-DD') AS d, status, scheduled_minutes, time_entry_id FROM payroll_shift_reviews WHERE client_id = ${p.id} ORDER BY shift_date`)
  check('payroll shift review: Tuesdays 6/2 and 6/16 only — 6/9 cancelled, nothing from the 6/23 suspension', JSON.stringify(rv.map((r) => r.d)) === JSON.stringify(['2026-06-02', '2026-06-16']), { gen: gen.json, rv })
  check('…6/2 matched to its punch and verified (118 of 120 scheduled minutes), 6/16 missing a punch',
    rv[0]?.status === 'verified' && rv[0].time_entry_id === 'te_pay' && Number(rv[0].scheduled_minutes) === 120 && rv[1]?.status === 'missing_punch', rv)
  check('…a bad date is refused', (await A('POST', '/api/payroll-shift-reviews/generate-shifts', { startDate: 'June', endDate: '2026-06-30' })).status === 400)

  // care's care-plan schedule text reads the engine, and says when a pattern is paused
  const cp = await mkClient('Plan')
  await insSched({ caregiver_id: cg1.id, client_id: cp.id, day_of_week: dow(addDays(TODAY, 1)), start: '09:00', end: '10:00', effective_date: addDays(TODAY, -7), suspended_from: addDays(TODAY, 10) })
  const { getClientVisitSchedule } = await import('./src/services/carePlanSchedule.ts')
  const plan = await getClientVisitSchedule(cp.id)
  check("the care-plan schedule says the pattern is paused, as the source CRM's does", plan.lines.length === 1 && / · paused from /.test(plan.lines[0]), plan)
  check('…and counts only the visits before the pause', plan.upcomingVisits === (await occOf(TODAY, addDays(TODAY, 27), sql`client_id = ${cp.id}`)).length, plan)
}

// ══ caregiver scope, the app's routes (coordinator's list a–i) ═══════════════════════════════════
{
  const served = await mkClient('Served'), other = await mkClient('Other')
  await q(sql`INSERT INTO client_assignments (id, client_id, caregiver_id, assignment_date, status) VALUES ('ca_srv', ${served.id}, ${cg1.id}, '2026-01-01', 'active')`)
  await q(sql`INSERT INTO medications (id, client_id, name, status) VALUES ('med_srv', ${served.id}, 'Lisinopril', 'active'), ('med_oth', ${other.id}, 'Metformin', 'active')`)
  await q(sql`INSERT INTO client_vitals (id, client_id, caregiver_id, recorded_at, pulse) VALUES ('cv_oth', ${other.id}, ${cg2.id}, NOW(), 80)`)
  await q(sql`INSERT INTO care_plans (id, client_id, service_type, status) VALUES ('cp_srv', ${served.id}, 'personal_care', 'active'), ('cp_oth', ${other.id}, 'companionship', 'active')`)

  // (a) medications / MAR / vitals and care plans: a caregiver reads only clients they serve
  for (const p of ['/api/medications/client/', '/api/medications/due/', '/api/medications/logs/client/', '/api/medications/vitals/client/', '/api/medications/vitals/latest/', '/api/medications/reports/adherence/']) {
    const mine = await CG1('GET', p + served.id)
    const not = await CG1('GET', p + other.id)
    check(`(a) GET ${p}:clientId — a caregiver reads a client they serve (200), not another (403)`, mine.status === 200 && not.status === 403, { mine: mine.status, not: not.status })
  }
  check('(a) …the office reads any client', (await A('GET', `/api/medications/client/${other.id}`)).json?.[0]?.name === 'Metformin')
  await q(sql`INSERT INTO time_entries (id, caregiver_id, client_id, start_time, end_time, is_complete) VALUES ('te_oth', ${cg2.id}, ${other.id}, NOW() - INTERVAL '2 hours', NOW() - INTERVAL '1 hour', true)`)
  check("(a) the MAR of someone else's visit for a client the caregiver does not serve is refused", (await CG1('GET', '/api/medications/logs/time-entry/te_oth')).status === 403)
  check('(a) …the visit\'s own caregiver reads it', (await CG2('GET', '/api/medications/logs/time-entry/te_oth')).status === 200)
  const plans = await CG1('GET', '/api/care-plans')
  check("(a) GET /api/care-plans with no clientId lists only the caregiver's clients' plans", plans.status === 200 && plans.json.some((p: any) => p.id === 'cp_srv') && !plans.json.some((p: any) => p.id === 'cp_oth'), plans.json?.map?.((p: any) => p.id))
  check('(a) …?clientId of a client they do not serve is refused', (await CG1('GET', `/api/care-plans?clientId=${other.id}`)).status === 403)
  check('(a) …the office lists every plan', (await A('GET', '/api/care-plans')).json.some((p: any) => p.id === 'cp_oth'))

  // (b) message threads: participants (or the office) only
  await q(sql`INSERT INTO message_threads (id, subject, created_by_id) VALUES ('th1', 'Shift question', ${cg1.id})`)
  await q(sql`INSERT INTO message_thread_participants (id, thread_id, user_id) VALUES ('tp1', 'th1', ${cg1.id}), ('tp2', 'th1', ${admin.id})`)
  await q(sql`INSERT INTO messages (id, thread_id, sender_id, body) VALUES ('m1', 'th1', ${cg1.id}, 'Can I swap Tuesday?')`)
  check('(b) a participant reads the thread', (await CG1('GET', '/api/messages/thread/th1')).json?.messages?.length === 1)
  check('(b) a caregiver who is not in it gets a 404', (await CG2('GET', '/api/messages/thread/th1')).status === 404)
  check('(b) …and cannot reply into it', (await CG2('POST', '/api/messages/thread/th1/reply', { body: 'hi' })).status === 404
    && Number((await q1(sql`SELECT COUNT(*)::int AS n FROM messages WHERE thread_id = 'th1'`)).n) === 1)
  check('(b) the office (an owner not in the thread) may read and answer', (await O('GET', '/api/messages/thread/th1')).status === 200 && (await O('POST', '/api/messages/thread/th1/reply', { body: 'Yes' })).status === 201)
  check('(b) replying to a thread that does not exist is a 404, not a stray message', (await CG1('POST', '/api/messages/thread/nope/reply', { body: 'x' })).status === 404)

  // (c) caregiver list: pay rates are the office's
  await q(sql`UPDATE "user" SET default_pay_rate = 18.50 WHERE id IN (${cg1.id}, ${cg2.id})`) /* unified: the business is the company table and its people the user table (RULEBOOK §4: agencies and users are refused names) */
  const asCg = await CG1('GET', '/api/caregivers')
  const asAd = await A('GET', '/api/caregivers')
  check('(c) GET /api/caregivers to a caregiver carries no pay rate', asCg.status === 200 && asCg.json.length > 0 && asCg.json.every((r: any) => !('default_pay_rate' in r)), asCg.json?.[0]) /* unified: the caregiver list is a list reply (RULEBOOK §3): its rows are data, not caregivers */
  check('(c) …to the office it does', asAd.json.some((r: any) => Number(r.default_pay_rate) === 18.5) /* unified: a list reply */)
  check("(c) a caregiver cannot open a colleague's full record (assignments, background checks, pay)", (await CG1('GET', `/api/caregivers/${cg2.id}`)).status === 403)
  const own = await CG1('GET', `/api/caregivers/${cg1.id}`)
  check('(c) …but sees their own, pay included', own.status === 200 && Number(own.json.default_pay_rate) === 18.5, own.json)

  // (d) week view
  const wvC = await CG1('GET', `/api/scheduling/week-view?weekOf=${TODAY}`)
  const wvA = await A('GET', `/api/scheduling/week-view?weekOf=${TODAY}`)
  check("(d) a caregiver's week view holds only their own row", wvC.status === 200 && wvC.json.caregivers.length === 1 && wvC.json.caregivers[0].caregiver.id === cg1.id, wvC.json?.caregivers?.map?.((x: any) => x.caregiver.id))
  check('(d) …the office sees everyone', wvA.json.caregivers.length > 1)

  // (e) mileage
  await A('POST', '/api/mileage', { caregiverId: cg2.id, date: TODAY, miles: '10', ratePerMile: '0.67' })
  const mine = await CG1('POST', '/api/mileage', { caregiverId: cg2.id, date: TODAY, miles: '4', ratePerMile: '0.67' })
  check('(e) a caregiver who names another caregiver still records their own trip', mine.status === 201 && mine.json.caregiverId === cg1.id, mine.json)
  const listC = await CG1('GET', `/api/mileage?caregiverId=${cg2.id}`)
  check("(e) a caregiver's mileage list is their own, whatever caregiverId says", listC.json.length === 1 && listC.json.every((e: any) => e.caregiverId === cg1.id), listC.json) /* unified: the mileage list is a list reply (RULEBOOK §3): its rows are data, not entries (the payroll group's mileage) */
  check('(e) …the office sees anyone\'s', (await A('GET', `/api/mileage?caregiverId=${cg2.id}`)).json.length === 1 /* unified: a list reply */)

  // (f) geofence
  check("(f) a caregiver reads the geofence of a client they serve, not another's",
    (await CG1('GET', `/api/time-entries/geofence/${served.id}`)).status === 200 && (await CG1('GET', `/api/time-entries/geofence/${other.id}`)).status === 403)

  // (g) dated occurrences through the one engine; one-time visits carry their exceptions
  const from = TODAY, to = addDays(TODAY, 13)
  const wk = await insSched({ caregiver_id: cg1.id, client_id: served.id, day_of_week: dow(TODAY), start: '07:00', end: '08:00', effective_date: addDays(TODAY, -7) })
  await q(sql`INSERT INTO schedule_exceptions (id, schedule_id, exception_date, exception_type) VALUES ('ex_g1', ${wk}, ${addDays(TODAY, 7)}::date, 'cancelled')`)
  const oneOff = await insSched({ caregiver_id: cg1.id, client_id: served.id, date: addDays(TODAY, 2), start: '18:00', end: '19:00' })
  await q(sql`INSERT INTO schedule_exceptions (id, schedule_id, exception_date, exception_type, cancel_reason) VALUES ('ex_g2', ${oneOff}, ${addDays(TODAY, 2)}::date, 'cancelled', 'client_hospital')`)
  const oc = await CG1('GET', `/api/schedules/${cg1.id}/occurrences?from=${from}&to=${to}`)
  const mineOcc = (oc.json.occurrences || []).filter((o: any) => o.client_id === served.id)
  check('(g) GET /api/schedules/:caregiverId/occurrences: today, not the cancelled week, not the cancelled one-time visit',
    oc.status === 200 && JSON.stringify(mineOcc.map((o: any) => o.date)) === JSON.stringify([TODAY]), mineOcc)
  const engine = await occOf(from, to, sql`caregiver_id = ${cg1.id}`)
  check('(g) …the same visits as the engine', (oc.json.occurrences || []).length === engine.length, { route: oc.json.occurrences?.length, engine: engine.length })
  check("(g) a caregiver cannot read a colleague's occurrences; the office can", (await CG1('GET', `/api/schedules/${cg2.id}/occurrences?from=${from}&to=${to}`)).status === 403
    && (await A('GET', `/api/schedules/${cg2.id}/occurrences?from=${from}&to=${to}`)).status === 200)
  check('(g) …bad or too-wide ranges are refused', (await CG1('GET', `/api/schedules/${cg1.id}/occurrences?from=x&to=${to}`)).status === 400
    && (await CG1('GET', `/api/schedules/${cg1.id}/occurrences?from=${from}&to=${addDays(from, 120)}`)).status === 400)
  const phone = await CG1('GET', `/api/schedules/${cg1.id}`)
  const oneRow = (phone.json || []).find((s: any) => s.id === oneOff)
  check('(g) the phone list gives a one-time visit its cancel exception too (it used to show)', oneRow?.exceptions?.some((e: any) => e.exception_type === 'cancelled'), oneRow)

  // (h) Expo push
  const sentExpo: any[] = []
  notify._setExpoTransport(async (msgs: any[]) => { sentExpo.push(...msgs); return msgs.map((m: any) => m.to.includes('gone') ? { status: 'error', details: { error: 'DeviceNotRegistered' } } : { status: 'ok', id: 'tkt' }) })
  check('(h) POST /api/push/expo-token refuses something that is not an Expo token', (await CG1('POST', '/api/push/expo-token', { token: 'abc' })).status === 400)
  check('(h) …stores the caller\'s token', (await CG1('POST', '/api/push/expo-token', { token: 'ExponentPushToken[live-1]', platform: 'ios' })).status === 201
    && (await CG1('POST', '/api/push/expo-token', { token: 'ExponentPushToken[gone-2]' })).status === 201)
  check('(h) …one row per device token, the caller\'s', Number((await q1(sql`SELECT COUNT(*)::int AS n FROM expo_push_tokens WHERE user_id = ${cg1.id}`)).n) === 2)
  const webBefore = pushes.length
  const n = await notify.sendPush(cg1.id, { title: 'New shift', body: 'Tuesday 9am', data: { type: 'shift_assigned' } })
  check('(h) sendPush reaches web push AND both Expo tokens in one batch', pushes.length === webBefore + 1 && sentExpo.length === 2 && sentExpo[0].title === 'New shift' && sentExpo[0].body === 'Tuesday 9am' && sentExpo[0].data?.type === 'shift_assigned', sentExpo)
  check('(h) …counting the devices reached (web 1 + Expo 1)', n === 2, n)
  check('(h) …and a DeviceNotRegistered token is deleted', (await q(sql`SELECT token FROM expo_push_tokens WHERE user_id = ${cg1.id}`)).map((r) => r.token).join() === 'ExponentPushToken[live-1]')
  const del = await CG2('DELETE', '/api/push/expo-token', { token: 'ExponentPushToken[live-1]' })
  check("(h) another person cannot remove someone's token", del.json.removed === 0)
  notify._setExpoTransport(async () => { throw new Error('expo down') })
  check('(h) Expo being down never breaks a send (web push still counts)', (await notify.sendPush(cg1.id, { title: 'x' })) === 1)

  // (i) GPS failure
  const inG = await CG1('POST', '/api/time-entries/clock-in', { clientId: served.id })
  const gf = await CG1('POST', '/api/time-entries/gps-failure', { action: 'clock-out', errorCode: 1, clientId: served.id })
  check('(i) POST /api/time-entries/gps-failure alerts the office (owner and admin)', gf.status === 200 && gf.json.alerted === 2 && gf.json.timeEntryId === inG.json.id, gf.json)
  const au = await q1(sql`SELECT new_data FROM audit_logs WHERE action = 'GPS_FAILURE' AND record_id = ${inG.json.id}`)
  check("(i) …recorded on the caller's own open visit", !!au && (au.new_data?.reason || JSON.parse(au.new_data || '{}').reason) === 'location permission denied', au)
  check('(i) …naming a client the caregiver does not serve is refused', (await CG1('POST', '/api/time-entries/gps-failure', { action: 'clock-in', clientId: other.id })).status === 403)
  const recent = await A('GET', '/api/time-entries/gps-failures-recent')
  check('(i) the office sees the open GPS alert', recent.json.count === 1 && /permission is off/.test(recent.json.failures[0].message), recent.json)
  check('(i) …which a caregiver cannot list', (await CG1('GET', '/api/time-entries/gps-failures-recent')).status === 403)
  await backdate(inG.json.id, 30)
  await A('POST', `/api/time-entries/${inG.json.id}/admin-force-clockout`, { reason: 'GPS off' })
  check("(i) the office's force clock-out marks that caregiver's GPS alerts handled", (await A('GET', '/api/time-entries/gps-failures-recent')).json.count === 0)
}

// ══ one agency clock (run last: it changes the agency's zone) ═══════════════════════════════════
{
  const t = await import('./src/services/agencyTime.ts')
  const { getConfig } = await import('./src/services/sandataClient.ts')
  const { getAgencyProfile } = await import('./src/services/agencyProfile.ts')
  check('the agency zone is agencies.timezone', (await t.agencyTimezone()) === 'UTC')
  check('…the same zone EVV (Sandata) and payroll (agency profile) use', (await getConfig()).timezone === 'UTC' && (await getAgencyProfile()).timezone === 'UTC')
  await q(sql`UPDATE company SET timezone = NULL WHERE id = ${ag.id}`) /* unified: the business is the company table and its people the user table (RULEBOOK §4: agencies and users are refused names) */
  check('not set: the state (WI) decides — America/Chicago', (await t.agencyTimezone()) === 'America/Chicago' && (await getConfig()).timezone === 'America/Chicago')
  process.env.AGENCY_TIMEZONE = 'America/Denver'
  check('…unless AGENCY_TIMEZONE is set, which comes before the state', (await t.agencyTimezone()) === 'America/Denver' && (await getAgencyProfile()).timezone === 'America/Denver')
  delete process.env.AGENCY_TIMEZONE
  await q(sql`UPDATE company SET state = NULL WHERE id = ${ag.id}`) /* unified: the business is the company table and its people the user table (RULEBOOK §4: agencies and users are refused names) */
  check('nothing at all: America/Chicago', (await t.agencyTimezone()) === 'America/Chicago')
  await q(sql`UPDATE company SET state = 'WI' WHERE id = ${ag.id}`) /* unified: the business is the company table and its people the user table (RULEBOOK §4: agencies and users are refused names) */
  const put = await A('PUT', '/api/sandata/settings', { timezone: 'America/New_York' })
  const row = await q1(sql`SELECT timezone FROM company WHERE id = ${ag.id}`) /* unified: the business is the company table and its people the user table (RULEBOOK §4: agencies and users are refused names) */
  check("the Sandata form's time zone is the agency's one zone (agencies.timezone)", put.status === 200 && row?.timezone === 'America/New_York', { put: put.json, row })
  const co = await A('GET', '/api/company')
  check('…the company record reports the same', co.json.effectiveTimezone === 'America/New_York', co.json?.effectiveTimezone)
  check('…and a zone Postgres would not know is refused', (await A('PUT', '/api/sandata/settings', { timezone: 'Mars/Olympus' })).status === 400)
  check('the evv-only zone column is gone from the schema', !readdirSync(UNI + 'server/db', { recursive: true } as any).map((p: any) => String(p)).filter((p: string) => /\.(ts|sql)$/.test(p)).some((p: string) => /evv_timezone|evvTimezone/.test(readFileSync(UNI + 'server/db/' + p, 'utf8'))) /* unified: the unified schema and migrations are apps/unified/server/db (schema/, migrations/) */)
  await q(sql`UPDATE company SET timezone = 'UTC' WHERE id = ${ag.id}`) /* unified: the business is the company table and its people the user table (RULEBOOK §4: agencies and users are refused names) */
}

console.log(`\nhomecare-integration: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
