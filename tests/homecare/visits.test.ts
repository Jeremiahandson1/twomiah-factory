// crm-homecare — the visits area, ported from the CVHC home care CRM, exercised through the real routes.
//
// What it pins, with the numbers CVHC's own code gives on the same input:
//   · the occurrence engine (weekly, bi-weekly parity, effective date, cancelled / modified / suspended,
//     overnight, training) — everything else expands through it;
//   · the scoped delete and the scoped Edit Shift ("this" / "following" / "all") never rewriting history;
//   · the clock-out billing rule: payer bills the schedule, private pay the clock, 7-minute grace,
//     zero-duration, 16-hour cap, VA note, offline punch flags — and the approval queue;
//   · open shifts offered to chosen caregivers, first-to-accept, a call-out filled back onto the day;
//   · shift swaps, visit change requests from all three sides, visit documentation, client-unavailable,
//     visit photos, and the two background scans (reminders once, over-visit texts once per threshold).
// Who may do what is asserted in both directions throughout.
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import jwt from 'jsonwebtoken'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { agencies, users, clients, referralSources } from './db/schema.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 400)) }
}
const q = async (s: any) => { const r: any = await db.execute(s); return (r?.rows ?? r) as any[] }
const q1 = async (s: any) => (await q(s))[0]

process.env.JWT_SECRET = process.env.JWT_SECRET || 'visits-test-secret'
await setupSchema()

// ── the agency runs on UTC here so "today" is the same day the test computes ─────────────────────────
const [ag] = await db.insert(agencies).values({ name: 'Visits Care', slug: 'visitscare', settings: { timezone: 'UTC' } } as any).returning()
const mkUser = async (role: string, tag: string, phone: string | null = null) => (await db.insert(users).values({
  email: `${tag}-visits@test.local`, passwordHash: 'x', firstName: tag, lastName: 'Tester', role, phone,
} as any).returning())[0]
const owner = await mkUser('owner', 'owner')
const admin = await mkUser('admin', 'admin', '7155550102')
const cg1 = await mkUser('caregiver', 'cgone', '7155550111')
const cg2 = await mkUser('caregiver', 'cgtwo', '7155550112')
const cg3 = await mkUser('caregiver', 'cgthree', '(715) 555-0113')

const [medicaid] = await db.insert(referralSources).values({ name: 'State Medicaid', payerType: 'medicaid' } as any).returning()
const [va] = await db.insert(referralSources).values({ name: 'Veterans Affairs', payerType: 'va' } as any).returning()
const mkClient = async (first: string, extra: Record<string, unknown> = {}) => (await db.insert(clients).values({
  firstName: first, lastName: 'Client', ...extra,
} as any).returning())[0]
const clA = await mkClient('Alma', { referredById: medicaid.id, portalEnabled: true })
const clP = await mkClient('Pia', { isPrivatePay: true })
const clV = await mkClient('Vic', { referredById: va.id })
const clX = await mkClient('Xena', { referredById: medicaid.id })

const app = new Hono()
for (const [mount, file] of [
  ['/api/schedules', 'schedules'],
  ['/api/schedules-all', 'schedulesAll'],
  ['/api/schedules-enhanced', 'schedulesEnhanced'],
  ['/api/schedule-exceptions', 'scheduleExceptions'],
  ['/api/open-shifts', 'openShifts'],
  ['/api/shift-swaps', 'shiftSwaps'],
  ['/api/time-entries', 'timeTracking'],
  ['/api/emergency', 'emergency'],
  ['/api/visit-docs', 'visitDocumentation'],
  ['/api/visit-change-requests', 'visitChangeRequests'],
  ['/api/portal', 'portalVisits'],
] as const) {
  app.route(mount, (await import(`./src/routes/${file}.ts`)).default)
}
const { occurrencesCte } = await import('./src/services/scheduleOccurrences.ts')
const { decideBilling, parseOfflineAt } = await import('./src/helpers/punchRules.ts')
const notify = await import('./src/services/visitNotify.ts')
const texts: { to: string; body: string }[] = []
const pushes: { userId: string; payload: any }[] = []
notify._setSmsSender(async (to: string, body: string) => { texts.push({ to, body }); return { status: 'sent', sid: 'SMtest', error: null } })
notify._setPushSender(async (userId: string, payload: any) => { pushes.push({ userId, payload }); return 1 })

const call = (headers: Record<string, string>) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method, headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const ct = res.headers.get('content-type') || ''
  const t = ct.includes('pdf') ? '' : await res.text()
  let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j, type: ct }
}
const as = (who: any) => call({ 'x-test-user': who.id, 'x-test-company': ag.id, 'x-test-role': who.role })
const portalToken = jwt.sign({ role: 'client', clientId: clA.id }, process.env.JWT_SECRET!)
const asPortal = call({ authorization: `Bearer ${portalToken}` })

// ── dates ────────────────────────────────────────────────────────────────────────────────────────────
const ymd = (d: Date) => d.toISOString().slice(0, 10)
const addDays = (s: string, n: number) => ymd(new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10) + n)))
const dow = (s: string) => new Date(`${s}T12:00:00Z`).getUTCDay()
const today = ymd(new Date())
// A fixed past month for the engine (no "now" involved).
const firstMonday = (() => { let d = '2026-09-01'; while (dow(d) !== 1) d = addDays(d, 1); return d })() // 2026-09-07

const insSched = async (v: Record<string, any>) => {
  const id = `sch_${Math.random().toString(36).slice(2, 10)}`
  const base = v.date || v.effective_date || '2026-01-01'
  await q(sql`INSERT INTO schedules (id, caregiver_id, client_id, day_of_week, date, start_time, end_time, frequency, effective_date,
      anchor_date, end_date, is_active, schedule_type, status, is_training, suspended_from, created_at, updated_at)
    VALUES (${id}, ${v.caregiver_id}, ${v.client_id}, ${v.day_of_week ?? null}, ${v.date ?? null}::date,
            ${`${base} ${v.start}`}::timestamp, ${`${base} ${v.end}`}::timestamp, ${v.frequency || 'weekly'},
            ${v.effective_date ?? null}::date, ${v.anchor_date ?? null}::date, ${v.end_date ?? null}::date, true,
            ${v.day_of_week != null ? 'recurring' : 'one-time'}, 'active', ${!!v.is_training}, ${v.suspended_from ?? null}::date, NOW(), NOW())`)
  return id
}
const occ = (from: string, to: string, scheduleId: string) => q(sql`WITH ${occurrencesCte(from, to)}
  SELECT to_char(occ_date, 'YYYY-MM-DD') AS d, to_char(start_time, 'HH24:MI') AS s, to_char(end_time, 'HH24:MI') AS e,
         minutes, caregiver_id, is_training FROM occ WHERE schedule_id = ${scheduleId} ORDER BY occ_date`)

