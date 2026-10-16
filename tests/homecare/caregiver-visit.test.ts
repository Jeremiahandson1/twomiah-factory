// crm-homecare — Run 3, the caregiver app (HIGH 7 and the caregiver-phone items):
//   1. the client card's Medications reads the medications table (the MAR list), not only the
//      client record's free-text box — "None on file" was printed beside a real medication;
//   2. a refused care task carries the client's reason (server refuses a bare "refused");
//   3. Report Miss lists only visits that can still be called out of: no clock-in for it, and not
//      one of today's that already ended; a worked visit is refused by the server too;
//   4. one open swap per visit day (the "Swap sent" state has a server behind it);
//   5. the active visit records a dose, vitals and a photo mid-visit, and the screens are wired;
//   6. a bare TIME ("09:30:00") prints as "9:30 AM".
// The clock is PINNED (bun:test setSystemTime) to noon UTC of today, the agency's zone is UTC, so
// "already ended today" means the same thing at any hour the suite runs.
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { readFileSync } from 'node:fs'
import { setSystemTime } from 'bun:test'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { agencies, users, clients } from './db/schema.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 500)) }
}
const q = async (s: any) => { const r: any = await db.execute(s); return (r?.rows ?? r) as any[] }

process.env.JWT_SECRET = process.env.JWT_SECRET || 'cgvisit-test-secret'
delete process.env.AGENCY_TIMEZONE
await setupSchema()

const ROOT = (process.env.FACTORY_ROOT || '') + 'templates/crm-homecare/'
const src = (p: string) => readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n')

const ymd = (d: Date) => d.toISOString().slice(0, 10)
const addDays = (s: string, k: number) => ymd(new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10) + k)))
const dow = (s: string) => new Date(`${s}T12:00:00Z`).getUTCDay()
const TODAY = ymd(new Date())
setSystemTime(new Date(`${TODAY}T12:00:00Z`))

await db.insert(agencies).values({ name: 'Visit Care', slug: 'cgvisit', state: 'WI', timezone: 'UTC' } as any).returning()
const mkUser = async (role: string, tag: string) => (await db.insert(users).values({
  email: `${tag}-cgv@test.local`, passwordHash: 'x', firstName: tag, lastName: 'Tester', role,
} as any).returning())[0]
const admin = await mkUser('admin', 'admin')
const cg1 = await mkUser('caregiver', 'cgone')
const cg2 = await mkUser('caregiver', 'cgtwo')
const mkClient = async (first: string, extra: Record<string, unknown> = {}) => (await db.insert(clients).values({ firstName: first, lastName: 'Client', ...extra } as any).returning())[0]

const app = new Hono()
for (const [mount, file] of [
  ['/api/clients', 'clients'],
  ['/api/care-tasks', 'careTasks'],
  ['/api/medications', 'medications'],
  ['/api/time-entries', 'timeTracking'],
  ['/api/emergency', 'emergency'],
  ['/api/shift-swaps', 'shiftSwaps'],
] as const) {
  app.route(mount, (await import(`./src/routes/${file}.ts`)).default)
}
const call = (headers: Record<string, string>) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}
const as = (who: any) => call({ 'x-test-user': who.id, 'x-test-role': who.role, 'x-test-email': who.email })
const A = as(admin), CG1 = as(cg1), CG2 = as(cg2)

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

const pat = await mkClient('Pat', { medications: JSON.stringify(['Aspirin 81mg', 'Lisinopril']) })
const sam = await mkClient('Sam')
const zed = await mkClient('Zed')
await insSched({ caregiver_id: cg1.id, client_id: pat.id, day_of_week: dow(TODAY), start: '14:00', end: '15:00', effective_date: addDays(TODAY, -21) })
await insSched({ caregiver_id: cg2.id, client_id: zed.id, day_of_week: dow(TODAY), start: '08:00', end: '09:00', effective_date: addDays(TODAY, -21) })

