// crm-homecare — EVV: the Sandata alternate-EVV pipeline and the weekly EVV allowance, ported from
// the CVHC CRM (migration v61/v72, routes/sandataRoutes.js, services/sandata*.js,
// helpers/evvWeekly.js). Expected numbers come from CVHC's own tests (backend/tests/evv-weekly.test.js,
// frontend/src/test/sandata.test.js) and from reading its code on the same inputs.
//
// What is covered:
//   · payloads: sequence ids, call types (Mobile / Telephony / Other), Adjusted times + VisitChanges,
//     exception acknowledgement, spec name/zip formatting, pre-flight problems
//   · the weekly allowance, against the real SQL: Sun–Sat in the agency zone, billable minutes,
//     open visits capped at the schedule, sandata_required false excluded, null vs 0 units
//   · allocateEvvWeek: CVHC's five claim-day cases
//   · routes: clock-in decision + GPS, clock-out EVV record, IVR caller id → Telephony, office
//     corrections with reason codes, exception acknowledgement, evv-units, evv-week, readiness,
//     settings (password never sent), WI-only payer presets, caregiver-context scoping
//   · the queue with Sandata stubbed: client-first sync, accept, reject, permanent failure →
//     needs_manual + notification, retry, resubmission of an accepted visit
//   · who may do what: caregivers are refused every office route and reach their own
process.env.ENCRYPTION_KEY = 'evv-test-key-not-a-secret'
process.env.SANDATA_STATUS_POLL_DELAYS_MS = '0'
process.env.SANDATA_QUEUE_DELAY_MS = '0'
process.env.SANDATA_RETRY_BASE_MS = '0'
for (const k of ['SANDATA_USERNAME', 'SANDATA_PASSWORD', 'SANDATA_ACCOUNT_ID', 'SANDATA_PROVIDER_ID', 'AGENCY_MEDICAID_ID', 'SANDATA_API_URL']) delete process.env[k]

import { Hono } from 'hono'
import { eq, sql } from 'drizzle-orm'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import {
  agencies, users, clients, referralSources, careTypes, clientAssignments, timeEntries, evvVisits,
  caregiverProfiles, authorizations, visitTimeChanges, sandataSubmissionQueue, notifications, auditLogs,
} from './db/schema.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 400)) }
}
const rowsOf = (r: any): any[] => (r && Array.isArray(r.rows) ? r.rows : [])

await setupSchema()

const payloads = await import('./src/services/sandataPayload.ts')
const weekly = await import('./src/services/evvWeekly.ts')
const evvSvc = await import('./src/services/evvVisits.ts')
const queue = await import('./src/services/sandataAutoSubmit.ts')
const client = await import('./src/services/sandataClient.ts')

// ══ 1. payloads (pure) ═══════════════════════════════════════════════════════════════════════
{
  const at = new Date('2026-10-14T15:04:05.678Z')
  check('sequence is the UTC timestamp YYYYMMDDHHMMSS', payloads.nextSequence(0, at) === 20261014150405)
  check('a resubmit in the same second still increases', payloads.nextSequence(20261014150405, at) === 20261014150406)
  check('a later sequence is never reused', payloads.nextSequence(20261014150499, at) === 20261014150500)

  const base = {
    providerId: '1234567890', visitOtherId: 'ck3x9evvvisitidabcdef', sequence: 20261014150405,
    workerId: '123-456-789', medicaidId: '1421146410', payerId: 'MCFC-CW', payerProgram: 'WIMCO',
    serviceCode: 'T1019', modifier: null, startTime: new Date('2026-10-14T14:00:00Z'), endTime: new Date('2026-10-14T16:15:00Z'),
    clockInLoc: { latitude: 44.81, longitude: -91.5 }, clockOutLoc: { lat: '44.82', lng: '-91.51' },
    originPhone: null, changes: [], exceptionAck: null, cancelled: false, timeZone: 'US/Central',
  }
  const p = payloads.buildVisitPayload(base as any)
  check('GPS punches go out as two Mobile calls', p.Calls.length === 2 && p.Calls.every((c: any) => c.CallType === 'Mobile'), p.Calls)
  check('call ids fit 16 chars and differ', p.Calls.every((c: any) => c.CallExternalID.length <= 16) && p.Calls[0].CallExternalID !== p.Calls[1].CallExternalID, p.Calls.map((c: any) => c.CallExternalID))
  check('both location shapes are read', p.Calls[0].CallLatitude === 44.81 && p.Calls[1].CallLongitude === -91.51)
  check('times are UTC to the second', p.Calls[0].CallDateTime === '2026-10-14T14:00:00Z' && p.Calls[1].CallDateTime === '2026-10-14T16:15:00Z')
  check('worker id and MA id are digits only', p.EmployeeIdentifier === '123456789' && p.ClientID === '1421146410')
  check('no adjusted times on a live visit', p.AdjInDateTime === null && p.AdjOutDateTime === null && !p.VisitChanges)
  check('VisitTimeZone comes from the agency zone', p.VisitTimeZone === 'US/Central')

  const ivr = payloads.buildVisitPayload({ ...base, originPhone: '+1 (715) 555-0101', clockInLoc: null, clockOutLoc: null } as any)
  check('an IVR visit is Telephony with the caller number and no coordinates',
    ivr.Calls.every((c: any) => c.CallType === 'Telephony' && c.OriginatingPhoneNumber === '7155550101' && c.CallLatitude === null), ivr.Calls)
  const tap = payloads.buildVisitPayload({ ...base, clockInLoc: null, clockOutLoc: { lat: null, lng: null } } as any)
  check('a tap with no GPS fix is CallType Other', tap.Calls.every((c: any) => c.CallType === 'Other'), tap.Calls)

  const adj = payloads.buildVisitPayload({
    ...base,
    changes: [{ new_end: '2026-10-14T16:15:00Z', changed_by_label: 'office@agency.test', changed_at: new Date('2026-10-15T09:00:00Z'), reason_code: '1', memo: 'forgot to clock out', resolution_code: '1' }],
  } as any)
  check('an office-set end time sends no Time Out call', adj.Calls.length === 1 && adj.Calls[0].CallAssignment === 'Time In', adj.Calls)
  check('…and goes out as AdjOutDateTime', adj.AdjOutDateTime === '2026-10-14T16:15:00Z' && adj.AdjInDateTime === null)
  check('…with a VisitChanges record whose sequence precedes the visit', adj.VisitChanges?.[0]?.SequenceID === 20261014150404
    && adj.VisitChanges[0].ReasonCode === '1' && adj.VisitChanges[0].ResolutionCode === '1' && adj.VisitChanges[0].ChangeMadeBy === 'office@agency.test', adj.VisitChanges)

  const ack = payloads.buildVisitPayload({ ...base, exceptionAck: { code: '15', acknowledged: true } } as any)
  check('an acknowledged exception rides along', ack.VisitExceptionAcknowledgement?.[0]?.ExceptionID === '15' && ack.VisitExceptionAcknowledgement[0].ExceptionAcknowledged === true)

  check('spec names drop nicknames and digits', payloads.specName('Mary "Mimi" O\'Neil-Smith2') === "Mary O'Neil-Smith", payloads.specName('Mary "Mimi" O\'Neil-Smith2'))
  check('spec names are at most 30 chars', payloads.specName('A'.repeat(40)).length === 30)
  check('a 5-digit zip is padded to 9', payloads.specZip('54701') === '547010000' && payloads.specZip('54701-1234') === '547011234' && payloads.specZip('547') === null)

  const probs = payloads.validateVisitBundle({ ...base, providerId: null, medicaidId: '123', workerId: '', payerId: null, serviceCode: null, endTime: null } as any).map((x) => x.code)
  check('pre-flight names every missing piece', ['NO_PROVIDER_ID', 'BAD_MEDICAID_ID', 'BAD_WORKER_ID', 'NO_PAYER_CODES', 'NO_SERVICE_CODE', 'NO_END'].every((c) => probs.includes(c)), probs)
  check('a complete bundle has no problems', payloads.validateVisitBundle(base as any).length === 0)

  const cp = payloads.buildClientPayload({ first_name: 'Ann', last_name: 'Lee', medicaid_id: '1421146410', address: '1 Main St', city: 'Town', zip: '54701', phone: '(715) 555-0101', sandata_payer_id: 'MCFC-CW', sandata_payer_program: 'WIMCO', default_service_code: 'T1019', is_active: true },
    { providerId: '1234567890', sequence: 1, includePayerSegment: true, timeZone: 'US/Central', agencyState: 'WI' })
  check('client payload: payer segment, padded zip, 10-digit phone, agency state fallback',
    cp.ClientPayerInformation[0].PayerID === 'MCFC-CW' && cp.ClientPayerInformation[0].ClientStatus === '02' && cp.ClientAddress[0].ClientZip === '547010000'
    && cp.ClientPhone[0].ClientPhone === '7155550101' && cp.ClientAddress[0].ClientState === 'WI' && cp.ClientTimezone === 'US/Central', cp)
  check('Sandata zone vocabulary', client.sandataTimeZone('America/New_York') === 'US/Eastern' && client.sandataTimeZone('America/Phoenix') === 'US/Arizona'
    && client.sandataTimeZone('America/Los_Angeles') === 'US/Pacific' && client.sandataTimeZone('America/Chicago') === 'US/Central')
}

