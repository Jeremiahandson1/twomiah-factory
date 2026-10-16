// A provider webhook proves it IS the provider before anything is written. (10/15)
//
// Until 10/15 POST /api/calltracking/webhook/{callrail,twilio,:provider}/:companyId and
// /api/ai-receptionist/webhook/{recording,status}/:companyId accepted ANY caller: anyone with a company id
// could write call-log rows, file contacts and fire the AI receptionist's missed-call rules. This drives
// the REAL routes with NODE_ENV=production: unsigned and forged requests are refused 403 and leave the
// call log as it was; a correctly signed one is accepted and logged. The CallRail signature is computed
// with CallRail's own rule, and the body is CallRail's official sample (tests/shared/fixtures).
// Twins: tests/homecare/webhook-signatures-homecare.test.ts, tests/roof/webhook-signatures-roof.test.ts.
import { Hono } from 'hono'
import crypto from 'node:crypto'
import { readFileSync } from 'node:fs'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user, contact } from './db/schema.ts'
import { eq, sql } from 'drizzle-orm'
import { errorHandler } from './src/utils/errors.ts'
import { twilioSignatureFor, callRailSignatureFor } from './src/shared/index.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 360)) }
}

await setupSchema()
const TOKEN = 'company-own-twilio-token-0123456789'
const [co] = await db.insert(company).values({
  name: 'Signed Calls Co', slug: 'signed-calls', email: 'sc@test.local', settings: {},
  enabledFeatures: ['call_tracking', 'ai_receptionist', 'contacts'],
  integrations: { twilioAccountSid: 'AC' + '0'.repeat(32), twilioAuthToken: TOKEN, twilioPhoneNumber: '+16085559999' },
} as any).returning()
const [noTwilio] = await db.insert(company).values({ name: 'No Twilio Co', slug: 'no-twilio', email: 'nt@test.local', settings: {}, enabledFeatures: ['call_tracking'] } as any).returning()
const mk = async (role: string) => (await db.insert(user).values({ email: `${role}-wh@test.local`, passwordHash: 'x', firstName: role, lastName: 'W', role, companyId: co.id, isActive: true } as any).returning())[0]
const owner = await mk('owner'), admin = await mk('admin'), manager = await mk('manager')

const app = new Hono()
app.route('/api/calltracking', (await import('./src/routes/calltracking.ts')).default)
app.route('/api/ai-receptionist', (await import('./src/routes/aiReceptionist.ts')).default)
app.onError(errorHandler)

// Production from here on: the verifiers read NODE_ENV per request.
process.env.NODE_ENV = 'production'
delete process.env.TWILIO_AUTH_TOKEN

const send = async (path: string, body: string, headers: Record<string, string>) => {
  const res = await app.request(path, { method: 'POST', headers, body })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j, text: t }
}
const as = (who: any) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, { method, headers: { 'content-type': 'application/json', 'x-test-user': who.id, 'x-test-company': co.id, 'x-test-role': who.role }, body: body === undefined ? undefined : JSON.stringify(body) })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j, text: t }
}
const rowsOf = (r: any) => (Array.isArray(r) ? r : r?.rows || []) as any[]
const callLog = async (id = co.id) => rowsOf(await db.execute(sql`SELECT caller_number, caller_name, provider_id FROM call_log WHERE company_id = ${id} ORDER BY created_at`))
const contacts = async () => (await db.select().from(contact).where(eq(contact.companyId, co.id))).length
const form = (p: Record<string, string>) => new URLSearchParams(p).toString()

const VECTOR = readFileSync((process.env.FACTORY_ROOT || '') + 'tests/shared/fixtures/callrail-vector.json', 'utf8').replace(/\r?\n$/, '')
const KEY = '072e77e426f92738a72fe23c4d1953b4'
const CALLRAIL = `/api/calltracking/webhook/callrail/${co.id}`

