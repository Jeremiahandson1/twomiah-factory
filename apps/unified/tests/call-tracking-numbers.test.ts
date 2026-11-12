// Tracking numbers from Twomiah (crm/comms/trackingLines.ts + calltracking.ts POST /voice; feature call_tracking_numbers, not
// ready) — ServiceTitan's built-in call tracking, no CallRail account. Through the real server as field service, against a
// stand-in Factory: a number is bought with this app's own call addresses, kept as a tracking number, given back; the first
// one returns a checkout; the Factory's list is the truth (a number bought after its checkout appears; one given back is
// switched off). A call to the number rings the business's line, showing the caller — signed by Twilio, Twomiah's account
// even where the business has its own; an unknown number says it is not in service. No live Twilio or Factory call is made.
import { test, expect, beforeAll, afterAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { twilioSignatureFor, FEATURE_REGISTRY } from '@twomiah/tenant-backend'
import { bootTenant, seedOwner } from './harness.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = '', token = ''
const TOKEN = 'platform-token'
const PN = 'PN' + 'a'.repeat(32)
const asked: Array<{ method: string; path: string; body: any }> = []
let factoryLines: any[] = []
let subscribed = false
const realFetch = globalThis.fetch
const call = (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } })
const json = async (r: Response) => ({ status: r.status, body: await r.json() as any })
function twilio(path: string, params: Record<string, string>, signWith: string | null = TOKEN) {
  const url = `http://localhost${path}`
  const headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded' }
  if (signWith) headers['x-twilio-signature'] = twilioSignatureFor(signWith, url, params)
  return t.app.request(url, { method: 'POST', headers, body: new URLSearchParams(params).toString() })
}

beforeAll(async () => {
  Object.assign(process.env, { FACTORY_URL: 'https://factory.test', TENANT_ID: 'tenant-1', FACTORY_SYNC_KEY: 'k', RENDER_EXTERNAL_URL: 'https://acme-app.test', TWILIO_ACCOUNT_SID: 'AC-platform', TWILIO_AUTH_TOKEN: TOKEN })
  t = await bootTenant({ vertical: 'fieldservice' })
  const s = await seedOwner(t)
  companyId = s.company.id
  await t.db.update(t.schema.company).set({ enabledFeatures: ['contacts', 'jobs', 'call_tracking', 'call_tracking_numbers'] } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
  token = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json() as any).accessToken
  globalThis.fetch = (async (input: any, init: any = {}) => {
    const url = String(input?.url ?? input)
    if (!url.startsWith('https://factory.test/')) return realFetch(input, init)
    const path = url.slice('https://factory.test'.length)
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined
    asked.push({ method: init.method || 'GET', path, body })
    const ok = (j: any, status = 200) => new Response(JSON.stringify(j), { status, headers: { 'content-type': 'application/json' } })
    if (init.headers?.['X-Factory-Key'] !== 'k') return ok({ error: 'Unauthorized' }, 401)
    if (path.endsWith('/numbers') && init.method === 'GET') return ok({ monthlyCents: 300, subscribed, lines: factoryLines })
    if (path.endsWith('/numbers') && init.method === 'POST') {
      if (!subscribed) return ok({ checkoutUrl: 'https://checkout.stripe.test/c/1' })
      const line = { sid: PN, phoneNumber: '+17155550123', label: body.label, forwardTo: '+17155550100', boughtAt: '2026-11-11T12:00:00Z' }
      factoryLines.push(line)
      return ok({ line }, 201)
    }
    if (path.endsWith('/release')) { factoryLines = factoryLines.filter((l) => !path.includes(l.sid)); return ok({ success: true }) }
    return ok({ error: 'unexpected ' + path }, 404)
  }) as any
}, 120_000)
afterAll(() => { globalThis.fetch = realFetch })

test('call_tracking_numbers is registered, not ready, where call tracking is', () => {
  const f = (FEATURE_REGISTRY as any[]).find((x) => x.id === 'call_tracking_numbers')
  expect(f.hidden).toBeFalsy()
  expect(f.templates).toContain('crm-fieldservice')
})