// ══ 2. allocateEvvWeek — CVHC's claim-day cases ══════════════════════════════════════════════
{
  const v = (date: string, hhmm: string, minutes: number, sentToSandata: boolean) => ({ date, start: `${date}T${hhmm}`, minutes, sentToSandata })
  const r = weekly.allocateEvvWeek(8, [v('2026-10-16', '09:00', 90, false), v('2026-10-12', '09:00', 90, true), v('2026-10-14', '09:00', 90, true)])
  check('EVV until the allowance; overshoot and unsent visits are non-EVV',
    JSON.stringify(r.days.map((d) => [d.date, d.evvUnits, d.homemakerUnits])) === JSON.stringify([['2026-10-12', 6, 0], ['2026-10-14', 2, 4], ['2026-10-16', 0, 6]]), r.days)
  check('…totals 8 EVV / 10 other', JSON.stringify(r.totals) === JSON.stringify({ evvUnits: 8, homemakerUnits: 10, evvAuthorizedUnits: 8 }), r.totals)
  const z = weekly.allocateEvvWeek(0, [v('2026-10-12', '09:00', 60, false)])
  check('0 EVV units: everything is non-EVV', JSON.stringify(z.totals) === JSON.stringify({ evvUnits: 0, homemakerUnits: 4, evvAuthorizedUnits: 0 }))
  const n = weekly.allocateEvvWeek(null, [v('2026-10-12', '09:00', 120, true), v('2026-10-13', '09:00', 120, true)])
  check('no allowance: every Sandata minute is EVV', n.totals.evvUnits === 16 && n.totals.homemakerUnits === 0)
  const rd = weekly.allocateEvvWeek(3, [v('2026-10-12', '09:00', 23, true), v('2026-10-13', '09:00', 23, true)])
  check('rounding never claims more EVV than authorized', rd.totals.evvUnits <= 3 && rd.totals.evvUnits + rd.totals.homemakerUnits === 3, rd.totals)
  const two = weekly.allocateEvvWeek(null, [v('2026-10-12', '09:00', 52, true), v('2026-10-12', '14:00', 53, true)])
  check('two visits on one day add up before rounding', two.days.length === 1 && two.days[0].evvUnits === 7)
  check('withTimeout: a slow answer is null', (await weekly.withTimeout(new Promise((r2) => setTimeout(() => r2(1), 200)), 10)) === null)
  check('withTimeout: a fast answer passes through', (await weekly.withTimeout(Promise.resolve(5), 1000)) === 5)
  check('clientInSandata: Sandata payer + 10–12 digit MA id, never private pay',
    weekly.clientInSandata({ sandata_evv_required: true, medicaid_id: ' 3886255573 ' })
    && !weekly.clientInSandata({ sandata_evv_required: true, medicaid_id: '123' })
    && !weekly.clientInSandata({ sandata_evv_required: false, medicaid_id: '3886255573' })
    && !weekly.clientInSandata({ sandata_evv_required: true, medicaid_id: '3886255573', is_private_pay: true })
    && !weekly.clientInSandata(null))
}

// ══ fixtures ═════════════════════════════════════════════════════════════════════════════════
const [ag] = await db.insert(agencies).values({ name: 'EVV Test Agency', slug: 'evvtest', state: 'WI' } as any).returning()
const mkUser = async (role: string, tag: string, extra: any = {}) => (await db.insert(users).values({
  email: `${tag}-evv@test.local`, passwordHash: 'x', firstName: tag, lastName: 'U', role, ...extra,
} as any).returning())[0]
const owner = await mkUser('owner', 'owner')
const admin = await mkUser('admin', 'admin')
const caregiver = await mkUser('caregiver', 'caregiver')
const caregiver2 = await mkUser('caregiver', 'caregiver2')