// ══ 1. the client card's medications ═════════════════════════════════════════════════════════════
{
  await q(sql`INSERT INTO medications (id, client_id, name, dosage, frequency, status) VALUES
    ('m_lis', ${pat.id}, 'Lisinopril', '10 mg', 'daily', 'active'),
    ('m_old', ${pat.id}, 'Warfarin', '5 mg', 'daily', 'discontinued')`)
  const v = await CG1('GET', `/api/clients/${pat.id}/caregiver-view`)
  check('1. the card lists the active medication from the Medications page (the MAR list)',
    v.status === 200 && /^Lisinopril · 10 mg · daily$/m.test(v.json.medications || ''), v.json?.medications)
  // Run 4: ONE source. With medication rows on file the client record's free-text box is not
  // printed beside them (it listed the same medicine a second time); it is the card's text only for
  // a client with no rows (r4-care.test.ts).
  check('1. …and ONLY the Medications list when it has rows — not the client record\'s free-text lines too',
    (v.json.medications || '').split('\n').join('|') === 'Lisinopril · 10 mg · daily' && v.json.medications_source === 'medications', v.json)
  check('1. …never a discontinued one', !/Warfarin/.test(v.json.medications || ''), v.json?.medications)
  const none = await A('GET', `/api/clients/${sam.id}/caregiver-view`)
  check('1. a client with none on file is null (the card prints "None on file")', none.status === 200 && none.json.medications === null, none.json)
}

