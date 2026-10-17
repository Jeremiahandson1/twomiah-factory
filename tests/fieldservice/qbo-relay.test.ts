// Connect QuickBooks through the Factory relay — the shared module, on a real CRM. (10/17)
//
// Every tenant now sends Intuit ONE redirect URI (the Factory's QuickBooks callback) and names its own callback in the
// signed state; the Factory relays the browser back. This drives the shared module's real routes in crm-fieldservice:
// the authorize URL, the token exchange's redirect_uri, the callback's state check — and proves a tenant whose env
// predates the relay (no QBO_RETURN_URL) sends exactly what it sent before.
// The relay itself and the Factory env are in tests/shared/qbo-relay.test.ts.
import { Hono } from 'hono'
import crypto from 'node:crypto'
import { eq } from 'drizzle-orm'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user, qbIntegration } from './db/schema.ts'
import { errorHandler } from './src/utils/errors.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => { if (ok) { passed++; console.log(`  ok   ${name}`) } else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 400)) } }

const TENANT = 'https://fstest-qbo1-wrench-api.onrender.com'
const RETURN = TENANT + '/api/quickbooks/callback'
const RELAY = 'https://twomiah-factory-api.onrender.com/api/v1/factory/integrations/qbo/callback'
const KEYS = ['QBO_CLIENT_ID', 'QBO_CLIENT_SECRET', 'QBO_REDIRECT_URI', 'QBO_RETURN_URL', 'QBO_STATE_SECRET', 'QUICKBOOKS_CLIENT_ID', 'QUICKBOOKS_CLIENT_SECRET', 'QUICKBOOKS_REDIRECT_URI']
for (const k of KEYS) delete process.env[k]
process.env.QBO_CLIENT_ID = 'cid'
process.env.QBO_CLIENT_SECRET = 'csecret'
process.env.FRONTEND_URL = TENANT
if (!process.env.JWT_SECRET) process.env.JWT_SECRET = 'qbo-relay-test-secret'

await setupSchema()
const [co] = await db.insert(company).values({ name: 'QBO Relay Co', slug: 'qborelay', email: 'qborelay@test.local', settings: {}, enabledFeatures: ['invoices', 'contacts', 'quickbooks'] } as any).returning()
const [owner] = await db.insert(user).values({ email: 'owner-qborelay@test.local', passwordHash: 'x', firstName: 'O', lastName: 'Wner', role: 'owner', companyId: co.id } as any).returning()

const app = new Hono()
app.route('/api/quickbooks', (await import('./src/routes/quickbooks.ts')).default)
app.onError(errorHandler)
const authUrl = async () => {
  const res = await app.request('/api/quickbooks/auth-url', { headers: { 'x-test-user': owner.id, 'x-test-company': co.id, 'x-test-role': 'owner' } })
  const j: any = await res.json().catch(() => ({}))
  return { status: res.status, url: j?.url ? new URL(j.url) : null, raw: j }
}

// Intuit's token endpoint and company info, faked: record what the tenant sends.
const realFetch = globalThis.fetch
const sent: Array<{ url: string; body: URLSearchParams | null }> = []
globalThis.fetch = (async (u: any, init: any) => {
  const url = String(u)
  sent.push({ url, body: init?.body ? new URLSearchParams(String(init.body)) : null })
  if (url.includes('oauth2/v1/tokens/bearer')) return new Response(JSON.stringify({ access_token: 'at', refresh_token: 'rt', expires_in: 3600 }), { status: 200 })
  return new Response(JSON.stringify({ CompanyInfo: { CompanyName: 'Books Co' } }), { status: 200 })
}) as any