// ══ 1. the occurrence engine ═════════════════════════════════════════════════════════════════════════
{
  const weekly = await insSched({ caregiver_id: cg1.id, client_id: clA.id, day_of_week: 1, start: '09:00', end: '11:00', effective_date: firstMonday })
  let o = await occ('2026-09-01', '2026-09-30', weekly)
  check('weekly Monday 9–11 in September 2026: 4 visits, 120 minutes each', o.length === 4 && o.every((x) => Number(x.minutes) === 120), o)
  check('…none before its effective date', (await occ('2026-08-01', '2026-08-31', weekly)).length === 0)

  const bi = await insSched({ caregiver_id: cg1.id, client_id: clA.id, day_of_week: 1, start: '13:00', end: '14:00', effective_date: firstMonday, anchor_date: firstMonday, frequency: 'biweekly' })
  o = await occ('2026-09-01', '2026-09-30', bi)
  check('bi-weekly from the anchor: Sep 7 and Sep 21 only', o.map((x) => x.d).join(',') === '2026-09-07,2026-09-21', o)

  await q(sql`INSERT INTO schedule_exceptions (id, schedule_id, exception_date, exception_type, created_at)
    VALUES ('exc_c1', ${weekly}, '2026-09-14', 'cancelled', NOW())`)
  await q(sql`INSERT INTO schedule_exceptions (id, schedule_id, exception_date, exception_type, override_start_time, override_end_time, override_caregiver_id, created_at)
    VALUES ('exc_m1', ${weekly}, '2026-09-21', 'modified', '10:00', '11:30', ${cg2.id}, NOW())`)
  o = await occ('2026-09-01', '2026-09-30', weekly)
  check('a cancelled occurrence does not exist', !o.some((x) => x.d === '2026-09-14') && o.length === 3, o)
  const m = o.find((x) => x.d === '2026-09-21')
  check('a modified occurrence carries its own times (90 min) and caregiver', m?.s === '10:00' && Number(m?.minutes) === 90 && m?.caregiver_id === cg2.id, m)

  await q(sql`UPDATE schedules SET suspended_from = '2026-09-28' WHERE id = ${weekly}`)
  o = await occ('2026-09-01', '2026-09-30', weekly)
  check('suspended from Sep 28: that visit stops, the earlier ones stay', !o.some((x) => x.d === '2026-09-28') && o.some((x) => x.d === '2026-09-07'), o)

  const overnight = await insSched({ caregiver_id: cg1.id, client_id: clA.id, date: '2026-09-10', start: '22:00', end: '06:00' })
  o = await occ('2026-09-10', '2026-09-10', overnight)
  check('an overnight 22:00–06:00 shift is 480 minutes, not negative', Number(o[0]?.minutes) === 480, o)

  const backdated = await insSched({ caregiver_id: cg1.id, client_id: clA.id, date: '2026-08-03', start: '08:00', end: '09:00' })
  check('a one-time shift entered after the fact still exists (no effective-date bound)', (await occ('2026-08-03', '2026-08-03', backdated)).length === 1)

  const training = await insSched({ caregiver_id: cg2.id, client_id: clA.id, date: '2026-09-11', start: '09:00', end: '10:00', is_training: true })
  check('a training shift is marked as such by the engine', (await occ('2026-09-11', '2026-09-11', training))[0]?.is_training === true)

  check('punch rule: 70 min worked on a 60-min Medicaid visit bills 60, flagged time_variance',
    JSON.stringify(decideBilling({ durationSeconds: 70 * 60, allottedMinutes: 60, isPrivatePay: false })) === JSON.stringify({ billableMinutes: 60, needsApproval: true, approvalReason: 'time_variance', durationMinutes: 70, discrepancyMinutes: 10 }))
  check('punch rule: 67 min on a 60-min visit is inside the 7-minute grace',
    decideBilling({ durationSeconds: 67 * 60, allottedMinutes: 60, isPrivatePay: false }).needsApproval === false)
  check('punch rule: 17 h private pay is capped at 16 h and flagged',
    JSON.stringify(decideBilling({ durationSeconds: 17 * 3600, allottedMinutes: null, isPrivatePay: true })) === JSON.stringify({ billableMinutes: 960, needsApproval: true, approvalReason: 'excessive_duration', durationMinutes: 1020, discrepancyMinutes: null }))
  check('offline punch: a tap from the future is refused', !!parseOfflineAt(new Date(Date.now() + 10 * 60000).toISOString()).error)
  check('offline punch: a tap older than 12 h is refused with its code', parseOfflineAt(new Date(Date.now() - 13 * 3600000).toISOString()).code === 'offline_punch_too_old')
}

// ══ 2. /api/schedules ════════════════════════════════════════════════════════════════════════════════
const future = addDays(today, 14)
const futureDow = dow(future)
let recurring: string
{
  const body = { caregiverId: cg1.id, clientId: clX.id, dayOfWeek: futureDow, startTime: '08:00', endTime: '09:30', effectiveDate: '2020-01-01' }
  const cg = await as(cg1)('POST', '/api/schedules', body)
  check('a caregiver cannot create a shift', cg.status === 403, cg)
  const r = await as(admin)('POST', '/api/schedules', body)
  check('an admin creates a recurring shift', r.status === 201, r.json)
  check('…its back-dated effective date is pulled forward to today', r.json?.effective_date === today, r.json)
  check('…times come back as wall-clock HH:MM:SS', r.json?.start_time === '08:00:00' && r.json?.end_time === '09:30:00', r.json)
  check('…and a missing authorization is a warning, not a refusal', Array.isArray(r.json?.authWarnings) && r.json.authWarnings.length > 0)
  recurring = r.json.id
  const dup = await as(owner)('POST', '/api/schedules', body)
  check('the same active recurring shift twice is refused (409)', dup.status === 409, dup)

  const one = { caregiverId: cg2.id, clientId: clX.id, date: future, startTime: '15:00', endTime: '16:00', isTraining: true }
  const o1 = await as(admin)('POST', '/api/schedules', one)
  const o2 = await as(admin)('POST', '/api/schedules', one)
  check('a double-submitted one-time shift returns the first row, not a billable twin', o1.status === 201 && o2.status === 200 && o2.json?.duplicate === true && o2.json?.id === o1.json?.id, [o1.status, o2.json])
  check('…and a training flag is stored', o1.json?.is_training === true)

  const mine = await as(cg1)('GET', `/api/schedules/${cg1.id}`)
  check('a caregiver reads their own schedule, exceptions attached', mine.status === 200 && Array.isArray(mine.json) && mine.json.every((s: any) => Array.isArray(s.exceptions)))
  const theirs = await as(cg1)('GET', `/api/schedules/${cg2.id}`)
  check("…but not another caregiver's", theirs.status === 403)

  // scoped delete
  const noDate = await as(admin)('DELETE', `/api/schedules/${recurring}?scope=this`)
  check('scope=this without a date is refused, never widened to a full delete', noDate.status === 400)
  const cgDel = await as(cg1)('DELETE', `/api/schedules/${recurring}?scope=all`)
  check('a caregiver cannot delete a shift', cgDel.status === 403)
  const d1 = await as(admin)('DELETE', `/api/schedules/${recurring}?scope=this&date=${future}&cancelReason=client_hospital`)
  const e1 = await q1(sql`SELECT exception_type, cancel_reason FROM schedule_exceptions WHERE schedule_id = ${recurring} AND exception_date = ${future}::date`)
  check('scope=this cancels the one day and records why', d1.status === 200 && e1?.exception_type === 'cancelled' && e1?.cancel_reason === 'client_hospital', e1)
  await as(admin)('DELETE', `/api/schedules/${recurring}?scope=this&date=${addDays(future, 7)}&cancelReason=made_up`)
  const e2 = await q1(sql`SELECT cancel_reason FROM schedule_exceptions WHERE schedule_id = ${recurring} AND exception_date = ${addDays(future, 7)}::date`)
  check('…an unknown reason is dropped, not stored', e2 && e2.cancel_reason === null, e2)
  const oneTimeThis = await as(admin)('DELETE', `/api/schedules/${o1.json.id}?scope=this&date=${future}`)
  check('scope=this on a one-time shift is refused', oneTimeThis.status === 400)

  const f = await as(admin)('DELETE', `/api/schedules/${recurring}?scope=following&date=${addDays(future, 21)}`)
  check('scope=following ends the pattern the day before', f.status === 200 && f.json?.endDate === addDays(future, 20), f.json)

  // scope=all on a pattern that has started keeps its history
  const started = await insSched({ caregiver_id: cg3.id, client_id: clX.id, day_of_week: dow(today), start: '06:00', end: '07:00', effective_date: addDays(today, -30) })
  const all = await as(admin)('DELETE', `/api/schedules/${started}?scope=all`)
  const after = await q1(sql`SELECT is_active, to_char(end_date, 'YYYY-MM-DD') AS end_date FROM schedules WHERE id = ${started}`)
  check('scope=all on a started pattern ENDS it yesterday and keeps it active (history stays billable)', all.status === 200 && after.is_active === true && after.end_date === addDays(today, -1), after)
  const notStarted = await insSched({ caregiver_id: cg3.id, client_id: clX.id, day_of_week: 3, start: '06:00', end: '07:00', effective_date: addDays(today, 30) })
  await as(admin)('DELETE', `/api/schedules/${notStarted}?scope=all`)
  check('…a pattern that never started is simply removed', (await q1(sql`SELECT is_active FROM schedules WHERE id = ${notStarted}`)).is_active === false)

  // suspend / resume
  const s1 = await insSched({ caregiver_id: cg1.id, client_id: clP.id, day_of_week: 2, start: '10:00', end: '12:00', effective_date: '2026-01-01' })
  const s2 = await insSched({ caregiver_id: cg2.id, client_id: clP.id, day_of_week: 4, start: '10:00', end: '12:00', effective_date: '2026-01-01' })
  const sus = await as(admin)('POST', `/api/schedules/${s1}/suspend`, { scope: 'client', fromDate: '2026-09-15' })
  check('suspend scope=client pauses every schedule of the client', sus.status === 200 && sus.json?.suspended === 2, sus.json)
  const o = await occ('2026-09-01', '2026-09-30', s2)
  check('…visits on/after the date stop, earlier ones stay', o.length > 0 && o.every((x) => x.d < '2026-09-15'), o)
  const cgSus = await as(cg1)('POST', `/api/schedules/${s1}/suspend`, {})
  check('a caregiver cannot suspend service', cgSus.status === 403)
  const res = await as(admin)('POST', `/api/schedules/client/${clP.id}/resume`, {})
  check('resume brings both back exactly as they were', res.json?.resumed === 2 && (await occ('2026-09-15', '2026-09-30', s2)).length > 0, res.json)
  const bad = await as(admin)('POST', `/api/schedules/${s1}/suspend`, { fromDate: 'next week' })
  check('a malformed suspend date is refused', bad.status === 400)

  const re = await as(admin)('PUT', `/api/schedules/${s1}/reassign`, { newCaregiverId: cg3.id })
  check('reassign hands the shift to another active caregiver', re.status === 200 && (await q1(sql`SELECT caregiver_id FROM schedules WHERE id = ${s1}`)).caregiver_id === cg3.id)
}

