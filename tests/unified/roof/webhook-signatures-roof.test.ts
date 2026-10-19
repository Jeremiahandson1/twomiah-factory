// ADAPTED COPY of tests/roof/webhook-signatures-roof.test.ts, for the unified app (tests/unified/harness/adapted.ts). Unchanged except the
// 14 read(s) marked "unified:", where the rulebook's reply shapes replaced the template's. The original keeps
// running against the template; tests/unified/harness/unified-divergences.ts names the assertions this copy stands in for.
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
import { company, user, lead, leadSource, smsMessage, smsConversation, contact } from './db/schema.ts' /* unified: a text belongs to a conversation (company, the number, the contact) in the CRM's texting: a message carries no company_id or contact_id of its own (packages/tenant-backend integrations/sms.ts); roofing kept them on each message */
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
const [owner] = await db.insert(user).values({ email: 'owner-whr@test.local', passwordHash: 'x', firstName: 'O', lastName: 'R', role: 'owner', companyId: co.id, isActive: true } as any).returning()

const app = new Hono()
app.route('/api/calltracking', (await import('./src/routes/calltracking.ts')).default)
app.route('/api/ai-receptionist', (await import('./src/routes/aiReceptionist.ts')).default)
app.route('/api/sms', (await import('./src/routes/sms.ts')).default)
app.route('/api/leads', (await import('./src/routes/leads.ts')).default)
app.route('/api/contacts', (await import('./src/routes/contacts.ts')).default)
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
const api = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, { method, headers: { 'content-type': 'application/json', 'x-test-user': owner.id, 'x-test-company': co.id, 'x-test-role': 'owner' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j, text: t }
}
const rowsOf = (r: any) => (Array.isArray(r) ? r : r?.rows || []) as any[]
const callLog = async () => rowsOf(await db.execute(sql`SELECT provider_id FROM call_log WHERE company_id = ${co.id}`))
const texts = async () => (await db.select({ id: smsMessage.id }).from(smsMessage).innerJoin(smsConversation, eq(smsMessage.conversationId, smsConversation.id)).where(eq(smsConversation.companyId, co.id))).length /* unified: a text belongs to a conversation (company, the number, the contact) in the CRM's texting: a message carries no company_id or contact_id of its own (packages/tenant-backend integrations/sms.ts); roofing kept them on each message */
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
  const SMS = '/api/sms/webhook/incoming'
  // A known customer here; /* unified: Twilio's inbound text arrives at the CRM's /api/sms/webhook/incoming (roofing's was /api/sms/webhook: a roofer's own number is repointed at cutover — CUTOVER_LEDGER, Roofing); the signature is checked against that URL */ the unknown sender has its own section below.
  await db.insert(contact).values({ companyId: co.id, name: 'Known Customer', mobile: '+16085550303' } /* unified: a contact has one name, and its mobile number is `mobile` (plan decision 3: roofing's mobile_phone) */ as any)
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

