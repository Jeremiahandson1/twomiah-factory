// QuickBooks Online: ONE redirect URI registered with Intuit, for every tenant. (10/17)
//
// Intuit only redirects to URIs registered by hand in the Intuit developer app, and every tenant CRM sent its own
// (<tenant>/api/quickbooks/callback) — so each new customer needed someone to add their URL in Intuit's portal before
// Connect QuickBooks worked, and it failed silently for every new signup. Now every tenant sends the Factory's
// QuickBooks callback, puts its own callback in the SIGNED state, and the Factory relays the browser to it — only to a
// known tenant backend, only to a QuickBooks callback path, otherwise 400 and never a redirect.
//
// Dependency-free: `bun run tests/shared/qbo-relay.test.ts`.
import { readFileSync } from 'node:fs'
import crypto from 'node:crypto'

const { qboRelayDecision, relayReturnUrl, tenantOriginLookup, TENANT_QBO_CALLBACK_PATHS } = await import('../../apps/api/src/services/qboRelay.ts')
const { quickbooksTenantEnv, QBO_ENVIRONMENT_KEYS, quickbooksSandbox } = await import('../../apps/api/src/services/quickbooksEnv.ts')
const { qboRedirectUri } = await import('../../apps/api/src/services/quickbooksOnline.ts')
const { signQboState, verifyQboState, QBO_STATE_TTL_MS } = await import('../../packages/tenant-backend/src/integrations/quickbooksState.ts')

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 400)) }
}
const read = (p: string) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8').split(String.fromCharCode(13, 10)).join(String.fromCharCode(10))

const TENANT = 'https://fstest-abc1-wrench-api.onrender.com'
const RETURN = TENANT + '/api/quickbooks/callback'
const RELAY = 'https://twomiah-factory-api.onrender.com/api/v1/factory/integrations/qbo/callback'
const known = async (origin: string) => origin === TENANT
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
const relayState = (returnUrl: unknown) => b64({ companyId: 'co_1', ts: Date.now(), returnUrl, sig: 'x' })

