// Twomiah Care — the home care caregiver app (apps/mobile, APP_VARIANT=care).
//
// The pure logic the screens stand on, run under plain bun (no React Native):
//   · the offline punch queue (apps/mobile/src/care/offlinePunches.ts) — a tap with no signal is
//     saved with the TAP time and replayed in order, a clock-out never before its clock-in, a refused
//     punch dropped and reported, a still-unreachable one kept;
//   · the schedule expansion (src/care/schedule.ts) — the server engine's rules on the phone;
//   · the Sandata EVV prompt decisions (src/care/sandata.ts);
//   · the clock-in guard, geofence verdict, payday snooze and signature image (src/care/rules.ts);
//   · the `care` variant in app.config.ts and eas.json, and the homecare tab set.
//
//   bun run tests/mobile/care-app.test.ts
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { createPunchQueue, isUnreachable, isOfflineId, type KV, type PunchSender } from '../../apps/mobile/src/care/offlinePunches.ts'
import { expandVisits, nextUp, isBiweeklyOn, totalHours, type ScheduleRow } from '../../apps/mobile/src/care/schedule.ts'
import { needsSandata, visitNeedsSandata, evvWeekMet, medicaidIdOf, sandataAfterPunch, showSandataNotice, smcLinks } from '../../apps/mobile/src/care/sandata.ts'
import { clockInBlocker, clockOutNoteBlocker, geofenceVerdict, haversineFeet, showPayday, snoozePayday, PAYDAY_SNOOZE_MS, base64Utf8, signatureDataUri, hasInk, contrast, readableOn } from '../../apps/mobile/src/care/rules.ts'
import { addDaysYmd, dowOfYmd, formatTime12, shiftMinutes } from '../../apps/mobile/src/care/time.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)) }
}

const memKV = (): KV & { data: Map<string, string> } => {
  const data = new Map<string, string>()
  return { data, getItem: async (k) => data.get(k) ?? null, setItem: async (k, v) => { data.set(k, v) } }
}

// A fake server: records every POST; answers from a script.
function fakeServer(answer: (path: string, body: any) => { status: number; data: any }) {
  const calls: { path: string; body: any }[] = []
  const send: PunchSender = async (path, body) => { calls.push({ path, body }); return answer(path, body) }
  return { calls, send }
}