const [evvPayer] = await db.insert(referralSources).values({ name: 'My Choice Wisconsin', sandataEvvRequired: true, sandataPayerId: 'MCFC-CW', sandataPayerProgram: 'WIMCO' } as any).returning()
const [otherPayer] = await db.insert(referralSources).values({ name: 'VA', sandataEvvRequired: false } as any).returning()
const [ct] = await db.insert(careTypes).values({ name: 'Personal Care', defaultServiceCode: 'T1019' } as any).returning()

let n = 0
const mkClient = async (extra: any = {}) => (await db.insert(clients).values({
  firstName: 'Client', lastName: `N${++n}`, referredById: evvPayer.id, medicaidId: '1421146410', evvWeeklyUnits: 12,
  careTypeId: ct.id, address: '1 Main St', city: 'Town', state: 'WI', zip: '54701', phone: '715-555-0100', ...extra,
} as any).returning())[0]
const mkEntry = async (clientId: string, start: string | Date, extra: any = {}) => (await db.insert(timeEntries).values({
  caregiverId: caregiver.id, clientId, startTime: new Date(start), isComplete: true, ...extra,
} as any).returning())[0]

// ══ 3. the weekly allowance against the real SQL ═════════════════════════════════════════════
{
  const tz = 'America/Chicago'
  const AT = '2026-10-14T15:00:00.000Z' // Wed 10:00 Central; week = Sun 10/11 – Sat 10/17
  const opts = { timezone: tz }
  const a = await mkClient()
  await mkEntry(a.id, '2026-10-12T14:00:00Z', { endTime: new Date('2026-10-12T15:30:00Z'), durationMinutes: 90, billableMinutes: 90 })
  let d = await weekly.decideSandataRequired(a.id, AT, opts)
  check('90 of 180 EVV minutes used → this visit goes to Sandata', d.required === true && d.usedMinutes === 90 && d.allowanceMinutes === 180 && d.reason === 'evv_minutes_remaining', d)
  check('the week is Sun–Sat', d.weekStart === '2026-10-11' && d.weekEnd === '2026-10-17', d)
  await mkEntry(a.id, '2026-10-13T14:00:00Z', { endTime: new Date('2026-10-13T15:29:00Z'), durationMinutes: 89, billableMinutes: 89 })
  d = await weekly.decideSandataRequired(a.id, AT, opts)
  check('179 used: a little left still sends the whole visit', d.required === true && d.usedMinutes === 179, d)
  await mkEntry(a.id, '2026-10-13T18:00:00Z', { endTime: new Date('2026-10-13T18:01:00Z'), durationMinutes: 1, billableMinutes: 1 })
  d = await weekly.decideSandataRequired(a.id, AT, opts)
  check('180 used → week met, no Sandata (non-EVV time)', d.required === false && d.reason === 'evv_week_met', d)

  const b = await mkClient()
  // A real missed clock-out: 23 hours on the clock, 135 billable. Only the billable counts.
  await mkEntry(b.id, '2026-10-12T14:00:00Z', { endTime: new Date('2026-10-13T13:00:00Z'), durationMinutes: 1380, billableMinutes: 135 })
  d = await weekly.decideSandataRequired(b.id, AT, opts)
  check('a missed clock-out counts its billable minutes, not 23 hours', d.usedMinutes === 135 && d.required === true, d)
  // Sat 10/10 23:30 Central (previous week) and Sat 10/17 23:30 Central (this week), both UTC-next-day.
  await mkEntry(b.id, '2026-10-11T04:30:00Z', { endTime: new Date('2026-10-11T05:00:00Z'), billableMinutes: 30 })
  await mkEntry(b.id, '2026-10-18T04:30:00Z', { endTime: new Date('2026-10-18T05:00:00Z'), billableMinutes: 30 })
  d = await weekly.decideSandataRequired(b.id, AT, opts)
  check('week boundaries are the agency\'s, not UTC\'s', d.usedMinutes === 165, d)
  await mkEntry(b.id, '2026-10-14T13:00:00Z', { endTime: new Date('2026-10-14T14:00:00Z'), billableMinutes: 60, sandataRequired: false })
  d = await weekly.decideSandataRequired(b.id, AT, opts)
  check('a visit decided "not to Sandata" does not count', d.usedMinutes === 165, d)
  const open = await mkEntry(b.id, '2026-10-14T13:00:00Z', { isComplete: false, allottedMinutes: 30 })
  d = await weekly.decideSandataRequired(b.id, AT, opts)
  check('an open visit counts elapsed time, capped at its schedule', d.usedMinutes === 195, d)
  d = await weekly.decideSandataRequired(b.id, AT, { ...opts, excludeEntryId: open.id })
  check('the new visit itself is excluded', d.usedMinutes === 165, d)
  const open2 = await mkEntry(b.id, '2026-10-14T14:40:00Z', { isComplete: false })
  d = await weekly.decideSandataRequired(b.id, AT, { ...opts, excludeEntryId: open.id })
  check('an open visit with no schedule counts its 20 elapsed minutes', d.usedMinutes === 185, d)
  await db.delete(timeEntries).where(eq(timeEntries.id, open2.id))
  await db.delete(timeEntries).where(eq(timeEntries.id, open.id))

  const nul = await mkClient({ evvWeeklyUnits: null })
  d = await weekly.decideSandataRequired(nul.id, AT, opts)
  check('no allowance entered → prompt every visit', d.required === true && d.reason === 'no_allowance_entered', d)
  const zero = await mkClient({ evvWeeklyUnits: 0 })
  d = await weekly.decideSandataRequired(zero.id, AT, opts)
  check('0 EVV units → never Sandata', d.required === false && d.reason === 'no_evv_units', d)
  for (const [label, extra] of [['private pay', { isPrivatePay: true }], ['a non-Sandata payer', { referredById: otherPayer.id }], ['no MA id', { medicaidId: '1197148' }], ['no payer', { referredById: null }]] as const) {
    const c2 = await mkClient(extra)
    d = await weekly.decideSandataRequired(c2.id, AT, opts)
    check(`${label} → never Sandata`, d.required === false && d.reason === 'not_sandata_client', d)
  }
}