// ══ 3. Edit Shift — this / following / all ═══════════════════════════════════════════════════════════
{
  const pat = await insSched({ caregiver_id: cg2.id, client_id: clX.id, day_of_week: 1, start: '09:00', end: '10:00', effective_date: firstMonday })
  const noScope = await as(admin)('PUT', `/api/schedules-all/${pat}`, { startTime: '09:30', endTime: '10:30' })
  check('editing a repeating shift with no scope is refused', noScope.status === 400 && noScope.json?.code === 'scope_required', noScope.json)
  const cgEdit = await as(cg2)('PUT', `/api/schedules-all/${pat}`, { scope: 'all', startTime: '09:30', endTime: '10:30' })
  check('a caregiver cannot edit a shift', cgEdit.status === 403)

  const thisOne = await as(admin)('PUT', `/api/schedules-all/${pat}`, { scope: 'this', editDate: '2026-09-14', startTime: '11:00', endTime: '12:15' })
  let o = await occ('2026-09-07', '2026-09-21', pat)
  check("scope=this changes only that day (a past date is allowed — that's payday correction)",
    thisOne.status === 200 && o.find((x) => x.d === '2026-09-14')?.s === '11:00' && Number(o.find((x) => x.d === '2026-09-14')?.minutes) === 75 && o.find((x) => x.d === '2026-09-21')?.s === '09:00', o)

  const fol = await as(admin)('PUT', `/api/schedules-all/${pat}`, { scope: 'following', editDate: '2026-09-21', startTime: '14:00', endTime: '15:00' })
  const oldRow = await q1(sql`SELECT to_char(end_date, 'YYYY-MM-DD') AS end_date FROM schedules WHERE id = ${pat}`)
  check('scope=following freezes the old pattern the day before', fol.status === 200 && oldRow.end_date === '2026-09-20', [fol.json, oldRow])
  const newId = fol.json?.id
  const before = await occ('2026-09-07', '2026-09-14', pat)
  const afterO = await occ('2026-09-21', '2026-09-28', newId)
  check('…weeks before keep the old time, weeks after carry the edit', before.length === 2 && before[0].s === '09:00' && afterO.length === 2 && afterO.every((x) => x.s === '14:00'), [before, afterO])
  check('…and the new pattern starts on the edit date', fol.json?.effective_date === '2026-09-21', fol.json)

  const allE = await as(admin)('PUT', `/api/schedules-all/${newId}`, { scope: 'all', startTime: '16:00', endTime: '17:30' })
  o = await occ('2026-09-21', '2026-09-28', newId)
  check('scope=all rewrites the pattern in place', allE.status === 200 && o.every((x) => x.s === '16:00' && Number(x.minutes) === 90), o)

  const list = await as(admin)('GET', '/api/schedules-all')
  check('GET /api/schedules-all lists active shifts with their exceptions and names', list.status === 200 && list.json.some((s: any) => s.id === pat && s.exceptions.length > 0 && s.caregiver_first_name))

  const exCg = await as(cg2)('GET', '/api/schedule-exceptions')
  check('schedule exceptions are the office\'s — a caregiver is refused', exCg.status === 403)
  const exAd = await as(admin)('POST', '/api/schedule-exceptions', { scheduleId: pat, exceptionDate: '2026-09-07', exceptionType: 'cancelled', cancelReason: 'admin_cancelled' })
  check('…an admin can cancel an occurrence with a reason', exAd.status === 201 && exAd.json?.cancel_reason === 'admin_cancelled', exAd.json)

  const enh = await as(admin)('POST', '/api/schedules-enhanced', { caregiverId: cg3.id, clientId: clX.id, dayOfWeek: 6, startTime: '08:00', endTime: '09:00', frequency: 'biweekly', effectiveDate: future, anchorDate: future })
  check('a bi-weekly shift is anchored on its own weekday', enh.status === 201 && dow(enh.json?.anchor_date) === 6 && enh.json.anchor_date >= future, enh.json)
  const split = await as(admin)('POST', '/api/schedules-enhanced', { caregiverId: cg3.id, clientId: clP.id, date: future, startTime: '07:00', endTime: '08:00', splitShift: { startTime: '07:30', endTime: '09:00' } })
  check('a split shift whose second half starts before the first ends is refused', split.status === 400)
}