console.log('offline punch queue')
{
  check('status 0 / 502 / 503 / 504 are "never reached the server"', [0, 502, 503, 504].every((s) => isUnreachable(s)) && ![200, 400, 409, 500].some((s) => isUnreachable(s)))
  check('offline visit ids are recognisable', isOfflineId('offline-abc') && !isOfflineId('cl123'))

  const q = createPunchQueue(memKV())
  await q.save({ localId: 'in1', userId: 'u1', kind: 'in', at: '2026-10-15T14:10:00.000Z', clientId: 'c1', latitude: 44.8, longitude: -91.5 })
  const sess = await q.offlineSession('u1')
  check('a saved clock-in is the open visit on the phone', sess?.id === 'offline-in1' && sess.client_id === 'c1' && sess.start_time === '2026-10-15T14:10:00.000Z', sess)
  check('another caregiver on the same phone does not see it', (await q.offlineSession('u2')) === null && (await q.count('u2')) === 0)

  await q.save({ localId: 'out1', userId: 'u1', kind: 'out', at: '2026-10-15T16:00:00.000Z', inLocalId: 'in1', notes: 'Bathed, lunch' })
  check('a saved clock-out closes the saved visit', (await q.offlineSession('u1')) === null)

  // Still no signal: nothing is lost, order kept.
  const dead = fakeServer(() => ({ status: 0, data: null }))
  const r0 = await q.flush({ userId: 'u1', send: dead.send })
  check('no signal: nothing sent, nothing dropped, stops at the first punch', r0.sent === 0 && r0.rejected.length === 0 && dead.calls.length === 1 && (await q.count('u1')) === 2, { r0, calls: dead.calls.length })

  // A server error is also "try again later".
  const down = fakeServer(() => ({ status: 500, data: { error: 'boom' } }))
  await q.flush({ userId: 'u1', send: down.send })
  check('a 5xx keeps the punches for later', (await q.count('u1')) === 2)
  const unauth = fakeServer(() => ({ status: 401, data: {} }))
  await q.flush({ userId: 'u1', send: unauth.send })
  check('a 401 keeps the punches (sign-in, then they send)', (await q.count('u1')) === 2)

  // Signal back: the clock-in goes first with its TAP time, then the clock-out against the new entry.
  const up = fakeServer((path) => path.endsWith('/clock-in') ? { status: 201, data: { id: 'te_9', client_id: 'c1' } } : { status: 200, data: { id: 'te_9' } })
  const r1 = await q.flush({ userId: 'u1', send: up.send })
  check('both punches sent', r1.sent === 2 && r1.rejected.length === 0, r1)
  check('clock-in first, with offlineAt = the tap time and the GPS fix', up.calls[0].path === '/api/time-entries/clock-in'
    && up.calls[0].body.offlineAt === '2026-10-15T14:10:00.000Z' && up.calls[0].body.clientId === 'c1' && up.calls[0].body.latitude === 44.8, up.calls[0])
  check('clock-out second, against the entry the clock-in became, with its own tap time and note',
    up.calls[1].path === '/api/time-entries/te_9/clock-out' && up.calls[1].body.offlineAt === '2026-10-15T16:00:00.000Z' && up.calls[1].body.notes === 'Bathed, lunch', up.calls[1])
  check('queue empty afterwards', (await q.count('u1')) === 0)
}
{
  // A clock-out saved while its clock-in had ALREADY synced (it remembers the entry id).
  const q = createPunchQueue(memKV())
  await q.save({ localId: 'inA', userId: 'u1', kind: 'in', at: '2026-10-15T14:00:00.000Z', clientId: 'c1' })
  const s1 = fakeServer(() => ({ status: 201, data: { id: 'te_A' } }))
  await q.flush({ userId: 'u1', send: s1.send })
  await q.save({ localId: 'outA', userId: 'u1', kind: 'out', at: '2026-10-15T15:00:00.000Z', inLocalId: 'inA', notes: 'x' })
  const s2 = fakeServer(() => ({ status: 200, data: {} }))
  const r = await q.flush({ userId: 'u1', send: s2.send })
  check('a later clock-out finds its synced visit by the remembered id', r.sent === 1 && s2.calls[0]?.path === '/api/time-entries/te_A/clock-out', s2.calls)
}
{
  // The server answers no to the clock-in (e.g. overlaps recorded time): drop it AND its clock-out, report it.
  const q = createPunchQueue(memKV())
  await q.save({ localId: 'inB', userId: 'u1', kind: 'in', at: '2026-10-15T14:00:00.000Z', clientId: 'c1' })
  await q.save({ localId: 'outB', userId: 'u1', kind: 'out', at: '2026-10-15T15:00:00.000Z', inLocalId: 'inB' })
  const s = fakeServer(() => ({ status: 409, data: { error: 'Your saved clock-in overlaps time already recorded — the office has been notified to fix it.', code: 'offline_conflict' } }))
  const r = await q.flush({ userId: 'u1', send: s.send })
  check('a refused clock-in is dropped with the server\'s reason', r.rejected.length === 1 && r.rejected[0].punch.localId === 'inB' && /overlaps/.test(r.rejected[0].error), r)
  check('its clock-out is dropped too (nothing to close)', (await q.count('u1')) === 0 && s.calls.length === 1)
}
{
  // A clock-out for a visit that reached the server, saved when the clock-out itself had no signal.
  const q = createPunchQueue(memKV())
  await q.save({ localId: 'outC', userId: 'u1', kind: 'out', at: '2026-10-15T15:00:00.000Z', entryId: 'te_C', inLocalId: null, notes: 'n' })
  const s = fakeServer(() => ({ status: 200, data: {} }))
  const r = await q.flush({ userId: 'u1', send: s.send })
  check('a clock-out with a known entry goes straight to that entry', r.sent === 1 && s.calls[0].path === '/api/time-entries/te_C/clock-out' && s.calls[0].body.offlineAt === '2026-10-15T15:00:00.000Z')
}
{
  // A clock-out whose clock-in vanished (never recorded) is reported, not sent anywhere.
  const q = createPunchQueue(memKV())
  await q.save({ localId: 'outD', userId: 'u1', kind: 'out', at: '2026-10-15T15:00:00.000Z', inLocalId: 'gone' })
  const s = fakeServer(() => ({ status: 200, data: {} }))
  const r = await q.flush({ userId: 'u1', send: s.send })
  check('an orphan clock-out is reported and removed, not sent', r.rejected.length === 1 && s.calls.length === 0 && (await q.count('u1')) === 0, r)
}
{
  // Two taps saved at the same instant (AsyncStorage is async): neither may overwrite the other.
  const q = createPunchQueue(memKV())
  await Promise.all([
    q.save({ localId: 'p1', userId: 'u1', kind: 'in', at: '2026-10-15T14:00:00.000Z', clientId: 'c1' }),
    q.save({ localId: 'p2', userId: 'u1', kind: 'out', at: '2026-10-15T15:00:00.000Z', inLocalId: 'p1' }),
  ])
  check('concurrent saves both land, in order', (await q._readAll()).map((p) => p.localId).join(',') === 'p1,p2')
  // A write the phone refuses is reported as not saved.
  const broken: KV = { getItem: async () => '[]', setItem: async () => { throw new Error('quota') } }
  const qb = createPunchQueue(broken)
  check('a refused write returns false (the screen then says "call the office")', (await qb.save({ localId: 'z', userId: 'u1', kind: 'in', at: 'x', clientId: 'c' })) === false)
}

