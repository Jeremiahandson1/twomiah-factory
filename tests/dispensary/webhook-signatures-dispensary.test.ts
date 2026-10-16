// Every dispensary provider webhook proves who sent it before anything is written. (10/15)
//
// Four doors accepted anyone: the Twilio SMS webhooks (wrote texts into threads, flipped delivery status,
// and parsed Twilio's form body as JSON), Plaid's Pay-by-Bank webhook (moved ach_transactions to
// completed on its word), the marketplace partner webhook (checked the secret only when the install had
// one, with !==), and the forked lead inbox (/inbound/email had no check; /inbound/webhook took ?company_id=).
// Real routes, NODE_ENV=production.
import { Hono } from 'hono'
import crypto from 'node:crypto'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user, lead, leadSource, plaidConfig, achTransaction, integrationPartner, companyIntegration, auditLog } from './db/schema.ts'
import { eq, sql } from 'drizzle-orm'
import { twilioSignatureFor } from './src/shared/index.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 360)) }
}

await setupSchema()
const [co] = await db.insert(company).values({ name: 'Signed Leaf', slug: 'signed-leaf', email: 'sl@test.local', settings: {}, enabledFeatures: ['pay_by_bank', 'marketplace', 'lead_inbox', 'sms'] } as any).returning()
await db.insert(user).values({ email: 'owner-whd@test.local', passwordHash: 'x', firstName: 'O', lastName: 'D', role: 'owner', companyId: co.id, isActive: true } as any)

const app = new Hono()
app.route('/api/sms', (await import('./src/routes/sms.ts')).default)
app.route('/api/pay-by-bank', (await import('./src/routes/pay-by-bank.ts')).default)
app.route('/api/marketplace', (await import('./src/routes/marketplace.ts')).default)
app.route('/api/leads', (await import('./src/routes/leads.ts')).default)

process.env.NODE_ENV = 'production'
const TOKEN = 'platform-twilio-token-0123456789abc'
process.env.TWILIO_AUTH_TOKEN = TOKEN
const FACTORY_KEY = 'disp-factory-sync-key-00000000001'
process.env.FACTORY_SYNC_KEY = FACTORY_KEY

const send = async (path: string, body: string, headers: Record<string, string>) => {
  const res = await app.request(path, { method: 'POST', headers, body })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j, text: t }
}
const rowsOf = (r: any) => (Array.isArray(r) ? r : r?.rows || []) as any[]
const form = (p: Record<string, string>) => new URLSearchParams(p).toString()
const FORM = { 'content-type': 'application/x-www-form-urlencoded' }
const JSONH = { 'content-type': 'application/json' }

console.log('\n══════════ Twilio SMS webhooks ══════════')
{
  const texts = async () => Number(rowsOf(await db.execute(sql`SELECT COUNT(*)::int AS n FROM sms_messages`))[0]?.n || 0)
  const IN = '/api/sms/webhook/incoming'
  const p = { MessageSid: 'SM-d-1', From: '+16085550404', To: '+16085556666', Body: 'Open late?' }
  const n0 = await texts()
  check('incoming, unsigned → 403', (await send(IN, form(p), FORM)).status === 403)
  check('incoming, JSON with no signature → 403 (it used to be the only shape read)', (await send(IN, JSON.stringify(p), JSONH)).status === 403)
  check('incoming, signed with another token → 403', (await send(IN, form(p), { ...FORM, 'x-twilio-signature': twilioSignatureFor('other', `http://localhost${IN}`, p) })).status === 403)
  check('nothing stored', (await texts()) === n0)
  const ok = await send(IN, form(p), { ...FORM, 'x-twilio-signature': twilioSignatureFor(TOKEN, `http://localhost${IN}`, p) })
  check('incoming, signed with TWILIO_AUTH_TOKEN, form-encoded → 200', ok.status === 200, { status: ok.status, body: ok.text })
  const ST = '/api/sms/webhook/status'
  const s = { MessageSid: 'SM-d-1', MessageStatus: 'delivered' }
  check('status, unsigned → 403', (await send(ST, form(s), FORM)).status === 403)
  check('status, signed → 200', (await send(ST, form(s), { ...FORM, 'x-twilio-signature': twilioSignatureFor(TOKEN, `http://localhost${ST}`, s) })).status === 200)
}