try {
  // ── a tenant whose env predates the relay: exactly as before ────────────────────────────────────────────────────
  process.env.QBO_REDIRECT_URI = RETURN
  const realNow = Date.now
  const FIXED = Date.now()
  Date.now = () => FIXED
  const before = await authUrl()
  Date.now = realNow
  const oldState = Buffer.from(JSON.stringify({ companyId: co.id, ts: FIXED, sig: crypto.createHmac('sha256', process.env.JWT_SECRET!).update(`${co.id}.${FIXED}`).digest('hex') })).toString('base64url')
  const oldUrl = `https://appcenter.intuit.com/connect/oauth2?${new URLSearchParams({ client_id: 'cid', response_type: 'code', scope: 'com.intuit.quickbooks.accounting', redirect_uri: RETURN, state: oldState })}`
  check('no QBO_RETURN_URL: the authorize URL is byte-for-byte the pre-relay one', before.status === 200 && before.url?.href === new URL(oldUrl).href, { got: before.url?.href, want: oldUrl })

  // ── the relay env ─────────────────────────────────────────────────────────────────────────────────────────────────
  process.env.QBO_REDIRECT_URI = RELAY
  process.env.QBO_RETURN_URL = RETURN
  const r = await authUrl()
  check('with the relay env, the authorize redirect_uri is the Factory relay', r.url?.searchParams.get('redirect_uri') === RELAY, r.raw)
  const state = r.url?.searchParams.get('state') || ''
  const payload = JSON.parse(Buffer.from(state, 'base64url').toString() || '{}')
  check('…and the state carries this tenant\'s own callback and company', payload.returnUrl === RETURN && payload.companyId === co.id, payload)

  // Swapped return URL: the callback refuses it and stores nothing.
  const swapped = Buffer.from(JSON.stringify({ ...payload, returnUrl: 'https://other-api.onrender.com/api/quickbooks/callback' })).toString('base64url')
  sent.length = 0
  const bad = await app.request(`/api/quickbooks/callback?code=c1&realmId=r1&state=${encodeURIComponent(swapped)}`)
  check('a state whose return URL was swapped is refused at the callback', bad.status === 302 && (bad.headers.get('location') || '').includes('error=invalid_state') && sent.length === 0, { status: bad.status, loc: bad.headers.get('location') })
  const unsigned = Buffer.from(JSON.stringify({ companyId: co.id })).toString('base64url')
  const bad2 = await app.request(`/api/quickbooks/callback?code=c1&realmId=r1&state=${encodeURIComponent(unsigned)}`)
  check('an unsigned state naming this company is refused', (bad2.headers.get('location') || '').includes('error=invalid_state'))

  // The callback as the relay delivers it: Intuit's query, unchanged.
  sent.length = 0
  const ok = await app.request(`/api/quickbooks/callback?code=the-code&realmId=9341457340784709&state=${encodeURIComponent(state)}`)
  check('the relayed callback connects the company', ok.status === 302 && (ok.headers.get('location') || '').endsWith('qbo=connected'), { status: ok.status, loc: ok.headers.get('location') })
  const exchange = sent.find(s => s.url.includes('oauth2/v1/tokens/bearer'))
  check('…and the token exchange sends the SAME redirect_uri as authorize (the relay)', exchange?.body?.get('redirect_uri') === RELAY && exchange?.body?.get('code') === 'the-code', exchange?.body?.toString())
  const [row] = await db.select().from(qbIntegration).where(eq(qbIntegration.companyId, co.id))
  check('…the connection is stored for this company with the realm Intuit sent', row?.realmId === '9341457340784709' && row?.accessToken === 'at', row)

  // An old-shape state (minted before the deploy, still in someone's browser) still completes.
  process.env.QBO_REDIRECT_URI = RETURN; delete process.env.QBO_RETURN_URL
  const lts = Date.now()
  const legacyFixed = Buffer.from(JSON.stringify({ companyId: co.id, ts: lts, sig: crypto.createHmac('sha256', process.env.JWT_SECRET!).update(`${co.id}.${lts}`).digest('hex') })).toString('base64url')
  sent.length = 0
  const old = await app.request(`/api/quickbooks/callback?code=c2&realmId=r2&state=${encodeURIComponent(legacyFixed)}`)
  check('a pre-relay state still completes on the callback', (old.headers.get('location') || '').endsWith('qbo=connected'), old.headers.get('location'))
  check('…exchanging with the tenant\'s own redirect_uri, as before', sent.find(s => s.url.includes('tokens/bearer'))?.body?.get('redirect_uri') === RETURN)

  // The legacy integrations-router path verifies the same state.
  const integ = await import('./src/routes/integrations.ts').catch(() => null)
  if (integ?.default) {
    const app2 = new Hono(); app2.route('/api/integrations', integ.default); app2.onError(errorHandler)
    const res = await app2.request(`/api/integrations/quickbooks/callback?code=c3&realmId=r3&state=${encodeURIComponent(swapped)}`)
    check('the /api/integrations/quickbooks/callback door refuses the swapped state too', (res.headers.get('location') || '').includes('error=invalid_state'), res.headers.get('location'))
  }
} finally {
  globalThis.fetch = realFetch
  for (const k of KEYS) delete process.env[k]
}

console.log(`\nfs-qbo-relay: ${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
