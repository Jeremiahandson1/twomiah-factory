// ADAPTED COPY of tests/homecare/scheduling.test.ts, for the unified app (tests/unified/harness/adapted.ts). Unchanged except the
// 10 read(s) marked "unified:", where the rulebook's reply shapes replaced the template's. The original keeps
// running against the template; tests/unified/harness/unified-divergences.ts names the assertions this copy stands in for.
// crm-homecare — Run 3 scheduling fixes, through the real routes and, where the fix is a screen's,
// through the screen's source.
//
//   · a shift's end before its start is refused unless the writer says OVERNIGHT, on every schedule
//     writer (POST /schedules, POST /schedules-enhanced, PUT /schedules-all/:id); overnight is kept;
//   · the 🗑 delete of a one-time visit really removes it from the caregiver's list, and the grid's
//     delete reads the server's answer instead of toasting success over a refusal;
//   · the Roster Optimizer's "existing hours" are the grid's week through the schedule engine
//     (one-time visits, a day covered for a colleague, an ended or suspended pattern);
//   · suspending a client's service from a date stops one-time visits after it, not before;
//   · "Move to Available Shifts" with "text them" unticked sends no text;
//   · the screens: Edit Shift opens on "This date only", the legend and the chips share one colour
//     rule, the month view names the client and caregiver, the viewed week survives a save, and the
//     Schedule Hub's edit pop-up is rendered from the create panel too;
//   · calendar days ('YYYY-MM-DD') read as the LOCAL day west of UTC (HIGH 1: "Tue, Oct 20" for a
//     Wednesday open shift).
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { readFileSync } from 'node:fs'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { agencies, users, clients } from './db/schema.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 400)) }
}
const q = async (s: any) => { const r: any = await db.execute(s); return (r?.rows ?? r) as any[] }
const q1 = async (s: any) => (await q(s))[0]
const snakeKey = (k: string) => k.replace(/[A-Z]/g, (m) => '_' + m.toLowerCase())
const templateShape = (v: any): any => Array.isArray(v) ? v.map(templateShape) : (v && typeof v === 'object') ? ((Array.isArray(v.data) && v.pagination) ? templateShape(v.data) : Object.fromEntries(Object.entries(v).flatMap(([k, x]) => { const s = templateShape(x); return snakeKey(k) === k ? [[k, s]] : [[k, s], [snakeKey(k), s]] }))) : v /* unified: templateShape reads a unified reply in the template's shape: a list reply ({ data, pagination }, RULEBOOK §3) as its rows, and every camelCase key (RULEBOOK §2) also under its snake_case name — the values are the server's, unchanged */
const ROOT = (process.env.FACTORY_ROOT || '') + 'templates/crm-homecare/'
const HC_WEB = (process.env.FACTORY_ROOT || '') + 'apps/unified/web/src/crm/pages/homecare/'
const MOVED: Record<string, string> = {
  'frontend/src/components/admin/DragDropScheduler.tsx': 'apps/unified/web/src/crm/pages/homecare/schedule/DragDropScheduler.tsx',
  'frontend/src/components/admin/SchedulingHub.tsx': 'apps/unified/web/src/crm/pages/homecare/schedule/SchedulingHub.tsx',
  'frontend/src/components/admin/MakeShiftAvailableModal.tsx': 'apps/unified/web/src/crm/pages/homecare/schedule/MakeShiftAvailableModal.tsx',
  'frontend/src/utils/shiftTimes.ts': 'apps/unified/web/src/crm/pages/homecare/lib/shiftTimes.ts',
  'backend/src/services/scheduleOccurrences.ts': 'apps/unified/server/crm/homecare/core/scheduleOccurrences.ts',
}
const src = (p: string) => { if (!MOVED[p]) throw new Error('unified: no moved file for ' + p); return readFileSync((process.env.FACTORY_ROOT || '') + MOVED[p], 'utf8').replace(/\r\n/g, '\n') } /* unified: the screens moved to apps/unified/web/src/crm/pages/homecare/ (docs/UNIFIED_HOMECARE_SCREENS.md) and the schedule rule to server/crm/homecare/core: src() reads the moved file for each template path it is given, and refuses a path with no moved file rather than read the template */