// ══ 4. the punch ═════════════════════════════════════════════════════════════════════════════════════
const insEntry = async (v: Record<string, any>) => {
  const id = `te_${Math.random().toString(36).slice(2, 10)}`
  await q(sql`INSERT INTO time_entries (id, caregiver_id, client_id, start_time, end_time, allotted_minutes, is_complete, needs_approval, created_at, updated_at)
    VALUES (${id}, ${v.caregiver_id}, ${v.client_id}, ${v.start.toISOString()}::timestamp, ${v.end ? v.end.toISOString() : null}::timestamp,
            ${v.allotted ?? null}, ${!!v.end}, false, NOW(), NOW())`)
  return id
}
const minsAgo = (n: number) => new Date(Date.now() - n * 60000)
const entry = (id: string) => q1(sql`SELECT billable_minutes, duration_minutes, needs_approval, approval_reason, is_complete, discrepancy_minutes FROM time_entries WHERE id = ${id}`)
const closeOpen = async (who: any) => q(sql`UPDATE time_entries SET end_time = NOW(), is_complete = true WHERE caregiver_id = ${who.id} AND end_time IS NULL`)
{
  let id = await insEntry({ caregiver_id: cg1.id, client_id: clA.id, start: minsAgo(70), allotted: 60 })
  const other = await as(cg2)('POST', `/api/time-entries/${id}/clock-out`, {})
  check("a caregiver cannot clock out someone else's visit", other.status === 404)
  let r = await as(cg1)('POST', `/api/time-entries/${id}/clock-out`, { notes: 'All good' })
  let e = await entry(id)
  check('Medicaid: 70 minutes on a 60-minute visit bills the schedule (60) and needs approval', r.status === 200 && e.billable_minutes === 60 && e.duration_minutes === 70 && e.needs_approval === true && e.approval_reason === 'time_variance' && e.discrepancy_minutes === 10, e)
  r = await as(cg1)('POST', `/api/time-entries/${id}/clock-out`, {})
  check('a second clock-out on a closed visit changes nothing', r.status === 200 && r.json?.already_complete === true && (await entry(id)).duration_minutes === 70)

  id = await insEntry({ caregiver_id: cg1.id, client_id: clA.id, start: minsAgo(65), allotted: 60 })
  await as(cg1)('POST', `/api/time-entries/${id}/clock-out`, {})
  e = await entry(id)
  check('…65 minutes is inside the 7-minute grace: bills 60, no approval', e.billable_minutes === 60 && e.needs_approval === false, e)

  id = await insEntry({ caregiver_id: cg1.id, client_id: clP.id, start: minsAgo(70), allotted: 60 })
  await as(cg1)('POST', `/api/time-entries/${id}/clock-out`, {})
  e = await entry(id)
  check('private pay bills the clock: 70', e.billable_minutes === 70 && e.needs_approval === false, e)

  id = await insEntry({ caregiver_id: cg1.id, client_id: clA.id, start: minsAgo(50), allotted: null })
  await as(cg1)('POST', `/api/time-entries/${id}/clock-out`, {})
  e = await entry(id)
  check('no schedule matched (payer client): bills actual, flagged unscheduled', e.billable_minutes === 50 && e.approval_reason === 'unscheduled', e)

  id = await insEntry({ caregiver_id: cg1.id, client_id: clA.id, start: new Date(Date.now() - 20000), allotted: 60 })
  await as(cg1)('POST', `/api/time-entries/${id}/clock-out`, {})
  e = await entry(id)
  check('a clock-out 20 seconds after clock-in bills 0 and is flagged zero_duration', e.billable_minutes === 0 && e.approval_reason === 'zero_duration', e)

  id = await insEntry({ caregiver_id: cg1.id, client_id: clA.id, start: minsAgo(17 * 60), allotted: 60 })
  await as(cg1)('POST', `/api/time-entries/${id}/clock-out`, {})
  e = await entry(id)
  check('a 17-hour "shift" (missed clock-out) is capped at the schedule and flagged', e.billable_minutes === 60 && e.approval_reason === 'time_variance,excessive_duration', e)

  id = await insEntry({ caregiver_id: cg1.id, client_id: clV.id, start: minsAgo(60), allotted: 60 })
  r = await as(cg1)('POST', `/api/time-entries/${id}/clock-out`, { notes: '  ' })
  check('a VA client needs a visit note to clock out', r.status === 400 && r.json?.code === 'va_note_required', r.json)
  r = await as(cg1)('POST', `/api/time-entries/${id}/clock-out`, { notes: 'Bathed, meal prep' })
  check('…with the note it closes', r.status === 200 && (await entry(id)).is_complete === true)

  id = await insEntry({ caregiver_id: cg1.id, client_id: clA.id, start: minsAgo(90), allotted: 60 })
  r = await as(cg1)('POST', `/api/time-entries/${id}/clock-out`, { offlineAt: minsAgo(30).toISOString() })
  e = await entry(id)
  check('an offline clock-out records the TAP time (60 min) and is flagged offline_punch', e.duration_minutes === 60 && e.billable_minutes === 60 && e.needs_approval === true && e.approval_reason === 'offline_punch', e)
  r = await as(cg1)('POST', `/api/time-entries/${await insEntry({ caregiver_id: cg1.id, client_id: clA.id, start: minsAgo(10), allotted: 60 })}/clock-out`, { offlineAt: new Date(Date.now() + 3600000).toISOString() })
  check('…a saved punch claiming the future is refused', r.status === 400 && r.json?.code === 'offline_punch_invalid', r.json)
  await closeOpen(cg1)

  // clock-in matching: a one-time visit at the punch time → allotted = its 90 minutes
  const punch = minsAgo(120)
  const pDate = ymd(punch)
  const pStart = new Date(punch.getTime() - 5 * 60000)
  const hm = (d: Date) => d.toISOString().slice(11, 16)
  const sched = await insSched({ caregiver_id: cg3.id, client_id: clX.id, date: pDate, start: hm(pStart), end: hm(new Date(pStart.getTime() + 90 * 60000)) })
  r = await as(cg3)('POST', '/api/time-entries/clock-in', { clientId: clX.id, offlineAt: punch.toISOString() })
  const te = await q1(sql`SELECT allotted_minutes, schedule_id, needs_approval, approval_reason FROM time_entries WHERE id = ${r.json?.id}`)
  check('clock-in finds the visit through the engine: allotted 90, linked to its schedule', r.status === 201 && te?.allotted_minutes === 90 && te?.schedule_id === sched, [r.json, te])
  check('…an offline clock-in is flagged for review', te?.needs_approval === true && te?.approval_reason === 'offline_punch', te)
  const again = await as(cg3)('POST', '/api/time-entries/clock-in', { clientId: clX.id, offlineAt: punch.toISOString() })
  check('…the same saved tap replayed returns the first entry', again.status === 200 && again.json?.duplicate === true && again.json?.id === r.json?.id, again.json)
  await closeOpen(cg3)

  // auto-close: a caregiver clocking into the next client closes the previous visit by the payer rule
  const prev = await insEntry({ caregiver_id: cg2.id, client_id: clA.id, start: minsAgo(40), allotted: 30 })
  r = await as(cg2)('POST', '/api/time-entries/clock-in', { clientId: clP.id })
  e = await entry(prev)
  check('clocking into the next client closes the open visit: 40 on a 30-min visit bills 30, time_variance', r.status === 201 && e.is_complete === true && e.billable_minutes === 30 && e.approval_reason === 'time_variance', e)
  const dupe = await as(cg2)('POST', '/api/time-entries/clock-in', { clientId: clP.id })
  check('a second tap within 30 seconds returns the open entry, no twin', dupe.status === 200 && dupe.json?.duplicate === true && dupe.json?.id === r.json?.id, dupe.json)
  const auto = await as(cg2)('POST', '/api/time-entries/clock-in', { clientId: clA.id, autoClockIn: true })
  check('an AUTOMATIC clock-in with no live visit is refused', auto.status === 409 && auto.json?.code === 'no_active_occurrence', auto.json)
  check('…and the refusal leaves the visit the caregiver is still at OPEN', (await entry(r.json.id)).is_complete === false)
  const trans = await as(cg2)('POST', '/api/time-entries/clock-in', { clientId: clA.id, autoTransition: true })
  check('automatic shift transition stays off', trans.status === 409 && trans.json?.code === 'auto_transition_disabled')
  let twin = false
  try { await insEntry({ caregiver_id: cg2.id, client_id: clA.id, start: new Date() }) } catch { twin = true }
  check('the database itself refuses a second open entry for one caregiver', twin)
  await closeOpen(cg2)

  const mineActive = await as(cg1)('GET', '/api/time-entries/active')
  check("a caregiver's /active is their own open visit (none now)", mineActive.status === 200 && mineActive.json === null, mineActive.json)

  // the approval queue
  const qCg = await as(cg1)('GET', '/api/time-entries/pending-approval')
  check('a caregiver cannot read the approval queue', qCg.status === 403)
  const qAd = await as(admin)('GET', '/api/time-entries/pending-approval')
  check('the office sees every flagged, finished visit', qAd.status === 200 && qAd.json.length >= 5 && qAd.json.every((x: any) => x.needs_approval === true), qAd.json?.length)
  const flagged = qAd.json.find((x: any) => x.approval_reason === 'time_variance')
  const ap = await as(cg1)('PATCH', `/api/time-entries/${flagged.id}/approve`, {})
  check('a caregiver cannot approve their own time', ap.status === 403)
  const rej = await as(admin)('PATCH', `/api/time-entries/${flagged.id}/approve`, { reject: true, notes: 'Not worked' })
  check('reject pays nothing and clears the flag', rej.status === 200 && rej.json?.billableMinutes === 0 && rej.json?.needsApproval === false && rej.json?.approvedById === admin.id, rej.json)
  const other2 = qAd.json.find((x: any) => x.id !== flagged.id)
  const neg = await as(admin)('PATCH', `/api/time-entries/${other2.id}/approve`, { billable_minutes: -5 })
  check('a negative override is refused', neg.status === 400)
  const ov = await as(admin)('PATCH', `/api/time-entries/${other2.id}/approve`, { billable_minutes: 45 })
  check('an override sets the billable minutes', ov.status === 200 && ov.json?.billableMinutes === 45 && ov.json?.approvedBillableMinutes === 45)

  // force clock-out at the scheduled amount
  const stuck = await insEntry({ caregiver_id: cg1.id, client_id: clA.id, start: minsAgo(300), allotted: 120 })
  const fc = await as(admin)('POST', `/api/time-entries/${stuck}/admin-force-clockout`, { scheduled: true, reason: 'Phone died' })
  e = await entry(stuck)
  check('force clock-out at the scheduled amount closes at 120 and flags it', fc.status === 200 && e.duration_minutes === 120 && e.billable_minutes === 120 && e.approval_reason === 'admin_force_clockout', e)

  // visit photos
  const pe = await insEntry({ caregiver_id: cg1.id, client_id: clA.id, start: minsAgo(30), end: minsAgo(1), allotted: 30 })
  const img = 'data:image/png;base64,iVBORw0KGgo='
  const up2 = await as(cg2)('POST', `/api/time-entries/${pe}/photos`, { imageBase64: img })
  check("a caregiver cannot attach a photo to someone else's visit", up2.status === 403)
  const up = await as(cg1)('POST', `/api/time-entries/${pe}/photos`, { imageBase64: img, caption: 'Lunch', category: 'meal' })
  check('the caregiver who worked it attaches a photo', up.status === 201 && up.json?.caption === 'Lunch')
  const notImg = await as(cg1)('POST', `/api/time-entries/${pe}/photos`, { imageBase64: 'hello' })
  check('…only an image data URI', notImg.status === 400)
  const list = await as(admin)('GET', `/api/time-entries/photos/client/${clA.id}`)
  check('the office lists a client\'s photos without the image bytes', list.status === 200 && list.json.length === 1 && !('image_base64' in list.json[0]))
  const cgList = await as(cg1)('GET', `/api/time-entries/photos/client/${clA.id}`)
  check('…a caregiver cannot', cgList.status === 403)
  const peek = await as(cg2)('GET', `/api/time-entries/photo/${up.json.id}`)
  check("another caregiver cannot open the photo", peek.status === 403)
  const del = await as(admin)('DELETE', `/api/time-entries/photo/${up.json.id}`)
  check('the office deletes a photo', del.status === 200)
}

