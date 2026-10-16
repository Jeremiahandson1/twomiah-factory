// crm-homecare — Run 3 HIGH 6 and item 7: what a family may change from the portal, and who is told.
//
//   · THE CANCEL RULE (visitChangeRequests.ts, CANCEL_NOTICE_HOURS): a reason is required; a visit that
//     has started, is over or was worked is refused (409, "call the office"); with 24+ hours' notice it
//     comes off the schedule at once; with less it is a LATE cancellation that waits for the office.
//     The office and the caregiver are told on both paths, and again when the office decides.
//   · GET /api/portal/visits says per visit whether it can still change (can_change), so the screen
//     stops offering Reschedule / Request Cancel on today's finished visit.
//   · My Caregivers = who serves the client NOW (assignment, or a visit in the next four weeks through
//     the engine — a covering caregiver counts for their day).
//   · The reschedule picker reads caregiver_availability (the office's screen); a day with no times
//     gets the default 08:00–17:00 working day; slots are as long as the visit.
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import jwt from 'jsonwebtoken'
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

process.env.JWT_SECRET = process.env.JWT_SECRET || 'portal-changes-test-secret'
await setupSchema()

// The agency runs on UTC so "now" here is the agency's wall clock.
const [ag] = await db.insert(agencies).values({ name: 'Portal Care', slug: 'portalcare', timezone: 'UTC' } as any).returning()
const mkUser = async (role: string, tag: string) => (await db.insert(users).values({
  email: `${tag}-pvc@test.local`, passwordHash: 'x', firstName: tag, lastName: 'Tester', role,
} as any).returning())[0]
const admin = await mkUser('admin', 'admin')
const cgA = await mkUser('caregiver', 'cga')
const cgB = await mkUser('caregiver', 'cgb')
const cgOld = await mkUser('caregiver', 'cgold')
const cgOther = await mkUser('caregiver', 'cgother')
const [pat] = await db.insert(clients).values({ firstName: 'Pat', lastName: 'Example', portalEnabled: true } as any).returning()
const [sam] = await db.insert(clients).values({ firstName: 'Sam', lastName: 'Other' } as any).returning()

const app = new Hono()
app.route('/api/portal', (await import('./src/routes/portalVisits.ts')).default)
app.route('/api/visit-change-requests', (await import('./src/routes/visitChangeRequests.ts')).default)
const { caregiversServingClient, servesClient } = await import('./src/routes/portal.ts')
const notify = await import('./src/services/visitNotify.ts')
const pushes: { userId: string; payload: any }[] = []
notify._setSmsSender(async () => ({ status: 'sent', sid: 'SMtest', error: null }))
notify._setPushSender(async (userId: string, payload: any) => { pushes.push({ userId, payload }); return 1 })
notify._setExpoTransport(async () => [])

const call = (headers: Record<string, string>) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method, headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}
const as = (who: any) => call({ 'x-test-user': who.id, 'x-test-company': ag.id, 'x-test-role': who.role })
const asPortal = call({ authorization: `Bearer ${jwt.sign({ role: 'client', clientId: pat.id }, process.env.JWT_SECRET!)}` })

const ymd = (d: Date) => d.toISOString().slice(0, 10)
const hm = (d: Date) => d.toISOString().slice(11, 16)
const addDays = (s: string, n: number) => ymd(new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10) + n)))
const dow = (s: string) => new Date(`${s}T12:00:00Z`).getUTCDay()
const today = ymd(new Date())

const insSched = async (v: Record<string, any>) => {
  const id = `sch_${Math.random().toString(36).slice(2, 10)}`
  const base = v.date || v.effective_date || '2026-01-01'
  await q(sql`INSERT INTO schedules (id, caregiver_id, client_id, day_of_week, date, start_time, end_time, frequency, effective_date,
      end_date, is_active, schedule_type, status, created_at, updated_at)
    VALUES (${id}, ${v.caregiver_id}, ${v.client_id}, ${v.day_of_week ?? null}, ${v.date ?? null}::date,
            ${`${base} ${v.start}`}::timestamp, ${`${base} ${v.end}`}::timestamp, 'weekly',
            ${v.effective_date ?? null}::date, ${v.end_date ?? null}::date, true,
            ${v.day_of_week != null ? 'recurring' : 'one-time'}, 'active', NOW(), NOW())`)
  return id
}
const occurs = async (scheduleId: string, d: string) => {
  const { occurrencesCte } = await import('./src/services/scheduleOccurrences.ts')
  return (await q(sql`WITH ${occurrencesCte(d, d)} SELECT 1 FROM occ WHERE schedule_id = ${scheduleId}`)).length > 0
}
const notes = (userId: string, type: string) => q1(sql`SELECT COUNT(*)::int AS n FROM notifications WHERE user_id = ${userId} AND type = ${type}`).then((r) => r.n)
const pushed = (userId: string, type: string) => pushes.filter((p) => p.userId === userId && p.payload?.data?.type === type).length
const visit = (scheduleId: string, d: string, start: string, end: string, cg = cgA.id) =>
  ({ source: 'schedule', scheduleId, visitDate: d, caregiverId: cg, startTime: start, endTime: end })

