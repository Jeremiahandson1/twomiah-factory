// A provider webhook proves it IS the provider before anything is written — homecare. (10/15)
//
// homecare's call-tracking and AI-receptionist webhooks (/:agencyId) accepted any caller, and its forked
// lead inbox took lead email from anyone (POST /api/leads/inbound/email had no check at all) and lead
// webhooks from anyone who knew the agency id (?company_id=). Real routes, NODE_ENV=production: unsigned
// and forged requests are refused and nothing is written; correctly signed ones are accepted.
// Twin: tests/crm/webhook-signatures-crm.test.ts.
import { Hono } from 'hono'
import { readFileSync } from 'node:fs'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { agencies, users, lead, leadSource } from './db/schema.ts'
import { eq, sql } from 'drizzle-orm'
import { twilioSignatureFor, callRailSignatureFor } from './src/shared/index.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 360)) }
}

await setupSchema()
const TOKEN = 'agency-own-twilio-token-0123456789'
const [ag] = await db.insert(agencies).values({ name: 'Signed Care', slug: 'signed-care', twilioAccountSid: 'AC' + '1'.repeat(32), twilioAuthToken: TOKEN, twilioPhoneNumber: '+16085558888' } as any).returning()
const mk = async (role: string) => (await db.insert(users).values({ email: `${role}-whc@test.local`, passwordHash: 'x', firstName: role, lastName: 'W', role } as any).returning())[0]
const owner = await mk('owner'), caregiver = await mk('caregiver')

const app = new Hono()
app.route('/api/calltracking', (await import('./src/routes/calltracking.ts')).default)
app.route('/api/ai-receptionist', (await import('./src/routes/aiReceptionist.ts')).default)
app.route('/api/leads', (await import('./src/routes/leads.ts')).default)

process.env.NODE_ENV = 'production'
delete process.env.TWILIO_AUTH_TOKEN
const FACTORY_KEY = 'factory-sync-key-for-this-test-0001'
process.env.FACTORY_SYNC_KEY = FACTORY_KEY

const send = async (path: string, body: string, headers: Record<string, string>) => {
  const res = await app.request(path, { method: 'POST', headers, body })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j, text: t }
}
const as = (who: any) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, { method, headers: { 'content-type': 'application/json', 'x-test-user': who.id, 'x-test-company': ag.id, 'x-test-role': who.role }, body: body === undefined ? undefined : JSON.stringify(body) })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j, text: t }
}
const rowsOf = (r: any) => (Array.isArray(r) ? r : r?.rows || []) as any[]
const callLog = async () => rowsOf(await db.execute(sql`SELECT caller_number, provider_id FROM call_log WHERE agency_id = ${ag.id}`))
const leads = async () => (await db.select().from(lead)).length
const form = (p: Record<string, string>) => new URLSearchParams(p).toString()
const VECTOR = readFileSync((process.env.FACTORY_ROOT || '') + 'tests/shared/fixtures/callrail-vector.json', 'utf8').replace(/\r?\n$/, '')
const KEY = '072e77e426f92738a72fe23c4d1953b4'

console.log('\n══════════ CallRail ══════════')
{
  const CR = `/api/calltracking/webhook/callrail/${ag.id}`
  const noKey = await send(CR, VECTOR, { 'content-type': 'application/json', signature: callRailSignatureFor(KEY, VECTOR) })
  check('no signing key set → 403, naming the missing key', noKey.status === 403 && /CallRail signing key not configured/.test(noKey.json?.reason || ''), noKey.json)
  const cg = await as(caregiver)('PUT', '/api/calltracking/settings', { callrailSigningKey: KEY })
  check('a caregiver may not set the key', cg.status === 403, { status: cg.status })
  const set = await as(owner)('PUT', '/api/calltracking/settings', { callrailSigningKey: KEY })
  check('the owner sets it', set.status === 200 && set.json?.callrailSigningKeySet === true, set.json)
  const g = await as(owner)('GET', '/api/calltracking/settings')
  check('GET says "set" and never returns the key', g.json?.callrailSigningKeySet === true && !g.text.includes(KEY), g.text)
  const forged = await send(CR, VECTOR.replace('Kaylah', 'Mallory'), { 'content-type': 'application/json', signature: callRailSignatureFor(KEY, VECTOR) })
  check('a body changed after signing → 403', forged.status === 403)
  const none = await send(CR, VECTOR, { 'content-type': 'application/json' })
  check('no Signature header → 403', none.status === 403)
  check('nothing logged', (await callLog()).length === 0)
  const ok = await send(CR, VECTOR, { 'content-type': 'application/json', signature: callRailSignatureFor(KEY, VECTOR) })
  check('genuine → 200 and logged with CallRail\'s caller', ok.status === 200 && (await callLog()).some((r) => r.caller_number === '+12148654559'), { status: ok.status, log: await callLog() })
}

