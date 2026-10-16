// Home care's one response path for every staff request — frontend/src/services/sessionFetch.ts. (Run 3, 10/16)
//
//   HIGH 10: "After a few minutes the access token expired: pages kept polling and getting 401, and the Schedule Hub
//   showed 'Failed to load schedule data' and 'No caregivers found'. A full page reload fixed it each time."
//   View As: "HTTP 403 'View As is read-only...', but the page shows nothing: the button says 'Saving...' then returns."
//
// The screens make ~500 raw fetch() calls with a token they captured at render. The old wrapper refreshed the session in
// the background but still handed each screen its 401, and the next poll sent the same dead token. Here the module runs
// against a fake server: a stale token is swapped for the current one, a 401 is refreshed and REPLAYED (the screen sees
// the real answer), a dead session goes to sign-in once and the screen's request never settles (no empty list painted),
// a 402 ACCOUNT_LOCKED opens the lock page, and a View As refusal reaches the person in the server's own words.
// Sign-in itself is never touched: a wrong password's 401 belongs to the login form. Nothing leaves the machine.
import { readFileSync } from 'node:fs'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}
const ROOT = process.env.FACTORY_ROOT || '../../'
const FE = ROOT + 'templates/crm-homecare/frontend/src/'
const { createSessionFetch } = await import(FE + 'services/sessionFetch.ts')

// ── a fake server: valid tokens, and what each path answers
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } })
function world(opts: { refreshWorks?: boolean } = {}) {
  const valid = new Set(['fresh'])
  const seen: Array<{ url: string; auth: string | null; method: string; body: any }> = []
  const events: string[] = []
  let current: string | null = 'old'
  const issued = new Set(['old'])
  let refreshes = 0
  const native = async (input: any, init?: any) => {
    const url = typeof input === 'string' ? input : input.url
    const h = new Headers(init?.headers ?? input?.headers)
    const auth = h.get('authorization')
    const body = init?.body ?? null
    seen.push({ url, auth, method: init?.method || 'GET', body })
    if (/\/api\/auth\/login/.test(url)) return json({ error: 'Invalid credentials' }, 401)
    const tok = auth?.replace(/^Bearer /, '')
    if (url.includes('/api/locked')) return json({ error: 'This account’s subscription has ended.', code: 'ACCOUNT_LOCKED', lock: 'subscription_ended' }, 402)
    if (tok === 'viewas' && (init?.method || 'GET') !== 'GET') return json({ error: 'View As is read-only — nothing can be changed while viewing as someone else. Exit View As to make changes.', code: 'view_as_read_only' }, 403)
    if (tok === 'viewas') return json({ ok: true, as: 'viewas' })
    if (!tok || !valid.has(tok)) return json({ error: 'Invalid or expired token' }, 401)
    return json({ ok: true, caregivers: [{ id: 'c1' }], body })
  }
  const port = {
    current: () => current,
    owns: (t: string) => issued.has(t),
    refresh: async () => { refreshes++; events.push('refresh'); if (opts.refreshWorks === false) return false; current = 'fresh'; issued.add('fresh'); return true },
    ended: () => events.push('ended'),
    notify: (m: string) => events.push('notify:' + m),
    locked: () => events.push('locked'),
    portalPaused: () => events.push('portalPaused'),
    onLockPage: () => false,
  }
  return { fetch: createSessionFetch(native, port), seen, events, refreshes: () => refreshes, port }
}
const settles = async (p: Promise<any>, ms = 200) => Promise.race([p.then(() => true, () => true), new Promise((r) => setTimeout(() => r(false), ms))])

