// CALL RECORDING on the tracking numbers Twomiah sells (CallRail's call recording; crm/comms/calltracking.ts + recordings.ts).
// Through the real server as field service, against a stand-in Twilio (nothing leaves the machine):
//   · off until the owner turns it on (Call Tracking › Settings), with the notice the caller hears and the days kept checked;
//   · on: the caller hears the notice first, then the call rings through recorded (both sides, from the answer);
//   · a finished recording is filed on its call — also when it comes in before the call's own report (the call is read from Twilio
//     and logged first); an unsigned one is refused;
//   · the screens are told a call has a recording and how long, never Twilio's address; it plays through the app (private,
//     no-store) and can be deleted (at Twilio, then off the call);
//   · a recording older than the days kept is deleted by the daily sweep.
import { test, expect, beforeAll, afterAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { twilioSignatureFor } from '@twomiah/tenant-backend'
import { bootTenant, seedOwner } from './harness.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = '', token = ''
const TOKEN = 'platform-token'
const AC = 'AC' + '0'.repeat(32)
const RE = (n: number) => 'RE' + String(n).padStart(32, '0')
const CA = (n: number) => 'CA' + String(n).padStart(32, '0')
const recUrl = (n: number) => `https://api.twilio.com/2010-04-01/Accounts/${AC}/Recordings/${RE(n)}`
const twilioAsked: Array<{ method: string; url: string; auth: string }> = []
const realFetch = globalThis.fetch
const call = (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } })
const json = async (r: Response) => ({ status: r.status, body: await r.json() as any })
function twilio(path: string, params: Record<string, string>, signWith: string | null = TOKEN) {
  const url = `http://localhost${path}`
  const headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded' }
  if (signWith) headers['x-twilio-signature'] = twilioSignatureFor(signWith, url, params)
  return t.app.request(url, { method: 'POST', headers, body: new URLSearchParams(params).toString() })
}
const callRow = async (sid: string) => (await (t.db as any).select().from(t.schema.callLog).where(eq(t.schema.callLog.providerId, sid)))[0]

beforeAll(async () => {
  Object.assign(process.env, { TWILIO_ACCOUNT_SID: AC, TWILIO_AUTH_TOKEN: TOKEN })
  t = await bootTenant({ vertical: 'fieldservice' })
  const s = await seedOwner(t)
  companyId = s.company.id
  await t.db.update(t.schema.company).set({ enabledFeatures: ['contacts', 'jobs', 'call_tracking', 'call_tracking_numbers'] } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
  token = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json() as any).accessToken
  await (t.db as any).insert(t.schema.trackingNumber).values({ companyId, phoneNumber: '+17155550123', forwardTo: '+17155550100', name: 'Google Ads', source: 'google', active: true })
  globalThis.fetch = (async (input: any, init: any = {}) => {
    const url = String(input?.url ?? input)
    if (!url.startsWith('https://api.twilio.com/')) return realFetch(input, init)
    const method = init.method || 'GET'
    twilioAsked.push({ method, url, auth: String(init.headers?.Authorization || '') })
    if (method === 'GET' && url.endsWith('.mp3')) return new Response(new Uint8Array([0x49, 0x44, 0x33, 1, 2, 3]), { status: 200, headers: { 'content-type': 'audio/mpeg' } })
    if (method === 'DELETE' && /\/Recordings\/RE\d+\.json$/.test(url)) return new Response(null, { status: 204 })
    const c = /\/Calls\/(CA\d+)\.json$/.exec(url)
    if (c) return new Response(JSON.stringify({ sid: c[1], from: '+16085550199', to: '+17155550123', status: 'completed', duration: '75', direction: 'inbound' }), { status: 200 })
    return new Response(JSON.stringify({ message: 'unexpected' }), { status: 404 })
  }) as any
}, 120_000)
afterAll(() => { globalThis.fetch = realFetch })