console.log('\n══════════ Twilio (calls + AI receptionist) ══════════')
{
  const TW = `/api/calltracking/webhook/twilio/${ag.id}`
  const p = { CallSid: 'CA-hc-1', From: '+16085550101', To: '+16085558888', CallStatus: 'completed', CallDuration: '5', Direction: 'inbound' }
  const before = (await callLog()).length
  check('call webhook unsigned → 403', (await send(TW, form(p), { 'content-type': 'application/x-www-form-urlencoded' })).status === 403)
  check('call webhook, wrong token → 403', (await send(TW, form(p), { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': twilioSignatureFor('nope', `http://localhost${TW}`, p) })).status === 403)
  check('nothing logged', (await callLog()).length === before)
  const ok = await send(TW, form(p), { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': twilioSignatureFor(TOKEN, `http://localhost${TW}`, p) })
  check('signed with the agency\'s token, form-encoded → 200 and logged', ok.status === 200 && (await callLog()).some((r) => r.provider_id === 'CA-hc-1'), { status: ok.status, body: ok.text })
  const ST = `/api/ai-receptionist/webhook/status/${ag.id}`
  const sp = { CallSid: 'CA-hc-2', From: '+16085550101', CallStatus: 'no-answer' }
  check('AI receptionist status, unsigned → 403', (await send(ST, form(sp), { 'content-type': 'application/x-www-form-urlencoded' })).status === 403)
  check('AI receptionist status, signed → 200', (await send(ST, form(sp), { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': twilioSignatureFor(TOKEN, `http://localhost${ST}`, sp) })).status === 200)
  const RC = `/api/ai-receptionist/webhook/recording/${ag.id}`
  check('AI receptionist recording, unsigned → 403', (await send(RC, form({ CallSid: 'x', RecordingUrl: 'https://e.example/r' }), { 'content-type': 'application/x-www-form-urlencoded' })).status === 403)
  const gone = await send(`/api/calltracking/webhook/whatever/${ag.id}`, '{}', { 'content-type': 'application/json' })
  check('the catch-all /webhook/:provider/:agencyId is gone', gone.status !== 200, { status: gone.status })
}

console.log('\n══════════ the forked lead inbox: /inbound/email asks for the Factory key ══════════')
{
  const [src] = await db.insert(leadSource).values({ platform: 'care_com', label: 'Care.com', enabled: true, webhookSecret: 'src-secret-123', companyId: ag.id } as any).returning()
  const email = JSON.stringify({ platform: 'care_com', from: 'Care.com <noreply@care.com>', subject: 'New lead: Pat Doe', text: 'Name: Pat Doe\nPhone: 608-555-0199', html: '' })
  const n0 = await leads()
  const none = await send('/api/leads/inbound/email', email, { 'content-type': 'application/json' })
  check('no X-Factory-Key → 401 (it took the email from anyone)', none.status === 401, { status: none.status })
  const wrong = await send('/api/leads/inbound/email', email, { 'content-type': 'application/json', 'X-Factory-Key': 'not-the-key' })
  check('the wrong key → 401', wrong.status === 401)
  const oldShape = await send('/api/leads/inbound/email', JSON.stringify({ to: `leads+${ag.id.slice(0, 8)}-care_com@inbound.twomiah.com`, subject: 'x', text: 'y' }), { 'content-type': 'application/json' })
  check('the old unauthenticated `to`-address shape is refused too', oldShape.status === 401)
  check('nothing filed', (await leads()) === n0)
  const ok = await send('/api/leads/inbound/email', email, { 'content-type': 'application/json', 'X-Factory-Key': FACTORY_KEY })
  check('the Factory\'s own post ({platform, …} + X-Factory-Key) → 201', ok.status === 201, { status: ok.status, body: ok.text })
  check('…and files ONE lead', (await leads()) === n0 + 1)
  delete process.env.FACTORY_SYNC_KEY
  const unset = await send('/api/leads/inbound/email', email, { 'content-type': 'application/json', 'X-Factory-Key': FACTORY_KEY })
  check('FACTORY_SYNC_KEY unset → 503, as the shared module answers', unset.status === 503, { status: unset.status })
  process.env.FACTORY_SYNC_KEY = FACTORY_KEY

  console.log('\n══════════ …and /inbound/webhook/:source asks for the source\'s secret ══════════')
  const n1 = await leads()
  const byId = await send(`/api/leads/inbound/webhook/care_com?company_id=${ag.id}`, JSON.stringify({ name: 'Mallory' }), { 'content-type': 'application/json' })
  check('?company_id= with no secret → 401 (it filed the lead)', byId.status === 401, { status: byId.status })
  const wrongSecret = await send('/api/leads/inbound/webhook/care_com?secret=guess', JSON.stringify({ name: 'Mallory' }), { 'content-type': 'application/json' })
  check('a wrong secret → 404', wrongSecret.status === 404)
  check('nothing filed', (await leads()) === n1)
  const good = await send('/api/leads/inbound/webhook/care_com', JSON.stringify({ name: 'Real Lead', phone: '6085550111' }), { 'content-type': 'application/json', 'x-webhook-secret': src.webhookSecret })
  check('the source\'s secret → 201 and filed', good.status === 201 && (await leads()) === n1 + 1, { status: good.status, body: good.text })
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