await setupSchema()
const [ag] = await db.insert(agencies).values({ name: 'Sched Care', slug: 'schedcare', timezone: 'UTC' } as any).returning()
const mkUser = async (role: string, tag: string, phone: string | null = null) => (await db.insert(users).values({
  email: `${tag}-sched@test.local`, passwordHash: 'x', firstName: tag, lastName: 'Tester', role, phone,
} as any).returning())[0]
const admin = await mkUser('admin', 'admin')
const cgA = await mkUser('caregiver', 'CaregiverA', '7155550121')
const cgB = await mkUser('caregiver', 'CaregiverB', '7155550122')
const mkClient = async (first: string) => (await db.insert(clients).values({ firstName: first, lastName: 'Client', isPrivatePay: true } as any).returning())[0]
const pat = await mkClient('Pat')
const sam = await mkClient('Sam')

const app = new Hono()
for (const [mount, file] of [
  ['/api/schedules', 'schedules'],
  ['/api/schedules-all', 'schedulesAll'],
  ['/api/schedules-enhanced', 'schedulesEnhanced'],
  ['/api/open-shifts', 'openShifts'],
  ['/api/roster-optimizer', 'rosterOptimizer'],
] as const) {
  app.route(mount, (await import(`./src/routes/${file}.ts`)).default)
}
const { occurrencesCte } = await import('./src/services/scheduleOccurrences.ts')
const notify = await import('./src/services/visitNotify.ts')
const texts: { to: string; body: string }[] = []
notify._setSmsSender(async (to: string, body: string) => { texts.push({ to, body }); return { status: 'sent', sid: 'SMtest', error: null } })
notify._setPushSender(async () => 1)

const as = (who: any) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method, headers: { 'content-type': 'application/json', 'x-test-user': who.id, 'x-test-company': ag.id, 'x-test-role': who.role },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text()
  let j: any = t; try { j = templateShape(JSON.parse(t)) } catch {} /* unified: each reply read through templateShape */
  return { status: res.status, json: j }
}
const office = as(admin)
const occFor = (from: string, to: string, where: any) => q(sql`WITH ${occurrencesCte(from, to)}
  SELECT schedule_id, caregiver_id, client_id, to_char(occ_date, 'YYYY-MM-DD') AS d, minutes FROM occ WHERE ${where} ORDER BY occ_date, start_time`)
const insSched = async (v: Record<string, any>) => {
  const id = `sch_${Math.random().toString(36).slice(2, 10)}`
  const base = v.date || v.effective_date || '2026-01-01'
  await q(sql`INSERT INTO schedules (id, caregiver_id, client_id, day_of_week, date, start_time, end_time, frequency, effective_date,
      end_date, is_active, schedule_type, status, suspended_from, created_at, updated_at)
    VALUES (${id}, ${v.caregiver_id}, ${v.client_id}, ${v.day_of_week ?? null}, ${v.date ?? null}::date,
            ${`${base} ${v.start}`}::timestamp, ${`${base} ${v.end}`}::timestamp, 'weekly',
            ${v.effective_date ?? null}::date, ${v.end_date ?? null}::date, true,
            ${v.day_of_week != null ? 'recurring' : 'one-time'}, 'active', ${v.suspended_from ?? null}::date, NOW(), NOW())`)
  return id
}