test('off until turned on: the call rings straight through, unrecorded', async () => {
  const s = await json(await call('/api/calltracking/settings'))
  expect(s.body).toMatchObject({ callRecording: false, callRecordingNotice: 'This call may be recorded for quality and training.', callRecordingKeepDays: 365 })
  const x = await (await twilio(`/api/calltracking/voice/${companyId}`, { From: '+16085550199', To: '+17155550123', CallSid: CA(1) })).text()
  expect(x).not.toContain('record=')
  expect(x).not.toContain('<Say>')
  expect(x).toContain('<Number>+17155550100</Number>')
})

test('turned on by the owner, the notice and the days kept checked', async () => {
  expect((await call('/api/calltracking/settings', { method: 'PUT', json: { callRecordingKeepDays: 7 } })).status).toBe(400)
  expect((await call('/api/calltracking/settings', { method: 'PUT', json: { callRecordingNotice: 'x'.repeat(301) } })).status).toBe(400)
  const r = await json(await call('/api/calltracking/settings', { method: 'PUT', json: { callRecording: true, callRecordingNotice: 'Calls are recorded so we get your job right.', callRecordingKeepDays: 90 } }))
  expect(r.status).toBe(200)
  expect(r.body).toMatchObject({ callRecording: true, callRecordingNotice: 'Calls are recorded so we get your job right.', callRecordingKeepDays: 90 })
  const audit = (await (t.db as any).select().from(t.schema.auditLog)).filter((a: any) => a.entityId === companyId)
  expect(audit.some((a: any) => a.metadata?.description === 'Call recording turned on')).toBe(true)
})

test('on: the caller hears the notice, then the call rings through recorded, both sides', async () => {
  const x = await (await twilio(`/api/calltracking/voice/${companyId}`, { From: '+16085550199', To: '+17155550123', CallSid: CA(2) })).text()
  expect(x.indexOf('<Say>Calls are recorded so we get your job right.</Say>')).toBeGreaterThan(-1)
  expect(x.indexOf('<Say>')).toBeLessThan(x.indexOf('<Dial'))
  expect(x).toContain('record="record-from-answer-dual"')
  expect(x).toContain(`recordingStatusCallback="https://localhost/api/calltracking/webhook/twilio-recording/${companyId}"`)
})

test('a finished recording is filed on its call; the screens are told it is there and how long, never where', async () => {
  await twilio(`/api/calltracking/webhook/twilio/${companyId}`, { CallSid: CA(2), From: '+16085550199', To: '+17155550123', CallStatus: 'completed', CallDuration: '60', Direction: 'inbound' })
  const r = await twilio(`/api/calltracking/webhook/twilio-recording/${companyId}`, { CallSid: CA(2), RecordingSid: RE(2), RecordingUrl: recUrl(2), RecordingStatus: 'completed', RecordingDuration: '58' })
  expect(r.status).toBe(200)
  expect(await callRow(CA(2))).toMatchObject({ recordingSid: RE(2), recordingSeconds: 58, recordingUrl: recUrl(2) })
  const list = await json(await call('/api/calltracking/calls'))
  const row = list.body.data.find((x: any) => x.providerId === CA(2))
  expect(row.recording).toEqual({ seconds: 58 })
  expect(row.recordingUrl).toBeNull()
  expect(row.recordingSid).toBeUndefined()
  expect(JSON.stringify(list.body)).not.toContain('api.twilio.com')
  const one = await json(await call(`/api/calltracking/calls/${row.id}`))
  expect(one.body.recording).toEqual({ seconds: 58 })
  expect(JSON.stringify(one.body)).not.toContain('api.twilio.com')
})