console.log('schedule expansion (server engine rules on the phone)')
{
  const MON = '2026-10-12' // a Monday
  check('fixture: 2026-10-12 is a Monday', dowOfYmd(MON) === 1)
  const base = (o: Partial<ScheduleRow>): ScheduleRow => ({
    id: 's', caregiver_id: 'me', client_id: 'c1', day_of_week: 1, date: null, start_time: '09:00:00', end_time: '12:00:00',
    client_first_name: 'Ann', client_last_name: 'Lee', exceptions: [], ...o,
  })
  const weekly = expandVisits([base({})], MON, 14)
  check('weekly Monday → two Mondays in 14 days', weekly.length === 2 && weekly[0].date === MON && weekly[1].date === '2026-10-19', weekly.map((v) => v.date))
  check('visit carries client name and times', weekly[0].clientName === 'Ann Lee' && weekly[0].startTime === '09:00:00')

  const bi = expandVisits([base({ frequency: 'biweekly', anchor_date: '2026-10-05' })], MON, 21)
  check('bi-weekly on the anchor fortnight (anchor Oct 5 → Oct 19, Nov 2; not Oct 12, 26)', bi.map((v) => v.date).join(',') === '2026-10-19', bi.map((v) => v.date))
  check('"bi-weekly" spelling counts too', expandVisits([base({ frequency: 'bi-weekly', anchor_date: '2026-10-12' })], MON, 14).length === 1)
  check('bi-weekly parity floors a date before the anchor', isBiweeklyOn('2026-10-04', '2026-10-05') === false && isBiweeklyOn('2026-09-28', '2026-10-05') === false && isBiweeklyOn('2026-09-21', '2026-10-05') === true)

  check('effective_date bounds a recurring row', expandVisits([base({ effective_date: '2026-10-15' })], MON, 14).map((v) => v.date).join() === '2026-10-19')
  check('end_date bounds a recurring row', expandVisits([base({ end_date: '2026-10-15' })], MON, 14).map((v) => v.date).join() === MON)
  check('suspended_from stops it', expandVisits([base({ suspended_from: '2026-10-13' })], MON, 14).map((v) => v.date).join() === MON)
  check('a cancelled date does not exist', expandVisits([base({ exceptions: [{ exception_date: MON, exception_type: 'cancelled' }] })], MON, 14).map((v) => v.date).join() === '2026-10-19')
  const mod = expandVisits([base({ exceptions: [{ exception_date: MON, exception_type: 'modified', override_start_time: '10:00:00', override_end_time: '13:00:00' }] })], MON, 7)
  check('a modified date takes its override times', mod[0].startTime === '10:00:00' && mod[0].endTime === '13:00:00', mod[0])
  check('a date moved to another caregiver is not mine', expandVisits([base({ exceptions: [{ exception_date: MON, exception_type: 'modified', override_caregiver_id: 'other' }] })], MON, 7).length === 0)
  const moved = expandVisits([base({ exceptions: [{ exception_date: MON, exception_type: 'modified', override_client_id: 'c2' }] })], MON, 7, { c2: 'Bea Ray' })
  check('a date moved to another client shows that client', moved[0].clientId === 'c2' && moved[0].clientName === 'Bea Ray' && moved[0].clientAddress === null, moved[0])

  const oneTime = base({ id: 'o', day_of_week: null, date: '2026-10-14', effective_date: '2026-11-01' })
  check('a one-time row is its own date (effective_date ignored)', expandVisits([oneTime], MON, 7).map((v) => v.date).join() === '2026-10-14')
  check('a one-time row outside the window is skipped', expandVisits([oneTime], '2026-10-20', 7).length === 0)
  check('a row with no times is not a visit', expandVisits([base({ start_time: null })], MON, 7).length === 0)
  const own = base({ id: 'own', day_of_week: 1 })
  const cover = base({ id: 'cov', day_of_week: null, date: MON, moved_in: true })
  check('a moved-in shift identical to my own is shown once', expandVisits([own, cover], MON, 1).length === 1)
  check('a moved-in shift on its own is shown, flagged', expandVisits([cover], MON, 1)[0]?.movedIn === true)
  const sorted = expandVisits([base({ id: 'b', start_time: '13:00:00', end_time: '14:00:00' }), base({ id: 'a' })], MON, 1)
  check('sorted by start time', sorted.map((v) => v.scheduleId).join() === 'a,b')
  check('hours total (incl. overnight wrap)', totalHours(expandVisits([base({ start_time: '22:00:00', end_time: '02:00:00' })], MON, 1)) === 4 && shiftMinutes('22:00', '02:00') === 240)

  const day = expandVisits([base({ id: 'a' }), base({ id: 'b', client_id: 'c2', start_time: '13:00:00', end_time: '15:00:00' })], MON, 1)
  check('next up: before 9 → next/starting soon', nextUp(day, 8 * 60 + 40).state === 'starting_soon' && nextUp(day, 7 * 60).state === 'next')
  check('next up: during a visit not clocked in → due now', nextUp(day, 10 * 60).state === 'due_now')
  check('next up: clocked in → in progress; past end → overdue', nextUp(day, 10 * 60, 'c1').state === 'in_progress' && nextUp(day, 12 * 60 + 30, 'c1').state === 'overdue')
  check('next up: between visits → the afternoon one', (() => { const n = nextUp(day, 12 * 60 + 15); return n.state === 'next' && n.visit.clientId === 'c2' })())
  check('next up: after the last → done; no visits → none', nextUp(day, 16 * 60).state === 'done' && nextUp([], 600).state === 'none')
  check('time helpers', formatTime12('13:05:00') === '1:05 PM' && formatTime12('00:30') === '12:30 AM' && addDaysYmd('2026-12-31', 1) === '2027-01-01')
}