// ══ 2. a refused task carries the reason ═════════════════════════════════════════════════════════
{
  const [task] = await q(sql`INSERT INTO client_task_templates (id, client_id, task_name, category, allotted_minutes, is_active, sort_order)
    VALUES ('tt_bath', ${pat.id}, 'Bathing', 'adl', 30, true, 0) RETURNING id`)
  await q(sql`INSERT INTO time_entries (id, caregiver_id, client_id, start_time, end_time, is_complete)
    VALUES ('te_tasks', ${cg1.id}, ${pat.id}, ${addDays(TODAY, -1)}::date + TIME '14:00', ${addDays(TODAY, -1)}::date + TIME '15:00', true)`)
  const bare = await CG1('PUT', `/api/care-tasks/time-entry/te_tasks/${task.id}`, { status: 'refused', notes: null })
  check('2. "refused" with no reason is refused, and the server says what to do', bare.status === 400 && /why the client refused/i.test(bare.json?.error || ''), bare)
  const blank = await CG1('PUT', `/api/care-tasks/time-entry/te_tasks/${task.id}`, { status: 'refused', notes: '   ' })
  check('2. …a blank reason is no reason', blank.status === 400, blank)
  const ok = await CG1('PUT', `/api/care-tasks/time-entry/te_tasks/${task.id}`, { status: 'refused', notes: 'Said she would shower tomorrow' })
  check('2. with the reason it is recorded', ok.status === 200 && ok.json.status === 'refused' && ok.json.notes === 'Said she would shower tomorrow', ok.json)
  const skipped = await CG1('PUT', `/api/care-tasks/time-entry/te_tasks/${task.id}`, { status: 'skipped' })
  check('2. other statuses still need no note', skipped.status === 200, skipped)
  const ui = src('frontend/src/components/CareTaskChecklist.tsx')
  check('2. the checklist\'s Refused button opens the reason dialog (not a bare PUT)', /onClick=\{\(\) => openNotes\(t, 'refuse'\)\}[^]*?>Refused</.test(ui) && !/setStatus\(t\.task_id, 'refused'/.test(ui))
  check('2. …which requires a reason and keeps itself open with the server\'s message', /refusing && !notesDraft\.trim\(\)/.test(ui) && /if \(msg\) \{ setNotesError\(msg\); return; \}/.test(ui))
}

// ══ 3. Report Miss: only visits that can still be called out of ══════════════════════════════════
{
  const ended = await insSched({ caregiver_id: cg1.id, client_id: sam.id, date: TODAY, start: '09:30', end: '11:30' })
  const worked = await insSched({ caregiver_id: cg1.id, client_id: zed.id, date: TODAY, start: '13:00', end: '16:00' })
  const ahead = await insSched({ caregiver_id: cg1.id, client_id: sam.id, date: TODAY, start: '17:00', end: '18:00' })
  const overnight = await insSched({ caregiver_id: cg1.id, client_id: sam.id, date: TODAY, start: '22:00', end: '06:00' })
  const tomorrow = await insSched({ caregiver_id: cg1.id, client_id: sam.id, date: addDays(TODAY, 1), start: '09:30', end: '11:30' })
  // cg1 clocked in to Zed's 13:00 visit at 12:55 (still in it at the pinned noon? no — the punch is what counts)
  await q(sql`INSERT INTO time_entries (id, caregiver_id, client_id, start_time, is_complete)
    VALUES ('te_worked', ${cg1.id}, ${zed.id}, ${TODAY}::date + TIME '11:55', false)`)
  const r = await CG1('GET', '/api/emergency/my-shifts')
  const ids = (r.json || []).map((s: any) => s.id)
  check('3. today\'s visit that already ended (09:30–11:30 at noon) is not offered', r.status === 200 && !ids.includes(ended), r.json)
  check('3. a visit with a clock-in for it is not offered', !ids.includes(worked), ids)
  check('3. today\'s later visit, the overnight one and tomorrow\'s are offered', ids.includes(ahead) && ids.includes(overnight) && ids.includes(tomorrow), ids)
  const refuse = await CG1('POST', '/api/emergency/miss-report', { scheduleId: worked, date: TODAY, reason: 'Sick' })
  check('3. the server refuses a call-out of a worked visit (409, with the reason)', refuse.status === 409 && /already worked/.test(refuse.json?.error || ''), refuse)
  check('3. …and cancelled nothing', (await q(sql`SELECT 1 FROM schedule_exceptions WHERE schedule_id = ${worked}`)).length === 0)
  const fine = await CG1('POST', '/api/emergency/miss-report', { scheduleId: ahead, date: TODAY, reason: 'Sick' })
  check('3. a visit still ahead is called out of as before', fine.status === 201, fine)
  const form = src('frontend/src/components/caregiver/ShiftMissReport.tsx')
  check('3. the form prints times through formatTime (no "09:30:00")', /\{formatTime\(shift\.start_time\)\} – \{formatTime\(shift\.end_time\)\}/.test(form) && !/\{shift\.start_time\} – \{shift\.end_time\}/.test(form))
}

// ══ 4. one open swap per visit day ═══════════════════════════════════════════════════════════════
{
  const s = await insSched({ caregiver_id: cg1.id, client_id: pat.id, date: addDays(TODAY, 4), start: '10:00', end: '11:00' })
  const first = await CG1('POST', '/api/shift-swaps', { scheduleId: s, shiftDate: addDays(TODAY, 4), targetCaregiverId: cg2.id })
  check('4. a swap request is sent', first.status === 201 && first.json.status === 'pending', first)
  const again = await CG1('POST', '/api/shift-swaps', { scheduleId: s, shiftDate: addDays(TODAY, 4), targetCaregiverId: cg2.id })
  check('4. a second one for the same visit day is refused (409) while the first is open', again.status === 409 && again.json?.swap?.id === first.json.id, again)
  await CG2('PUT', `/api/shift-swaps/${first.json.id}/respond`, { accepted: true })
  check('4. …still refused once the coworker accepted (waiting on the office)', (await CG1('POST', '/api/shift-swaps', { scheduleId: s, shiftDate: addDays(TODAY, 4), targetCaregiverId: cg2.id })).status === 409)
  await A('PUT', `/api/shift-swaps/${first.json.id}/reject`, { reason: 'no' })
  check('4. after the office turns it down a new request may be sent', (await CG1('POST', '/api/shift-swaps', { scheduleId: s, shiftDate: addDays(TODAY, 4), targetCaregiverId: cg2.id })).status === 201)
  const dash = src('frontend/src/components/CaregiverDashboard.tsx')
  check('4. the Swap button turns into "Swap sent" for an open swap of that day', /swapPendingFor\(s\) \? \([^]*?Swap sent/.test(dash) && /r\.status === 'pending' \|\| r\.status === 'accepted'/.test(dash))
  check('5a. Claim: every Claim button is disabled while one is in flight, and the card shows the claim', /disabled=\{!!claimingShiftId\}/.test(dash) && /claimedShifts\[shift\.id\] \? \(/.test(dash) && /if \(claimingShiftId\) return;/.test(dash))
}

// ══ 5. the active visit: a dose, vitals, a photo — mid-visit ═════════════════════════════════════
{
  await q(sql`INSERT INTO time_entries (id, caregiver_id, client_id, start_time, is_complete)
    VALUES ('te_active', ${cg2.id}, ${zed.id}, ${TODAY}::date + TIME '11:00', false)`)
  await q(sql`INSERT INTO medications (id, client_id, name, status) VALUES ('m_zed', ${zed.id}, 'Metformin', 'active')`)
  const due = await CG2('GET', `/api/medications/due/${zed.id}`)
  check('5. the visit lists the client\'s active medications', due.status === 200 && due.json.some((m: any) => m.id === 'm_zed'), due)
  const dose = await CG2('POST', '/api/medications/log', { medicationId: 'm_zed', clientId: zed.id, timeEntryId: 'te_active', status: 'given' })
  check('5. the caregiver records a dose against this visit', dose.status === 201 && dose.json.timeEntryId === 'te_active', dose)
  const logs = await CG2('GET', '/api/medications/logs/time-entry/te_active')
  check('5. …and the visit reads it back', logs.status === 200 && logs.json.length === 1 && logs.json[0].status === 'given', logs)
  const vit = await CG2('POST', '/api/medications/vitals', { clientId: zed.id, timeEntryId: 'te_active', pulse: '72', systolicBp: '120', diastolicBp: '80' })
  check('5. records vitals against this visit', vit.status === 201, vit)
  const bad = await CG2('POST', '/api/medications/vitals', { clientId: zed.id, timeEntryId: 'te_active', pulse: '900' })
  check('5. an implausible reading is refused with the reason the screen shows', bad.status === 400 && /Pulse 900/.test(bad.json?.error || ''), bad)
  const img = 'data:image/jpeg;base64,' + 'A'.repeat(200)
  const ph = await CG2('POST', '/api/time-entries/te_active/photos', { imageBase64: img, caption: 'Lunch', category: 'task' })
  check('5. uploads a photo while still clocked in', ph.status === 201 && ph.json.caption === 'Lunch', ph)
  check('5. another caregiver cannot add to this visit', (await CG1('POST', '/api/time-entries/te_active/photos', { imageBase64: img })).status === 403)
  const dash = src('frontend/src/components/CaregiverDashboard.tsx')
  const panel = src('frontend/src/components/caregiver/VisitCarePanel.tsx')
  check('5. the active visit renders the panel with the visit and its client', /<VisitCarePanel timeEntryId=\{activeSession\.id\} clientId=\{activeSession\.client_id\} \/>/.test(dash))
  check('5. …which posts the dose, the vitals and the photo to those routes',
    /'\/api\/medications\/log'/.test(panel) && /'\/api\/medications\/vitals'/.test(panel) && /`\/api\/time-entries\/\$\{timeEntryId\}\/photos`/.test(panel) && /`\/api\/medications\/due\/\$\{clientId\}`/.test(panel))
}

// ══ 6. a bare time prints as a clock time ═══════════════════════════════════════════════════════
{
  const { formatTime } = await import(ROOT + 'frontend/src/utils/datetime.ts')
  check('6. "09:30:00" → "9:30 AM", "13:05" → "1:05 PM", "00:00:00" → "12:00 AM"',
    formatTime('09:30:00') === '9:30 AM' && formatTime('13:05') === '1:05 PM' && formatTime('00:00:00') === '12:00 AM' && formatTime('25:00') === '', [formatTime('09:30:00'), formatTime('13:05'), formatTime('00:00:00')])
}

setSystemTime()
console.log(`\nhomecare-caregiver-visit: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