// ══ routes ═══════════════════════════════════════════════════════════════════════════════════
const app = new Hono()
for (const [mount, file] of [
  ['/api/sandata', 'sandata'],
  ['/api/clients', 'clients'],
  ['/api/time-entries', 'timeTracking'],
  ['/api/ivr', 'ivr'],
  ['/api/evv', 'evv'],
  ['/api/referral-sources', 'referralSources'],
  ['/api/company', 'company'],
] as const) {
  app.route(mount, (await import(`./src/routes/${file}.ts`)).default)
}
const as = (who: any) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json', 'x-test-user': who.id, 'x-test-agency': ag.id, 'x-test-role': who.role },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j, text: t }
}
const twilio = async (path: string, form: Record<string, string>) => {
  const res = await app.request(path, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form).toString() })
  return { status: res.status, text: await res.text() }
}

// ── office routes refuse caregivers ──────────────────────────────────────────────────────────
for (const [m, p, body] of [
  ['GET', '/api/sandata/status', undefined], ['GET', '/api/sandata/readiness', undefined], ['GET', '/api/sandata/settings', undefined],
  ['PUT', '/api/sandata/settings', { username: 'x' }], ['POST', '/api/sandata/submit', { visitIds: ['x'] }],
  ['PUT', '/api/sandata/visit/nope', {}], ['POST', '/api/sandata/visit/nope/acknowledge', { reasonCode: '1' }],
  ['POST', '/api/sandata/poll-status', {}], ['GET', '/api/sandata/queue', undefined], ['POST', '/api/sandata/queue/retry/nope', {}],
  ['POST', '/api/sandata/sync-client/nope', {}], ['GET', '/api/sandata/payer-presets', undefined], ['GET', '/api/sandata/config', undefined],
  ['GET', '/api/clients/evv-week', undefined], ['PATCH', '/api/clients/nope/evv-units', { units: 4 }],
  ['POST', '/api/referral-sources', { name: 'X' }], ['PUT', '/api/referral-sources/nope', { name: 'X' }], ['DELETE', '/api/referral-sources/nope', undefined],
] as const) {
  const r = await as(caregiver)(m, p, body)
  check(`a caregiver is refused ${m} ${p}`, r.status === 403 && r.json?.error === 'Admin access required', { status: r.status, body: r.json })
  const o = await as(owner)(m, p, body)
  check(`an owner reaches ${m} ${p}`, o.status !== 403 && o.status !== 401 && o.status < 500, { status: o.status, body: o.json })
}

// ── clock-in decides, clock-out builds the EVV record ────────────────────────────────────────
const cA = await mkClient()
const cB = await mkClient({ referredById: otherPayer.id, medicaidId: '1234567890' })
const cUnassigned = await mkClient()
for (const cl of [cA, cB]) await db.insert(clientAssignments).values({ clientId: cl.id, caregiverId: caregiver.id, assignmentDate: '2026-10-01', status: 'active' } as any)
{
  const r = await as(caregiver)('POST', '/api/time-entries/clock-in', { clientId: cA.id, latitude: 44.81, longitude: -91.5 })
  check('clock-in answers 201 with sandata_required', r.status === 201 && r.json?.sandata_required === true, r.json)
  const [te] = await db.select().from(timeEntries).where(eq(timeEntries.id, r.json.id))
  check('…stores the decision on the visit', te.sandataRequired === true)
  check('…and keeps the GPS fix the app sends as latitude/longitude', (te.clockInLocation as any)?.lat === 44.81 && (te.clockInLocation as any)?.lng === -91.5, te.clockInLocation)

  const ctx = await as(caregiver)('GET', '/api/sandata/caregiver-context')
  const ids = (ctx.json?.clients || []).map((x: any) => x.id)
  check('caregiver-context: only my clients', ctx.status === 200 && ids.includes(cA.id) && ids.includes(cB.id) && !ids.includes(cUnassigned.id), ids)
  const ca = ctx.json.clients.find((x: any) => x.id === cA.id); const cb = ctx.json.clients.find((x: any) => x.id === cB.id)
  check('…a Sandata client carries its Medicaid ID for copying', ca.in_sandata === true && ca.medicaid_id === '1421146410', ca)
  check('…a non-Sandata client carries no Medicaid ID', cb.in_sandata === false && cb.medicaid_id === null, cb)
  check('…the open visit and its decision', ctx.json.activeVisit?.time_entry_id === r.json.id && ctx.json.activeVisit?.sandata_required === true, ctx.json.activeVisit)
  const ctx2 = await as(caregiver2)('GET', '/api/sandata/caregiver-context')
  check('another caregiver sees none of them', ctx2.status === 200 && ctx2.json.clients.length === 0 && ctx2.json.activeVisit === null, ctx2.json)

  // An hour-long visit: backdate the punch, then clock out.
  await db.update(timeEntries).set({ startTime: new Date(Date.now() - 60 * 60000) }).where(eq(timeEntries.id, r.json.id))
  const out = await as(caregiver)('POST', `/api/time-entries/${r.json.id}/clock-out`, { latitude: 44.82, longitude: -91.51, notes: 'ok' })
  check('clock-out answers 200 and echoes the clock-in decision', out.status === 200 && out.json?.sandata_required === true, out.json)
  const [ev] = await db.select().from(evvVisits).where(eq(evvVisits.timeEntryId, r.json.id))
  check('…an EVV record exists for the visit', !!ev)
  check('…4.00 units for 60 minutes (15-minute units)', Number(ev?.unitsOfService) === 4, ev?.unitsOfService)
  check('…the procedure code comes from the care type', ev?.serviceCode === 'T1019')
  check('…GPS in and out are on the record', Number(ev?.gpsInLat) === 44.81 && Number(ev?.gpsOutLng) === -91.51, ev)
  const codes = ((ev?.verificationIssues as any[]) || []).map((i) => i.code).sort()
  check('…missing worker id and authorization are flagged, so it waits as pending', ev?.sandataStatus === 'pending' && JSON.stringify(codes) === JSON.stringify(['NO_AUTH', 'NO_WORKER_ID']), { status: ev?.sandataStatus, codes })

  await db.insert(caregiverProfiles).values({ caregiverId: caregiver.id, evvWorkerId: '123456789' } as any)
  await db.insert(authorizations).values({ clientId: cA.id, payerId: evvPayer.id, procedureCode: 'T1019', authorizedUnits: '400', startDate: '2026-01-01', endDate: '2027-12-31', status: 'active' } as any)
  const re = await as(admin)('POST', `/api/evv/create-from-entry/${r.json.id}`, {})
  const [ev2] = await db.select().from(evvVisits).where(eq(evvVisits.timeEntryId, r.json.id))
  check('re-building the record after the fixes clears the issues (one row, upserted)', re.status === 201 && ev2.id === ev.id && (ev2.verificationIssues as any[]).length === 0 && ev2.isVerified === true, ev2)
  check('…and a fixed visit becomes ready to submit', ev2.sandataStatus === 'ready', ev2.sandataStatus)
  const [a2] = await db.select().from(authorizations).where(eq(authorizations.clientId, cA.id))
  check('…and does not touch authorization used units (the claims engine deducts them)', Number(a2.usedUnits) === 0, a2.usedUnits)
  const v = await as(admin)('PATCH', `/api/evv/${ev.id}/verify`, {})
  const [ev3] = await db.select().from(evvVisits).where(eq(evvVisits.id, ev.id))
  check('office verify does not pretend Sandata accepted it', v.status === 200 && ev3.sandataStatus !== 'accepted', ev3.sandataStatus)
}

