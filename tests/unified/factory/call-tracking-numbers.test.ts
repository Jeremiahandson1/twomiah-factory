// Call tracking numbers sold by Twomiah (apps/api/src/services/callTrackingNumbers.ts) against a fake Twilio that records every
// call: a number is bought pointed at the business's own CRM (voice + status addresses), kept, given back; the first number
// rides a paid checkout's metadata; a lapsed subscription gives every number back; each finished call is charged to the
// wallet once, at exactly Twilio's price for the call in and its forward out, and a call Twilio has not priced yet waits.
// The Factory DB is a stand-in; the wallet is a recorder; nothing reaches Twilio or Stripe.
import { test, expect, beforeEach } from 'bun:test'
import { stubAuth } from './stubs.ts'
import { sharedFactoryDb } from './fakeStore.ts'

process.env.TWOMIAH_TWILIO_ACCOUNT_SID = 'AC-isv'
process.env.TWOMIAH_TWILIO_AUTH_TOKEN = 'isv-token'

const supabase = sharedFactoryDb
const debits: Array<{ tenantId: string; hc: number; reason: string; ref: string }> = []
stubAuth({ supabase, authenticate: async () => {}, requireRole: () => async () => {} })
const svc = await import('../../../apps/api/src/services/callTrackingNumbers.ts')
const { crmOrigins } = await import('../../../apps/api/src/routes/factory/callTracking.ts')

type Call = { method: string; url: string; form: URLSearchParams }
let calls: Call[] = []
let twilioCalls: Record<string, any[]> = {}
let kids: Record<string, any[]> = {}
const PN = (c: string) => 'PN' + c.repeat(32)
const realFetch = globalThis.fetch
beforeEach(() => {
  supabase.rpc = async (_fn: string, a: any) => { debits.push({ tenantId: a.p_tenant, hc: a.p_amount, reason: a.p_reason, ref: a.p_twilio_ref }); supabase.tables.messaging_ledger.push({ tenant_id: a.p_tenant, twilio_ref: a.p_twilio_ref }); return { data: 0, error: null } }
  supabase.tables.tenants = [{ id: 't-1', name: 'Acme HVAC', render_backend_url: 'https://acme-app.test', domain: 'acmehvac.com', factory_sync_key: 'k', calltrack_sub_id: null }]
  supabase.tables.call_tracking_numbers = []
  supabase.tables.messaging_ledger = []
  calls = []; debits.length = 0; twilioCalls = {}; kids = {}
  globalThis.fetch = (async (input: any, init: any = {}) => {
    const url = String(input), method = init.method || 'GET'
    calls.push({ method, url, form: new URLSearchParams(typeof init.body === 'string' ? init.body : '') })
    const ok = (j: any) => new Response(JSON.stringify(j), { status: 200, headers: { 'content-type': 'application/json' } })
    if (url.includes('/AvailablePhoneNumbers/US/Local.json')) return ok({ available_phone_numbers: url.includes('AreaCode=999') ? [] : [{ phone_number: '+17155550123' }] })
    if (method === 'POST' && url.endsWith('/IncomingPhoneNumbers.json')) return ok({ sid: PN('a'), phone_number: '+17155550123' })
    if (method === 'DELETE' && url.includes('/IncomingPhoneNumbers/')) return new Response(null, { status: 204 })
    if (url.includes('/Calls.json?ParentCallSid=')) return ok({ calls: kids[/ParentCallSid=(\w+)/.exec(url)![1]] || [] })
    if (url.includes('/Calls.json?To=')) return ok({ calls: twilioCalls[decodeURIComponent(/To=([^&]+)/.exec(url)![1])] || [] })
    return new Response(JSON.stringify({ message: 'unexpected ' + method + ' ' + url }), { status: 404 })
  }) as any
})
process.on('exit', () => { globalThis.fetch = realFetch })

const REQ = { label: 'Google Ads', forwardTo: '(715) 555-0100', areaCode: '715', voiceUrl: 'https://acme-app.test/api/calltracking/voice/co-1', statusUrl: 'https://acme-app.test/api/calltracking/webhook/twilio/co-1' }

test('a number is bought in the area code, pointed at the business\'s own CRM, and kept', async () => {
  const line = await svc.buyLine('t-1', REQ)
  expect(line).toMatchObject({ sid: PN('a'), phoneNumber: '+17155550123', label: 'Google Ads', forwardTo: '+17155550100' })
  const search = calls.find((c) => c.url.includes('AvailablePhoneNumbers'))!
  expect(search.url).toContain('VoiceEnabled=true'); expect(search.url).toContain('AreaCode=715')
  const buy = calls.find((c) => c.method === 'POST' && c.url.endsWith('/IncomingPhoneNumbers.json'))!
  expect(Object.fromEntries(buy.form)).toMatchObject({ PhoneNumber: '+17155550123', VoiceUrl: REQ.voiceUrl, VoiceMethod: 'POST', StatusCallback: REQ.statusUrl, StatusCallbackMethod: 'POST' })
  expect(buy.url).toContain('/Accounts/AC-isv/')
  expect((await svc.activeLines('t-1')).map((l) => l.phoneNumber)).toEqual(['+17155550123'])
})