console.log('\n══════════ Plaid Pay-by-Bank webhook ══════════')
{
  const PB = '/api/pay-by-bank/webhook'
  const [tx] = await db.insert(achTransaction).values({ companyId: co.id, amount: '42.00', status: 'processing', transferId: 'tr_1' } as any).returning()
  const body = JSON.stringify({ webhook_type: 'TRANSFER_EVENTS', transfer_events: [{ transfer_id: 'tr_1', event_type: 'settled' }] }, null, 2)
  const status = async () => (await db.select().from(achTransaction).where(eq(achTransaction.id, tx.id)))[0]?.status
  const noCfg = await send(PB, body, JSONH)
  check('no Plaid config in production → 403, naming what is missing', noCfg.status === 403 && /Plaid not configured/.test(noCfg.json?.reason || ''), noCfg.json)
  check('…and the transfer is NOT marked settled', (await status()) === 'processing')

  await db.insert(plaidConfig).values({ companyId: co.id, plaidClientId: 'cid', plaidSecret: 'sec', plaidEnvironment: 'sandbox', enabled: true } as any)
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const jwk = { ...(publicKey.export({ format: 'jwk' }) as any), kid: 'kid-1', alg: 'ES256' }
  const realFetch = globalThis.fetch
  let keyAsked = ''
  ;(globalThis as any).fetch = async (url: any, init: any) => {
    if (String(url).endsWith('/webhook_verification_key/get')) {
      const b = JSON.parse(init.body)
      keyAsked = `${b.client_id}/${b.secret}/${b.key_id}`
      return new Response(JSON.stringify(b.key_id === 'kid-1' ? { key: jwk } : { error_code: 'INVALID_KEY' }), { status: b.key_id === 'kid-1' ? 200 : 400 })
    }
    return realFetch(url, init)
  }
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const jwtFor = (raw: string) => {
    const h = b64({ alg: 'ES256', kid: 'kid-1', typ: 'JWT' })
    const p = b64({ iat: Math.floor(Date.now() / 1000), request_body_sha256: crypto.createHash('sha256').update(raw).digest('hex') })
    return `${h}.${p}.${crypto.sign('sha256', Buffer.from(`${h}.${p}`), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`
  }
  check('no Plaid-Verification header → 403', (await send(PB, body, JSONH)).status === 403)
  const forged = body.replace('tr_1', 'tr_1 ')
  check('a JWT for another body → 403', (await send(PB, forged, { ...JSONH, 'plaid-verification': jwtFor(body) })).status === 403)
  check('…the transfer is still processing', (await status()) === 'processing')
  const ok = await send(PB, body, { ...JSONH, 'plaid-verification': jwtFor(body) })
  check('a genuine Plaid webhook → 200', ok.status === 200, { status: ok.status, body: ok.text })
  check('…the key was fetched with this shop\'s Plaid client id + secret and the JWT\'s kid', keyAsked === 'cid/sec/kid-1', keyAsked)
  check('…and the transfer is now completed', (await status()) === 'completed')
  ;(globalThis as any).fetch = realFetch
}

console.log('\n══════════ marketplace partner webhook ══════════')
{
  const [partner] = await db.insert(integrationPartner).values({ name: 'Leafly', slug: 'leafly-wh', category: 'menu' } as any).returning()
  const [inst] = await db.insert(companyIntegration).values({ companyId: co.id, partnerId: partner.id, status: 'active', webhookSecret: null } as any).returning()
  const MK = `/api/marketplace/webhook/${partner.id}`
  const logged = async () => (await db.select().from(auditLog).where(eq(auditLog.action, 'integration_webhook'))).length
  const n0 = await logged()
  check('an install with NO secret no longer takes anyone\'s payload → 401', (await send(MK, '{"event":"x"}', JSONH)).status === 401)
  await db.update(companyIntegration).set({ webhookSecret: 'whsec_test_1' } as any).where(eq(companyIntegration.id, inst.id))
  check('the wrong secret → 401', (await send(MK, '{"event":"x"}', { ...JSONH, 'x-webhook-secret': 'whsec_test_2' })).status === 401)
  check('nothing recorded', (await logged()) === n0)
  check('the install\'s secret → 200', (await send(MK, '{"event":"x"}', { ...JSONH, 'x-webhook-secret': 'whsec_test_1' })).status === 200)
  check('…recorded once', (await logged()) === n0 + 1)
}

console.log('\n══════════ the forked lead inbox ══════════')
{
  await db.insert(leadSource).values({ name: 'Weedmaps', platform: 'weedmaps', label: 'Weedmaps', enabled: true, webhookSecret: 'wm-secret', companyId: co.id } as any)
  const leads = async () => (await db.select().from(lead)).length
  const email = JSON.stringify({ platform: 'weedmaps', from: 'x@weedmaps.com', subject: 'New order lead', text: 'Name: Lee\nPhone: 608-555-0177', html: '' })
  const n0 = await leads()
  check('/inbound/email, no X-Factory-Key → 401', (await send('/api/leads/inbound/email', email, JSONH)).status === 401)
  check('/inbound/webhook, ?company_id= and no secret → 401', (await send(`/api/leads/inbound/webhook/weedmaps?company_id=${co.id}`, '{"name":"M"}', JSONH)).status === 401)
  check('nothing filed', (await leads()) === n0)
  check('/inbound/email from the Factory → 201', (await send('/api/leads/inbound/email', email, { ...JSONH, 'X-Factory-Key': FACTORY_KEY })).status === 201)
  check('/inbound/webhook with the source secret → 201', (await send('/api/leads/inbound/webhook/weedmaps', '{"name":"Real"}', { ...JSONH, 'x-webhook-secret': 'wm-secret' })).status === 201)
  check('two leads filed', (await leads()) === n0 + 2)
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