console.log('\n══════════ CallRail, before the owner has pasted a signing key ══════════')
{
  const r = await send(CALLRAIL, VECTOR, { 'content-type': 'application/json', signature: callRailSignatureFor(KEY, VECTOR) })
  check('refused 403 in production', r.status === 403, { status: r.status, body: r.text })
  check('…and the body says which key is missing', /CallRail signing key not configured/.test(r.json?.reason || ''), r.json)
  check('…and nothing was logged', (await callLog()).length === 0)
}

console.log('\n══════════ the owner pastes the key (Call Tracking › Settings) ══════════')
{
  const m = await as(manager)('PUT', '/api/calltracking/settings', { callrailSigningKey: KEY })
  check('a manager may not set it (integrations:update is owner + admin)', m.status === 403, { status: m.status })
  const mg = await as(manager)('GET', '/api/calltracking/settings')
  check('…nor read whether one is set', mg.status === 403, { status: mg.status })
  const bad = await as(owner)('PUT', '/api/calltracking/settings', { callrailSigningKey: 'has spaces in it' })
  check('a key with spaces is refused 400', bad.status === 400, bad.json)
  const r = await as(owner)('PUT', '/api/calltracking/settings', { callrailSigningKey: KEY })
  check('the owner sets it', r.status === 200 && r.json?.callrailSigningKeySet === true, r.json)
  const g = await as(admin)('GET', '/api/calltracking/settings')
  check('an admin reads "set"', g.status === 200 && g.json?.callrailSigningKeySet === true, g.json)
  check('…and the key itself is never in the answer', !g.text.includes(KEY) && !r.text.includes(KEY), g.text)
  check('…which hands out the CallRail webhook URL for this company', String(g.json?.callrailWebhookUrl || '').endsWith(`/api/calltracking/webhook/callrail/${co.id}`), g.json)
  const [row]: any[] = await db.select().from(company).where(eq(company.id, co.id))
  check('stored on the company row', row.callrailSigningKey === KEY)
  const { sanitizeCompany } = await import('./src/shared/index.ts')
  check('…and stripped by sanitizeCompany, which every company response goes through', !('callrailSigningKey' in sanitizeCompany(row)))
}

console.log('\n══════════ CallRail, forged ══════════')
{
  const none = await send(CALLRAIL, VECTOR, { 'content-type': 'application/json' })
  check('no Signature header → 403', none.status === 403, { status: none.status })
  const wrongKey = await send(CALLRAIL, VECTOR, { 'content-type': 'application/json', signature: callRailSignatureFor('not-the-key-0000', VECTOR) })
  check('signed with another key → 403', wrongKey.status === 403)
  const forged = VECTOR.replace('+12148654559', '+19995550000')
  const tampered = await send(CALLRAIL, forged, { 'content-type': 'application/json', signature: callRailSignatureFor(KEY, VECTOR) })
  check('a body changed after signing → 403', tampered.status === 403)
  const otherCo = await send(`/api/calltracking/webhook/callrail/${noTwilio.id}`, VECTOR, { 'content-type': 'application/json', signature: callRailSignatureFor(KEY, VECTOR) })
  check('one company\'s signature does not open another company\'s webhook (no key there) → 403', otherCo.status === 403)
  check('nothing was logged by any of them', (await callLog()).length === 0 && (await callLog(noTwilio.id)).length === 0)
  check('…and no contact was made', (await contacts()) === 0)
}

console.log('\n══════════ CallRail, genuine ══════════')
{
  const r = await send(CALLRAIL, VECTOR, { 'content-type': 'application/json', signature: callRailSignatureFor(KEY, VECTOR) })
  check('accepted 200', r.status === 200, { status: r.status, body: r.text })
  const log = await callLog()
  check('ONE call logged', log.length === 1, log)
  check('…with the caller CallRail sent (customer_phone_number — the old mapper read a field CallRail never sends)', log[0]?.caller_number === '+12148654559' && log[0]?.caller_name === 'Kaylah Mills', log[0])
  check('…and CallRail\'s call id', log[0]?.provider_id === '766970532', log[0])
}

