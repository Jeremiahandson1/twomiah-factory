// The AI Receptionist's phone line (server/crm/comms/aiReceptionist.ts, Twilio's voice webhooks). Its greeting and
// forwarding number were saved and nothing used them (matrix 10/23). Now Twilio's voice URL for the business's number
// answers in TwiML: the call rings the forwarding number; not picked up — or no forwarding number — the caller hears
// the greeting and leaves a message; the missed-call rules reply once, the voicemail rules once more after the message.
// Signed like Twilio signs (X-Twilio-Signature with the company's auth token). No text or call leaves: the texting
// service is a recorder; no OpenAI key, so nothing is transcribed.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { twilioSignatureFor } from '@twomiah/tenant-backend'
import { bootTenant, seedOwner } from './harness.ts'

const json = async (r: Response) => (await r.json()) as any
const TOKEN = 'twilio-auth-token-test'
let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = ''
let owner: (p: string, init?: any) => Promise<Response>
const texts: any[] = []

/** A request as Twilio makes it: form-encoded, signed over the full URL and the sorted parameters. */
function twilio(path: string, params: Record<string, string>, sign = true) {
  const url = `http://localhost${path}`
  const headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded' }
  if (sign) headers['x-twilio-signature'] = twilioSignatureFor(TOKEN, url, params)
  return Promise.resolve(t.app.request(url, { method: 'POST', headers, body: new URLSearchParams(params).toString() }))
}
const callRow = async (sid: string) => (await t.db.select().from(t.schema.callLog).where(eq(t.schema.callLog.providerId, sid)))
const until = async (ok: () => boolean, ms = 3000) => { const end = Date.now() + ms; while (!ok() && Date.now() < end) await new Promise((r) => setTimeout(r, 25)) }
const settings = (body: any) => owner('/api/ai-receptionist/settings', { method: 'PUT', json: body })