{
  // The Schedule Hub's poll, with the token it captured an hour ago.
  const w = world()
  const res = await w.fetch('/api/scheduling/caregivers', { headers: { Authorization: 'Bearer old' } })
  const body = await res.json()
  check(`an expired session is refreshed and the request replayed — the screen gets its caregivers, not a 401 (${res.status})`, res.status === 200 && body.caregivers?.length === 1, body)
  check('…one refresh, and the replay carried the NEW token', w.refreshes() === 1 && w.seen.at(-1)?.auth === 'Bearer fresh', w.seen)
  // The next poll: the screen still holds "old". It is sent with the current token straight away — no 401 storm.
  const before = w.seen.length
  const next = await w.fetch('/api/scheduling/caregivers', { headers: { Authorization: 'Bearer old' } })
  check('the next poll with the captured token goes out with the current one — no second 401, no second refresh', next.status === 200 && w.seen.length === before + 1 && w.seen.at(-1)?.auth === 'Bearer fresh' && w.refreshes() === 1, w.seen.slice(before))
}
{
  // A save is replayed with its body (the server refused it before any route ran).
  const w = world()
  const res = await w.fetch('/api/clients', { method: 'POST', headers: { Authorization: 'Bearer old', 'Content-Type': 'application/json' }, body: JSON.stringify({ firstName: 'Pat' }) })
  const b = await res.json()
  check('a write refused 401 is replayed once, with its body, after the refresh', res.status === 200 && b.body === JSON.stringify({ firstName: 'Pat' }) && w.seen.filter((s) => s.method === 'POST').length === 2, w.seen)
  // A Request object (some screens build one) is replayed from a copy taken before it was sent.
  const w2 = world()
  const req = new Request('http://x.test/api/clients', { method: 'POST', headers: { Authorization: 'Bearer old' }, body: 'payload' })
  const r2 = await w2.fetch(req)
  check('a Request object is replayed too', r2.status === 200 && w2.refreshes() === 1, w2.seen)
}
{
  // The refresh token is gone too: the session has ended.
  const w = world({ refreshWorks: false })
  const p = w.fetch('/api/scheduling/caregivers', { headers: { Authorization: 'Bearer old' } })
  check('a session that cannot be refreshed: the screen\'s request NEVER settles — no "Failed to load", no empty list', !(await settles(p)))
  check('…and the person is sent to sign in, once', w.events.filter((e) => e === 'ended').length === 1, w.events)
  const p2 = w.fetch('/api/dashboard/summary', { headers: { Authorization: 'Bearer old' } })
  check('…every other screen\'s request in flight waits for the page to leave too, and sign-in is not called twice', !(await settles(p2)) && w.events.filter((e) => e === 'ended').length === 1, w.events)
}
{
  // Not this session's token: a View As token, a portal token, none at all.
  const w = world()
  const login = await w.fetch('/api/auth/login', { method: 'POST', headers: { Authorization: 'Bearer old' }, body: '{}' })
  check('sign-in passes through untouched: a wrong password is the login form\'s 401', login.status === 401 && w.refreshes() === 0)
  const anon = await w.fetch('/api/scheduling/caregivers')
  check('a request with no token is not "refreshed" into the staff session', anon.status === 401 && w.refreshes() === 0 && w.seen.at(-1)?.auth === null)
  const portal = await w.fetch('/api/portal/visits', { headers: { Authorization: 'Bearer portal-client-token' } })
  check('a client-portal token is left alone (it has no refresh) — its own screen handles the 401', portal.status === 401 && w.refreshes() === 0 && w.seen.at(-1)?.auth === 'Bearer portal-client-token')
  const viewRead = await w.fetch('/api/clients', { headers: { Authorization: 'Bearer viewas' } })
  check('a View As read keeps the View As token — never swapped for the admin\'s own', viewRead.status === 200 && w.seen.at(-1)?.auth === 'Bearer viewas')
  const outside = await w.fetch('https://maps.example.test/tiles/1', { headers: { Authorization: 'Bearer old' } })
  check('a request outside /api/ is not touched', w.seen.at(-1)?.url === 'https://maps.example.test/tiles/1' && w.seen.at(-1)?.auth === 'Bearer old' && !!outside)
}
{
  // View As: the refusal reaches the person.
  const w = world()
  const save = await w.fetch('/api/clients/1', { method: 'PUT', headers: { Authorization: 'Bearer viewas' }, body: '{}' })
  const said = w.events.filter((e) => e.startsWith('notify:'))
  check(`a View As write: the server's own sentence is shown (${save.status})`, save.status === 403 && said.length === 1 && /View As is read-only/.test(said[0]), w.events)
  const sb = await save.json()
  check('…and the screen still gets the 403 with its body, to handle as it does', sb.code === 'view_as_read_only')
  await w.fetch('/api/clients/1', { method: 'PUT', headers: { Authorization: 'Bearer viewas' }, body: '{}' })
  check('…a save that fires several writes says it once, not five times', w.events.filter((e) => e.startsWith('notify:')).length === 1, w.events)
  const other = await w.fetch('/api/clients/2', { method: 'PUT', headers: { Authorization: 'Bearer fresh' }, body: '{}' })
  check('a write that succeeds is not announced', other.status === 200 && w.events.filter((e) => e.startsWith('notify:')).length === 1)
}
{
  // A cancelled agency: any screen's 402 opens the lock page.
  const w = world()
  const r = await w.fetch('/api/locked/clients', { headers: { Authorization: 'Bearer fresh' } })
  check(`a 402 ACCOUNT_LOCKED opens the lock page (${r.status})`, r.status === 402 && w.events.includes('locked'), w.events)
  const w2 = world(); w2.port.onLockPage = () => true
  await w2.fetch('/api/locked/clients', { headers: { Authorization: 'Bearer fresh' } })
  check('…but not again from the lock page itself', !w2.events.includes('locked'), w2.events)
}
{
  // A portal's 402 is the portal's (Run 4, blocker 3): a family member or client is told the agency is paused and stays on
  // their portal — the staff lock page means nothing to them. Their tokens are not this session's, and never refreshed.
  const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
  const tok = (role: string) => `${b64({ alg: 'HS256' })}.${b64({ role, clientId: 'c1' })}.sig`
  for (const [who, headers] of [
    ['a family member', { Authorization: `Bearer ${tok('family')}` }],
    ['a client (signed in)', { Authorization: `Bearer ${tok('client')}` }],
    ['a client (emailed link)', { 'x-portal-token': 'db-link-token' }],
  ] as const) {
    const w = world()
    const r = await w.fetch('/api/locked/family-portal/portal/schedule', { headers })
    check(`${who}: a 402 ACCOUNT_LOCKED shows the portal's "paused" screen, not the staff lock page (${r.status})`, r.status === 402 && w.events.includes('portalPaused') && !w.events.includes('locked') && w.refreshes() === 0, w.events)
  }
  const staffish = world()
  await staffish.fetch('/api/locked/clients', { headers: { Authorization: `Bearer ${tok('admin')}` } })
  check('a staff role in a token it did not issue (View As) still goes to the lock page', staffish.events.includes('locked') && !staffish.events.includes('portalPaused'), staffish.events)
  const api = readFileSync(FE + 'services/api.ts', 'utf8'), app = readFileSync(FE + 'App.tsx', 'utf8')
  check('the portal apps listen: api.ts raises the event, both portal apps render PortalPaused on it', /portalPaused: \(\) => \{[^}]*dispatchEvent\(new CustomEvent\(PORTAL_PAUSED_EVENT\)\)/.test(api) && (app.match(/if \(paused\) return <PortalPaused onLogout=\{handleLogout\} \/>;/g) || []).length === 2 && (app.match(/const paused = usePortalPaused\(\);/g) || []).length === 2)
}