// ── the relay ─────────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const state = relayState(RETURN)
  const d = await qboRelayDecision({ code: 'AB+12/x=', state, realmId: '9341457340784709' }, known)
  check('a known tenant\'s state is relayed with a 302 target', d.kind === 'redirect', d)
  if (d.kind === 'redirect') {
    const u = new URL(d.location)
    check('…to exactly that tenant\'s QuickBooks callback', u.origin + u.pathname === RETURN, d.location)
    check('…with code, state and realmId unchanged', u.searchParams.get('code') === 'AB+12/x=' && u.searchParams.get('state') === state && u.searchParams.get('realmId') === '9341457340784709', d.location)
    check('…and nothing else added', [...u.searchParams.keys()].sort().join(',') === 'code,realmId,state', d.location)
  }
  const legacy = await qboRelayDecision({ code: 'c', state: relayState(TENANT + '/api/integrations/quickbooks/callback'), realmId: 'r' }, known)
  check('the integrations-router callback (crm-dispensary\'s) is a valid target too', legacy.kind === 'redirect' && legacy.location.startsWith(TENANT + '/api/integrations/quickbooks/callback?'), legacy)
  check('only the two callback paths are allowed', TENANT_QBO_CALLBACK_PATHS.size === 2)

  const err = await qboRelayDecision({ error: 'access_denied', error_description: 'User denied & left', state }, known)
  check('an Intuit error is relayed to the tenant, not swallowed', err.kind === 'redirect', err)
  if (err.kind === 'redirect') {
    const u = new URL(err.location)
    check('…error and error_description passed through unchanged, with the state', u.searchParams.get('error') === 'access_denied' && u.searchParams.get('error_description') === 'User denied & left' && u.searchParams.get('state') === state, err.location)
  }

  const refused = async (name: string, returnUrl: unknown, lookup = known) => {
    const r = await qboRelayDecision({ code: 'c', state: relayState(returnUrl), realmId: 'r' }, lookup)
    check(name, r.kind === 'refuse', r)
  }
  await refused('an unknown host → refused (400), never a redirect', 'https://evil.example.com/api/quickbooks/callback')
  await refused('a look-alike host (tenant host as a prefix of another domain) → refused', TENANT + '.evil.com/api/quickbooks/callback')
  await refused('a known host on a path that is not the callback → refused', TENANT + '/api/auth/login')
  await refused('…including the callback path with a suffix', TENANT + '/api/quickbooks/callback/extra')
  await refused('…and a dot-segment walk out of the callback', TENANT + '/api/quickbooks/callback/../../../evil')
  await refused('http instead of https → refused', 'http://fstest-abc1-wrench-api.onrender.com/api/quickbooks/callback')
  await refused('credentials in the URL → refused', 'https://user:pw@fstest-abc1-wrench-api.onrender.com/api/quickbooks/callback')
  await refused('a query on the return URL → refused', RETURN + '?next=https://evil.example.com')
  await refused('a fragment on the return URL → refused', RETURN + '#x')
  await refused('a non-string return URL → refused', { href: RETURN })
  await refused('an empty return URL → refused', '')
  await refused('not a URL → refused', 'javascript:alert(1)')
  await refused('a lookup that throws is a refusal, not a redirect', RETURN, async () => { throw new Error('db down') })

  check('garbage state is not a relay state (the Factory\'s own flow handles it)', relayReturnUrl('%%%not-base64%%%').relay === false && (await qboRelayDecision({ state: 'garbage!!' }, known)).kind === 'not-relay')
  check('the Factory\'s own state (a UUID) is not a relay state', (await qboRelayDecision({ state: crypto.randomUUID(), code: 'c', realmId: 'r' }, known)).kind === 'not-relay')
  check('no state at all is not a relay state', (await qboRelayDecision({ code: 'c' }, known)).kind === 'not-relay')
  check('a JSON state without a return URL (an old tenant\'s) is not relayed', (await qboRelayDecision({ state: b64({ companyId: 'c', ts: 1, sig: 'x' }) }, known)).kind === 'not-relay')
}

// ── the known-hosts lookup reads tenants.render_backend_url ─────────────────────────────────────────────────────────
{
  const rows = [{ render_backend_url: TENANT + '/' }, { render_backend_url: 'https://other-api.onrender.com' }]
  const asked: any[] = []
  const fakeSupabase = { from: (t: string) => ({ select: (_c: string) => ({ in: (col: string, vals: string[]) => ({ limit: async () => { asked.push({ t, col, vals }); return { data: rows.filter(r => vals.includes(r.render_backend_url)), error: null } } }) }) }) }
  const lookup = tenantOriginLookup(fakeSupabase)
  check('a tenant whose render_backend_url is stored with a trailing slash is known', await lookup(TENANT) === true)
  check('…the query is on tenants.render_backend_url, exact values', asked[0]?.t === 'tenants' && asked[0]?.col === 'render_backend_url' && asked[0]?.vals.includes(TENANT), asked)
  check('a host no tenant has is unknown', await lookup('https://nobody-api.onrender.com') === false)
  const broken = tenantOriginLookup({ from: () => ({ select: () => ({ in: () => ({ limit: async () => ({ data: null, error: { message: 'x' } }) }) }) }) })
  check('a database error is "unknown", never "allow"', await broken(TENANT) === false)
}