// ══ 1. an end before the start: refused unless the shift is marked overnight ═══════════════════════
{
  const slip = await office('POST', '/api/schedules', { caregiverId: cgA.id, clientId: sam.id, scheduleType: 'one-time', date: '2026-12-31', startTime: '09:00', endTime: '08:00' })
  check('POST /schedules: 9:00am → 8:00am without "overnight" is a 400 that says why', slip.status === 400 && /before the start time/.test(slip.json?.error) && /overnight/.test(slip.json?.error), slip)
  const same = await office('POST', '/api/schedules', { caregiverId: cgA.id, clientId: sam.id, scheduleType: 'one-time', date: '2026-12-31', startTime: '09:00', endTime: '09:00' })
  check('…equal times are still refused', same.status === 400 && /cannot be the same/.test(same.json?.error), same)
  const night = await office('POST', '/api/schedules', { caregiverId: cgA.id, clientId: sam.id, scheduleType: 'one-time', date: '2026-12-31', startTime: '22:00', endTime: '06:00', overnight: true })
  check('…an overnight 22:00 → 06:00, said so, is created', night.status === 201 && night.json?.end_time === '06:00:00', night)
  const nightOcc = await occFor('2026-12-31', '2026-12-31', sql`schedule_id = ${night.json?.id}`)
  check('…and the engine reads it as 8 hours (480 minutes)', Number(nightOcc[0]?.minutes) === 480, nightOcc)
  const fwd = await office('POST', '/api/schedules', { caregiverId: cgA.id, clientId: sam.id, scheduleType: 'one-time', date: '2026-12-30', startTime: '09:00', endTime: '11:00' })
  check('…an ordinary 9–11 visit is untouched by the rule', fwd.status === 201, fwd)

  const enh = await office('POST', '/api/schedules-enhanced', { caregiverId: cgB.id, clientId: pat.id, scheduleType: 'one-time', date: '2026-12-29', startTime: '13:00', endTime: '12:00' })
  check('POST /schedules-enhanced: an end before the start is a 400 too', enh.status === 400 && /before the start time/.test(enh.json?.error), enh)
  const enhNight = await office('POST', '/api/schedules-enhanced', { caregiverId: cgB.id, clientId: pat.id, scheduleType: 'one-time', date: '2026-12-29', startTime: '20:00', endTime: '07:00', overnight: true })
  check('…and overnight is allowed when said', enhNight.status === 201, enhNight)
  const split = await office('POST', '/api/schedules-enhanced', { caregiverId: cgB.id, clientId: pat.id, scheduleType: 'one-time', date: '2026-12-28', startTime: '08:00', endTime: '10:00', splitShift: { startTime: '15:00', endTime: '14:00' } })
  check('…a split shift whose second part ends before it starts is refused', split.status === 400 && /segment 2 must end after it starts/.test(split.json?.error), split)

  const put = await office('PUT', `/api/schedules-all/${fwd.json.id}`, { clientId: sam.id, startTime: '09:00', endTime: '08:00', date: '2026-12-30', dayOfWeek: null })
  check('PUT /schedules-all: editing a visit to end before it starts is a 400', put.status === 400 && /before the start time/.test(put.json?.error), put)
  const putEnd = await office('PUT', `/api/schedules-all/${fwd.json.id}`, { endTime: '08:00' })
  check('…also when only the end is sent (the kept start counts)', putEnd.status === 400, putEnd)
  const putOk = await office('PUT', `/api/schedules-all/${night.json.id}`, { clientId: sam.id, startTime: '22:00', endTime: '07:00', overnight: true, date: '2026-12-31', dayOfWeek: null, notes: 'longer night' })
  check('…and an overnight visit edited as overnight saves', putOk.status === 200 && putOk.json?.end_time === '07:00:00', putOk)
  const notes = await office('PUT', `/api/schedules-all/${night.json.id}`, { notes: 'notes only' })
  check('…a notes-only edit of an overnight visit is not refused', notes.status === 200, notes)
}