// ── the wiring: installed once over window.fetch, every screen behind it, the old half-measure gone
{
  const api = readFileSync(FE + 'services/api.ts', 'utf8')
  check('services/api.ts installs it over window.fetch, before any screen can fetch', /window\.fetch = createSessionFetch\(window\.fetch\.bind\(window\)/.test(api))
  check('…owning exactly the tokens this session issued', /owns: \(token\) => api\.issued\.has\(token\)/.test(api) && /this\.issued\.add\(accessToken\)/.test(api))
  check('…a dead session goes to sign-in with the reason, the lock page on a 402, the toast on View As', /window\.location\.assign\('\/login\?expired=1'\)/.test(api) && /locked: \(\) => window\.location\.assign\(LOCK_PAGE\)/.test(api) && /notify: \(message\) => toast\(message/.test(api))
  const ctx = readFileSync(FE + 'contexts/AuthContext.tsx', 'utf8')
  check('the old wrapper that handed screens their 401 is gone from AuthContext', !/window\.fetch\s*=/.test(ctx))
  const cfg = readFileSync(FE + 'config.ts', 'utf8')
  check('apiCall no longer kills a staff session on an expired token before even asking', /isTokenExpired\(token\) && !api\.issued\.has\(token\)/.test(cfg))
  const login = readFileSync(FE + 'components/Login.tsx', 'utf8')
  check('sign-in says why the person is there again', /get\('expired'\) === '1'/.test(login) && /Your session ended/.test(login))
  // Three pages read a key the session has not written since the 'token' → 'accessToken' rename: every call sent "Bearer null".
  for (const page of ['PtoPage', 'NoShowPage', 'PerformanceReviewsPage']) {
    check(`${page} reads the session's token, not the retired 'token' key`, !/getItem\('token'\)/.test(readFileSync(FE + `pages/${page}.tsx`, 'utf8')))
  }
}

console.log(`\nhomecare-session-fetch: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
