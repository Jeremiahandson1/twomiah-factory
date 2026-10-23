// The phone app's home care screens (apps/mobile/src/care, app/(care), app/(tabs)/{shifts,care-schedule,time-clock,
// messages,more-homecare}) against the real unified server, signed in AS A CAREGIVER (role 'field'): every endpoint the
// screens call, with the params and bodies the app sends, answers with every field name the app's code reads. The app
// reads camelCase and every list through asList (`data`); this is the evidence the screens get real data, not
// "undefined" and Invalid Date.
//
// The pure phone logic runs on the real replies too: the schedule rows expand into visits (src/care/schedule.ts), and
// the Sandata prompt fires from the clock-in's sandataRequired (src/care/sandata.ts).
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { getCurrentPayPeriod } from '../server/crm/homecare/payroll/payrollVerification.ts'
import { expandVisits } from '../../mobile/src/care/schedule.ts'
import { sandataAfterPunch, needsSandata, medicaidIdOf } from '../../mobile/src/care/sandata.ts'
import { isFieldRole, isOfficeRole } from '../../mobile/src/auth/roles.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
const tokens: Record<string, string> = {}
const ids: Record<string, string> = {}
let today = ''
let tomorrow = ''

const login = async (email: string, password: string) =>
  (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()) as any