// ── a client whose EVV week is already met: clock-in says no Sandata ─────────────────────────
{
  const met = await mkClient({ evvWeeklyUnits: 4 })
  await db.insert(clientAssignments).values({ clientId: met.id, caregiverId: caregiver2.id, assignmentDate: '2026-10-01', status: 'active' } as any)
  await mkEntry(met.id, new Date(), { caregiverId: caregiver2.id, endTime: new Date(), billableMinutes: 60 })
  const r = await as(caregiver2)('POST', '/api/time-entries/clock-in', { clientId: met.id })
  check('week met → clock-in answers sandata_required false', r.status === 201 && r.json?.sandata_required === false, r.json)
  const ew = await as(admin)('GET', `/api/clients/evv-week?clientId=${met.id}`)
  const row = ew.json?.[0]
  check('evv-week: allowance 60, 60 used, 0 left, next visit not to Sandata',
    ew.status === 200 && row?.allowance_minutes === 60 && row?.used_minutes === 60 && row?.remaining_minutes === 0 && row?.next_visit_to_sandata === false && row?.sandata_visits === 1, row)
  const all = await as(admin)('GET', '/api/clients/evv-week')
  check('evv-week lists only Sandata clients', all.status === 200 && !all.json.some((x: any) => x.client_id === cB.id) && all.json.some((x: any) => x.client_id === met.id))
  await as(caregiver2)('POST', `/api/time-entries/${r.json.id}/clock-out`, {})
}

// ── PATCH evv-units ──────────────────────────────────────────────────────────────────────────
{
  const c3 = await mkClient({ evvWeeklyUnits: null })
  for (const bad of [7.5, 673, -1, 'twelve']) {
    const r = await as(admin)('PATCH', `/api/clients/${c3.id}/evv-units`, { units: bad })
    check(`evv-units refuses ${JSON.stringify(bad)}`, r.status === 400 && /whole number from 0 to 672/.test(r.json?.error || ''), r.json)
  }
  let r = await as(admin)('PATCH', `/api/clients/${c3.id}/evv-units`, { units: 12 })
  check('evv-units saves 12', r.status === 200 && r.json?.evv_weekly_units === 12, r.json)
  r = await as(admin)('PATCH', `/api/clients/${c3.id}/evv-units`, { units: 672 })
  check('evv-units accepts the 672 ceiling', r.status === 200 && r.json?.evv_weekly_units === 672)
  r = await as(admin)('PATCH', `/api/clients/${c3.id}/evv-units`, { units: '' })
  check('blank clears it to "not entered"', r.status === 200 && r.json?.evv_weekly_units === null, r.json)
  r = await as(admin)('PATCH', '/api/clients/nope/evv-units', { units: 3 })
  check('unknown client → 404', r.status === 404)
  const audits = await db.select().from(auditLogs).where(eq(auditLogs.recordId, c3.id))
  check('every change is audited with old and new values', audits.length === 3 && audits.some((a: any) => a.newData?.evv_weekly_units === 12), audits.length)
}

// ── office correction and exception acknowledgement ──────────────────────────────────────────
const [someEv] = await db.select().from(evvVisits).where(eq(evvVisits.clientId, cA.id))
{
  const newEnd = new Date(new Date(someEv.actualStart).getTime() + 90 * 60000).toISOString()
  let r = await as(admin)('PUT', `/api/sandata/visit/${someEv.id}`, { actualEnd: newEnd })
  check('changing a time without a reason code is refused', r.status === 400 && /reasonCode required/.test(r.json?.error || ''), r.json)
  r = await as(admin)('PUT', `/api/sandata/visit/${someEv.id}`, { actualEnd: newEnd, reasonCode: '6' })
  check('reason code 6 is not a valid code', r.status === 400)
  r = await as(admin)('PUT', `/api/sandata/visit/${someEv.id}`, { actualEnd: newEnd, reasonCode: '8' })
  check('reason code 8 needs a memo', r.status === 400 && /requires a memo/.test(r.json?.error || ''), r.json)
  r = await as(admin)('PUT', `/api/sandata/visit/${someEv.id}`, { actualEnd: new Date(new Date(someEv.actualStart).getTime() - 60000).toISOString(), reasonCode: '1' })
  check('an end before the start is refused', r.status === 400)
  r = await as(admin)('PUT', `/api/sandata/visit/${someEv.id}`, { actualEnd: newEnd, reasonCode: '1', reasonMemo: 'forgot to clock out' })
  check('a coded correction is saved', r.status === 200, r.json)
  const changes = await db.select().from(visitTimeChanges).where(eq(visitTimeChanges.timeEntryId, someEv.timeEntryId))
  check('…as a visit_time_changes row: who, old end, new end, code, memo',
    changes.length === 1 && changes[0].changedById === admin.id && changes[0].reasonCode === '1' && changes[0].memo === 'forgot to clock out'
    && changes[0].newEnd?.toISOString() === newEnd && changes[0].oldEnd?.toISOString() === new Date(someEv.actualEnd as any).toISOString() && changes[0].newStart === null, changes)
  const bundle = await queue.fetchBundle(someEv.id)
  const cfg = await client.getConfig()
  const p = payloads.buildVisitPayload({ ...queue.toVisitBundle(bundle!, cfg), sequence: 20261015000000 })
  check('…which reaches the payload as AdjOutDateTime + VisitChanges by the admin\'s email',
    p.AdjOutDateTime === payloads.utc(newEnd) && p.VisitChanges?.[0]?.ChangeMadeBy === admin.email && p.Calls.length === 1 && p.Calls[0].CallAssignment === 'Time In', { adj: p.AdjOutDateTime, vc: p.VisitChanges, calls: p.Calls })
  const det = await as(admin)('GET', `/api/sandata/visit/${someEv.id}`)
  check('visit detail lists the time changes', det.status === 200 && det.json?.time_changes?.length === 1, det.json?.time_changes)

  await db.update(evvVisits).set({ sandataStatus: 'exception', sandataExceptionCode: '15' }).where(eq(evvVisits.id, someEv.id))
  r = await as(admin)('POST', `/api/sandata/visit/${someEv.id}/acknowledge`, {})
  check('acknowledging needs a reason code', r.status === 400)
  r = await as(admin)('POST', `/api/sandata/visit/${someEv.id}/acknowledge`, { reasonCode: '5' })
  check('code 5 needs a memo', r.status === 400 && /requires a memo/.test(r.json?.error || ''), r.json)
  r = await as(admin)('POST', `/api/sandata/visit/${someEv.id}/acknowledge`, { reasonCode: '5', memo: 'member declined to verify' })
  const [acked] = await db.select().from(evvVisits).where(eq(evvVisits.id, someEv.id))
  check('an acknowledged exception goes back to ready with who/why', r.status === 200 && acked.exceptionAck === true && acked.exceptionAckById === admin.id
    && acked.exceptionAckReason === '5' && acked.sandataStatus === 'ready', acked)
  const p2 = payloads.buildVisitPayload({ ...queue.toVisitBundle((await queue.fetchBundle(someEv.id))!, cfg), sequence: 1 })
  check('…and the resubmission carries VisitExceptionAcknowledgement', p2.VisitExceptionAcknowledgement?.[0]?.ExceptionID === '15', p2.VisitExceptionAcknowledgement)
}

