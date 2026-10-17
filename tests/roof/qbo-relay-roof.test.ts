// crm-roof's QuickBooks connect, through the Factory relay. (10/17)
//
// Roof forks QuickBooks (services/quickbooks.ts + routes/quickbooks.ts). Reading it for the relay found three more
// faults, each of which alone stopped Connect QuickBooks on every roof tenant:
//   · it read QB_CLIENT_ID / QB_CLIENT_SECRET / QB_REDIRECT_URI, which nothing sets — the Factory sets QBO_*;
//   · Settings navigated the browser to /api/quickbooks/connect, a page load with no Authorization header, so the
//     authenticate middleware answered 401 to every click — it now asks /auth-url with the session, then navigates;
//   · the state was base64 of { companyId } and the callback trusted it — anyone could finish an Intuit consent with a
//     hand-made state naming another company and attach their books to it. It is signed now (shared quickbooksState).
// With the relay env it sends the ONE registered redirect URI and names its own callback in the signed state.
import { Hono } from 'hono'
import { eq } from 'drizzle-orm'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 400)) }
}

const TENANT = 'https://rooftest-qbo1-roof-api.onrender.com'
const RETURN = TENANT + '/api/quickbooks/callback'
const RELAY = 'https://twomiah-factory-api.onrender.com/api/v1/factory/integrations/qbo/callback'
const KEYS = ['QB_CLIENT_ID', 'QB_CLIENT_SECRET', 'QB_REDIRECT_URI', 'QBO_CLIENT_ID', 'QBO_CLIENT_SECRET', 'QBO_REDIRECT_URI', 'QBO_RETURN_URL', 'QBO_STATE_SECRET']
for (const k of KEYS) delete process.env[k]
if (!process.env.JWT_SECRET) process.env.JWT_SECRET = 'roof-qbo-relay-secret'

const { setupSchema } = await import('./setup.ts')
await setupSchema()
const { db } = await import('./db/index.ts')
const { company, user, qbIntegration } = await import('./db/schema.ts')
const [co] = await db.insert(company).values({ name: 'Relay Roofing', slug: 'relay-roof', email: 'relay@test.local', state: 'OH', settings: {}, enabledFeatures: ['quickbooks'] } as any).returning()
const mk = async (role: string, tag: string) => (await db.insert(user).values({ email: `${tag}@relay-roof.local`, passwordHash: 'x', firstName: tag, lastName: 'U', role, companyId: co.id, isActive: true } as any).returning())[0]
const owner = await mk('owner', 'owner')
const crew = await mk('field', 'crew')
const [other] = await db.insert(company).values({ name: 'Victim Roofing', slug: 'victim-roof', email: 'victim@test.local', state: 'OH', settings: {}, enabledFeatures: ['quickbooks'] } as any).returning()

const app = new Hono()
app.route('/api/quickbooks', (await import('./src/routes/quickbooks.ts')).default)
const get = (who: any, path: string) => app.request(path, { headers: { 'x-test-user': who.id, 'x-test-company': co.id, 'x-test-role': who.role } })
const authUrl = async (who = owner) => {
  const res = await get(who, '/api/quickbooks/auth-url')
  const j: any = await res.json().catch(() => ({}))
  return { status: res.status, url: j?.url ? new URL(j.url) : null, raw: j }
}
const decode = (s: string) => JSON.parse(Buffer.from(s, 'base64url').toString() || '{}')

const realFetch = globalThis.fetch
const sent: Array<{ url: string; body: URLSearchParams | null }> = []
globalThis.fetch = (async (u: any, init: any) => {
  const url = String(u)
  sent.push({ url, body: init?.body ? new URLSearchParams(String(init.body)) : null })
  return new Response(JSON.stringify({ access_token: 'at', refresh_token: 'rt', expires_in: 3600 }), { status: 200 })
}) as any

try {
  const none = await authUrl()
  check('no Intuit app configured: a plain 503, not an Intuit URL with an empty client id', none.status === 503 && !none.url, none)

  // The Factory's names, env from before the relay.
  process.env.QBO_CLIENT_ID = 'cid'; process.env.QBO_CLIENT_SECRET = 'csecret'; process.env.QBO_REDIRECT_URI = RETURN
  const before = await authUrl()
  check('QBO_* (what the Factory sets) is read: the authorize URL carries the client id', before.status === 200 && before.url?.searchParams.get('client_id') === 'cid', before.raw)
  check('…redirect_uri is the tenant\'s own callback with no relay env', before.url?.searchParams.get('redirect_uri') === RETURN)
  const st0 = decode(before.url?.searchParams.get('state') || '')
  check('…and the state is signed, with no return URL', typeof st0.sig === 'string' && st0.companyId === co.id && !('returnUrl' in st0), st0)
  const crewAsk = await authUrl(crew)
  check('connecting the books is integrations:create — the crew seat is refused', crewAsk.status === 403, crewAsk.status)

  // The relay env.
  process.env.QBO_REDIRECT_URI = RELAY; process.env.QBO_RETURN_URL = RETURN
  const r = await authUrl()
  check('relay env: redirect_uri is the Factory relay', r.url?.searchParams.get('redirect_uri') === RELAY, r.raw)
  const state = r.url?.searchParams.get('state') || ''
  const st = decode(state)
  check('…and the state names this tenant\'s callback', st.returnUrl === RETURN && st.companyId === co.id, st)

  // Forged and swapped.
  sent.length = 0
  const forged = Buffer.from(JSON.stringify({ companyId: other.id })).toString('base64url')
  const f = await app.request(`/api/quickbooks/callback?code=c&realmId=r&state=${encodeURIComponent(forged)}`)
  check('an unsigned state naming another company is refused, and nothing is exchanged', f.status === 400 && sent.length === 0, f.status)
  const [victimRow] = await db.select().from(qbIntegration).where(eq(qbIntegration.companyId, other.id))
  check('…that company has no QuickBooks connection', !victimRow)
  const swapped = Buffer.from(JSON.stringify({ ...st, returnUrl: 'https://other-api.onrender.com/api/quickbooks/callback' })).toString('base64url')
  const s2 = await app.request(`/api/quickbooks/callback?code=c&realmId=r&state=${encodeURIComponent(swapped)}`)
  check('a state with its return URL swapped is refused', s2.status === 400)

  // The relayed callback.
  sent.length = 0
  const ok = await app.request(`/api/quickbooks/callback?code=the-code&realmId=123145&state=${encodeURIComponent(state)}`)
  check('the relayed callback connects the company', ok.status === 302, ok.status)
  const ex = sent.find(s => s.url.includes('tokens/bearer'))
  check('…exchanging with the SAME redirect_uri as authorize (the relay)', ex?.body?.get('redirect_uri') === RELAY && ex?.body?.get('code') === 'the-code', ex?.body?.toString())
  const [row] = await db.select().from(qbIntegration).where(eq(qbIntegration.companyId, co.id))
  check('…and the connection is stored for this company with Intuit\'s realm', row?.realmId === '123145' && row?.accessToken === 'at', row)
} finally {
  globalThis.fetch = realFetch
  for (const k of KEYS) delete process.env[k]
}

// Settings asking /auth-url with the session (instead of navigating to /connect) is checked in tests/shared/qbo-relay.test.ts.

console.log(`\nroof-qbo-relay: ${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
