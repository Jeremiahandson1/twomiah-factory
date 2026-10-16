// A provider webhook proves it IS the provider before anything is written — roof. (10/15)
//
// Roof had the same unsigned call-tracking and AI-receptionist webhooks as the other CRMs, plus two of
// its own: the inbound-SMS webhook (index.ts exempts it from auth because it "verifies itself" — it did
// not) and the forked lead inbox's /inbound/email, which had no check at all. Real routes,
// NODE_ENV=production: forged → refused, nothing written; signed → accepted.
// Twins: tests/crm/webhook-signatures-crm.test.ts, tests/homecare/webhook-signatures-homecare.test.ts.
import { Hono } from 'hono'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user, lead, leadSource, smsMessage, contact } from './db/schema.ts'
import { eq, sql } from 'drizzle-orm'
// crm-roof has no shared errorHandler export — the same inline handler its other suites use.
const errorHandler = (err: any, c: any) => c.json({ error: err?.message || 'Internal error' }, err?.status || 500)
import { twilioSignatureFor } from './src/shared/index.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 360)) }
}

await setupSchema()
const TOKEN = 'roof-own-twilio-token-0123456789ab'
const NUMBER = '+16085557777'
const [co] = await db.insert(company).values({
  name: 'Signed Roofing', slug: 'signed-roofing', email: 'sr@test.local', settings: {},
  enabledFeatures: ['ai_receptionist', 'two_way_texting', 'lead_inbox', 'contacts'],
  twilioAccountSid: 'AC' + '2'.repeat(32), twilioAuthToken: TOKEN, twilioPhoneNumber: NUMBER,
} as any).returning()
await db.insert(user).values({ email: 'owner-whr@test.local', passwordHash: 'x', firstName: 'O', lastName: 'R', role: 'owner', companyId: co.id, isActive: true } as any)

const app = new Hono()
app.route('/api/calltracking', (await import('./src/routes/calltracking.ts')).default)
app.route('/api/ai-receptionist', (await import('./src/routes/aiReceptionist.ts')).default)
app.route('/api/sms', (await import('./src/routes/sms.ts')).default)
app.route('/api/leads', (await import('./src/routes/leads.ts')).default)
app.onError(errorHandler)

process.env.NODE_ENV = 'production'
delete process.env.TWILIO_AUTH_TOKEN
const FACTORY_KEY = 'roof-factory-sync-key-000000000001'
process.env.FACTORY_SYNC_KEY = FACTORY_KEY

const send = async (path: string, body: string, headers: Record<string, string>) => {
  const res = await app.request(path, { method: 'POST', headers, body })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j, text: t }
}
const rowsOf = (r: any) => (Array.isArray(r) ? r : r?.rows || []) as any[]
const callLog = async () => rowsOf(await db.execute(sql`SELECT provider_id FROM call_log WHERE company_id = ${co.id}`))
const texts = async () => (await db.select().from(smsMessage).where(eq(smsMessage.companyId, co.id))).length
const leads = async () => (await db.select().from(lead)).length
const form = (p: Record<string, string>) => new URLSearchParams(p).toString()
const FORM = { 'content-type': 'application/x-www-form-urlencoded' }

console.log('\n══════════ Twilio call webhook ══════════')
{
  const TW = `/api/calltracking/webhook/twilio/${co.id}`
  const p = { CallSid: 'CA-rf-1', From: '+16085550202', To: NUMBER, CallStatus: 'completed', CallDuration: '9', Direction: 'inbound' }
  check('unsigned → 403', (await send(TW, form(p), FORM)).status === 403)
  check('forged → 403', (await send(TW, form(p), { ...FORM, 'x-twilio-signature': twilioSignatureFor('guess', `http://localhost${TW}`, p) })).status === 403)
  check('nothing logged', (await callLog()).length === 0)
  const ok = await send(TW, form(p), { ...FORM, 'x-twilio-signature': twilioSignatureFor(TOKEN, `http://localhost${TW}`, p) })
  check('signed → 200 and logged', ok.status === 200 && (await callLog()).length === 1, { status: ok.status, body: ok.text })
  const ST = `/api/ai-receptionist/webhook/status/${co.id}`
  check('AI receptionist status, unsigned → 403', (await send(ST, form({ CallStatus: 'no-answer', From: '+16085550202' }), FORM)).status === 403)
  check('the catch-all /webhook/:provider/:companyId is gone', (await send(`/api/calltracking/webhook/zzz/${co.id}`, '{}', { 'content-type': 'application/json' })).status !== 200)
}

console.log('\n══════════ inbound SMS (/api/sms/webhook) ══════════')
{
  const SMS = '/api/sms/webhook'
  // A known customer: a text from a number in no contact writes contact_id 'unknown', which the foreign key
  // refuses (a 500, separate from signing — reported, not fixed here).
  await db.insert(contact).values({ companyId: co.id, firstName: 'Known', lastName: 'Customer', mobilePhone: '+16085550303' } as any)
  const p = { MessageSid: 'SM-rf-1', From: '+16085550303', To: NUMBER, Body: 'Is my roof done?' }
  const u = await send(SMS, form(p), FORM)
  check('unsigned → 403 (it wrote the text into the thread)', u.status === 403, { status: u.status, body: u.text })
  const f = await send(SMS, form({ ...p, Body: 'Pay this link' }), { ...FORM, 'x-twilio-signature': twilioSignatureFor(TOKEN, `http://localhost${SMS}`, p) })
  check('a body changed after signing → 403', f.status === 403)
  check('no text stored', (await texts()) === 0)
  const ok = await send(SMS, form(p), { ...FORM, 'x-twilio-signature': twilioSignatureFor(TOKEN, `http://localhost${SMS}`, p) })
  check('signed with the number\'s company token → 200 and stored', ok.status === 200 && (await texts()) === 1, { status: ok.status, body: ok.text })
}

console.log('\n══════════ the forked lead inbox ══════════')
{
  await db.insert(leadSource).values({ platform: 'angi', label: 'Angi', enabled: true, webhookSecret: 'roof-src-secret', companyId: co.id } as any)
  const email = JSON.stringify({ platform: 'angi', from: 'Angi <leads@angi.com>', subject: 'New lead', text: 'Name: Sam Roe\nPhone: 608-555-0144', html: '' })
  const n0 = await leads()
  check('/inbound/email with no X-Factory-Key → 401', (await send('/api/leads/inbound/email', email, { 'content-type': 'application/json' })).status === 401)
  check('…with a wrong key → 401', (await send('/api/leads/inbound/email', email, { 'content-type': 'application/json', 'X-Factory-Key': 'x' })).status === 401)
  check('…nothing filed', (await leads()) === n0)
  const ok = await send('/api/leads/inbound/email', email, { 'content-type': 'application/json', 'X-Factory-Key': FACTORY_KEY })
  check('the Factory\'s post → 201, one lead', ok.status === 201 && (await leads()) === n0 + 1, { status: ok.status, body: ok.text })
  check('/inbound/webhook with ?company_id= and no secret → 401', (await send(`/api/leads/inbound/webhook/angi?company_id=${co.id}`, '{"name":"M"}', { 'content-type': 'application/json' })).status === 401)
  check('…nothing filed', (await leads()) === n0 + 1)
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
