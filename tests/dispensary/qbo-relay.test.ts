// crm-dispensary's own QuickBooks connect, through the Factory relay. (10/17)
//
// The dispensary forks the integrations router and its QuickBooks OAuth. Two things change here:
//   · its state was base64 of { companyId, userId } and the callback trusted it — anyone could finish an Intuit consent
//     with a hand-made state naming another shop and attach their books to it. It is signed now (shared quickbooksState).
//   · with the relay env (QBO_REDIRECT_URI = the Factory's callback, QBO_RETURN_URL = this backend) it sends Intuit the
//     ONE registered URI and names its own callback — /api/integrations/quickbooks/callback — in the signed state.
// Without QBO_RETURN_URL it redirects straight to itself, as before.
import { Hono } from 'hono'
import { eq } from 'drizzle-orm'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 400)) }
}

const TENANT = 'https://dsptest-qbo1-leaf-api.onrender.com'
const OWN_CB = TENANT + '/api/integrations/quickbooks/callback'
const RELAY = 'https://twomiah-factory-api.onrender.com/api/v1/factory/integrations/qbo/callback'
for (const k of ['QBO_REDIRECT_URI', 'QBO_RETURN_URL', 'QUICKBOOKS_REDIRECT_URI', 'QBO_STATE_SECRET']) delete process.env[k]
process.env.QUICKBOOKS_CLIENT_ID = 'cid'
process.env.QUICKBOOKS_CLIENT_SECRET = 'csecret'
process.env.API_URL = TENANT
process.env.FRONTEND_URL = TENANT
if (!process.env.JWT_SECRET) process.env.JWT_SECRET = 'dsp-qbo-relay-secret'

const { setupSchema } = await import('./setup.ts')
const { db } = await import('./db/index.ts')
const { company, user } = await import('./db/schema.ts')
await setupSchema()
const [co] = await db.insert(company).values({ name: 'Relay Leaf', slug: 'leaf-qbo', email: 'qbo@test.local', state: 'OH', enabledFeatures: ['contacts', 'orders', 'products', 'integrations'] } as any).returning()
const [owner] = await db.insert(user).values({ email: 'owner-qbo@test.local', passwordHash: 'x', firstName: 'O', lastName: 'U', role: 'owner', companyId: co.id } as any).returning()
const [other] = await db.insert(company).values({ name: 'Victim Leaf', slug: 'leaf-victim', email: 'victim@test.local', state: 'OH', enabledFeatures: ['integrations'] } as any).returning()

const app = new Hono()
app.route('/api/integrations', (await import('./src/routes/integrations.ts')).default)
app.onError((await import('./src/utils/errors.ts')).errorHandler)
const authUrl = async () => {
  const res = await app.request('/api/integrations/quickbooks/auth-url', { headers: { 'x-test-user': owner.id, 'x-test-company': co.id, 'x-test-role': 'owner' } })
  const j: any = await res.json().catch(() => ({}))
  return { status: res.status, url: j?.authUrl ? new URL(j.authUrl) : null, raw: j }
}
const decode = (s: string) => JSON.parse(Buffer.from(s, 'base64url').toString() || '{}')

const realFetch = globalThis.fetch
const sent: Array<{ url: string; body: URLSearchParams | null }> = []
globalThis.fetch = (async (u: any, init: any) => {
  const url = String(u)
  sent.push({ url, body: init?.body ? new URLSearchParams(String(init.body)) : null })
  if (url.includes('oauth2/v1/tokens/bearer')) return new Response(JSON.stringify({ access_token: 'at', refresh_token: 'rt', expires_in: 3600 }), { status: 200 })
  return new Response(JSON.stringify({ CompanyInfo: { CompanyName: 'Leaf Books' } }), { status: 200 })
}) as any

try {
  // ── env from before the relay ───────────────────────────────────────────────────────────────────────────────────
  const before = await authUrl()
  check('no relay env: redirect_uri is the shop\'s own callback, as before', before.url?.searchParams.get('redirect_uri') === OWN_CB, before.raw)
  const st0 = decode(before.url?.searchParams.get('state') || '')
  check('…the state is signed and carries no return URL', typeof st0.sig === 'string' && st0.companyId === co.id && !('returnUrl' in st0), st0)

  // ── the relay env ─────────────────────────────────────────────────────────────────────────────────────────────────
  process.env.QBO_REDIRECT_URI = RELAY
  process.env.QBO_RETURN_URL = TENANT + '/api/quickbooks/callback'   // what the Factory emits for every CRM
  const r = await authUrl()
  check('relay env: redirect_uri is the Factory relay', r.url?.searchParams.get('redirect_uri') === RELAY, r.raw)
  const state = r.url?.searchParams.get('state') || ''
  const st = decode(state)
  check('…and the state names THIS router\'s callback (the dispensary has no /api/quickbooks)', st.returnUrl === OWN_CB && st.companyId === co.id, st)

  // Forged and swapped states store nothing.
  const forged = Buffer.from(JSON.stringify({ companyId: other.id, userId: 'x' })).toString('base64')
  sent.length = 0
  const f = await app.request(`/api/integrations/quickbooks/callback?code=c&realmId=r&state=${encodeURIComponent(forged)}`)
  check('an unsigned state naming another shop is refused (it used to attach the caller\'s books to that shop)', (f.headers.get('location') || '').includes('error=quickbooks_failed') && sent.length === 0, f.headers.get('location'))
  const [victim] = await db.select().from(company).where(eq(company.id, other.id))
  check('…and that shop has no QuickBooks connection', !(victim?.integrations as any)?.quickbooksAccessToken)
  const swapped = Buffer.from(JSON.stringify({ ...st, returnUrl: 'https://other-api.onrender.com/api/integrations/quickbooks/callback' })).toString('base64url')
  const s2 = await app.request(`/api/integrations/quickbooks/callback?code=c&realmId=r&state=${encodeURIComponent(swapped)}`)
  check('a state with its return URL swapped is refused', (s2.headers.get('location') || '').includes('error=quickbooks_failed'))

  // The relayed callback.
  sent.length = 0
  const ok = await app.request(`/api/integrations/quickbooks/callback?code=the-code&realmId=4620816365&state=${encodeURIComponent(state)}`)
  check('the relayed callback connects the shop', (ok.headers.get('location') || '').endsWith('success=quickbooks'), ok.headers.get('location'))
  const ex = sent.find(s => s.url.includes('tokens/bearer'))
  check('…exchanging with the SAME redirect_uri as authorize (the relay)', ex?.body?.get('redirect_uri') === RELAY && ex?.body?.get('code') === 'the-code', ex?.body?.toString())
  const [mine] = await db.select().from(company).where(eq(company.id, co.id))
  check('…and the realm is stored on this shop', (mine?.integrations as any)?.quickbooksRealmId === '4620816365', mine?.integrations)

  // A hand-set QUICKBOOKS_REDIRECT_URI wins: no relay.
  process.env.QUICKBOOKS_REDIRECT_URI = 'https://books.example.com/cb'
  const hand = await authUrl()
  check('an explicit QUICKBOOKS_REDIRECT_URI is used as-is, without a return URL', hand.url?.searchParams.get('redirect_uri') === 'https://books.example.com/cb' && !('returnUrl' in decode(hand.url?.searchParams.get('state') || '')), hand.raw)
} finally {
  globalThis.fetch = realFetch
  for (const k of ['QBO_REDIRECT_URI', 'QBO_RETURN_URL', 'QUICKBOOKS_REDIRECT_URI']) delete process.env[k]
}

console.log(`\ndispensary-qbo-relay: ${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