// ══ 1. a reason is required ══════════════════════════════════════════════════════════════════════════
{
  const d = addDays(today, 5)
  const s = await insSched({ caregiver_id: cgA.id, client_id: pat.id, date: d, start: '10:00', end: '12:00' })
  const r = await asPortal('POST', '/api/portal/visits/cancel-request', { ...visit(s, d, '10:00', '12:00'), reason: '   ' })
  check('a cancel with no reason is refused with a message the screen shows', r.status === 400 && /why you are cancelling/.test(r.json?.error || ''), r.json)
  check('…nothing is filed and the visit stands', (await q1(sql`SELECT COUNT(*)::int AS n FROM visit_change_requests WHERE schedule_id = ${s}`)).n === 0 && await occurs(s, d))
}

// ══ 2. 24+ hours' notice: applied at once, office and caregiver told ═════════════════════════════════
{
  const d = addDays(today, 3)
  const s = await insSched({ caregiver_id: cgA.id, client_id: pat.id, day_of_week: dow(d), start: '09:30', end: '11:30', effective_date: today })
  const r = await asPortal('POST', '/api/portal/visits/cancel-request', { ...visit(s, d, '09:30', '11:30'), reason: 'Doctor appointment' })
  check('with 24+ hours\' notice the cancel applies at once', r.status === 201 && r.json?.auto_applied === true && r.json?.status === 'approved' && !(await occurs(s, d)), r.json)
  check('…the request records why and how much notice', r.json?.cancel_reason === 'Doctor appointment' && /Applied at once: .*hours' notice/.test(r.json?.admin_notes || ''), r.json)
  check('…the caregiver is told in the app AND by push', (await notes(cgA.id, 'visit_cancelled')) === 1 && pushed(cgA.id, 'visit_cancelled') === 1)
  check('…and the office is told', (await notes(admin.id, 'visit_cancelled')) === 1)
  check('…the next week\'s visit is untouched', await occurs(s, addDays(d, 7)))
}

// ══ 3. less than 24 hours' notice: a late cancellation waits for the office ═════════════════════════
const soon = (h: number) => { const t = new Date(Date.now() + h * 3600000); return { d: ymd(t), s: hm(t), e: hm(new Date(t.getTime() + 3600000)) } }
const lateSlot = () => { for (const h of [3, 5, 8]) { const x = soon(h); if (x.e > x.s) return x } return soon(3) }
{
  const L = lateSlot()
  const s = await insSched({ caregiver_id: cgA.id, client_id: pat.id, date: L.d, start: L.s, end: L.e })
  const before = await notes(cgA.id, 'visit_cancel_request')
  const r = await asPortal('POST', '/api/portal/visits/cancel-request', { ...visit(s, L.d, L.s, L.e), reason: 'Feeling unwell' })
  check('with less than 24 hours\' notice the cancel waits for the office', r.status === 201 && r.json?.auto_applied === false && r.json?.status === 'pending' && await occurs(s, L.d), r.json)
  check('…the caregiver is told the client asked (app + push)', (await notes(cgA.id, 'visit_cancel_request')) === before + 1 && pushed(cgA.id, 'visit_cancel_request') >= 1)
  const officeNote = await q1(sql`SELECT title, message FROM notifications WHERE user_id = ${admin.id} AND type = 'visit_cancel_request' ORDER BY created_at DESC LIMIT 1`)
  check('…the office is told it needs a decision, with the reason', /Late Cancellation/.test(officeNote?.title || '') && /Feeling unwell/.test(officeNote?.message || ''), officeNote)
  const again = await asPortal('POST', '/api/portal/visits/cancel-request', { ...visit(s, L.d, L.s, L.e), reason: 'Still unwell' })
  check('…a second cancel of the same visit is refused while one waits', again.status === 409, again.json)
  const cgCancelledBefore = await notes(cgA.id, 'visit_cancelled')
  const ok = await as(admin)('PUT', `/api/visit-change-requests/${r.json.id}/resolve`, { action: 'approve' })
  check('the office approves: the visit leaves the schedule', ok.status === 200 && !(await occurs(s, L.d)), ok.json)
  check('…and the caregiver is told it is cancelled (app + push)', (await notes(cgA.id, 'visit_cancelled')) === cgCancelledBefore + 1 && pushed(cgA.id, 'visit_cancelled') >= 2)
}
{
  const L = lateSlot()
  const s = await insSched({ caregiver_id: cgA.id, client_id: pat.id, date: L.d, start: L.s, end: L.e })
  const r = await asPortal('POST', '/api/portal/visits/cancel-request', { ...visit(s, L.d, L.s, L.e), reason: 'Maybe' })
  const no = await as(admin)('PUT', `/api/visit-change-requests/${r.json.id}/resolve`, { action: 'deny', adminNotes: 'Too late to cancel' })
  check('the office denies a late cancel: the visit stands and the caregiver is told', no.status === 200 && await occurs(s, L.d) && (await notes(cgA.id, 'change_request_denied')) === 1)
}

// ══ 4. a visit that started, is over, or was worked cannot change from the portal ═════════════════
{
  const y = addDays(today, -1)
  const past = await insSched({ caregiver_id: cgA.id, client_id: pat.id, date: y, start: '09:30', end: '11:30' })
  const c1 = await asPortal('POST', '/api/portal/visits/cancel-request', { ...visit(past, y, '09:30', '11:30'), reason: 'Oops' })
  check('a past visit cannot be cancelled (409, call the office)', c1.status === 409 && /call the office/i.test(c1.json?.error || ''), c1.json)
  const r1 = await asPortal('POST', '/api/portal/visits/reschedule-request', { ...visit(past, y, '09:30', '11:30'), proposedDate: addDays(today, 2), proposedStartTime: '10:00', proposedEndTime: '12:00' })
  check('…nor moved', r1.status === 409, r1.json)

  const t = addDays(today, 1)
  const worked = await insSched({ caregiver_id: cgA.id, client_id: pat.id, date: t, start: '09:30', end: '11:30' })
  await q(sql`INSERT INTO time_entries (id, caregiver_id, client_id, start_time, end_time, is_complete, needs_approval, created_at, updated_at)
    VALUES ('te_pvc1', ${cgA.id}, ${pat.id}, ${`${t} 06:30:00`}::timestamp, ${`${t} 06:31:00`}::timestamp, true, false, NOW(), NOW())`)
  const c2 = await asPortal('POST', '/api/portal/visits/cancel-request', { ...visit(worked, t, '09:30', '11:30'), reason: 'Oops' })
  check('a visit the caregiver already clocked in for cannot be cancelled', c2.status === 409 && /clocked in/.test(c2.json?.error || ''), c2.json)
  check('…and nothing was filed for either', (await q1(sql`SELECT COUNT(*)::int AS n FROM visit_change_requests WHERE schedule_id IN (${past}, ${worked})`)).n === 0)

  const list = await asPortal('GET', '/api/portal/visits?limit=50')
  const w = list.json.find((v: any) => v.schedule_id === worked && v.scheduled_date === t)
  check('the visit list marks the worked visit can_change: false', w && w.can_change === false, w)
  const open = await insSched({ caregiver_id: cgA.id, client_id: pat.id, date: addDays(today, 6), start: '13:00', end: '14:00' })
  const list2 = await asPortal('GET', '/api/portal/visits?limit=50')
  const o = list2.json.find((v: any) => v.schedule_id === open)
  check('…and an upcoming untouched visit can_change: true', o && o.can_change === true, o)
  const pastList = await asPortal('GET', '/api/portal/visits?past=true&limit=50')
  const p = pastList.json.find((v: any) => v.schedule_id === past)
  check('…and a past visit can_change: false', p && p.can_change === false, p)
}

// ══ 5. My Caregivers: who serves the client NOW ═════════════════════════════════════════════════════
{
  // A's weekly pattern; B covers one upcoming day (an open-shift fill writes a per-day override).
  const d = addDays(today, 8)
  const s = await insSched({ caregiver_id: cgA.id, client_id: pat.id, day_of_week: dow(d), start: '09:30', end: '11:30', effective_date: today })
  await q(sql`INSERT INTO schedule_exceptions (id, schedule_id, exception_date, exception_type, override_caregiver_id, created_at)
    VALUES ('exc_pvc_b', ${s}, ${d}::date, 'modified', ${cgB.id}, NOW())`)
  // An old caregiver whose pattern ended last month: not serving now.
  await insSched({ caregiver_id: cgOld.id, client_id: pat.id, day_of_week: 1, start: '08:00', end: '09:00', effective_date: addDays(today, -90), end_date: addDays(today, -30) })
  const list = (await caregiversServingClient(pat.id, true)).map((r: any) => r.caregiver_id)
  check('a caregiver covering an upcoming visit is listed (Run 3: Caregiver B was missing)', list.includes(cgB.id), list)
  check('…alongside the pattern\'s own caregiver', list.includes(cgA.id), list)
  check('…and a caregiver whose pattern has ended is not', !list.includes(cgOld.id), list)
  check('the background-check gate follows the same list', (await servesClient(cgB.id, pat.id)) && !(await servesClient(cgOld.id, pat.id)))
}

// ══ 6. the reschedule picker's slots ════════════════════════════════════════════════════════════════
{
  // cgB serves Pat (section 5). Every day available, NO times recorded — the Run 3 case.
  await q(sql`INSERT INTO caregiver_availability (id, caregiver_id, status, max_hours_per_week,
      monday_available, tuesday_available, wednesday_available, thursday_available, friday_available, saturday_available, sunday_available)
    VALUES ('ca_pvc_b', ${cgB.id}, 'available', 40, true, true, true, true, true, true, true)`)
  const from = addDays(today, 2), to = addDays(today, 2)
  const r = await asPortal('GET', `/api/portal/caregivers/${cgB.id}/availability?startDate=${from}&endDate=${to}&durationMinutes=120`)
  const starts = (r.json || []).map((x: any) => `${x.startTime}-${x.endTime}`)
  check('availability with no times falls back to the 08:00–17:00 working day (not "no slots")', r.status === 200 && starts[0] === '08:00:00-10:00:00' && starts[starts.length - 1] === '15:00:00-17:00:00' && starts.length === 8, starts)

  // A visit B has for another client blocks that time.
  await insSched({ caregiver_id: cgB.id, client_id: sam.id, date: from, start: '10:30', end: '11:30' })
  const r2 = await asPortal('GET', `/api/portal/caregivers/${cgB.id}/availability?startDate=${from}&endDate=${to}&durationMinutes=60`)
  const s2 = (r2.json || []).map((x: any) => x.startTime)
  check('…a visit for another client takes its hours out', !s2.includes('10:00:00') && !s2.includes('11:00:00') && s2.includes('09:00:00') && s2.includes('12:00:00'), s2)

  await q(sql`UPDATE caregiver_availability SET ${sql.raw(['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][dow(from)])}_available = false WHERE caregiver_id = ${cgB.id}`)
  const r3 = await asPortal('GET', `/api/portal/caregivers/${cgB.id}/availability?startDate=${from}&endDate=${to}`)
  check('…a day marked unavailable has no slots', r3.status === 200 && r3.json.length === 0, r3.json)
  await q(sql`UPDATE caregiver_availability SET status = 'unavailable' WHERE caregiver_id = ${cgB.id}`)
  const r4 = await asPortal('GET', `/api/portal/caregivers/${cgB.id}/availability?startDate=${addDays(today, 1)}&endDate=${addDays(today, 7)}`)
  check('…a caregiver marked unavailable has none at all', r4.status === 200 && r4.json.length === 0, r4.json)

  // No availability row at all: the default week (Mon–Fri) on the default day.
  const wk = Array.from({ length: 7 }, (_, i) => addDays(today, 1 + i))
  const r5 = await asPortal('GET', `/api/portal/caregivers/${cgA.id}/availability?startDate=${wk[0]}&endDate=${wk[6]}`)
  const days = new Set((r5.json || []).map((x: any) => x.dayOfWeek))
  check('no availability row = Mon–Fri on the default day', r5.status === 200 && days.size > 0 && !days.has(0) && !days.has(6), [...days])
  const r6 = await asPortal('GET', `/api/portal/caregivers/${cgOther.id}/availability`)
  check('a caregiver who does not serve the client shows nothing', r6.status === 200 && r6.json.length === 0)
  const r7 = await asPortal('GET', `/api/portal/caregivers/${cgA.id}/availability?durationMinutes=5`)
  check('a nonsense duration is refused', r7.status === 400)
}

console.log(`\nhomecare-portal-visit-changes: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