console.log('\n══════════ a text from a number in no contact (10/16) ══════════')
{
  // It wrote contact_id 'unknown', the foreign key refused it, and the text was lost behind a 500.
  const SMS = '/api/sms/webhook/incoming'
  const p = { MessageSid: 'SM-rf-unknown' /* unified: Twilio's inbound text arrives at the CRM's /api/sms/webhook/incoming */, From: '(608) 555-0909', To: NUMBER, Body: 'Who do I call about my gutters?' }
  const before = await texts()
  const r = await send(SMS, form(p), { ...FORM, 'x-twilio-signature': twilioSignatureFor(TOKEN, `http://localhost${SMS}`, p) })
  check('accepted 200, not a 500', r.status === 200, { status: r.status, body: r.text })
  const [kept]: any[] = await db.select({ contactId: smsConversation.contactId, twilioSid: smsMessage.twilioSid }).from(smsMessage).innerJoin(smsConversation, eq(smsMessage.conversationId, smsConversation.id)).where(eq(smsMessage.twilioSid, 'SM-rf-unknown')) /* unified: a text belongs to a conversation (company, the number, the contact) in the CRM's texting: a message carries no company_id or contact_id of its own (packages/tenant-backend integrations/sms.ts); roofing kept them on each message */
  check('…the text is kept, unlinked (contact null), not lost', (await texts()) === before + 1 && kept && kept.contactId === null, kept)
  const other = await db.insert(contact).values({ companyId: co.id, name: 'Other Person', mobile: '608-555-1111' } /* unified: a contact has one name, and its mobile number is `mobile` (plan decision 3: roofing's mobile_phone) */ as any).returning()
  const oc = await (async () => { const l = await api('GET', `/api/sms/conversations?contactId=${other[0].id}`); const msgs: any[] = []; for (const row of (l.json?.data || [])) { const one = await api('GET', `/api/sms/conversations/${row.conversation.id}`); msgs.push(...(one.json?.messages || [])) } return { status: l.status, json: { messages: msgs, smsThread: msgs }, text: JSON.stringify(msgs) } })() /* unified: a contact's texts are their conversations (GET /api/sms/conversations?contactId=, then each conversation's messages) — the contact page's Messages panel; reading them links a stray thread from the contact's number first (the fix roofing had, made the CRM's) */
  check('a contact with a different number does not get it', oc.status === 200 && !(oc.json?.messages || []).some((m: any) => m.twilioSid === 'SM-rf-unknown'), oc.text?.slice(0, 200))
  const [still]: any[] = await db.select({ contactId: smsConversation.contactId, twilioSid: smsMessage.twilioSid }).from(smsMessage).innerJoin(smsConversation, eq(smsMessage.conversationId, smsConversation.id)).where(eq(smsMessage.twilioSid, 'SM-rf-unknown')) /* unified: a text belongs to a conversation (company, the number, the contact) in the CRM's texting: a message carries no company_id or contact_id of its own (packages/tenant-backend integrations/sms.ts); roofing kept them on each message */
  check('…and the text stays unlinked', still?.contactId === null, still)
  const [newbie] = await db.insert(contact).values({ companyId: co.id, name: 'New Caller', mobile: '608.555.0909' } /* unified: a contact has one name, and its mobile number is `mobile` (plan decision 3: roofing's mobile_phone) */ as any).returning()
  const conv = await (async () => { const l = await api('GET', `/api/sms/conversations?contactId=${newbie.id}`); const msgs: any[] = []; for (const row of (l.json?.data || [])) { const one = await api('GET', `/api/sms/conversations/${row.conversation.id}`); msgs.push(...(one.json?.messages || [])) } return { status: l.status, json: { messages: msgs, smsThread: msgs }, text: JSON.stringify(msgs) } })() /* unified: a contact's texts are their conversations (GET /api/sms/conversations?contactId=, then each conversation's messages) — the contact page's Messages panel; reading them links a stray thread from the contact's number first (the fix roofing had, made the CRM's) */
  check('when a contact with that number is opened, the text is in their thread', conv.status === 200 && (conv.json?.messages || []).some((m: any) => m.twilioSid === 'SM-rf-unknown'), { status: conv.status, body: conv.text?.slice(0, 300) })
  const [linked]: any[] = await db.select({ contactId: smsConversation.contactId, twilioSid: smsMessage.twilioSid }).from(smsMessage).innerJoin(smsConversation, eq(smsMessage.conversationId, smsConversation.id)).where(eq(smsMessage.twilioSid, 'SM-rf-unknown')) /* unified: a text belongs to a conversation (company, the number, the contact) in the CRM's texting: a message carries no company_id or contact_id of its own (packages/tenant-backend integrations/sms.ts); roofing kept them on each message */
  check('…and it is filed under them for good', linked?.contactId === newbie.id, linked)
  // The contact record (GET /api/contacts/:id, the SMS thread on the contact page) files them too.
  const p2 = { MessageSid: 'SM-rf-unknown-2', From: '+16085550808', To: NUMBER, Body: 'Second stray' }
  await send(SMS, form(p2), { ...FORM, 'x-twilio-signature': twilioSignatureFor(TOKEN, `http://localhost${SMS}`, p2) })
  const [third] = await db.insert(contact).values({ companyId: co.id, name: 'Third Caller', phone: '608 555 0808' } /* unified: a contact has one name (plan decision 3) */ as any).returning()
  const card = await (async () => { const l = await api('GET', `/api/sms/conversations?contactId=${third.id}`); const msgs: any[] = []; for (const row of (l.json?.data || [])) { const one = await api('GET', `/api/sms/conversations/${row.conversation.id}`); msgs.push(...(one.json?.messages || [])) } return { status: l.status, json: { messages: msgs, smsThread: msgs }, text: JSON.stringify(msgs) } })() /* unified: a contact's texts are their conversations (GET /api/sms/conversations?contactId=, then each conversation's messages) — the contact page's Messages panel; reading them links a stray thread from the contact's number first (the fix roofing had, made the CRM's) */
  check('the contact page\'s thread files a stray text by the contact\'s phone', card.status === 200 && (card.json?.smsThread || []).some((m: any) => m.twilioSid === 'SM-rf-unknown-2'), { status: card.status, body: card.text?.slice(0, 300) })
}

console.log('\n══════════ the lead email address handed out is the one the Factory routes (10/16) ══════════')
{
  process.env.TENANT_ID = 'aaaabbbb-cccc-dddd-eeee-ffff00001111'
  const made = await api('POST', '/api/leads/sources', { platform: 'thumbtack', label: 'Thumbtack' })
  check('a new source is handed {tenantId}-leads-{platform}@parse.twomiah.com', made.status === 201 && made.json?.inboundEmail === 'aaaabbbbccccddddeeeeffff00001111-leads-thumbtack@parse.twomiah.com', made.json)
  const list = await api('GET', '/api/leads/sources')
  const angi = (list.json?.data || []).find((s: any) => s.platform === 'angi')
  check('an existing source is re-addressed when the list is read', angi?.inboundEmail === 'aaaabbbbccccddddeeeeffff00001111-leads-angi@parse.twomiah.com', angi)
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