console.log('Sandata EVV prompts')
{
  const inS = { id: 'c1', first_name: 'Ann', last_name: 'Lee', in_sandata: true, medicaid_id: '1234567890' }
  const notS = { id: 'c2', first_name: 'Bo', in_sandata: false, medicaid_id: null }
  check('in_sandata is the server\'s call', needsSandata(inS) && !needsSandata(notS) && !needsSandata(null))
  check('visit needs Sandata: unknown (offline) → prompt', visitNeedsSandata(inS, null) && visitNeedsSandata(inS, undefined) && visitNeedsSandata(inS, true))
  check('visit needs Sandata: this week\'s EVV hours met → no', visitNeedsSandata(inS, false) === false && evvWeekMet(inS, false) === true)
  check('a client not in Sandata never prompts', !visitNeedsSandata(notS, true) && !evvWeekMet(notS, false))
  const after = sandataAfterPunch('in', inS, null)
  check('after a clock-in: prompt with the client\'s name', after?.type === 'prompt' && after.kind === 'in' && after.clientName === 'Ann Lee', after)
  check('after a clock-in with EVV hours met: the "no Sandata" notice', sandataAfterPunch('in', inS, false)?.type === 'week_met')
  check('after a clock-out with EVV hours met: nothing', sandataAfterPunch('out', inS, false) === null)
  check('after a punch for a non-Sandata client: nothing', sandataAfterPunch('in', notS, null) === null)
  check('Medicaid ID only when it looks like one', medicaidIdOf(inS) === '1234567890' && medicaidIdOf({ id: 'x', medicaid_id: 'ABC' }) === null)
  const ctx = { sandataAgencyId: null, clients: [notS], activeVisit: null }
  check('one-time notice only for a caregiver with a client in Sandata, until dismissed',
    !showSandataNotice(ctx, false) && showSandataNotice({ ...ctx, clients: [inS] }, false) && !showSandataNotice({ ...ctx, clients: [inS] }, true) && !showSandataNotice(null, false))
  check('"Open Sandata" goes to Sandata Mobile Connect\'s store page per platform',
    smcLinks('ios')[0].includes('apps.apple.com') && smcLinks('android')[0].startsWith('market://') && smcLinks('android')[1].includes('play.google.com'))
  const sandataSrc = readFileSync(join(import.meta.dir, '../../apps/mobile/src/care/sandata.ts'), 'utf8') + readFileSync(join(import.meta.dir, '../../apps/mobile/src/care/components/Sandata.tsx'), 'utf8')
  check('no state or agency hard-coded in the Sandata code (Wisconsin, agency ids, phone numbers)', !/wisconsin|\b95685\b|833-?931|chippewa|cvhc|my choice/i.test(sandataSrc))
}