beforeAll(async () => {
  t = await bootTenant()
  const s = await seedOwner(t)
  companyId = s.company.id
  await t.db.update(t.schema.company).set({ name: 'Tom & Jerry’s <Plumbing>', twilioAccountSid: 'AC00000000000000000000000000000000', twilioAuthToken: TOKEN, enabledFeatures: ['contacts', 'ai_receptionist', 'call_tracking'] } as any).where(eq(t.schema.company.id, companyId))
  const tok = (await json(await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } }))).accessToken
  owner = (p, init = {}) => Promise.resolve(t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tok}` } }))
  ;(t.services.crm.sms as any).sendSMS = async (_c: string, m: any) => { texts.push(m); return { status: 'sent' } }
  await t.db.insert(t.schema.aiReceptionistRule).values([
    { companyId, name: 'Missed', trigger: 'missed_call', channel: 'sms', messageTemplate: 'Sorry we missed you — {{company}} will call back.' },
    { companyId, name: 'Voicemail', trigger: 'voicemail', channel: 'sms', messageTemplate: 'Got your message.' },
    // Fires on a missed call AND on a voicemail outside hours — the rule that would answer one call twice.
    { companyId, name: 'After hours', trigger: 'after_hours', channel: 'sms', messageTemplate: 'We are closed now.' },
  ] as any)
}, 120_000)

describe('the settings', () => {
  test('a forwarding number that cannot be rung is refused; a real one is kept as typed', async () => {
    const bad = await settings({ forwardingNumber: '555-12' })
    expect(bad.status).toBe(400)
    expect((await json(bad)).fields).toEqual({ forwardingNumber: 'Enter a 10-digit US phone number' })
    // Hours that make every minute "after hours" (start 23:59, end 00:00), so the after-hours rule fires whatever the clock.
    const ok = await settings({ isEnabled: true, businessHoursStart: '23:59', businessHoursEnd: '00:00', forwardingNumber: '(608) 555-0111', greetingText: 'You reached Tom & Jerry’s. Leave a message <please>.' })
    expect(ok.status).toBe(200)
    expect((await json(ok)).forwardingNumber).toBe('(608) 555-0111')
  })
})

describe('the line', () => {
  test('an unsigned call is refused', async () => {
    expect((await twilio(`/api/ai-receptionist/webhook/voice/${companyId}`, { CallSid: 'CAX', From: '+16085550199', To: '+16085550100' }, false)).status).toBe(403)
  })

  test('a call rings the forwarding number for 20 seconds, and is in the call log', async () => {
    const r = await twilio(`/api/ai-receptionist/webhook/voice/${companyId}`, { CallSid: 'CA1', From: '+16085550199', To: '+16085550100', FromCity: 'MADISON', FromState: 'WI' })
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toContain('text/xml')
    expect(await r.text()).toBe(`<?xml version="1.0" encoding="UTF-8"?><Response><Dial timeout="20" action="/api/ai-receptionist/webhook/dial-result/${companyId}" method="POST">+16085550111</Dial></Response>`)
    const [row] = await callRow('CA1')
    expect(row).toMatchObject({ status: 'ringing', callerNumber: '+16085550199', direction: 'inbound' })
  })

  test('picked up: the call is done — completed, and nobody is texted', async () => {
    const r = await twilio(`/api/ai-receptionist/webhook/dial-result/${companyId}`, { CallSid: 'CA1', DialCallStatus: 'completed', From: '+16085550199' })
    expect(await r.text()).toContain('<Response><Hangup/></Response>')
    expect((await callRow('CA1'))[0].status).toBe('completed')
    await new Promise((res) => setTimeout(res, 100))
    expect(texts).toEqual([])
  })

  test('not picked up: the greeting (escaped) and a recorded message; the missed-call reply goes once', async () => {
    await twilio(`/api/ai-receptionist/webhook/voice/${companyId}`, { CallSid: 'CA2', From: '+16085550198', To: '+16085550100' })
    const r = await twilio(`/api/ai-receptionist/webhook/dial-result/${companyId}`, { CallSid: 'CA2', DialCallStatus: 'no-answer', From: '+16085550198' })
    const body = await r.text()
    expect(body).toContain('<Say voice="alice">You reached Tom &amp; Jerry’s. Leave a message &lt;please&gt;.</Say>')
    expect(body).toContain(`<Record maxLength="120" playBeep="true" timeout="5" action="/api/ai-receptionist/webhook/voicemail-done/${companyId}" method="POST" recordingStatusCallback="/api/ai-receptionist/webhook/recording/${companyId}" recordingStatusCallbackMethod="POST" recordingStatusCallbackEvent="completed"/>`)
    expect((await callRow('CA2'))[0].status).toBe('missed')
    await until(() => texts.length > 1)
    expect(texts.map((m) => [m.toPhone, m.message]).sort()).toEqual([['+16085550198', 'Sorry we missed you — Tom & Jerry’s <Plumbing> will call back.'], ['+16085550198', 'We are closed now.']])
    expect((await callRow('CA2'))[0].aiResponseSent).toBe(true)
    expect(await (await twilio(`/api/ai-receptionist/webhook/voicemail-done/${companyId}`, { CallSid: 'CA2' })).text()).toContain('<Hangup/>')
  })

  test('the message arrives: the call is a voicemail, and only the voicemail rules reply — not the missed-call or after-hours one again', async () => {
    texts.length = 0
    const r = await twilio(`/api/ai-receptionist/webhook/recording/${companyId}`, { CallSid: 'CA2', RecordingUrl: 'https://api.twilio.com/2010-04-01/Accounts/AC0/Recordings/RE1', RecordingStatus: 'completed' })
    expect(r.status).toBe(200)
    await until(() => texts.length > 0)
    await new Promise((res) => setTimeout(res, 100))
    expect(texts.map((m) => m.message)).toEqual(['Got your message.'])
    expect((await callRow('CA2'))[0].status).toBe('voicemail')
  })

  test("call tracking's end-of-call report updates the same row — never a second one, never un-missing it", async () => {
    const r = await twilio(`/api/calltracking/webhook/twilio/${companyId}`, { CallSid: 'CA2', CallStatus: 'completed', CallDuration: '48', From: '+16085550198', To: '+16085550100', Direction: 'inbound' })
    expect(r.status).toBe(200)
    const rows = await callRow('CA2')
    expect(rows.length).toBe(1)
    expect(rows[0]).toMatchObject({ status: 'voicemail', duration: 48 })
  })

  test('no forwarding number: straight to the greeting — the plain one when none is written', async () => {
    texts.length = 0
    expect((await settings({ forwardingNumber: null, greetingText: null })).status).toBe(200)
    const r = await twilio(`/api/ai-receptionist/webhook/voice/${companyId}`, { CallSid: 'CA3', From: '+16085550197', To: '+16085550100' })
    const body = await r.text()
    expect(body).not.toContain('<Dial')
    expect(body).toContain('<Say voice="alice">Thanks for calling Tom &amp; Jerry’s &lt;Plumbing&gt;. We can&apos;t'.replace('&apos;', "'"))
    expect(body).toContain('<Record ')
    await until(() => texts.length > 1)
    expect(texts.map((m) => m.toPhone)).toEqual(['+16085550197', '+16085550197'])
  })

  test('the receptionist switched off: the call still rings and takes a message, but nobody is texted', async () => {
    texts.length = 0
    expect((await settings({ isEnabled: false, forwardingNumber: '6085550111' })).status).toBe(200)
    await twilio(`/api/ai-receptionist/webhook/voice/${companyId}`, { CallSid: 'CA4', From: '+16085550196', To: '+16085550100' })
    const r = await twilio(`/api/ai-receptionist/webhook/dial-result/${companyId}`, { CallSid: 'CA4', DialCallStatus: 'busy', From: '+16085550196' })
    expect(await r.text()).toContain('<Record ')
    await new Promise((res) => setTimeout(res, 150))
    expect(texts).toEqual([])
  })
})