test('no number in that area code: tried anywhere, then said plainly', async () => {
  await svc.buyLine('t-1', { ...REQ, areaCode: '999' })
  expect(calls.filter((c) => c.url.includes('AvailablePhoneNumbers')).map((c) => c.url.includes('AreaCode'))).toEqual([true, false])
})

test('given back: released at Twilio, no longer held — and not another business\'s', async () => {
  await svc.buyLine('t-1', REQ)
  expect(await svc.releaseLine('t-2', PN('a'))).toBe(false)
  expect(await svc.releaseLine('t-1', PN('a'))).toBe(true)
  expect(calls.some((c) => c.method === 'DELETE' && c.url.endsWith(`/IncomingPhoneNumbers/${PN('a')}.json`))).toBe(true)
  expect(await svc.activeLines('t-1')).toEqual([])
  expect(await svc.releaseLine('t-1', PN('a'))).toBe(false)
})

test("what a buy asks for is checked: a name, a US line to ring, and only the business's own app as the call addresses", () => {
  expect(svc.buyProblem(REQ, 'https://acme-app.test')).toBeNull()
  expect(svc.buyProblem({ ...REQ, label: ' ' }, 'https://acme-app.test')).toContain('Name the number')
  expect(svc.buyProblem({ ...REQ, forwardTo: '555' }, 'https://acme-app.test')).toContain('US phone number')
  expect(svc.buyProblem({ ...REQ, areaCode: '71' }, 'https://acme-app.test')).toContain('three digits')
  expect(svc.buyProblem({ ...REQ, voiceUrl: 'https://evil.example/x' }, 'https://acme-app.test')).toContain('own app')
  expect(svc.buyProblem({ ...REQ, statusUrl: 'http://acme-app.test/x' }, 'https://acme-app.test')).toContain('own app')
  expect(crmOrigins(supabase.tables.tenants[0])).toEqual(['https://acme-app.test', 'https://acmehvac.com', 'https://www.acmehvac.com'])
})

test('the first number: its request rides the checkout, and is bought once paid; the subscription is kept', async () => {
  const meta = { addon: 'calltrack_numbers', tenant_id: 't-1', ...svc.pendingToMeta(REQ) }
  expect(svc.pendingFromMeta(meta)).toEqual({ label: 'Google Ads', forwardTo: '+17155550100', areaCode: '715', voiceUrl: REQ.voiceUrl, statusUrl: REQ.statusUrl })
  const line = await svc.onCheckoutPaid('t-1', 'sub_ct', meta)
  expect(line?.phoneNumber).toBe('+17155550123')
  expect(supabase.tables.tenants[0].calltrack_sub_id).toBe('sub_ct')
})

test('the subscription ended: every number goes back to Twilio', async () => {
  await svc.buyLine('t-1', REQ)
  supabase.tables.tenants[0].calltrack_sub_id = 'sub_ct'
  expect(await svc.onSubscriptionEnded('t-1')).toBe(1)
  expect(await svc.activeLines('t-1')).toEqual([])
  expect(supabase.tables.tenants[0].calltrack_sub_id).toBeNull()
})

test("each call is charged once, at Twilio's price for the call in and the forward out; one not yet priced waits", async () => {
  await svc.buyLine('t-1', REQ)
  twilioCalls['+17155550123'] = [
    { sid: 'CA1', status: 'completed', price: '-0.00850' },          // 1 minute in…
    { sid: 'CA2', status: 'completed', price: null },                // Twilio has not priced it yet
    { sid: 'CA3', status: 'in-progress', price: null },              // still on the line
  ]
  kids.CA1 = [{ sid: 'CA1-out', status: 'completed', price: '-0.01400' }] // …and its forward to the business's line
  expect(await svc.billCalls()).toEqual({ calls: 1, hc: 85 + 140 })
  expect(debits).toEqual([{ tenantId: 't-1', hc: 225, reason: 'call_tracking_call', ref: 'call:CA1' }])
  // The next pass: CA1 is not charged again; CA2 now priced is.
  twilioCalls['+17155550123'][1].price = '-0.01700'
  kids.CA2 = [{ sid: 'CA2-out', status: 'completed', price: '-0.02800' }]
  expect(await svc.billCalls()).toEqual({ calls: 1, hc: 170 + 280 })
  expect(debits.map((d) => d.ref)).toEqual(['call:CA1', 'call:CA2'])
})

test('Twilio prices to hundredths of a cent, exactly', () => {
  expect([svc.priceHc('-0.00850'), svc.priceHc('-0.0225'), svc.priceHc(null), svc.priceHc('')]).toEqual([85, 225, null, null])
  expect(svc.e164('715-555-0100')).toBe('+17155550100')
  expect(svc.e164('1 (715) 555 0100')).toBe('+17155550100')
  expect(svc.e164('555-0100')).toBeNull()
})