// ══ 2. the 🗑 on a one-time visit removes it ═════════════════════════════════════════════════════════
{
  const id = await insSched({ caregiver_id: cgA.id, client_id: sam.id, date: '2026-12-31', start: '09:00', end: '08:00' })
  const before = await office('GET', `/api/schedules/caregiver/${cgA.id}`)
  check('the Dec 31 9:00am–8:00am visit is in Caregiver A\'s list', before.json.some((s: any) => s.id === id))
  const del = await office('DELETE', `/api/schedules/${id}?scope=all`)
  check('DELETE scope=all on a one-time visit succeeds', del.status === 200 && del.json?.deletedCount === 1, del)
  const after = await office('GET', `/api/schedules/caregiver/${cgA.id}`)
  check('…and it is gone from the list the panel reloads', !after.json.some((s: any) => s.id === id))
  const cg = await as(cgA)('DELETE', `/api/schedules/${before.json[0].id}?scope=all`)
  check('a caregiver cannot delete a schedule (403)', cg.status === 403, cg)

  const grid = src('frontend/src/components/admin/DragDropScheduler.tsx')
  const delFn = grid.slice(grid.indexOf('async function handleDeleteShift'), grid.indexOf('// ═══ EDIT — scope-aware ═══')) /* unified: the delete handler ends where the edit section begins; the moved grid marks it '// ═══ EDIT — scope-aware ═══' */
  check('the grid\'s delete reads the server\'s answer (no unchecked DELETE fetch)', /import \{[^}]*\bapi\b[^}]*\} from '\.\.\/lib\/http'/.test(grid) && /const del = \(query: string\) => api\.delete\(/.test(delFn) && /catch \(err\) \{\s*toast\.error\(errorMessage\(err, 'Delete failed'\)\)/.test(delFn) && !/fetch\(/.test(delFn) /* unified: the moved grid deletes through the app's api client (lib/http → packages/tenant-ui client.ts handleResponse), which throws on a refusal; every branch awaits del(), so a refused delete skips its success toast and lands in the catch's toast.error with the server's sentence — there is no res.ok to read and no raw fetch */ && (delFn.match(/await del\(/g) || []).length === 4)
  const hub = src('frontend/src/components/admin/SchedulingHub.tsx')
  check('the Schedule Hub\'s 🗑 passes the schedule, not just its id', (hub.match(/handleDeleteSchedule\(s\.id, s\)/g) || []).length === 2 && !/handleDeleteSchedule\(s\.id\)/.test(hub))
  const panel = hub.slice(hub.indexOf('if (createPanelOpen) {'), hub.indexOf('\n  return (\n    <>'))
  check('the edit pop-up is rendered from the create panel too (a row click there did nothing)', panel.includes('{renderScheduleModals()}') && /const renderScheduleModals = \(\) => \([\s\S]*\{editModal && \(/.test(hub))
}

// ══ 3. the Roster Optimizer's existing hours are the engine's week ═════════════════════════════════
{
  // The week of Sun Nov 1 2026. B has a one-time Wednesday visit (2h) and covers A's Monday for one
  // day (2h): 4.00h, all of it outside B's own recurring patterns. A keeps a weekly Tuesday (4h); an
  // ended Thursday pattern and a suspended Friday one count nothing.
  await insSched({ caregiver_id: cgB.id, client_id: pat.id, date: '2026-11-04', start: '09:00', end: '11:00' })
  const mon = await insSched({ caregiver_id: cgA.id, client_id: pat.id, day_of_week: 1, start: '13:00', end: '15:00', effective_date: '2026-10-01' })
  await q(sql`INSERT INTO schedule_exceptions (id, schedule_id, exception_date, exception_type, override_caregiver_id, created_at)
    VALUES ('exc_ro1', ${mon}, '2026-11-02', 'modified', ${cgB.id}, NOW())`)
  await insSched({ caregiver_id: cgA.id, client_id: sam.id, day_of_week: 2, start: '09:00', end: '13:00', effective_date: '2026-10-01' })
  await insSched({ caregiver_id: cgA.id, client_id: sam.id, day_of_week: 4, start: '09:00', end: '12:00', effective_date: '2026-10-01', end_date: '2026-10-31' })
  await insSched({ caregiver_id: cgA.id, client_id: sam.id, day_of_week: 5, start: '09:00', end: '12:00', effective_date: '2026-10-01', suspended_from: '2026-10-20' })
  const roster = await office('GET', '/api/roster-optimizer/roster?weekOf=2026-11-04')
  const rB = roster.json?.caregivers?.find((c: any) => c.id === cgB.id)
  const rA = roster.json?.caregivers?.find((c: any) => c.id === cgA.id)
  check('the roster names the week it counts (Sun–Sat, the grid\'s week)', roster.json?.week?.start === '2026-11-01' && roster.json?.week?.end === '2026-11-07', roster.json?.week)
  check('Caregiver B: 4.00h (a one-time visit + a day covered for A), not "0h existing"', Number(rB?.current_weekly_hours) === 4, rB)
  check('Caregiver A: 4.00h (the Tuesday; the covered Monday, the ended and the suspended patterns count nothing)', Number(rA?.current_weekly_hours) === 4, rA)
  const engine = await q1(sql`WITH ${occurrencesCte('2026-11-01', '2026-11-07')} SELECT ROUND(SUM(hours)::numeric, 2) AS h FROM occ WHERE caregiver_id = ${cgB.id}`)
  check('…the same number the schedule engine gives for that week', Number(engine.h) === Number(rB?.current_weekly_hours), engine)
  const run = await office('POST', '/api/roster-optimizer/run', { weekOf: '2026-11-04', caregivers: [{ id: cgB.id, targetHours: 10 }], clients: [{ id: sam.id, hoursPerWeek: 2, visitsPerWeek: 1 }] })
  const sB = (run.json?.summary?.caregivers || []).find((c: any) => c.id === cgB.id)
  check('the run\'s summary uses the same existing hours', run.status === 200 && Number(sB?.existingHours) === 4 && Number(sB?.remainingCapacity) === 10 - 4 - Number(sB?.proposedNewHours), { status: run.status, sB, keys: Object.keys(run.json || {}) })
}

// ══ 4. suspending a client's service covers one-time visits after the date ═══════════════════════
{
  const lee = await mkClient('Lee')
  const weekly = await insSched({ caregiver_id: cgA.id, client_id: lee.id, day_of_week: 1, start: '08:00', end: '09:00', effective_date: '2026-11-01' })
  const earlyOne = await insSched({ caregiver_id: cgB.id, client_id: lee.id, date: '2026-11-03', start: '10:00', end: '11:00' })
  const lateOne = await insSched({ caregiver_id: cgB.id, client_id: lee.id, date: '2026-11-12', start: '10:00', end: '11:00' })
  const sus = await office('POST', `/api/schedules/client/${lee.id}/suspend`, { fromDate: '2026-11-05' })
  check('the Clients screen\'s suspend pauses every schedule of the client, one-time ones included', sus.status === 200 && sus.json?.suspended === 3, sus.json)
  const o = await occFor('2026-11-01', '2026-11-30', sql`client_id = ${lee.id}`)
  check('the one-time visit AFTER the date is gone', !o.some((x: any) => x.schedule_id === lateOne), o)
  check('the one-time visit BEFORE the date stays', o.some((x: any) => x.schedule_id === earlyOne && x.d === '2026-11-03'), o)
  check('the weekly visits stop from the date (Nov 2 stays, Nov 9 on are gone)', o.filter((x: any) => x.schedule_id === weekly).map((x: any) => x.d).join(',') === '2026-11-02', o)
  const res = await office('POST', `/api/schedules/client/${lee.id}/resume`, {})
  const back = await occFor('2026-11-01', '2026-11-30', sql`schedule_id = ${lateOne}`)
  check('resume brings the one-time visit back', res.json?.resumed === 3 && back.length === 1, { res: res.json, back })
  check('a caregiver cannot suspend a client', (await as(cgA)('POST', `/api/schedules/client/${lee.id}/suspend`, {})).status === 403)
}

// ══ 5. "Move to Available Shifts" with "text them" unticked sends no text ═════════════════════════
{
  const id = await insSched({ caregiver_id: cgA.id, client_id: pat.id, date: '2026-11-20', start: '09:00', end: '11:00' })
  const os = await office('POST', `/api/open-shifts/from-schedule/${id}`, { date: '2026-11-20', visibleTo: [cgB.id] })
  const n0 = texts.length
  const quiet = await office('POST', `/api/open-shifts/${os.json?.id}/notify`, { caregiverIds: [cgB.id], sms: false })
  check('notify with sms:false texts nobody', quiet.status === 200 && quiet.json?.texted === 0 && texts.length === n0, { quiet: quiet.json, sent: texts.length - n0 })
  check('…but still tells the caregiver in the app', quiet.json?.notified === 1 && (await q1(sql`SELECT COUNT(*)::int AS n FROM notifications WHERE user_id = ${cgB.id} AND type = 'open_shift_offer'`)).n === 1)
  const loud = await office('POST', `/api/open-shifts/${os.json?.id}/notify`, { caregiverIds: [cgB.id], sms: true })
  check('…and with sms:true it texts', loud.json?.texted === 1 && texts.length === n0 + 1, loud.json)
  const modal = src('frontend/src/components/admin/MakeShiftAvailableModal.tsx')
  check('the modal sends the box as sms and says the app notice is sent either way', /sms: sendText/.test(modal) && /in-app notification/.test(modal))
}

// ══ 6. the screens ═══════════════════════════════════════════════════════════════════════════════════
{
  const grid = src('frontend/src/components/admin/DragDropScheduler.tsx')
  const open = grid.slice(grid.indexOf('function openEditShift'), grid.indexOf('async function handleSaveShift'))
  check('Edit Shift opens on "This date only"', /setEditScope\('this'\)/.test(open) && !/setEditScope\('following'\)/.test(open))
  const legend = grid.slice(grid.indexOf('{/* Client legend */}'), grid.indexOf('═══ CREATE SHIFT ═══')) /* unified: the legend ends where the create dialog begins; the moved grid marks it '═══ CREATE SHIFT ═══' (the template's 'CREATE SHIFT MODAL' is not in it) */
  check('the legend and the chips both colour by clientColor()', /clientColor\(c\.id, clientMap\)/.test(legend) && !/PALETTE\[/.test(legend) && /const color\s+= clientColor\(s\.clientId, clientMap\)/.test(grid) /* unified: the grid's rows are camelCase (RULEBOOK §2): the chip colours by s.clientId */)
  check('the viewed week survives a save: only the first load replaces the grid', /if \(loading && !hasLoaded\) return/.test(grid) && /sessionStorage\.setItem\(WEEK_KEY/.test(grid))
  check('the grid\'s days are local calendar days, not UTC slices', /weekDates\.map\(localYmd\)/.test(grid) && !/toISOString\(\)\.split\('T'\)\[0\]/.test(grid))
  check('the forms send "overnight" and check the one times rule', (grid.match(/shiftTimesError\(/g) || []).length >= 2 && /overnight,\n/.test(grid))
  const hub = src('frontend/src/components/admin/SchedulingHub.tsx')
  check('the month view names the client and the caregiver', /const label = `\$\{formatTime\(sc\.startTime\)\} \$\{getClientName\(sc\.clientId\)\} · \$\{getCaregiverName\(sc\.caregiverId\)\}`/.test(hub) /* unified: the month view's rows are camelCase (startTime, clientId, caregiverId) */)
  check('the Schedule Hub forms check the same times rule', (hub.match(/shiftTimesError\(/g) || []).length === 2)
  const fe = src('frontend/src/utils/shiftTimes.ts'), be = src('backend/src/services/scheduleOccurrences.ts')
  const msg = 'The end time is before the start time. If the shift runs past midnight, mark it as overnight.'
  check('the form\'s rule and the server\'s say the same thing', fe.includes(msg) && be.includes(msg))
}

// ══ 7. calendar days are the LOCAL day west of UTC (HIGH 1) ═══════════════════════════════════════
{
  process.env.TZ = 'America/Chicago'
  const { parseLocalDate, formatDate, toLocalYMD } = await import(HC_WEB + 'lib/date.ts') /* unified: the calendar-day helpers are lib/date.ts */
  const dt = await import(HC_WEB + 'lib/datetime.ts') /* unified: the date formatters are lib/datetime.ts */
  const opts = { weekday: 'short', month: 'short', day: 'numeric' } as const
  check('the zone is really Central here (the bug only shows west of UTC)', new Date('2026-10-21').getDate() === 20)
  check('shift_date 2026-10-21 reads "Wed, Oct 21", not "Tue, Oct 20"', formatDate('2026-10-21', opts) === 'Wed, Oct 21', formatDate('2026-10-21', opts))
  check('2026-10-26 reads "Mon, Oct 26", not "Sun, Oct 25"', formatDate('2026-10-26', opts) === 'Mon, Oct 26')
  check('a DATE column sent as UTC midnight is the same day', toLocalYMD('2026-10-21T00:00:00.000Z') === '2026-10-21')
  check('an instant stays an instant (02:30Z on the 17th is the evening of the 16th in Central)', toLocalYMD('2026-10-17T02:30:00.000Z') === '2026-10-16')
  check('parseLocalDate gives local midnight of that day', parseLocalDate('2026-10-21').getHours() === 0 && parseLocalDate('2026-10-21').getDate() === 21)
  check('utils/datetime formatDate agrees', dt.formatDate('2026-10-21', opts) === 'Wed, Oct 21')
  process.env.TZ = 'UTC'
}

console.log(`\nhomecare-scheduling: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