// ══ 5. open shifts ═══════════════════════════════════════════════════════════════════════════════════
{
  const day = addDays(today, 10)
  const pat = await insSched({ caregiver_id: cg1.id, client_id: clA.id, day_of_week: dow(day), start: '12:00', end: '14:00', effective_date: today })
  const cgPost = await as(cg1)('POST', `/api/open-shifts/from-schedule/${pat}`, { date: day })
  check('a caregiver cannot post an open shift', cgPost.status === 403)
  const off = await as(admin)('POST', `/api/open-shifts/from-schedule/${pat}`, { date: addDays(day, 1) })
  check('posting a day the shift does not happen is refused', off.status === 400, off.json)
  const post = await as(admin)('POST', `/api/open-shifts/from-schedule/${pat}`, { date: day, visibleTo: [cg2.id], autoAssign: true, bonusAmount: 15 })
  check('the office offers one visit to a chosen caregiver', post.status === 200 && post.json?.shift_date === day && post.json?.start_time === '12:00:00' && post.json?.auto_assign === true, post.json)
  const dupPost = await as(admin)('POST', `/api/open-shifts/from-schedule/${pat}`, { date: day })
  check('…the same visit cannot be posted twice', dupPost.status === 409)
  const seen3 = await as(cg3)('GET', '/api/open-shifts/available')
  const seen2 = await as(cg2)('GET', '/api/open-shifts/available')
  check('a caregiver it was not offered to does not see it', !seen3.json.some((s: any) => s.id === post.json.id))
  check('…the chosen caregiver does', seen2.json.some((s: any) => s.id === post.json.id))
  const sneak = await as(cg3)('POST', `/api/open-shifts/${post.json.id}/claim`, {})
  check('…and the other one cannot take it', sneak.status === 403)
  const board = await as(cg2)('GET', '/api/open-shifts')
  check("the office board is the office's", board.status === 403)
  const take = await as(cg2)('POST', `/api/open-shifts/${post.json.id}/claim`, {})
  const oDay = (await occ(day, day, pat))[0]
  check('first to accept gets it: on their schedule for that ONE day', take.status === 200 && take.json?.assigned === true && oDay?.caregiver_id === cg2.id, [take.json, oDay])
  check('…the pattern itself still belongs to its caregiver', (await occ(addDays(day, 7), addDays(day, 7), pat))[0]?.caregiver_id === cg1.id)
  check('…and the posting is filled', (await q1(sql`SELECT status FROM open_shifts WHERE id = ${post.json.id}`)).status === 'filled')

  // claim → approve
  const day2 = addDays(day, 7)
  const p2 = await as(admin)('POST', `/api/open-shifts/from-schedule/${pat}`, { date: day2 })
  const c3 = await as(cg3)('POST', `/api/open-shifts/${p2.json.id}/claim`, {})
  const c2 = await as(cg2)('POST', `/api/open-shifts/${p2.json.id}/claim`, {})
  check('without auto-assign a claim waits for the office', c3.status === 200 && c3.json?.assigned === false)
  check('…and a second caregiver is told it is gone', c2.status === 400)
  const cgApprove = await as(cg3)('POST', `/api/open-shifts/${p2.json.id}/approve`, {})
  check('a caregiver cannot approve a claim', cgApprove.status === 403)
  const ok = await as(admin)('POST', `/api/open-shifts/${p2.json.id}/approve`, {})
  check('the office approves: the day moves to the claimer', ok.status === 200 && (await occ(day2, day2, pat))[0]?.caregiver_id === cg3.id)
  const claims = await as(admin)('GET', `/api/open-shifts/${p2.json.id}/claims`)
  check('…and the claim is recorded as approved', claims.json?.[0]?.status === 'approved' && claims.json[0].caregiver_id === cg3.id, claims.json)

  // a call-out filled brings the visit back on the substitute
  const day3 = addDays(day, 14)
  const miss = await as(cg1)('POST', '/api/emergency/miss-report', { scheduleId: pat, date: day3, reason: 'Sick' })
  const ex = await q1(sql`SELECT exception_type, cancel_reason FROM schedule_exceptions WHERE schedule_id = ${pat} AND exception_date = ${day3}::date`)
  check('a miss report cancels that visit as a caregiver call-out', miss.status === 201 && ex?.exception_type === 'cancelled' && ex?.cancel_reason === 'caregiver_callout', ex)
  const os = await q1(sql`SELECT id, urgency, status FROM open_shifts WHERE schedule_id = ${pat} AND date = ${day3}::date`)
  check('…and posts it as an urgent open shift', miss.json?.openShiftCreated === true && os?.urgency === 'urgent' && os?.status === 'open', os)
  const fill = await as(admin)('POST', `/api/open-shifts/${os.id}/smart-fill`, { caregiverId: cg3.id })
  const ex2 = await q1(sql`SELECT exception_type, cancel_reason, override_caregiver_id FROM schedule_exceptions WHERE schedule_id = ${pat} AND exception_date = ${day3}::date`)
  check('filling the call-out brings the visit back, on the substitute', fill.status === 200 && ex2.exception_type === 'modified' && ex2.override_caregiver_id === cg3.id && ex2.cancel_reason === null, ex2)

  // any other cancellation has no visit to fill
  const day4 = addDays(day, 21)
  await as(admin)('DELETE', `/api/schedules/${pat}?scope=this&date=${day4}&cancelReason=client_hospital`)
  const os4 = await as(admin)('POST', '/api/open-shifts', { clientId: clA.id, scheduleId: pat, shiftDate: day4, startTime: '12:00', endTime: '14:00' })
  const fill4 = await as(admin)('POST', `/api/open-shifts/${os4.json.id}/smart-fill`, { caregiverId: cg2.id })
  check('a visit cancelled because the client is in hospital cannot be "filled"', fill4.status === 409, fill4.json)

  const notify = await as(admin)('POST', `/api/open-shifts/${os4.json.id}/notify`, { caregiverIds: [cg2.id], sms: true, customMessage: 'Easy visit' })
  check('the office texts the chosen caregivers', notify.status === 200 && notify.json?.notified === 1 && notify.json?.texted === 1 && texts.some((t) => t.to === '+17155550112' && t.body.startsWith('Visits Care:')), [notify.json, texts.slice(-1)])
  const avail = await as(admin)('GET', `/api/open-shifts/caregivers-available?date=${day2}&startTime=12:00&endTime=14:00`)
  check('caregivers-available marks who is already busy then', avail.status === 200 && avail.json.find((x: any) => x.id === cg3.id)?.busy === true && avail.json.find((x: any) => x.id === cg2.id)?.available === true, avail.json)
  const cancel = await as(admin)('POST', `/api/open-shifts/${os4.json.id}/cancel`, {})
  check('the office can take a posting down', cancel.status === 200)
}