// ── the signed state ───────────────────────────────────────────────────────────────────────────────────────────────
{
  const SECRET = 'jwt-secret-for-test'
  const now = Date.parse('2026-10-17T12:00:00Z')
  const fresh = signQboState({ companyId: 'co_1', returnUrl: RETURN }, SECRET, now)
  check('a new state carries the return URL and verifies', verifyQboState(fresh, SECRET, now)?.returnUrl === RETURN && verifyQboState(fresh, SECRET, now)?.companyId === 'co_1')
  const swapped = b64({ ...JSON.parse(Buffer.from(fresh, 'base64url').toString()), returnUrl: 'https://other-api.onrender.com/api/quickbooks/callback' })
  check('a state whose return URL was swapped is refused', verifyQboState(swapped, SECRET, now) === null)
  const dropped = JSON.parse(Buffer.from(fresh, 'base64url').toString()); delete dropped.returnUrl
  check('…and so is one whose return URL was removed', verifyQboState(b64(dropped), SECRET, now) === null)
  const oldSig = crypto.createHmac('sha256', SECRET).update(`co_1.${now}`).digest('hex')
  const oldShape = b64({ companyId: 'co_1', ts: now, sig: oldSig })
  check('the pre-relay shape { companyId, ts, sig } still verifies', verifyQboState(oldShape, SECRET, now)?.companyId === 'co_1')
  check('without a return URL the signer writes exactly the pre-relay bytes', signQboState({ companyId: 'co_1' }, SECRET, now) === oldShape)
  check('an expired state is refused', verifyQboState(fresh, SECRET, now + QBO_STATE_TTL_MS + 1) === null)
  check('another tenant\'s secret does not verify it', verifyQboState(fresh, 'other-secret', now) === null)
  check('an unsigned { companyId } (what crm-roof and crm-dispensary used to send) is refused', verifyQboState(b64({ companyId: 'co_1' }), SECRET, now) === null && verifyQboState(Buffer.from(JSON.stringify({ companyId: 'co_1', userId: 'u' })).toString('base64'), SECRET, now) === null)
  let threw = false; try { signQboState({ companyId: 'co_1' }, '') } catch { threw = true }
  check('there is no unsigned state: no secret, no state', threw)
}

// The shared service's getAuthUrl / exchange / callback run against a real CRM in tests/fieldservice/qbo-relay.test.ts
// (it needs the template's drizzle and hono); dispensary's and roof's forks in their own suites.

// ── the Factory hands every tenant the same redirect URI, and moves existing tenants onto it ───────────────────────
{
  const env = { QBO_CLIENT_ID: 'cid', QBO_CLIENT_SECRET: 'cs', NODE_ENV: 'production' } as any
  const out = quickbooksTenantEnv(TENANT + '/', env)
  const get = (k: string) => out.find(v => v.key === k)?.value
  check('QBO_REDIRECT_URI is the Factory\'s QuickBooks callback', get('QBO_REDIRECT_URI') === RELAY, out)
  check('…the same function the Factory\'s own connection uses (Intuit compares exactly)', get('QBO_REDIRECT_URI') === qboRedirectUri(env))
  check('QBO_RETURN_URL is the tenant\'s own /api/quickbooks/callback', get('QBO_RETURN_URL') === RETURN, out)
  check('two tenants get the same redirect URI and different return URLs', quickbooksTenantEnv('https://vettest-x-api.onrender.com', env).find(v => v.key === 'QBO_REDIRECT_URI')?.value === RELAY && quickbooksTenantEnv('https://vettest-x-api.onrender.com', env).find(v => v.key === 'QBO_RETURN_URL')?.value === 'https://vettest-x-api.onrender.com/api/quickbooks/callback')
  check('an explicit QBO_REDIRECT_URI on the Factory is what tenants get', quickbooksTenantEnv(TENANT, { ...env, QBO_REDIRECT_URI: 'https://factory.example.com/cb' }).find(v => v.key === 'QBO_REDIRECT_URI')?.value === 'https://factory.example.com/cb')
  check('no Intuit app on the Factory → nothing emitted', quickbooksTenantEnv(TENANT, { NODE_ENV: 'production' } as any).length === 0)
  check('the backfill corrects QBO_REDIRECT_URI and QBO_RETURN_URL on existing tenants', QBO_ENVIRONMENT_KEYS.includes('QBO_REDIRECT_URI') && QBO_ENVIRONMENT_KEYS.includes('QBO_RETURN_URL'))
  check('QBO_SANDBOX=1 (what the Factory\'s own connection reads as sandbox) is sandbox for tenants too', quickbooksSandbox({ QBO_SANDBOX: '1' } as any) === true && quickbooksSandbox({ QBO_SANDBOX: 'true' } as any) === true && quickbooksSandbox({ QBO_SANDBOX: 'false' } as any) === false && quickbooksSandbox({} as any) === false)

  const deploy = read('apps/api/src/services/deploy.ts')
  const refresh = deploy.slice(deploy.indexOf('export async function refreshPlatformIntegrationEnv'), deploy.indexOf('export async function refreshPlatformIntegrationEnv') + 2000)
  check('refreshPlatformIntegrationEnv overwrites QBO_ENVIRONMENT_KEYS when they differ', /QBO_ENVIRONMENT_KEYS\.includes\(v\.key\) && current\.get\(v\.key\) !== v\.value/.test(refresh))
  const upd = deploy.slice(deploy.indexOf('const platformEnv = await refreshPlatformIntegrationEnv(crmServiceId)'))
  check('updateCustomerCode redeploys after refreshing the env (Render loads env only on a deploy)', upd.indexOf("'/deploys'") > 0 && upd.indexOf("'/deploys'") < 3000)
}