console.log('\n══════════ Twilio call webhook ══════════')
const TWILIO = `/api/calltracking/webhook/twilio/${co.id}`
const call = { CallSid: 'CA-wh-1', From: '+16085550123', To: '+16085559999', CallStatus: 'completed', CallDuration: '42', Direction: 'inbound', FromCity: 'MADISON', FromState: 'WI' }
{
  const before = (await callLog()).length
  const unsigned = await send(TWILIO, form(call), { 'content-type': 'application/x-www-form-urlencoded' })
  check('unsigned → 403', unsigned.status === 403, { status: unsigned.status })
  const forged = await send(TWILIO, form(call), { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': twilioSignatureFor('wrong-token', `http://localhost${TWILIO}`, call) })
  check('signed with the wrong token → 403', forged.status === 403)
  const tampered = await send(TWILIO, form({ ...call, From: '+19995550000' }), { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': twilioSignatureFor(TOKEN, `http://localhost${TWILIO}`, call) })
  check('a param changed after signing → 403', tampered.status === 403)
  check('nothing logged', (await callLog()).length === before)
  const ok = await send(TWILIO, form(call), { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': twilioSignatureFor(TOKEN, `http://localhost${TWILIO}`, call) })
  check('signed with the company\'s own token, FORM-encoded (what Twilio sends) → 200', ok.status === 200, { status: ok.status, body: ok.text })
  const log = await callLog()
  check('…and the call is logged with its caller (the form body is read — c.req.json() threw on it before)', log.length === before + 1 && log.some((l) => l.caller_number === '+16085550123' && l.provider_id === 'CA-wh-1'), log)
  const none = await send(`/api/calltracking/webhook/twilio/${noTwilio.id}`, form(call), { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': twilioSignatureFor(TOKEN, `http://localhost/api/calltracking/webhook/twilio/${noTwilio.id}`, call) })
  check('a company with no Twilio token anywhere → 403, naming TWILIO_AUTH_TOKEN', none.status === 403 && /TWILIO_AUTH_TOKEN/.test(none.json?.reason || ''), none.json)
}

console.log('\n══════════ the catch-all /webhook/:provider/:companyId is gone ══════════')
{
  const before = (await callLog()).length
  const r = await send(`/api/calltracking/webhook/anything/${co.id}`, JSON.stringify({ callerNumber: '+15550009999' }), { 'content-type': 'application/json' })
  check('it is not answered 200 any more', r.status !== 200, { status: r.status })
  check('…and it wrote nothing', (await callLog()).length === before)
}

console.log('\n══════════ AI receptionist: recording + status callbacks ══════════')
{
  const STATUS = `/api/ai-receptionist/webhook/status/${co.id}`
  const p = { CallSid: 'CA-wh-2', From: '+16085550123', To: '+16085559999', CallStatus: 'no-answer' }
  const u = await send(STATUS, form(p), { 'content-type': 'application/x-www-form-urlencoded' })
  check('status: unsigned → 403', u.status === 403, { status: u.status })
  const s = await send(STATUS, form(p), { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': twilioSignatureFor(TOKEN, `http://localhost${STATUS}`, p) })
  check('status: signed → 200', s.status === 200, { status: s.status, body: s.text })
  const REC = `/api/ai-receptionist/webhook/recording/${co.id}`
  const rp = { CallSid: 'CA-wh-3', RecordingUrl: 'https://api.twilio.com/rec/RE1', RecordingSid: 'RE1' }
  const ru = await send(REC, form(rp), { 'content-type': 'application/x-www-form-urlencoded' })
  check('recording: unsigned → 403', ru.status === 403)
  const rj = await send(REC, JSON.stringify(rp), { 'content-type': 'application/json', 'x-twilio-signature': 'forged' })
  check('recording: a JSON body with a made-up signature → 403', rj.status === 403)
}

process.env.NODE_ENV = 'test'
console.log('\n══════════ outside production, no key configured: allowed (local dev, this harness) ══════════')
{
  const r = await send(`/api/calltracking/webhook/twilio/${noTwilio.id}`, JSON.stringify({ ...call, CallSid: 'CA-dev' }), { 'content-type': 'application/json' })
  check('a JSON Twilio body with no token anywhere → 200 outside production', r.status === 200, { status: r.status, body: r.text })
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