console.log('clock-in guard, geofence, payday, signature')
{
  check('a second open visit is refused', /still clocked in with Ann Lee/.test(clockInBlocker({ clientId: 'c2', active: { id: 'te1', client_id: 'c1' }, activeClientName: 'Ann Lee' }) || ''))
  check('an offline open visit is refused too', !!clockInBlocker({ clientId: 'c2', active: { id: 'offline-x', client_id: 'c1', offline: true } }))
  check('no client picked → refused; busy → refused; else allowed',
    !!clockInBlocker({ clientId: '', active: null }) && !!clockInBlocker({ clientId: 'c1', active: null, busy: true }) && clockInBlocker({ clientId: 'c1', active: null }) === null)
  check('offline clock-out needs a note; online does not', !!clockOutNoteBlocker({ offline: true, note: ' ' }) && clockOutNoteBlocker({ offline: true, note: 'ok' }) === null && clockOutNoteBlocker({ offline: false, note: '' }) === null)

  const home = { lat: 44.8113, lng: -91.4985 }
  check('haversine: ~0.001° lat ≈ 365 ft', Math.abs(haversineFeet(home.lat, home.lng, home.lat + 0.001, home.lng) - 364.8) < 2)
  const near = geofenceVerdict({ fix: { latitude: home.lat + 0.0005, longitude: home.lng, accuracy: 10 }, clientLat: home.lat, clientLng: home.lng, radiusFeet: 300 })
  const far = geofenceVerdict({ fix: { latitude: home.lat + 0.01, longitude: home.lng, accuracy: 10 }, clientLat: home.lat, clientLng: home.lng, radiusFeet: 300 })
  check('inside the radius / outside it', near.status === 'inside' && far.status === 'outside' && 'distanceFeet' in far && far.distanceFeet > 3000, { near, far })
  check('a fuzzy fix whose error circle reaches the radius counts as inside',
    geofenceVerdict({ fix: { latitude: home.lat + 0.0012, longitude: home.lng, accuracy: 50 }, clientLat: home.lat, clientLng: home.lng, radiusFeet: 300 }).status === 'inside')
  check('no fix / no client location → unknown (never blocks)', geofenceVerdict({ fix: null, clientLat: 1, clientLng: 1 }).status === 'unknown'
    && geofenceVerdict({ fix: { latitude: 1, longitude: 1 }, clientLat: null, clientLng: null }).status === 'unknown')
  check('radius defaults to 300 ft', (geofenceVerdict({ fix: { latitude: home.lat, longitude: home.lng }, clientLat: home.lat, clientLng: home.lng }) as any).radiusFeet === 300)

  const pend = { payPeriodStart: '2026-10-04', payPeriodEnd: '2026-10-10' }
  const now = Date.UTC(2026, 9, 15, 15)
  check('payday card shows when pending, never when the agency has it off (pending null)', showPayday(pend, null, now) && !showPayday(null, null, now))
  const sn = snoozePayday(pend, now)
  check('"Remind me later" hides it for 4 hours, for THIS period only',
    !showPayday(pend, sn, now + 1000) && showPayday(pend, sn, now + PAYDAY_SNOOZE_MS + 1) && showPayday({ payPeriodStart: '2026-10-11', payPeriodEnd: '2026-10-17' }, sn, now + 1000))
  const shiftsTsx = readFileSync(join(import.meta.dir, '../../apps/mobile/app/(tabs)/time-clock.tsx'), 'utf8')
  check('the clock screen never renders the payday prompt (it can\'t block clocking in)', !/payday/i.test(shiftsTsx))

  const samples = ['', 'a', 'ab', 'abc', 'Zoë — ✓ 🙂', '<svg xmlns="http://www.w3.org/2000/svg"/>']
  check('base64Utf8 matches Buffer for ASCII, accents, emoji', samples.every((s) => base64Utf8(s) === Buffer.from(s, 'utf8').toString('base64')))
  const strokes = [[{ x: 10, y: 10 }, { x: 50, y: 40 }, { x: 90, y: 20 }]]
  const uri = signatureDataUri(strokes, 300, 180)
  const svg = Buffer.from(uri.split(',')[1], 'base64').toString('utf8')
  check('signature is a data:image URI (what /api/documents/:id/sign accepts)', uri.startsWith('data:image/svg+xml;base64,'))
  check('signature SVG has the path, dark ink on white', svg.includes('<path d="M10 10 L50 40 L90 20"/>') && svg.includes('fill="#ffffff"') && svg.includes('stroke="#111827"'), svg)
  check('a tap is not a signature', !hasInk([[{ x: 1, y: 1 }]]) && hasInk(strokes))

  // Both themes. Surfaces from src/theme/ThemeContext.tsx: light #ffffff, dark #1a1d2e.
  const surfaces = { light: '#ffffff', dark: '#1a1d2e' }
  const agencyColours = ['#0f766e', '#1e40af', '#dc2626', '#facc15', '#22c55e', '#000000', '#ffffff']
  check('agency colour as link text reads at 4.5:1 on the card surface, light AND dark, for any shade',
    agencyColours.every((c) => contrast(readableOn(c, surfaces.light, false), surfaces.light) >= 4.5 && contrast(readableOn(c, surfaces.dark, true), surfaces.dark) >= 4.5))
  check('a colour that already reads is left alone', readableOn('#0f766e', surfaces.light, false) === '#0f766e')
  const ui = readFileSync(join(import.meta.dir, '../../apps/mobile/src/care/ui.tsx'), 'utf8')
  const pairs = Array.from(ui.matchAll(/(light|dark): { bg: '(#[0-9a-f]{6})', border: '#[0-9a-f]{6}', text: '(#[0-9a-f]{6})' }/g))
  check('every banner tone pair (ink on its ground) passes 4.5:1, light and dark', pairs.length === 10 && pairs.every((m) => contrast(m[3], m[2]) >= 4.5),
    pairs.map((m) => `${m[1]} ${contrast(m[3], m[2]).toFixed(2)}`))
  const solid = Array.from(/SOLID = {([^}]*)}/.exec(ui)?.[1].matchAll(/'(#[0-9a-f]{6})'/g) || []).map((m) => m[1])
  check('white on every solid button colour passes 4.5:1', solid.length === 3 && solid.every((c) => contrast('#ffffff', c) >= 4.5), solid)
}