// ── the Factory's callback relays before it handles its own connection ───────────────────────────────────────────
{
  const admin = read('apps/api/src/routes/factory/admin.ts')
  const cb = admin.slice(admin.indexOf("factory.get('/integrations/qbo/callback'"))
  const relayAt = cb.indexOf('qboRelayDecision(c.req.query(), tenantOriginLookup(supabase))')
  check('the callback asks the relay first', relayAt > 0 && relayAt < cb.indexOf('qboOAuthStates.get(state)') && relayAt < cb.indexOf("if (error)"))
  check('a refused relay is a 400, not a redirect', /relay\.kind === 'refuse'[\s\S]{0,200}\}, 400\)/.test(cb.slice(0, 800)))
  const factory = read('apps/api/src/routes/factory.ts')
  check('the callback is public (Intuit redirects a browser with no Factory session)', factory.includes("c.req.path.includes('/integrations/qbo/callback')"))
}

// ── the forks use the same signer and send the relay ──────────────────────────────────────────────────────────────
{
  const disp = read('templates/crm-dispensary/backend/src/routes/integrations.ts')
  check('crm-dispensary signs its state and verifies it on the callback', disp.includes('signQboState(') && disp.includes('verifyQboState(state, qbStateSecret())') && !/JSON\.parse\(Buffer\.from\(state/.test(disp))
  check('…authorize and exchange both send qbRedirectUri()', (disp.match(/redirect_uri: qbRedirectUri\(\)/g) || []).length === 2)
  const roofSvc = read('templates/crm-roof/backend/src/services/quickbooks.ts')
  const roofRt = read('templates/crm-roof/backend/src/routes/quickbooks.ts')
  check('crm-roof signs its state and verifies it on the callback', roofSvc.includes('signQboState(') && roofRt.includes('qb.verifyState(state)') && !/JSON\.parse\(Buffer\.from\(state/.test(roofRt))
  check('…and reads the QBO_* names the Factory sets', /process\.env\.QBO_CLIENT_ID/.test(roofSvc) && /process\.env\.QBO_REDIRECT_URI/.test(roofSvc))
  const roofSettings = read('templates/crm-roof/frontend/src/pages/settings/SettingsPage.tsx')
  check('…and its Settings asks /auth-url with the session instead of navigating to /connect (a page load carries no bearer token: 401)', roofSettings.includes("api.raw('/api/quickbooks/auth-url')") && !roofSettings.includes("window.location.href = '/api/quickbooks/connect'"))
}

console.log(`\nqbo-relay: ${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