// ══ 6. shift swaps ═══════════════════════════════════════════════════════════════════════════════════
{
  const pat = await insSched({ caregiver_id: cg1.id, client_id: clP.id, day_of_week: dow(addDays(today, 3)), start: '17:00', end: '18:00', effective_date: today })
  const req = await as(cg1)('POST', '/api/shift-swaps', { scheduleId: pat, targetCaregiverId: cg2.id, reason: 'Appointment' })
  check('a caregiver asks a coworker to take one day; no date given → the next occurrence', req.status === 201 && req.json?.shift_date === addDays(today, 3), req.json)
  const forOther = await as(cg3)('POST', '/api/shift-swaps', { scheduleId: pat, targetCaregiverId: cg2.id })
  check("…nobody can offer away a shift that isn't theirs", forOther.status === 403)
  const early = await as(admin)('PUT', `/api/shift-swaps/${req.json.id}/approve`, {})
  check('the office cannot approve before the coworker accepts', early.status === 400)
  const wrong = await as(cg3)('PUT', `/api/shift-swaps/${req.json.id}/respond`, { accepted: true })
  check('only the coworker asked may answer', wrong.status === 403)
  await as(cg2)('PUT', `/api/shift-swaps/${req.json.id}/respond`, { accepted: true })
  const self = await as(cg1)('PUT', `/api/shift-swaps/${req.json.id}/approve`, {})
  check('a caregiver cannot approve a swap', self.status === 403)
  const okS = await as(admin)('PUT', `/api/shift-swaps/${req.json.id}/approve`, {})
  const d = addDays(today, 3)
  check('approved: that ONE day is the coworker\'s, the next week is not', okS.status === 200 && (await occ(d, d, pat))[0]?.caregiver_id === cg2.id && (await occ(addDays(d, 7), addDays(d, 7), pat))[0]?.caregiver_id === cg1.id)
  const seen = await as(cg3)('GET', '/api/shift-swaps')
  check('a caregiver only sees swaps they are part of', seen.status === 200 && seen.json.length === 0)
}