// ── IVR: caller id → Telephony ───────────────────────────────────────────────────────────────
{
  const ivrClient = await mkClient({ ivrCode: '517' })
  const r = await twilio(`/api/ivr/clock-in?caregiverId=${caregiver.id}`, { Digits: '517', From: '+1 (715) 555-0101' })
  check('IVR clock-in answers TwiML', r.status === 200 && /clocked in/.test(r.text), r.text.slice(0, 200))
  const [te] = await db.select().from(timeEntries).where(eq(timeEntries.clientId, ivrClient.id))
  check('…and keeps the caller number', te?.originPhone === '7155550101', te?.originPhone)
  const o = await twilio(`/api/ivr/clock-out?caregiverId=${caregiver.id}&timeEntryId=${te.id}`, { Digits: '1', From: '7155550199' })
  const [te2] = await db.select().from(timeEntries).where(eq(timeEntries.id, te.id))
  check('IVR clock-out does not overwrite the clock-in caller', o.status === 200 && te2.originPhone === '7155550101', te2.originPhone)
  const [ev] = await db.select().from(evvVisits).where(eq(evvVisits.timeEntryId, te.id))
  check('a phone-closed visit gets its EVV record, marked telephony', ev?.evvMethod === 'telephony', ev)
  const cfg = await client.getConfig()
  const p = payloads.buildVisitPayload({ ...queue.toVisitBundle((await queue.fetchBundle(ev.id))!, cfg), sequence: 1 })
  check('…and goes to Sandata as Telephony calls', p.Calls.length === 2 && p.Calls.every((c: any) => c.CallType === 'Telephony' && c.OriginatingPhoneNumber === '7155550101'), p.Calls)
}

// ── settings, presets, config, readiness ─────────────────────────────────────────────────────
{
  let r = await as(admin)('PUT', '/api/sandata/settings', { timezone: 'Mars/Olympus' })
  check('an unknown time zone is refused', r.status === 400)
  r = await as(admin)('PUT', '/api/sandata/settings', { apiUrl: 'http://evil.example.com/intake' })
  check('a non-Sandata API URL is refused', r.status === 400)
  const sub = await as(admin)('POST', '/api/sandata/submit', { visitIds: [someEv.id] })
  check('submit before an account exists is a clear 400', sub.status === 400 && /not configured/.test(sub.json?.error || ''), sub.json)
  check('enqueue is dormant without an account', (await queue.enqueueVisit(someEv.id)).queued === false)

  const rd = await as(admin)('GET', '/api/sandata/readiness')
  check('readiness: not configured, caregiver2 has no worker id', rd.status === 200 && rd.json.configured === false
    && rd.json.caregiversWithIssues.some((u: any) => u.id === caregiver2.id) && !rd.json.caregiversWithIssues.some((u: any) => u.id === caregiver.id), rd.json.caregiversWithIssues)
  check('readiness: a VA client is out of scope; a bad MA id is flagged',
    !rd.json.clientsWithIssues.some((c: any) => c.id === cB.id) && rd.json.clientsWithIssues.some((c: any) => c.issues.includes('missing/invalid Medicaid ID')), rd.json.clientsWithIssues.slice(0, 3))

  let pre = await as(admin)('GET', '/api/sandata/payer-presets')
  check('a Wisconsin agency is offered the WI payer codes', pre.json?.presets?.length === 5 && pre.json.presets[0].sandataPayerId === 'MCFC-CW', pre.json)
  await db.update(agencies).set({ state: 'OH' }).where(eq(agencies.id, ag.id))
  pre = await as(admin)('GET', '/api/sandata/payer-presets')
  check('…another state is not', pre.json?.presets?.length === 0, pre.json)
  const cfgOH = await client.getConfig()
  check('…and its EVV zone follows its state', cfgOH.timezone === 'America/New_York' && cfgOH.sandataTimeZone === 'US/Eastern', cfgOH.timezone)
  await db.update(agencies).set({ state: 'WI' }).where(eq(agencies.id, ag.id))

  r = await as(admin)('PUT', '/api/sandata/settings', { username: 'agency-api', password: 'S3cret-pass!', accountId: 'acct-1', providerId: '1234567890', agencyId: '95000', timezone: 'America/Chicago' })
  check('the account saves', r.status === 200 && r.json?.isConfigured === true, r.json)
  const g = await as(admin)('GET', '/api/sandata/settings')
  check('settings never send the password back', g.status === 200 && g.json.hasPassword === true && !g.text.includes('S3cret-pass!') && !('password' in g.json), g.json)
  const [agRow] = await db.select().from(agencies).where(eq(agencies.id, ag.id))
  check('the password is stored encrypted', !!agRow.sandataPasswordEncrypted && !agRow.sandataPasswordEncrypted.includes('S3cret'), agRow.sandataPasswordEncrypted?.slice(0, 12))
  check('the provider id is the agency Medicaid id', agRow.medicaidId === '1234567890')
  const comp = await as(caregiver)('GET', '/api/company')
  check('/api/company does not send the encrypted password', comp.status === 200 && !comp.text.includes('sandataPasswordEncrypted'), comp.text.slice(0, 120))
  const conf = await as(admin)('GET', '/api/sandata/config')
  check('config reports configured', conf.json?.isConfigured === true && conf.json?.setupInstructions === null)
  const ctx = await as(caregiver)('GET', '/api/sandata/caregiver-context')
  check('the caregiver help gets the agency id', ctx.json?.sandataAgencyId === '95000' && ctx.json?.isWisconsin === true)
  r = await as(admin)('PUT', '/api/sandata/settings', { username: 'agency-api' })
  const cfgKeep = await client.getConfig()
  check('saving without a password keeps it', r.status === 200 && cfgKeep.password === 'S3cret-pass!')
}