test("a recording before the call's own report: the call is read from Twilio and logged first; unsigned or unfinished is not filed", async () => {
  expect((await twilio(`/api/calltracking/webhook/twilio-recording/${companyId}`, { CallSid: CA(3), RecordingSid: RE(3), RecordingUrl: recUrl(3), RecordingStatus: 'completed', RecordingDuration: '10' }, 'wrong-token')).status).toBe(403)
  expect(await callRow(CA(3))).toBeUndefined()
  await twilio(`/api/calltracking/webhook/twilio-recording/${companyId}`, { CallSid: CA(3), RecordingSid: RE(3), RecordingUrl: recUrl(3), RecordingStatus: 'absent', RecordingDuration: '0' })
  expect(await callRow(CA(3))).toBeUndefined()
  await twilio(`/api/calltracking/webhook/twilio-recording/${companyId}`, { CallSid: CA(3), RecordingSid: RE(3), RecordingUrl: recUrl(3), RecordingStatus: 'completed', RecordingDuration: '70' })
  expect(await callRow(CA(3))).toMatchObject({ callerNumber: '+16085550199', duration: 75, recordingSid: RE(3), recordingSeconds: 70 })
  expect(twilioAsked.some((a) => a.url.endsWith(`/Calls/${CA(3)}.json`) && a.auth === 'Basic ' + Buffer.from(`${AC}:${TOKEN}`).toString('base64'))).toBe(true)
  // A recording at an address that is not Twilio's is not filed.
  await twilio(`/api/calltracking/webhook/twilio-recording/${companyId}`, { CallSid: CA(2), RecordingSid: RE(9), RecordingUrl: 'https://evil.example/r.mp3', RecordingStatus: 'completed', RecordingDuration: '5' })
  expect((await callRow(CA(2))).recordingSid).toBe(RE(2))
})

test('it plays through the app, never cached; deleting it deletes it at Twilio, then off the call', async () => {
  const id = (await callRow(CA(2))).id
  const a = await call(`/api/calltracking/calls/${id}/recording`)
  expect(a.status).toBe(200)
  expect(a.headers.get('content-type')).toBe('audio/mpeg')
  expect(a.headers.get('cache-control')).toBe('private, no-store')
  expect(new Uint8Array(await a.arrayBuffer()).slice(0, 3)).toEqual(new Uint8Array([0x49, 0x44, 0x33]))
  expect((await t.call(`/api/calltracking/calls/${id}/recording`)).status).toBe(401)
  const del = await call(`/api/calltracking/calls/${id}/recording`, { method: 'DELETE' })
  expect(del.status).toBe(200)
  expect(twilioAsked.some((x) => x.method === 'DELETE' && x.url.endsWith(`/Recordings/${RE(2)}.json`))).toBe(true)
  expect(await callRow(CA(2))).toMatchObject({ recordingSid: null, recordingUrl: null, recordingSeconds: null })
  expect((await call(`/api/calltracking/calls/${id}/recording`)).status).toBe(404)
})

test('older than the days kept: deleted by the daily sweep; a newer one stays', async () => {
  const old = await callRow(CA(3))
  await (t.db as any).update(t.schema.callLog).set({ startTime: new Date(Date.now() - 100 * 86_400_000) }).where(eq(t.schema.callLog.id, old.id))
  await twilio(`/api/calltracking/webhook/twilio/${companyId}`, { CallSid: CA(4), From: '+16085550198', To: '+17155550123', CallStatus: 'completed', CallDuration: '30', Direction: 'inbound' })
  await twilio(`/api/calltracking/webhook/twilio-recording/${companyId}`, { CallSid: CA(4), RecordingSid: RE(4), RecordingUrl: recUrl(4), RecordingStatus: 'completed', RecordingDuration: '28' })
  await (t.services.crm as any).eventJobs.callRecordingSweep()
  expect((await callRow(CA(3))).recordingSid).toBeNull()
  expect((await callRow(CA(4))).recordingSid).toBe(RE(4))
  expect(twilioAsked.some((x) => x.method === 'DELETE' && x.url.endsWith(`/Recordings/${RE(3)}.json`))).toBe(true)
})