const as = (who: string) => async (path: string, init: any = {}) => {
  const r = await t.call(path, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tokens[who]}` } })
  const text = await r.text()
  let body: any = text
  try { body = JSON.parse(text) } catch { /* not JSON */ }
  return { status: r.status, body }
}
const cg = (path: string, init?: any) => as('cg')(path, init)
/** asList, as the app reads a list (src/care/careApi.ts). */
const listOf = (body: any): any[] => (Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : [])
/** Every key the screen reads is on the row (present, even when null). */
const hasKeys = (row: any, keys: string[]) => expect(keys.filter((k) => !(k in (row || {})))).toEqual([])
const noSnake = (row: any) => expect(Object.keys(row || {}).filter((k) => k.includes('_'))).toEqual([])
const addDays = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10)

beforeAll(async () => {
  t = await bootTenant({ vertical: 'homecare' })
  const seeded = await seedOwner(t)
  const companyId = seeded.company.id
  // The agency's clock is UTC here, so "today" below is the agency's today.
  // Documents to sign are the Documents switch's (2026-10-22: home care's switches hide what they name).
  await t.db.update(t.schema.company).set({ timezone: 'UTC', enabledFeatures: ['documents'] } as any).where(eq(t.schema.company.id, companyId))
  today = new Date().toISOString().slice(0, 10)
  tomorrow = addDays(today, 1)
  tokens.owner = (await login('owner@test.example', seeded.password)).accessToken
  ids.owner = seeded.owner.id
  const hash = await Bun.password.hash('Caregiver-pass-1', 'bcrypt')
  const [ann] = await t.db.insert(t.schema.user).values({ email: 'ann@test.example', passwordHash: hash, firstName: 'Ann', lastName: 'Carer', role: 'field', companyId } as any).returning()
  const [bea] = await t.db.insert(t.schema.user).values({ email: 'bea@test.example', passwordHash: hash, firstName: 'Bea', lastName: 'Cover', role: 'field', companyId } as any).returning()
  const [mo] = await t.db.insert(t.schema.user).values({ email: 'mo@test.example', passwordHash: hash, firstName: 'Mo', lastName: 'Manager', role: 'manager', companyId } as any).returning()
  ids.cg = ann.id; ids.cw = bea.id; ids.mg = mo.id
  tokens.cg = (await login('ann@test.example', 'Caregiver-pass-1')).accessToken
  tokens.cw = (await login('bea@test.example', 'Caregiver-pass-1')).accessToken

  // A Medicaid client whose payer requires Sandata EVV.
  const [rs] = await t.db.insert(t.schema.referralSources).values({ companyId, name: 'Medicaid', sandataEvvRequired: true } as any).returning()
  const [pat] = await t.db.insert(t.schema.clients).values({
    companyId, firstName: 'Pat', lastName: 'Client', isActive: true, address: '1 Main St', city: 'Eau Claire', state: 'WI', zip: '54701',
    phone: '7155550100', latitude: '44.81', longitude: '-91.49', medicaidId: '1234567890', referredById: rs.id, allergies: 'Penicillin',
  } as any).returning()
  ids.pat = pat.id

  const own = as('owner')
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay()
  const rec = await own('/api/schedules', { method: 'POST', json: { caregiverId: ids.cg, clientId: ids.pat, dayOfWeek: dow, startTime: '09:00', endTime: '11:00', notes: 'Bring gloves' } })
  const one = await own('/api/schedules', { method: 'POST', json: { caregiverId: ids.cg, clientId: ids.pat, date: tomorrow, startTime: '13:00', endTime: '15:00' } })
  const cov = await own('/api/schedules', { method: 'POST', json: { caregiverId: ids.cw, clientId: ids.pat, date: tomorrow, startTime: '16:00', endTime: '18:00' } })
  const cov2 = await own('/api/schedules', { method: 'POST', json: { caregiverId: ids.cw, clientId: ids.pat, date: addDays(today, 2), startTime: '08:00', endTime: '10:00' } })
  expect([rec.status, one.status, cov.status, cov2.status]).toEqual([201, 201, 201, 201])
  ids.recSched = rec.body.id; ids.sched = one.body.id; ids.cwSched = cov.body.id; ids.movedIn = cov2.body.id
  // Next week's recurring visit is cancelled; a coworker's visit the day after tomorrow is moved onto Ann.
  await t.db.insert(t.schema.scheduleExceptions).values([
    { companyId, scheduleId: ids.recSched, exceptionDate: addDays(today, 7), exceptionType: 'cancelled' },
    { companyId, scheduleId: cov2.body.id, exceptionDate: addDays(today, 2), exceptionType: 'modified', overrideCaregiverId: ids.cg },
  ] as any)

  expect((await own(`/api/care-tasks/client/${ids.pat}`, { method: 'POST', json: { taskName: 'Help with bathing', category: 'adl', allottedMinutes: 20 } })).status).toBe(200)
  const med = await own('/api/medications', { method: 'POST', json: { clientId: ids.pat, name: 'Lisinopril', dosage: '10 mg', route: 'oral', frequency: 'daily', instructions: 'With food' } })
  expect(med.status).toBe(201)
  ids.med = med.body.id
  expect((await own('/api/care-plans', { method: 'POST', json: { clientId: ids.pat, serviceType: 'Personal care', careGoals: 'Stay home safely', status: 'active', startDate: today } })).status).toBe(201)
  await t.db.insert(t.schema.documents).values({ companyId, entityType: 'company', name: 'Handbook', requiresSignature: true, fileType: 'pdf', description: 'Read me', expirationDate: addDays(today, 30) } as any)
  expect((await own('/api/messages/send', { method: 'POST', json: { subject: 'Welcome', body: 'Hi Ann', recipientIds: [ids.cg] } })).status).toBe(201)
  await t.db.insert(t.schema.notifications).values({ companyId, userId: ids.cg, title: 'Shift reminder', message: 'Pat at 9' } as any)
  expect((await own('/api/open-shifts', { method: 'POST', json: { clientId: ids.pat, date: tomorrow, startTime: '19:00', endTime: '21:00', notes: 'Evening', bonusAmount: 10 } })).status).toBe(201)
  // A coworker asks Ann to take a shift; a client asks to move one of Ann's visits.
  expect((await as('cw')('/api/shift-swaps', { method: 'POST', json: { scheduleId: ids.cwSched, targetCaregiverId: ids.cg, reason: 'Doctor' } })).status).toBe(201)
  await t.db.insert(t.schema.visitChangeRequests).values({
    companyId, clientId: ids.pat, caregiverId: ids.cg, requestType: 'reschedule', scheduleId: ids.sched, visitDate: tomorrow,
    originalStartTime: '13:00', originalEndTime: '15:00', proposedDate: tomorrow, proposedStartTime: '15:00', proposedEndTime: '17:00',
    requestedBy: 'client', requestReason: 'Doctor',
  } as any)
  // Payday verification on, with a payable shift in the last pay period.
  expect((await own('/api/payroll-verification/settings', { method: 'PUT', json: { paydayVerification: true } })).status).toBe(200)
  const period = getCurrentPayPeriod(today)!
  await t.db.insert(t.schema.payrollShiftReviews).values({
    companyId, payPeriodStart: period.start, payPeriodEnd: period.end, caregiverId: ids.cg, clientId: ids.pat, scheduleId: ids.sched,
    shiftDate: period.start, scheduledStart: '09:00', scheduledEnd: '11:00', payableMinutes: 120, status: 'verified',
  } as any)
}, 120_000)

describe('the phone app, as a caregiver, against the unified home care server', () => {
  test('sign-in: the caregiver is the field seat — no office banner, office staff are manager / admin / owner', async () => {
    const me = await cg('/api/auth/me')
    expect(me.status).toBe(200)
    expect(me.body.user.role).toBe('field')
    expect(isFieldRole(me.body.user.role)).toBe(true) // CareContext isCaregiver
    expect(isOfficeRole('manager') && isOfficeRole('admin') && isOfficeRole('owner')).toBe(true)
  })

  test('Today / Schedule: schedule rows (camelCase) expand into visits — moved-in and cancelled days included', async () => {
    const r = await cg(`/api/schedules/${ids.cg}?includeMovedIn=1`)
    expect(r.status).toBe(200)
    const rows = listOf(r.body)
    expect(rows.length).toBe(3)
    for (const s of rows) {
      hasKeys(s, ['id', 'clientId', 'dayOfWeek', 'date', 'startTime', 'endTime', 'notes', 'clientFirstName', 'clientLastName', 'clientAddress', 'clientCity', 'careTypeName', 'isTraining', 'exceptions'])
    }
    const recurring = rows.find((s) => s.id === ids.recSched)
    hasKeys(recurring, ['caregiverId', 'frequency', 'effectiveDate', 'anchorDate', 'endDate', 'suspendedFrom', 'createdAt'])
    hasKeys(recurring.exceptions[0], ['exceptionDate', 'exceptionType', 'overrideStartTime', 'overrideEndTime', 'overrideCaregiverId', 'overrideClientId', 'cancelReason'])
    expect(rows.find((s) => s.movedIn === true)?.date).toBe(addDays(today, 2))
    const visits = expandVisits(rows, today, 14, { [ids.pat]: 'Pat Client' })
    const dates = visits.map((v) => `${v.date} ${v.startTime}`)
    expect(dates).toContain(`${today} 09:00:00`)
    expect(dates).toContain(`${tomorrow} 13:00:00`)
    expect(dates).toContain(`${addDays(today, 2)} 08:00:00`)
    expect(dates).not.toContain(`${addDays(today, 7)} 09:00:00`) // cancelled
    const v = visits.find((x) => x.date === today)!
    expect({ name: v.clientName, addr: v.clientAddress, city: v.clientCity, notes: v.notes }).toEqual({ name: 'Pat Client', addr: '1 Main St', city: 'Eau Claire', notes: 'Bring gloves' })
    expect(visits.find((x) => x.date === addDays(today, 2))?.movedIn).toBe(true)
  })

  test('clients, a client, the care plan, the geofence and the Sandata context', async () => {
    const clients = listOf((await cg('/api/clients')).body)
    expect(clients.map((c) => c.id)).toEqual([ids.pat])
    hasKeys(clients[0], ['id', 'firstName', 'lastName', 'address', 'city', 'state', 'zip', 'phone', 'latitude', 'longitude', 'assistanceNeeds', 'allergies', 'serviceType'])
    const one = await cg(`/api/clients/${ids.pat}`)
    expect(one.status).toBe(200)
    hasKeys(one.body, ['id', 'firstName', 'lastName', 'address', 'city', 'state', 'zip', 'phone', 'allergies', 'assistanceNeeds', 'serviceType'])
    const plans = listOf((await cg(`/api/care-plans?clientId=${encodeURIComponent(ids.pat)}`)).body)
    expect(plans.length).toBe(1)
    hasKeys(plans[0], ['isActive', 'serviceType', 'frequency', 'serviceDescription', 'careGoals', 'specialInstructions', 'precautions', 'medicationNotes', 'mobilityNotes', 'dietaryNotes', 'communicationNotes', 'updatedAt'])
    expect(plans[0].isActive).toBe(true)
    const geo = await cg(`/api/time-entries/geofence/${encodeURIComponent(ids.pat)}`)
    expect(geo.status).toBe(200)
    hasKeys(geo.body, ['settings', 'client'])
    hasKeys(geo.body.client, ['latitude', 'longitude'])
    const ctx = await cg('/api/sandata/caregiver-context')
    hasKeys(ctx.body, ['sandataAgencyId', 'clients', 'activeVisit'])
    hasKeys(ctx.body.clients[0], ['id', 'firstName', 'lastName', 'inSandata', 'medicaidId'])
    expect(needsSandata(ctx.body.clients[0])).toBe(true)
    expect(medicaidIdOf(ctx.body.clients[0])).toBe('1234567890')
  })

  test('a visit: clock in → open visit → tasks, MAR, vitals, photo, warnings → clock out; the Sandata prompt fires', async () => {
    expect((await cg('/api/time-entries/active')).body).toBe(null)
    const inn = await cg('/api/time-entries/clock-in', { method: 'POST', json: { clientId: ids.pat, latitude: 44.81, longitude: -91.49 } })
    expect(inn.status).toBe(201)
    hasKeys(inn.body, ['id', 'clientId', 'startTime', 'sandataRequired'])
    noSnake(inn.body)
    ids.entry = inn.body.id
    const ctx = (await cg('/api/sandata/caregiver-context')).body
    // The app's prompt after a clock-in: the client is in Sandata and the server says this visit goes to Sandata.
    expect(sandataAfterPunch('in', ctx.clients.find((c: any) => c.id === ids.pat), inn.body.sandataRequired))
      .toEqual({ type: 'prompt', kind: 'in', clientId: ids.pat, clientName: 'Pat Client' })
    hasKeys(ctx.activeVisit, ['timeEntryId', 'clientId', 'sandataRequired'])
    expect(ctx.activeVisit.timeEntryId).toBe(ids.entry)

    const active = await cg('/api/time-entries/active')
    expect(active.body).toEqual({ id: ids.entry, clientId: ids.pat, startTime: expect.any(String), clientName: 'Pat Client' })
    expect(Number.isNaN(new Date(active.body.startTime).getTime())).toBe(false)

    expect((await cg(`/api/time-entries/${ids.entry}/gps`, { method: 'POST', json: { latitude: 44.81, longitude: -91.49, accuracy: 5, speed: null, heading: null } })).status).toBe(201)
    const warn = await cg('/api/time-entries/check-warnings', { method: 'POST', json: { timeEntryId: ids.entry } })
    expect(warn.status).toBe(200)
    hasKeys(warn.body, ['warning'])

    const tasks = listOf((await cg(`/api/care-tasks/time-entry/${ids.entry}`)).body)
    expect(tasks.length).toBe(1)
    hasKeys(tasks[0], ['taskId', 'taskName', 'description', 'category', 'allottedMinutes', 'cadence', 'status', 'notes', 'doneThisWeek'])
    expect((await cg(`/api/care-tasks/time-entry/${ids.entry}/${tasks[0].taskId}`, { method: 'PUT', json: { status: 'completed', notes: null } })).status).toBe(200)
    expect(listOf((await cg(`/api/care-tasks/time-entry/${ids.entry}`)).body)[0].status).toBe('completed')

    const meds = listOf((await cg(`/api/medications/due/${ids.pat}`)).body)
    expect(meds.length).toBe(1)
    hasKeys(meds[0], ['id', 'medicationName', 'name', 'dosage', 'route', 'frequency', 'instructions', 'isPrn'])
    expect((await cg('/api/medications/log', { method: 'POST', json: { medicationId: ids.med, clientId: ids.pat, timeEntryId: ids.entry, status: 'given' } })).status).toBe(201)
    const logs = listOf((await cg(`/api/medications/logs/time-entry/${ids.entry}`)).body)
    hasKeys(logs[0], ['medicationId', 'status', 'administeredTime', 'administeredAt'])
    expect(logs[0].medicationId).toBe(ids.med)

    const vit = await cg('/api/medications/vitals', { method: 'POST', json: { clientId: ids.pat, timeEntryId: ids.entry, notes: null, systolicBp: '120', diastolicBp: '80', pulse: '70', temperatureF: '98.6', oxygenSaturation: '97' } })
    expect(vit.status).toBe(201)
    expect(vit.body).toMatchObject({ systolicBp: 120, diastolicBp: 80, pulse: 70, oxygenSaturation: 97, temperatureF: '98.6' })
    const latest = (await cg(`/api/medications/vitals/latest/${ids.pat}`)).body
    hasKeys(latest, ['recordedAt', 'systolicBp', 'diastolicBp', 'pulse', 'temperatureF', 'oxygenSaturation'])

    expect((await cg(`/api/time-entries/${ids.entry}/photos`, { method: 'POST', json: { imageBase64: 'data:image/png;base64,iVBORw0KGgo=', category: 'visit' } })).status).toBe(201)

    const out = await cg(`/api/time-entries/${ids.entry}/clock-out`, { method: 'POST', json: { latitude: 44.81, longitude: -91.49, notes: 'Good visit' } })
    expect(out.status).toBe(200)
    hasKeys(out.body, ['sandataRequired'])
    expect(sandataAfterPunch('out', ctx.clients[0], out.body.sandataRequired)?.type).toBe('prompt')
    expect((await cg(`/api/time-entries/${ids.entry}/late-location`, { method: 'POST', json: { latitude: 44.81, longitude: -91.49, which: 'clock_out' } })).status).toBe(200)

    const recent = listOf((await cg('/api/time-entries/recent?limit=20')).body)
    expect(recent.map((e) => e.id)).toEqual([ids.entry])
    hasKeys(recent[0], ['id', 'clientId', 'startTime', 'endTime', 'notes', 'hoursWorked', 'clientName'])
  })

  test('the Today cards: documents, swaps, requests, hours, payday, counts', async () => {
    const docs = listOf((await cg(`/api/documents/unsigned/${encodeURIComponent(ids.cg)}`)).body)
    expect(docs.length).toBe(1)
    hasKeys(docs[0], ['id', 'name', 'description', 'fileType', 'fileName', 'expirationDate'])
    const swaps = listOf((await cg('/api/shift-swaps')).body)
    const incoming = swaps.filter((s) => s.targetId === ids.cg && s.status === 'pending')
    expect(incoming.length).toBe(1)
    hasKeys(incoming[0], ['id', 'requesterId', 'targetId', 'shiftDate', 'startTime', 'endTime', 'status', 'reason', 'clientFirstName', 'clientLastName', 'requesterFirstName', 'requesterLastName', 'targetFirstName', 'targetLastName'])
    const reqs = listOf((await cg('/api/visit-change-requests')).body)
    const fromClient = reqs.filter((r) => r.requestedBy === 'client')
    expect(fromClient.length).toBe(1)
    hasKeys(fromClient[0], ['id', 'scheduleId', 'visitDate', 'requestType', 'originalStartTime', 'proposedDate', 'proposedStartTime', 'proposedEndTime', 'cancelReason', 'requestReason', 'counterDate', 'counterStartTime', 'counterMessage', 'status', 'clientFirstName', 'clientLastName'])
    const hours = await cg(`/api/scheduling/caregiver-hours/${encodeURIComponent(ids.cg)}`)
    expect(hours.status).toBe(200)
    expect(Number.isFinite(parseFloat(hours.body.totalHours))).toBe(true)
    const pay = (await cg('/api/payroll-verification/me/pending')).body.pending
    hasKeys(pay, ['payPeriodStart', 'payPeriodEnd', 'payDate', 'totalHours', 'hourlyRate', 'grossPay', 'shifts'])
    hasKeys(pay.shifts[0], ['id', 'shiftDate', 'scheduledStart', 'scheduledEnd', 'payableMinutes', 'clientFirst', 'clientLast'])
    expect(typeof (await cg('/api/messages/unread-count')).body.count).toBe('number')
    expect(typeof (await cg('/api/push/unread-count')).body.count).toBe('number')
  })

  test('requests and swaps the caregiver sends from a visit, and the answers', async () => {
    const move = await cg('/api/visit-change-requests/reschedule-request', { method: 'POST', json: {
      scheduleId: ids.movedIn, visitDate: addDays(today, 2), startTime: '08:00:00', endTime: '10:00:00', proposedDate: addDays(today, 3), proposedStartTime: '08:00', proposedEndTime: '10:00', reason: 'appt',
    } })
    expect({ s: move.status, b: move.body }).toEqual({ s: 201, b: expect.anything() })
    const mine = listOf((await cg('/api/visit-change-requests')).body).filter((r) => r.requestedBy === 'caregiver')
    expect(mine.map((r) => `${r.scheduleId}|${String(r.visitDate).slice(0, 10)}`)).toEqual([`${ids.movedIn}|${addDays(today, 2)}`]) // care-schedule "Move sent"
    const swap = await cg('/api/shift-swaps', { method: 'POST', json: { scheduleId: ids.sched, targetCaregiverId: ids.cw, reason: 'Exam', shiftDate: tomorrow } })
    expect(swap.status).toBe(201)
    expect((await cg(`/api/shift-swaps/${swap.body.id}/cancel`, { method: 'PUT', json: {} })).status).toBe(200)
    const incoming = listOf((await cg('/api/shift-swaps')).body).find((s) => s.targetId === ids.cg)
    expect((await cg(`/api/shift-swaps/${incoming.id}/respond`, { method: 'PUT', json: { accepted: false } })).status).toBe(200)
    const client = listOf((await cg('/api/visit-change-requests')).body).find((r) => r.requestedBy === 'client')
    expect((await cg(`/api/visit-change-requests/${client.id}/resolve`, { method: 'PUT', json: { action: 'counter', counterDate: tomorrow, counterStartTime: '16:00', counterEndTime: '18:00', counterMessage: null } })).status).toBe(200)
    // Coworkers to ask (shift-action) are the field seats; the office to message (compose) is manager / admin / owner.
    const users = listOf((await cg('/api/messages/users')).body)
    for (const u of users) hasKeys(u, ['id', 'firstName', 'lastName', 'role'])
    expect(users.filter((u) => isFieldRole(u.role) && u.id !== ids.cg).map((u) => u.id)).toEqual([ids.cw])
    expect(users.filter((u) => isOfficeRole(u.role)).map((u) => u.id).sort()).toEqual([ids.mg, ids.owner].sort())
    const missed = await cg('/api/emergency/miss-report', { method: 'POST', json: { scheduleId: ids.sched, date: tomorrow, reason: 'Family emergency', alternativeContact: null } })
    expect(missed.status).toBeLessThan(300)
    const na = await cg('/api/emergency/client-unavailable', { method: 'POST', json: { scheduleId: ids.recSched, date: today, reason: 'client_not_home', note: null } })
    expect(na.status).toBeLessThan(300)
  })

  test('messages: inbox, thread, reply, a new message to the office', async () => {
    const inbox = listOf((await cg('/api/messages/inbox')).body)
    expect(inbox.length).toBe(1)
    hasKeys(inbox[0], ['id', 'subject', 'unread', 'latestMessage', 'updatedAt'])
    hasKeys(inbox[0].latestMessage, ['body', 'senderName', 'createdAt'])
    const th = await cg(`/api/messages/thread/${inbox[0].id}`)
    hasKeys(th.body, ['thread', 'messages'])
    hasKeys(th.body.thread, ['subject'])
    hasKeys(th.body.messages[0], ['id', 'senderId', 'senderName', 'body', 'createdAt', 'isDeleted'])
    expect((await cg(`/api/messages/thread/${inbox[0].id}/reply`, { method: 'POST', json: { body: 'Thanks' } })).status).toBe(201)
    const sent = await cg('/api/messages/send', { method: 'POST', json: { subject: 'Late', body: 'Running late', recipientIds: [ids.mg] } })
    expect(sent.status).toBe(201)
    expect(typeof sent.body.thread.id).toBe('string')
  })

  test('incident, mileage, notifications, open shifts, documents signing, payday answer, push token', async () => {
    const mc = listOf((await cg('/api/incidents/my-clients')).body)
    hasKeys(mc[0], ['id', 'firstName', 'lastName'])
    const inc = await cg('/api/incidents/caregiver-report', { method: 'POST', json: {
      clientId: ids.pat, incidentType: 'fall', incidentDate: today, incidentTime: null, description: 'Slipped', injuriesOrDamage: '', actionsTaken: '', witnesses: '', photos: [],
    } })
    expect(inc.status).toBe(201)
    hasKeys(inc.body, ['incidentNumber'])

    expect((await cg('/api/mileage', { method: 'POST', json: { caregiverId: ids.cg, date: today, startLocation: 'Home', endLocation: 'Pat', miles: '4.5', clientId: ids.pat, notes: null } })).status).toBe(201)
    const trips = listOf((await cg(`/api/mileage?caregiverId=${encodeURIComponent(ids.cg)}&limit=30`)).body)
    expect(trips.length).toBe(1)
    hasKeys(trips[0], ['id', 'caregiverId', 'date', 'miles', 'startLocation', 'endLocation', 'clientName'])

    const notes = listOf((await cg('/api/notifications')).body)
    expect(notes.length).toBeGreaterThan(0)
    for (const n of notes) hasKeys(n, ['id', 'title', 'message', 'isRead', 'status', 'createdAt'])
    expect((await cg('/api/push/mark-read', { method: 'POST', json: { ids: [notes[0].id] } })).status).toBe(200)
    expect((await cg('/api/push/mark-read', { method: 'POST', json: { ids: 'all' } })).status).toBe(200)
    expect((await cg('/api/push/unread-count')).body.count).toBe(0)

    const open = listOf((await cg('/api/open-shifts/available')).body)
    // The office's posted evening shift, and the urgent one Ann's "can't make it" posted above.
    expect(open.length).toBe(2)
    for (const s of open) hasKeys(s, ['id', 'shiftDate', 'startTime', 'endTime', 'clientFirstName', 'clientLastName', 'bonusAmount', 'urgency', 'notes'])
    const evening = open.find((s) => s.notes === 'Evening')
    expect({ date: evening.shiftDate, start: evening.startTime, end: evening.endTime, client: evening.clientFirstName, bonus: Number(evening.bonusAmount) })
      .toEqual({ date: tomorrow, start: '19:00:00', end: '21:00:00', client: 'Pat', bonus: 10 })
    const claim = await cg(`/api/open-shifts/${evening.id}/claim`, { method: 'POST', json: {} })
    expect(claim.status).toBe(200)
    hasKeys(claim.body, ['assigned', 'message'])

    const doc = listOf((await cg(`/api/documents/unsigned/${encodeURIComponent(ids.cg)}`)).body)[0]
    expect((await cg(`/api/documents/${doc.id}/sign`, { method: 'POST', json: { signatureImageBase64: 'data:image/svg+xml;base64,PHN2Zy8+', typedName: 'Ann Carer' } })).status).toBeLessThan(300)
    expect(listOf((await cg(`/api/documents/unsigned/${encodeURIComponent(ids.cg)}`)).body).length).toBe(0)

    const pay = (await cg('/api/payroll-verification/me/pending')).body.pending
    const verify = await cg('/api/payroll-verification/me/verify', { method: 'POST', json: {
      payPeriodStart: pay.payPeriodStart, payPeriodEnd: pay.payPeriodEnd, confirmed: true, disputeReason: null, reportedTotalHours: pay.totalHours, reportedGrossPay: pay.grossPay,
    } })
    expect(verify.status).toBe(200)
    expect((await cg('/api/payroll-verification/me/pending')).body.pending).toBe(null)

    const push = await cg('/api/push/expo-token', { method: 'POST', json: { token: 'ExponentPushToken[caregiver-phone-1]', platform: 'ios' } })
    expect(push.status).toBe(201)
    const [row] = await t.db.select().from(t.schema.expoPushTokens).where(eq(t.schema.expoPushTokens.token, 'ExponentPushToken[caregiver-phone-1]'))
    expect(row?.userId).toBe(ids.cg)
  })
})