// ══ 7. visit change requests — portal, caregiver, office ═════════════════════════════════════════════
{
  const d1 = addDays(today, 4)
  const pat = await insSched({ caregiver_id: cg1.id, client_id: clA.id, day_of_week: dow(d1), start: '09:00', end: '10:00', effective_date: today })
  const v = await asPortal('GET', '/api/portal/visits')
  check('the family sees their visits, expanded from the schedule', v.status === 200 && v.json.some((x: any) => x.schedule_id === pat && x.scheduled_date === d1), v.json)
  const noAuth = await call({})('GET', '/api/portal/visits')
  check('…not without signing in', noAuth.status === 401)

  const cancel = await asPortal('POST', '/api/portal/visits/cancel-request', { source: 'schedule', scheduleId: pat, visitDate: d1, caregiverId: cg1.id, startTime: '09:00', endTime: '10:00', reason: 'Family visiting' })
  const ex = await q1(sql`SELECT exception_type, cancel_reason FROM schedule_exceptions WHERE schedule_id = ${pat} AND exception_date = ${d1}::date`)
  check('a client cancelling an upcoming visit takes effect at once', cancel.status === 201 && cancel.json?.auto_applied === true && ex?.exception_type === 'cancelled', [cancel.json, ex])
  check('…the caregiver is told', (await q1(sql`SELECT COUNT(*)::int AS n FROM notifications WHERE user_id = ${cg1.id} AND type = 'visit_cancelled'`)).n === 1)
  const after = await asPortal('GET', '/api/portal/visits')
  check('…and the visit is gone from the family\'s list', !after.json.some((x: any) => x.schedule_id === pat && x.scheduled_date === d1))

  const otherPat = await insSched({ caregiver_id: cg2.id, client_id: clX.id, day_of_week: dow(d1), start: '11:00', end: '12:00', effective_date: today })
  const notMine = await asPortal('POST', '/api/portal/visits/cancel-request', { source: 'schedule', scheduleId: otherPat, visitDate: d1, caregiverId: cg2.id, startTime: '11:00', endTime: '12:00' })
  check("a family cannot cancel another client's visit", notMine.status === 404)

  // a visit that was worked today is not moved — it goes to the office instead
  const todayPat = await insSched({ caregiver_id: cg3.id, client_id: clA.id, date: today, start: '00:05', end: '00:10' })
  await insEntry({ caregiver_id: cg3.id, client_id: clA.id, start: new Date(`${today}T00:06:00Z`), end: new Date(`${today}T00:09:00Z`) })
  const worked = await asPortal('POST', '/api/portal/visits/cancel-request', { source: 'schedule', scheduleId: todayPat, visitDate: today, caregiverId: cg3.id, startTime: '00:05', endTime: '00:10' })
  check('a visit already worked is NOT auto-cancelled; it waits for the office', worked.status === 201 && worked.json?.auto_applied === false && worked.json?.status === 'pending', worked.json)

  // client reschedule → caregiver counter → client accepts → the schedule moves
  const d2 = addDays(today, 5)
  const pat2 = await insSched({ caregiver_id: cg1.id, client_id: clA.id, day_of_week: dow(d2), start: '13:00', end: '14:00', effective_date: today })
  const rq = await asPortal('POST', '/api/portal/visits/reschedule-request', { source: 'schedule', scheduleId: pat2, visitDate: d2, caregiverId: cg1.id, startTime: '13:00', endTime: '14:00', proposedDate: d2, proposedStartTime: '15:00', proposedEndTime: '16:00' })
  check('the family asks to move a visit', rq.status === 201 && rq.json?.status === 'pending' && rq.json?.requested_by === 'client', rq.json)
  const otherCg = await as(cg2)('PUT', `/api/visit-change-requests/${rq.json.id}/resolve`, { action: 'approve' })
  check("a caregiver cannot answer a request about someone else's visit", otherCg.status === 404)
  const counter = await as(cg1)('PUT', `/api/visit-change-requests/${rq.json.id}/resolve`, { action: 'counter', counterDate: addDays(d2, 1), counterStartTime: '10:00', counterEndTime: '11:00', counterMessage: 'Mornings are better' })
  check("the visit's caregiver may counter-offer a client's request", counter.status === 200)
  const open = await asPortal('GET', '/api/portal/change-requests')
  check('…the family sees the counter-offer', open.json.some((x: any) => x.id === rq.json.id && x.status === 'counter_offered'))
  const accept = await asPortal('PUT', `/api/portal/change-requests/${rq.json.id}/respond`, { accept: true })
  const oldDay = await occ(d2, d2, pat2)
  const applied = await q1(sql`SELECT applied_schedule_id FROM visit_change_requests WHERE id = ${rq.json.id}`)
  const moved = await occ(addDays(d2, 1), addDays(d2, 1), applied.applied_schedule_id)
  check('accepting moves it: the old day cancelled, a one-time visit on the new day at the new time', accept.status === 200 && oldDay.length === 0 && moved[0]?.s === '10:00' && moved[0]?.caregiver_id === cg1.id, [oldDay, moved])

  // caregiver asks to move their own visit; the office approves a same-day time change
  const d3 = addDays(today, 6)
  const pat3 = await insSched({ caregiver_id: cg2.id, client_id: clX.id, day_of_week: dow(d3), start: '08:00', end: '09:00', effective_date: today })
  const notOwn = await as(cg1)('POST', '/api/visit-change-requests/reschedule-request', { scheduleId: pat3, visitDate: d3, startTime: '08:00', endTime: '09:00', proposedDate: d3, proposedStartTime: '09:00', proposedEndTime: '10:00' })
  check('a caregiver can only ask to move their own visit', notOwn.status === 403)
  const same = await as(cg2)('POST', '/api/visit-change-requests/reschedule-request', { scheduleId: pat3, visitDate: d3, startTime: '08:00', endTime: '09:00', proposedDate: d3, proposedStartTime: '08:00', proposedEndTime: '09:00' })
  check('…and must actually change something', same.status === 400)
  const mine = await as(cg2)('POST', '/api/visit-change-requests/reschedule-request', { scheduleId: pat3, visitDate: d3, startTime: '08:00', endTime: '09:00', proposedDate: d3, proposedStartTime: '09:30', proposedEndTime: '10:30', reason: 'School run' })
  check('the caregiver files the request', mine.status === 201 && mine.json?.requested_by === 'caregiver')
  const twice = await as(cg2)('POST', '/api/visit-change-requests/reschedule-request', { scheduleId: pat3, visitDate: d3, startTime: '08:00', endTime: '09:00', proposedDate: d3, proposedStartTime: '11:00', proposedEndTime: '12:00' })
  check('…one open request per visit', twice.status === 409)
  const selfOk = await as(cg2)('PUT', `/api/visit-change-requests/${mine.json.id}/resolve`, { action: 'approve' })
  check('the caregiver cannot approve their own request', selfOk.status === 403)
  const q2 = await as(cg2)('GET', '/api/visit-change-requests')
  check('a caregiver sees only their own requests', q2.status === 200 && q2.json.length > 0 && q2.json.every((x: any) => x.caregiver_id === cg2.id))
  const okA = await as(admin)('PUT', `/api/visit-change-requests/${mine.json.id}/resolve`, { action: 'approve' })
  const moved3 = await occ(d3, d3, pat3)
  check('the office approves: same day, new time, the pattern untouched for other weeks', okA.status === 200 && moved3[0]?.s === '09:30' && (await occ(addDays(d3, 7), addDays(d3, 7), pat3))[0]?.s === '08:00', moved3)
  check('…and the caregiver hears back', (await q1(sql`SELECT COUNT(*)::int AS n FROM notifications WHERE user_id = ${cg2.id} AND type = 'visit_rescheduled'`)).n === 1)
}

// ══ 8. client unavailable (cancel with a reason) ════════════════════════════════════════════════════
{
  const tomorrow = addDays(today, 1)
  const pat = await insSched({ caregiver_id: cg3.id, client_id: clX.id, date: tomorrow, start: '18:00', end: '19:00' })
  const bogus = await as(cg3)('POST', '/api/emergency/client-unavailable', { scheduleId: pat, date: tomorrow, reason: 'aliens' })
  check('an unknown reason is refused', bogus.status === 400)
  const other = await as(cg3)('POST', '/api/emergency/client-unavailable', { scheduleId: pat, date: tomorrow, reason: 'other' })
  check('"Other" needs a note', other.status === 400)
  const notMine = await as(cg1)('POST', '/api/emergency/client-unavailable', { scheduleId: pat, date: tomorrow, reason: 'client_refused' })
  check("a caregiver cannot cancel someone else's visit", notMine.status === 403)
  const ok = await as(cg3)('POST', '/api/emergency/client-unavailable', { scheduleId: pat, date: tomorrow, reason: 'client_refused' })
  check('the caregiver records the client refused: the visit is cancelled with that reason', ok.status === 201 && ok.json?.exception?.cancel_reason === 'client_refused' && (await occ(tomorrow, tomorrow, pat)).length === 0, ok.json)
  check('…and the office is told it will not be billed', (await q1(sql`SELECT COUNT(*)::int AS n FROM notifications WHERE user_id = ${admin.id} AND type = 'client_unavailable'`)).n === 1)
  const far = addDays(today, 10)
  const pat2 = await insSched({ caregiver_id: cg3.id, client_id: clX.id, date: far, start: '18:00', end: '19:00' })
  const tooFar = await as(cg3)('POST', '/api/emergency/client-unavailable', { scheduleId: pat2, date: far, reason: 'client_cancelled' })
  check('a caregiver may only do this from 7 days ago through tomorrow', tooFar.status === 400)
  const office = await as(admin)('POST', '/api/emergency/client-unavailable', { scheduleId: pat2, date: far, reason: 'client_cancelled' })
  check('…the office may, any date', office.status === 201)
}

// ══ 9. visit documentation ══════════════════════════════════════════════════════════════════════════
{
  const pat = await insSched({ caregiver_id: cg1.id, client_id: clV.id, day_of_week: 3, start: '09:00', end: '11:00', effective_date: '2026-09-01' })
  const from = '2026-09-01', to = '2026-09-30'
  const cgRead = await as(cg1)('GET', `/api/visit-docs/clients/${clV.id}?from=${from}&to=${to}`)
  check('visit documentation is the office\'s', cgRead.status === 403)
  const list = await as(admin)('GET', `/api/visit-docs/clients/${clV.id}?from=${from}&to=${to}`)
  const weds = list.json?.visits?.filter((x: any) => x.schedule_id === pat) || []
  check('every scheduled visit in the range is listed (5 Wednesdays in Sep 2026)', list.status === 200 && weds.length === 5, weds.map((x: any) => x.visit_date))
  const bad = await as(admin)('PUT', `/api/visit-docs/clients/${clV.id}/visits`, { visitDate: '2026-09-02', startTime: '10:00', caregiverId: cg1.id, note: 'x' })
  check('a note can only be saved on a real scheduled visit', bad.status === 404)
  const save = await as(admin)('PUT', `/api/visit-docs/clients/${clV.id}/visits`, { visitDate: '2026-09-02', startTime: '09:00', caregiverId: cg1.id, note: 'Shower, lunch', tasks: [{ taskId: 't1', taskName: 'Bathing', done: true }] })
  check('the office saves one visit\'s note; the end time comes from the schedule', save.status === 200 && save.json?.end_time === '11:00:00' && save.json?.tasks?.[0]?.taskName === 'Bathing', save.json)
  const bulk = await as(admin)('POST', `/api/visit-docs/clients/${clV.id}/visits/bulk`, { from, to, note: 'Personal care provided.' })
  const docs = await q(sql`SELECT to_char(visit_date, 'YYYY-MM-DD') AS d, note FROM visit_documentation WHERE client_id = ${clV.id} ORDER BY visit_date`)
  check('bulk fill writes the visits without a note and leaves the written one alone', bulk.json?.written === 4 && bulk.json?.skipped === 1 && docs.find((x: any) => x.d === '2026-09-02')?.note === 'Shower, lunch', [bulk.json, docs])
  const again = await as(admin)('POST', `/api/visit-docs/clients/${clV.id}/visits/bulk`, { from, to, note: 'Again' })
  check('…run again it writes nothing', again.json?.written === 0)
  const pdf = await as(admin)('GET', `/api/visit-docs/clients/${clV.id}/notes.pdf?from=${from}&to=${to}`)
  check('the care notes print as a PDF', pdf.status === 200 && pdf.type.includes('application/pdf'))
}