// ── referral sources / payers: office only, Sandata fields saved ─────────────────────────────
{
  const r = await as(admin)('POST', '/api/referral-sources', { name: 'Inclusa', sandataEvvRequired: true, sandataPayerId: 'INCLUSA', sandataPayerProgram: 'WIMCO' })
  check('an admin creates a Sandata payer', r.status === 201 && r.json?.sandataEvvRequired === true && r.json?.sandataPayerId === 'INCLUSA', r.json)
}

// ══ 4. the queue, with Sandata stubbed ═══════════════════════════════════════════════════════
const realFetch = globalThis.fetch
const calls: Array<{ method: string; url: string; headers: any; body: any }> = []
let visitVerdict: any[] = [{ Reason: 'Transaction Received.' }]
let clientVerdict: any[] = [{ Reason: 'Transaction Received.' }]
;(globalThis as any).fetch = async (url: string, init: any = {}) => {
  const method = init.method || 'GET'
  calls.push({ method, url: String(url), headers: init.headers, body: init.body ? JSON.parse(init.body) : null })
  const json = (o: any, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })
  if (/\/clients\/rest\/api\/v1\.1\/status/.test(url)) return json(clientVerdict)
  if (/\/visits\/rest\/api\/v1\.1\/status/.test(url)) return json(visitVerdict)
  if (/\/clients\/rest\/api\/v1\.1$/.test(url)) return json({ uuid: 'client-tx-1' })
  if (/\/visits\/rest\/api\/v1\.1$/.test(url)) return json({ uuid: `visit-tx-${calls.length}` })
  return json({ error: 'unexpected' }, 404)
}
const waitFor = async (fn: () => Promise<boolean>, ms = 4000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 25)) }
  return false
}
try {
  // A complete visit: worker id, MA id, payer codes, service code, GPS.
  const cq = await mkClient()
  const te = await mkEntry(cq.id, new Date(Date.now() - 2 * 3600000), { endTime: new Date(Date.now() - 3600000), durationMinutes: 60, billableMinutes: 60, clockInLocation: { lat: 44.8, lng: -91.5 }, clockOutLocation: { lat: 44.8, lng: -91.5 } })
  await db.insert(authorizations).values({ clientId: cq.id, payerId: evvPayer.id, procedureCode: 'T1019', authorizedUnits: '400', startDate: '2026-01-01', endDate: '2027-12-31', status: 'active' } as any)
  const ev = await evvSvc.createEVVFromTimeEntry(te.id)
  check('a complete visit is ready', ev?.sandataStatus === 'ready', ev?.verificationIssues)
  const done = await waitFor(async () => {
    const [q] = await db.select().from(sandataSubmissionQueue).where(eq(sandataSubmissionQueue.evvVisitId, ev!.id))
    return q?.status === 'completed'
  })
  check('a ready visit is auto-queued and completed', done)
  const [after] = await db.select().from(evvVisits).where(eq(evvVisits.id, ev!.id))
  check('…accepted by Sandata, with its transaction uuid and sequence', after.sandataStatus === 'accepted' && /^visit-tx-/.test(after.sandataUuid || '') && Number(after.sandataSequence) > 20260000000000, after)
  const posts = calls.filter((c) => c.method === 'POST')
  check('…the client record went first, then the visit', posts.length === 2 && /\/clients\//.test(posts[0].url) && /\/visits\//.test(posts[1].url), posts.map((p) => p.url))
  check('…to the UAT endpoint by default', posts.every((p) => p.url.startsWith(client.UAT_BASE)))
  const expectAuth = 'Basic ' + Buffer.from('agency-api:S3cret-pass!').toString('base64')
  check('…with Basic auth and the Account header', posts[0].headers.Authorization === expectAuth && posts[0].headers.Account === 'acct-1', posts[0].headers)
  check('…the visit payload is the spec shape', posts[1].body[0].ProviderIdentification.ProviderID === '1234567890' && posts[1].body[0].PayerID === 'MCFC-CW'
    && posts[1].body[0].EmployeeIdentifier === '123456789' && posts[1].body[0].Calls.length === 2, posts[1].body[0])
  const [cqAfter] = await db.select().from(clients).where(eq(clients.id, cq.id))
  check('…and the client is marked synced', !!cqAfter.sandataSyncedAt && Number(cqAfter.sandataSequence) > 0)

  // A correction to an ACCEPTED visit is retransmitted with a higher sequence.
  const before = calls.length
  const prevSeq = Number(after.sandataSequence)
  const fix = await as(admin)('PUT', `/api/sandata/visit/${ev!.id}`, { actualEnd: new Date(Date.now() - 3000000).toISOString(), reasonCode: '1' })
  const resent = await waitFor(async () => {
    const [x] = await db.select().from(evvVisits).where(eq(evvVisits.id, ev!.id))
    return Number(x.sandataSequence) > prevSeq && x.sandataStatus === 'accepted'
  })
  const newPosts = calls.slice(before).filter((c) => c.method === 'POST')
  check('a corrected accepted visit is resent (only the visit — the client is already synced)', fix.status === 200 && resent && newPosts.length === 1 && /\/visits\//.test(newPosts[0].url), newPosts.map((p) => p.url))
  check('…as Adjusted time with VisitChanges', !!newPosts[0]?.body?.[0]?.AdjOutDateTime && newPosts[0]?.body?.[0]?.VisitChanges?.length === 1)

  // A Sandata rejection.
  visitVerdict = [{ Reason: 'Invalid ClientID' }]
  const te2 = await mkEntry(cq.id, new Date(Date.now() - 5 * 3600000), { endTime: new Date(Date.now() - 4 * 3600000), billableMinutes: 60, clockInLocation: { lat: 1, lng: 1 }, clockOutLocation: { lat: 1, lng: 1 } })
  const ev2 = await evvSvc.createEVVFromTimeEntry(te2.id)
  await waitFor(async () => {
    const [q] = await db.select().from(sandataSubmissionQueue).where(eq(sandataSubmissionQueue.evvVisitId, ev2!.id))
    return q?.status === 'failed'
  })
  const [rej] = await db.select().from(evvVisits).where(eq(evvVisits.id, ev2!.id))
  const [rq] = await db.select().from(sandataSubmissionQueue).where(eq(sandataSubmissionQueue.evvVisitId, ev2!.id))
  check('a rejected visit is retried, then lands in needs_manual', rq?.status === 'failed' && rq?.retryCount === queue.MAX_RETRIES && rej.sandataStatus === 'needs_manual', { q: rq?.status, retries: rq?.retryCount, s: rej.sandataStatus })
  check('…with Sandata\'s reason', /Invalid ClientID/.test(rej.sandataExceptionDesc || ''), rej.sandataExceptionDesc)
  const notes = await db.select().from(notifications).where(eq(notifications.type, 'evv_submission_failed'))
  check('…and the office is told (owner and admin)', notes.some((x) => x.userId === admin.id) && notes.some((x) => x.userId === owner.id) && !notes.some((x) => x.userId === caregiver.id), notes.map((x) => x.userId))
  const qv = await as(admin)('GET', '/api/sandata/queue')
  check('the queue view lists the failure', qv.status === 200 && qv.json.recentFailures.some((f: any) => f.evv_visit_id === ev2!.id))

  visitVerdict = [{ Reason: 'Transaction Received.' }]
  const retry = await as(admin)('POST', `/api/sandata/queue/retry/${rq.id}`, {})
  const retried = await waitFor(async () => {
    const [q] = await db.select().from(sandataSubmissionQueue).where(eq(sandataSubmissionQueue.id, rq.id))
    return q?.status === 'completed'
  })
  check('retry re-queues a failed submission and it goes through', retry.status === 200 && retried)
  const again = await as(admin)('POST', `/api/sandata/queue/retry/${rq.id}`, {})
  check('…a submission that is not failed cannot be "retried"', again.status === 404)

  // Permanent: no worker id → fails fast, no retries burned, no POST.
  const cg3 = await mkUser('caregiver', 'caregiver3')
  const te3 = await mkEntry(cq.id, new Date(Date.now() - 8 * 3600000), { caregiverId: cg3.id, endTime: new Date(Date.now() - 7 * 3600000), billableMinutes: 60, clockInLocation: { lat: 1, lng: 1 }, clockOutLocation: { lat: 1, lng: 1 } })
  const ev3 = await evvSvc.createEVVFromTimeEntry(te3.id)
  check('a visit with a verification issue is not auto-queued', ev3?.sandataStatus === 'pending')
  const before3 = calls.length
  const sub = await as(admin)('POST', '/api/sandata/submit', { visitIds: [ev3!.id] })
  check('submit queues it', sub.status === 200 && sub.json?.queued === 1, sub.json)
  await waitFor(async () => {
    const [q] = await db.select().from(sandataSubmissionQueue).where(eq(sandataSubmissionQueue.evvVisitId, ev3!.id))
    return q?.status === 'failed'
  })
  const [q3] = await db.select().from(sandataSubmissionQueue).where(eq(sandataSubmissionQueue.evvVisitId, ev3!.id))
  const [v3] = await db.select().from(evvVisits).where(eq(evvVisits.id, ev3!.id))
  check('a permanent problem fails fast to needs_manual with the fix-it message', q3?.status === 'failed' && q3?.retryCount === 1 && v3.sandataStatus === 'needs_manual'
    && v3.sandataExceptionCode === 'BAD_WORKER_ID' && /worker ID/.test(v3.sandataExceptionDesc || ''), { q: q3, code: v3.sandataExceptionCode })
  check('…without calling Sandata', calls.length === before3, calls.slice(before3).map((c) => c.url))
  // CVHC treated a COMPLETED queue row as "already in queue", so a corrected visit was never resent.
  const dup = await queue.enqueueVisit(ev!.id)
  check('a visit whose last submission completed can be queued again', dup.queued === true, dup)
  await waitFor(async () => {
    const rows = await db.select().from(sandataSubmissionQueue).where(eq(sandataSubmissionQueue.evvVisitId, ev!.id))
    return rows.every((r) => r.status === 'completed')
  })

  // poll-status resolves a visit left 'submitted'.
  await db.update(evvVisits).set({ sandataStatus: 'submitted', sandataUuid: 'visit-tx-poll' }).where(eq(evvVisits.id, ev2!.id))
  const poll = await as(admin)('POST', '/api/sandata/poll-status', {})
  const [polled] = await db.select().from(evvVisits).where(eq(evvVisits.id, ev2!.id))
  check('poll-status resolves submitted visits', poll.status === 200 && poll.json.resolved >= 1 && polled.sandataStatus === 'accepted', { poll: poll.json, s: polled.sandataStatus })

  const st = await as(admin)('GET', `/api/sandata/status?startDate=2026-01-01&endDate=2027-12-31`)
  check('the status dashboard counts by Sandata status', st.status === 200 && st.json.sandataConfigured === true && st.json.summary.accepted >= 2 && st.json.summary.total === st.json.visits.length, st.json.summary)
  const ss = await as(admin)('GET', `/api/sandata/submission-status?startDate=2026-01-01&endDate=2027-12-31`)
  check('submission-status joins the queue', ss.status === 200 && ss.json.visits.some((v: any) => v.queue_status === 'completed'), ss.json.summary)
} finally {
  ;(globalThis as any).fetch = realFetch
}

console.log(`\nhomecare-evv: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