test("the first number: the Factory's checkout comes back, with this app's own call addresses", async () => {
  const r = await json(await call('/api/calltracking-lines', { method: 'POST', json: { label: 'Google Ads', forwardTo: '715-555-0100', areaCode: '715' } }))
  expect(r).toEqual({ status: 200, body: { checkoutUrl: 'https://checkout.stripe.test/c/1' } })
  expect(asked.at(-1)).toMatchObject({ method: 'POST', path: '/api/v1/factory/internal/calltracking/self/tenant-1/numbers', body: {
    label: 'Google Ads', forwardTo: '715-555-0100', areaCode: '715',
    voiceUrl: `https://acme-app.test/api/calltracking/voice/${companyId}`, statusUrl: `https://acme-app.test/api/calltracking/webhook/twilio/${companyId}`,
    returnUrl: 'https://acme-app.test/crm/call-tracking',
  } })
  // Not asked for nonsense.
  expect((await call('/api/calltracking-lines', { method: 'POST', json: { label: ' ', forwardTo: '715-555-0100' } })).status).toBe(400)
  expect((await call('/api/calltracking-lines', { method: 'POST', json: { label: 'Yard signs', forwardTo: '555' } })).status).toBe(400)
})

test("paid: the Factory's list brings the number in as a tracking number, ringing the business's line", async () => {
  subscribed = true
  factoryLines = [{ sid: PN, phoneNumber: '+17155550123', label: 'Google Ads', forwardTo: '+17155550100', boughtAt: '2026-11-11T12:00:00Z' }]
  const r = await json(await call('/api/calltracking-lines'))
  expect(r.body).toMatchObject({ monthlyCents: 300, subscribed: true })
  expect(r.body.numbers.map((n: any) => [n.phoneNumber, n.forwardTo, n.source, n.provider, n.providerId, n.active])).toEqual([['+17155550123', '+17155550100', 'Google Ads', 'twomiah', PN, true]])
  // Asked again, still one.
  expect((await json(await call('/api/calltracking-lines'))).body.numbers.length).toBe(1)
})

test("a call to it rings the business's line, showing the caller; only Twilio's signature is let in", async () => {
  const params = { CallSid: 'CA1', From: '+16085550142', To: '+17155550123', Direction: 'inbound', CallStatus: 'ringing' }
  const r = await twilio(`/api/calltracking/voice/${companyId}`, params)
  expect(r.status).toBe(200)
  expect(r.headers.get('content-type')).toContain('xml')
  expect(await r.text()).toBe('<?xml version="1.0" encoding="UTF-8"?><Response><Dial answerOnBridge="true" callerId="+16085550142"><Number>+17155550100</Number></Dial></Response>')
  expect((await twilio(`/api/calltracking/voice/${companyId}`, params, null)).status).toBe(403)
  expect((await twilio(`/api/calltracking/voice/${companyId}`, params, 'someone-else')).status).toBe(403)
  const unknown = await twilio(`/api/calltracking/voice/${companyId}`, { ...params, To: '+17155559999' })
  expect(await unknown.text()).toContain('<Say>This number is not in service.</Say><Hangup/>')
})

test("a business with its own Twilio account still gets the calls to Twomiah's numbers", async () => {
  await t.db.update(t.schema.company).set({ integrations: { twilioAccountSid: 'AC-own', twilioAuthToken: 'own-token' } } as any).where(eq(t.schema.company.id, companyId))
  const params = { CallSid: 'CA2', From: '+16085550142', To: '+17155550123', Direction: 'inbound', CallStatus: 'ringing' }
  expect((await twilio(`/api/calltracking/voice/${companyId}`, params, TOKEN)).status).toBe(200)
  expect((await twilio(`/api/calltracking/voice/${companyId}`, params, 'own-token')).status).toBe(200)
  await t.db.update(t.schema.company).set({ integrations: {} } as any).where(eq(t.schema.company.id, companyId))
})

test('given back: the Factory releases it, and it stops ringing', async () => {
  const id = (await json(await call('/api/calltracking-lines'))).body.numbers[0].id
  expect((await json(await call(`/api/calltracking-lines/${id}/release`, { method: 'POST', json: {} }))).status).toBe(200)
  expect(asked.at(-1)!.path).toBe(`/api/v1/factory/internal/calltracking/self/tenant-1/numbers/${PN}/release`)
  expect((await json(await call('/api/calltracking-lines'))).body.numbers).toEqual([])
  const r = await twilio(`/api/calltracking/voice/${companyId}`, { CallSid: 'CA3', From: '+16085550142', To: '+17155550123', Direction: 'inbound', CallStatus: 'ringing' })
  expect(await r.text()).toContain('not in service')
})

test('switched off: the numbers are closed', async () => {
  await t.db.update(t.schema.company).set({ enabledFeatures: ['contacts', 'jobs', 'call_tracking'] } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
  expect([403, 404]).toContain((await call('/api/calltracking-lines')).status)
})