// ══ 10. the two background scans ═════════════════════════════════════════════════════════════════════
{
  const { scanShiftReminders } = await import('./src/jobs/shiftReminders.ts')
  const { scanOvertimeAlerts } = await import('./src/jobs/overtimeAlerts.ts')
  const day = '2026-11-03'
  const at = new Date(`${day}T10:00:00Z`)
  await insSched({ caregiver_id: cg2.id, client_id: clP.id, date: day, start: '11:00', end: '12:00' })
  const cancelled = await insSched({ caregiver_id: cg3.id, client_id: clP.id, date: day, start: '11:02', end: '12:00' })
  await q(sql`INSERT INTO schedule_exceptions (id, schedule_id, exception_date, exception_type, created_at) VALUES ('exc_rem', ${cancelled}, ${day}, 'cancelled', NOW())`)
  pushes.length = 0
  const n1 = await scanShiftReminders(at)
  const n2 = await scanShiftReminders(new Date(at.getTime() + 5 * 60000))
  check('a visit an hour away gets one "Shift in 1 hour" — a cancelled one gets none', n1 === 1 && pushes.length === 1 && pushes[0].userId === cg2.id && pushes[0].payload.body.includes('11:00–12:00'), pushes)
  check('…and the next scan does not send it again', n2 === 0)

  texts.length = 0
  const T = new Date(Date.now() - 3 * 3600000)
  await q(sql`UPDATE time_entries SET end_time = NOW(), is_complete = true WHERE end_time IS NULL`)
  const ot = await insEntry({ caregiver_id: cg3.id, client_id: clA.id, start: new Date(T.getTime() - 70 * 60000), allotted: 60 })
  const a1 = await scanOvertimeAlerts(T)
  check('10 minutes past a 60-minute visit: the caregiver gets one text', a1 === 1 && texts.length === 1 && texts[0].to === '+17155550113' && texts[0].body.includes('10 min past your 1 hr visit'), texts)
  check('…once', (await scanOvertimeAlerts(new Date(T.getTime() + 60000))) === 0)
  const a2 = await scanOvertimeAlerts(new Date(T.getTime() + 55 * 60000))
  const log = await q(sql`SELECT threshold_min, sent FROM overtime_alert_log WHERE time_entry_id = ${ot} ORDER BY threshold_min`)
  check('65 minutes over: the +60 text goes to the caregiver and the office; +30 is marked skipped', a2 === 2 && texts.some((t) => t.to === '+17155550102') &&
    JSON.stringify(log) === JSON.stringify([{ threshold_min: 5, sent: true }, { threshold_min: 30, sent: false }, { threshold_min: 60, sent: true }]), [a2, log])
  check('…with an in-app notification for the office', (await q1(sql`SELECT COUNT(*)::int AS n FROM notifications WHERE type = 'overtime_alert'`)).n >= 2)
  check('a punch stuck 13 hours past its visit gets no text', (await scanOvertimeAlerts(new Date(T.getTime() + 13 * 3600000))) === 0)
}

// ══ 11. Schedule Hub support (/api/scheduling) ══════════════════════════════════════════════════════
{
  const hub = new Hono()
  hub.route('/api/scheduling', (await import('./src/routes/schedulingHub.ts')).default)
  const asH = (who: any) => async (method: string, path: string, body?: unknown) => {
    const res = await hub.request(path, { method, headers: { 'content-type': 'application/json', 'x-test-user': who.id, 'x-test-role': who.role }, body: body === undefined ? undefined : JSON.stringify(body) })
    const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
    return { status: res.status, json: j }
  }
  const lonely = await mkUser('caregiver', 'cgfour')
  const cl = await mkClient('Hana', { weeklyAuthorizedUnits: '40', doNotUseCaregivers: [cg1.id] })
  // A bi-weekly 4-hour shift: counted only in its on-weeks.
  await insSched({ caregiver_id: lonely.id, client_id: cl.id, day_of_week: 2, start: '08:00', end: '12:00', effective_date: '2026-09-01', anchor_date: '2026-09-01', frequency: 'biweekly' })
  const on = await asH(admin)('GET', '/api/scheduling/coverage-overview?weekOf=2026-09-01')
  const off = await asH(admin)('GET', '/api/scheduling/coverage-overview?weekOf=2026-09-08')
  const hOn = on.json?.caregivers?.find((x: any) => x.id === lonely.id)?.scheduledHours
  const hOff = off.json?.caregivers?.find((x: any) => x.id === lonely.id)?.scheduledHours
  check('coverage counts a bi-weekly shift only in its on-week (4 h, then 0)', hOn === 4 && hOff === 0, [hOn, hOff])
  const under = on.json?.underScheduledClients?.find((x: any) => x.id === cl.id)
  check('…and a client authorized 40 units (10 h) with 16 units scheduled is short 24 units / 6 h', under?.scheduledUnits === 16 && under?.shortfallUnits === 24 && under?.shortfallHours === 6, under)
  const cgCov = await asH(cg1)('GET', '/api/scheduling/coverage-overview')
  check('coverage is the office\'s', cgCov.status === 403)
  const wk = await asH(admin)('GET', '/api/scheduling/week-view?weekOf=2026-09-01')
  const tue = wk.json?.caregivers?.find((x: any) => x.caregiver.id === lonely.id)?.days?.[2]
  check('the week view puts the shift on its Tuesday with wall-clock times', tue?.length === 1 && tue[0].start_time === '08:00:00', tue)
  const ot = await asH(admin)('POST', '/api/scheduling/check-weekly-hours', { caregiverId: lonely.id, date: '2026-09-02', startTime: '08:00', endTime: '20:00' })
  check('overtime check: 4 h scheduled + 12 h proposed = 16 h projected', ot.json?.currentWeeklyHours === 4 && ot.json?.projectedHours === 16 && ot.json?.overtimeHours === 0, ot.json)
  const mineH = await asH(cg2)('GET', `/api/scheduling/caregiver-hours/${lonely.id}`)
  check("a caregiver cannot read another caregiver's hours", mineH.status === 403)
  const sug = await asH(admin)('GET', `/api/scheduling/suggest-caregivers?clientId=${cl.id}&date=2026-09-01&startTime=09:00&endTime=10:00`)
  const ids = (sug.json?.suggestions || []).map((x: any) => x.id)
  check('suggestions leave out the client\'s do-not-use caregiver and rank a busy one below a free one',
    !ids.includes(cg1.id) && ids.indexOf(lonely.id) > ids.indexOf(cg3.id) && sug.json.suggestions.find((x: any) => x.id === lonely.id)?.hasConflict === true, ids)
}

console.log(`\nhomecare-visits: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