console.log('the care variant (app.config.ts, eas.json) and the homecare tabs')
{
  const mobile = join(import.meta.dir, '../../apps/mobile')
  const mod = await import('../../apps/mobile/app.config.ts')
  const build = (variant: string | undefined, env: Record<string, string | undefined> = {}) => {
    const saved = { APP_VARIANT: process.env.APP_VARIANT, EAS_BUILD: process.env.EAS_BUILD, TWOMIAH_EAS_BUILD: process.env.TWOMIAH_EAS_BUILD }
    process.env.APP_VARIANT = variant
    if (variant === undefined) delete process.env.APP_VARIANT
    delete process.env.EAS_BUILD; delete process.env.TWOMIAH_EAS_BUILD
    Object.assign(process.env, env)
    try { return { config: mod.default({ config: {} } as any), error: null as any } }
    catch (e) { return { config: null as any, error: e } }
    finally {
      for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
    }
  }
  const care = build('care')
  const c = care.config
  check('APP_VARIANT=care builds', !care.error, care.error?.message)
  check('Twomiah Care identity: name, slug, bundle id, package, scheme',
    c?.name === 'Twomiah Care' && c?.slug === 'twomiah-care' && c?.ios?.bundleIdentifier === 'com.twomiah.care' && c?.android?.package === 'com.twomiah.care' && c?.scheme === 'twomiahcare', c && { name: c.name, slug: c.slug })
  check('locked to the homecare vertical', c?.extra?.lockedVertical === 'homecare' && c?.extra?.appName === 'Twomiah Care' && c?.extra?.appVariant === 'care')
  check('care primary colour passes 4.5:1 with white text', (() => {
    const hex = String(c?.extra?.primaryColor || '')
    const ch = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    const L = 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2]
    return 1.05 / (L + 0.05) >= 4.5
  })(), c?.extra?.primaryColor)
  check('caregiver-worded camera + location permissions (visit photos; EVV clock in/out)',
    /visit photos/i.test(c?.ios?.infoPlist?.NSCameraUsageDescription) && /clock in and out/i.test(c?.ios?.infoPlist?.NSLocationWhenInUseUsageDescription) && /EVV/.test(c?.ios?.infoPlist?.NSLocationWhenInUseUsageDescription))
  check('no invented EAS project id: none in extra, updates off, placeholder named', !c?.extra?.eas && c?.updates?.enabled === false && !('url' in (c?.updates || {})) && mod.CARE_EAS_PROJECT_ID === mod.CARE_EAS_PROJECT_ID_PLACEHOLDER)
  const easLocal = build('care', { TWOMIAH_EAS_BUILD: 'care' })
  check('eas build (care profile) stops, saying exactly what to create', !!easLocal.error && /expo\.dev/.test(easLocal.error.message) && /"twomiah-care"/.test(easLocal.error.message) && /CARE_EAS_PROJECT_ID/.test(easLocal.error.message), easLocal.error?.message)
  check('…and on the EAS build server too', !!build('care', { EAS_BUILD: 'true' }).error)
  const roofer = build('roofer', { EAS_BUILD: 'true' })
  check('other variants unchanged and still build on EAS', !roofer.error && roofer.config.extra.eas.projectId === '4c6bd5f4-6680-451c-b3d7-d4c31eae44f4' && roofer.config.updates.url === 'https://u.expo.dev/4c6bd5f4-6680-451c-b3d7-d4c31eae44f4')
  check('generic variant unchanged', build(undefined).config?.slug === 'twomiah-mobile' && !build(undefined).config?.extra?.lockedVertical)
  check('an unknown variant is refused', !!build('nope').error)

  const eas = JSON.parse(readFileSync(join(mobile, 'eas.json'), 'utf8'))
  check('eas.json: care-preview / care-production like the others',
    eas.build['care-preview']?.extends === 'preview' && eas.build['care-preview'].env.APP_VARIANT === 'care' && eas.build['care-preview'].channel === 'care-preview'
    && eas.build['care-production']?.extends === 'production' && eas.build['care-production'].env.APP_VARIANT === 'care' && eas.build['care-production'].channel === 'care-production')
  check('eas.json: both care profiles carry the local build guard', eas.build['care-preview'].env.TWOMIAH_EAS_BUILD && eas.build['care-production'].env.TWOMIAH_EAS_BUILD)

  const verticals = readFileSync(join(mobile, 'src/vertical/verticals.ts'), 'utf8')
  const homecare = /homecare: \[([\s\S]*?)\]/.exec(verticals)?.[1] || ''
  const names = Array.from(homecare.matchAll(/name: '([^']+)'/g)).map((m) => m[1])
  const layout = readFileSync(join(mobile, 'app/(tabs)/_layout.tsx'), 'utf8')
  check('homecare has five tabs', names.length === 5, names)
  check('every homecare tab has its screen file and is in ALL_TABS', names.every((n) => existsSync(join(mobile, `app/(tabs)/${n}.tsx`)) && layout.includes(`'${n}'`)), names)
  const pushed = new Set<string>()
  for (const f of ['app/(tabs)/shifts.tsx', 'app/(tabs)/time-clock.tsx', 'app/(tabs)/care-schedule.tsx', 'app/(tabs)/more-homecare.tsx', 'app/(tabs)/messages.tsx', 'src/hooks/usePushNotifications.ts']) {
    for (const m of readFileSync(join(mobile, f), 'utf8').matchAll(/\/\(care\)\/([a-z-]+)/g)) pushed.add(m[1])
  }
  const missing = [...pushed].filter((r) => !existsSync(join(mobile, `app/(care)/${r}.tsx`)) && !existsSync(join(mobile, `app/(care)/${r}/[id].tsx`)))
  check('every /(care)/… route the tabs open exists', missing.length === 0, missing)
  const careFiles = ['src/care/CareContext.tsx', 'app/(tabs)/shifts.tsx', 'app/(tabs)/time-clock.tsx', 'app/(care)/incident.tsx', 'app/(care)/shift-action.tsx']
    .map((f) => readFileSync(join(mobile, f), 'utf8')).join('\n')
  check('no CVHC names in the caregiver screens', !/chippewa|cvhc|my choice|wisconsin/i.test(careFiles))
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
