// The premium website's branded email — ONE place per business — through the site's real server
// (website-premium-contractor/server-static.ts, the 11 premium templates are identical in these files), on a
// throwaway SQLite file, with the Factory faked (no network):
//   1. GET /api/internal/email-aliases — the Factory's read-back for a website-only tenant: refused without the
//      key, with a wrong key, and when FACTORY_SYNC_KEY is unset (never an open list); with it, the CRM's shape
//   2. a website-only owner's address: saved here, pushed to the Factory with the site's key, listed back by
//      the read-back as a forward address
//   3. admin-only on the server too (the nav item is adminOnly): an editor is refused every alias route
//   4. the status the page shows is the Factory's report, passed through; an unreachable Factory is a state
//   5. paired with a CRM — by CRM_API_URL (a site built with its CRM: Higgs) or by settings.crmUrl (the add-on):
//      the page is pointed at the CRM's address page, every write is refused (an address made here would be
//      deleted by the Factory's reconcile, which reads only the CRM), and Billing's crm-status says ready
// The page itself: templates/website-premium-*/admin/src/pages/EmailPage.tsx (routed at /email — guard
// scripts/check-premium-admin-nav-routes.ts). Needs the template's own dependencies:
//   cd templates/website-premium-contractor && bun install && cd ../.. && bun tests/shared/premium-site-email.test.ts
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'premium-email-'))
process.env.SITE_DB_PATH = join(dir, 'site.db')
process.env.JWT_SECRET = 'test-jwt-secret-premium-email'
process.env.FACTORY_URL = 'https://factory.test'
process.env.TENANT_ID = '0123abcd-0000-4000-8000-00000000cafe'
const KEY = 'k-site-0123456789abcdef'
process.env.FACTORY_SYNC_KEY = KEY
delete process.env.CRM_API_URL

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 600)) }
}

const ROOT = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const T = ROOT + 'templates/website-premium-contractor/'

// ── the Factory, faked: every outgoing fetch is recorded and answered here ────────────────────────────
const factoryCalls: Array<{ url: string; method: string; key: string | null; body: any }> = []
let statusAnswer: { status: number; body: any } = { status: 200, body: { state: 'waiting_for_domain', domain: null, aliases: [] } }
let factoryDown = false
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(input?.url || input)
  if (!url.startsWith('https://factory.test/')) return realFetch(input, init)
  const headers = init?.headers || {}
  factoryCalls.push({ url, method: init?.method || 'GET', key: headers['X-Factory-Key'] ?? null, body: init?.body ? JSON.parse(init.body) : null })
  if (factoryDown) throw new Error('connect ECONNREFUSED')
  if (url.endsWith('/email-alias-status')) return new Response(JSON.stringify(statusAnswer.body), { status: statusAnswer.status, headers: { 'content-type': 'application/json' } })
  return new Response(JSON.stringify({ success: true, action: 'deferred', reason: 'waiting_for_domain' }), { status: 200, headers: { 'content-type': 'application/json' } })
}) as any

const { migrateDb } = await import(T + 'db/migrate.ts')
migrateDb()
const { db } = await import(T + 'db/index.ts')
const schema = await import(T + 'db/schema.ts')
const jwt = (await import(T + 'node_modules/jsonwebtoken/index.js')).default
const server = (await import(T + 'server-static.ts')).default as { fetch: (r: Request) => Promise<Response> }

const [admin] = await db.insert(schema.users).values({ email: 'owner@pat-builds.test', passwordHash: 'x', name: 'Pat', role: 'admin' } as any).returning()
const [editor] = await db.insert(schema.users).values({ email: 'ed@pat-builds.test', passwordHash: 'x', name: 'Ed', role: 'editor' } as any).returning()
// Settings row the site boots with (set-crm-url refuses without one).
if (!(await db.select().from(schema.settings).limit(1))[0]) await db.insert(schema.settings).values({ companyName: "Pat Builds" } as any)
const token = (u: any) => jwt.sign({ sub: u.id, email: u.email, role: u.role }, process.env.JWT_SECRET!, { expiresIn: 600 })

const call = async (method: string, path: string, opts: { as?: any; key?: string; body?: unknown } = {}) => {
  const headers: Record<string, string> = { host: 'pat-builds-site.onrender.com' }
  if (opts.as) headers.Authorization = 'Bearer ' + token(opts.as)
  if (opts.key !== undefined) headers['X-Factory-Key'] = opts.key
  if (opts.body !== undefined) headers['content-type'] = 'application/json'
  const res = await server.fetch(new Request('http://localhost' + path, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) }))
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}

// ── 1. the read-back ──────────────────────────────────────────────────────────────────────────────────
{
  const none = await call('GET', '/api/internal/email-aliases')
  check(`read-back without the key is refused (${none.status})`, none.status === 401, none)
  const wrong = await call('GET', '/api/internal/email-aliases', { key: KEY.replace(/.$/, 'X') })
  check(`…with a wrong key of the same length too (${wrong.status})`, wrong.status === 401, wrong)
  const short = await call('GET', '/api/internal/email-aliases', { key: 'k' })
  check(`…and a short one (${short.status})`, short.status === 401, short)
  const ok = await call('GET', '/api/internal/email-aliases', { key: KEY })
  check(`with the key: the CRM's shape, empty to start (${ok.status})`, ok.status === 200 && Array.isArray(ok.json?.aliases) && ok.json.aliases.length === 0, ok)
  delete process.env.FACTORY_SYNC_KEY
  const unset = await call('GET', '/api/internal/email-aliases', { key: '' })
  check(`no FACTORY_SYNC_KEY on the site → 503, never an open list (${unset.status})`, unset.status === 503, unset)
  process.env.FACTORY_SYNC_KEY = KEY
}

// ── 2. a website-only owner's address ─────────────────────────────────────────────────────────────────
let supportId = ''
{
  const list0 = await call('GET', '/api/admin/email-aliases', { as: admin })
  check(`the page's list loads (was a ReferenceError on \`settings\`) (${list0.status})`, list0.status === 200 && Array.isArray(list0.json?.data) && list0.json.crmEmailUrl === null, list0)
  const made = await call('POST', '/api/admin/email-aliases', { as: admin, body: { localPart: 'Support', forwardTo: 'pat@gmail.com' } })
  check(`an address is saved (${made.status})`, made.status === 201 && made.json?.alias?.localPart === 'support' && made.json.synced === true, made)
  supportId = made.json?.alias?.id
  const push = factoryCalls.find((f) => f.url.endsWith('/customers/' + process.env.TENANT_ID + '/email-alias-sync'))
  check('…and pushed to the Factory with the site\'s key', !!push && push.key === KEY && push.body?.localPart === 'support' && push.body?.routingMode === 'forward' && push.body?.forwardTo === 'pat@gmail.com', push)
  const back = await call('GET', '/api/internal/email-aliases', { key: KEY })
  const a = back.json?.aliases?.[0]
  check('the read-back lists it — forward, enabled, to the inbox', back.json?.aliases?.length === 1 && a.localPart === 'support' && a.routingMode === 'forward' && a.forwardTo === 'pat@gmail.com' && a.enabled === true, back.json)
  check('…and nothing else from the row (no ids, no sync errors)', a && Object.keys(a).sort().join() === 'enabled,forwardTo,localPart,routingMode', a)
  const paused = await call('PATCH', '/api/admin/email-aliases/' + supportId, { as: admin, body: { enabled: false } })
  const back2 = await call('GET', '/api/internal/email-aliases', { key: KEY })
  check(`a paused address reads back as switched off (${paused.status})`, paused.status === 200 && back2.json?.aliases?.[0]?.enabled === false, back2.json)
  await call('PATCH', '/api/admin/email-aliases/' + supportId, { as: admin, body: { enabled: true } })
}

// ── 3. admin-only on the server ───────────────────────────────────────────────────────────────────────
{
  const r = await Promise.all([
    call('GET', '/api/admin/email-aliases', { as: editor }),
    call('GET', '/api/admin/email-aliases/status', { as: editor }),
    call('POST', '/api/admin/email-aliases', { as: editor, body: { localPart: 'ed', forwardTo: 'ed@gmail.com' } }),
    call('PATCH', '/api/admin/email-aliases/' + supportId, { as: editor, body: { enabled: false } }),
    call('DELETE', '/api/admin/email-aliases/' + supportId, { as: editor }),
    call('POST', '/api/admin/email-aliases/' + supportId + '/resync', { as: editor }),
    call('POST', '/api/admin/email-aliases/resend-confirmation', { as: editor, body: { destination: 'pat@gmail.com' } }),
  ])
  check(`an editor is refused every alias route (${r.map((x) => x.status).join(',')})`, r.every((x) => x.status === 403), r.map((x) => x.status))
  const anon = await call('GET', '/api/admin/email-aliases')
  check(`…and nobody signed in gets anything (${anon.status})`, anon.status === 401, anon)
}

// ── 4. status: the Factory's report, passed through ───────────────────────────────────────────────────
{
  statusAnswer = { status: 200, body: { state: 'action_needed', domain: 'patbuilds.com', aliases: [{ localPart: 'support', address: 'support@patbuilds.com', state: 'confirm_destination', destination: 'pat@gmail.com', detail: 'Cloudflare sent a confirmation email' }] } }
  const s = await call('GET', '/api/admin/email-aliases/status', { as: admin })
  const req = factoryCalls.at(-1)
  check(`status asks the Factory for this tenant, with the key (${s.status})`, req?.url === `https://factory.test/api/v1/factory/customers/${process.env.TENANT_ID}/email-alias-status` && req?.key === KEY, req)
  check('…and passes its report through', s.status === 200 && s.json?.domain === 'patbuilds.com' && s.json?.aliases?.[0]?.state === 'confirm_destination', s.json)
  statusAnswer = { status: 401, body: { error: 'Unauthorized' } }
  const s401 = await call('GET', '/api/admin/email-aliases/status', { as: admin })
  check('a Factory refusal is an "error" state the page names, not a 500', s401.status === 200 && s401.json?.state === 'error' && /Unauthorized/.test(s401.json?.detail || ''), s401.json)
  factoryDown = true
  const down = await call('GET', '/api/admin/email-aliases/status', { as: admin })
  check('an unreachable Factory too', down.status === 200 && down.json?.state === 'error' && /reach the Factory/.test(down.json?.detail || ''), down.json)
  factoryDown = false
  const resend = await call('POST', '/api/admin/email-aliases/resend-confirmation', { as: admin, body: { destination: 'Pat@Gmail.com' } })
  const rq = factoryCalls.at(-1)
  check(`resend goes to the Factory's confirmation route, lower-cased (${resend.status})`, resend.status === 200 && rq?.url.endsWith('/email-alias-confirmation') && rq?.body?.destination === 'pat@gmail.com' && rq?.key === KEY, rq)
}

// ── 5. paired with a CRM ──────────────────────────────────────────────────────────────────────────────
for (const how of ['CRM_API_URL', 'settings.crmUrl'] as const) {
  const [s] = await db.select().from(schema.settings).limit(1)
  if (how === 'CRM_API_URL') process.env.CRM_API_URL = 'https://pat-builds-api.onrender.com'
  else {
    delete process.env.CRM_API_URL
    const r = await call('POST', '/api/internal/set-crm-url', { key: KEY, body: { crmUrl: 'https://pat-builds-api.onrender.com/' } })
    check(`[${how}] the add-on's set-crm-url is accepted (${r.status})`, r.status === 200, r)
  }
  const list = await call('GET', '/api/admin/email-aliases', { as: admin })
  check(`[${how}] the page is pointed at the CRM's address page`, list.status === 200 && list.json?.crmEmailUrl === 'https://pat-builds-api.onrender.com/crm/settings/email', list.json)
  check(`[${how}] …and still sees the addresses made here before (to carry over)`, list.json?.data?.length === 1, list.json?.data)
  const before = factoryCalls.length
  const w = await Promise.all([
    call('POST', '/api/admin/email-aliases', { as: admin, body: { localPart: 'info', forwardTo: 'pat@gmail.com' } }),
    call('PATCH', '/api/admin/email-aliases/' + supportId, { as: admin, body: { enabled: false } }),
    call('DELETE', '/api/admin/email-aliases/' + supportId, { as: admin }),
    call('POST', '/api/admin/email-aliases/' + supportId + '/resync', { as: admin }),
  ])
  check(`[${how}] every write is refused, naming the CRM's page (${w.map((x) => x.status).join(',')})`, w.every((x) => x.status === 409 && x.json?.crmEmailUrl === 'https://pat-builds-api.onrender.com/crm/settings/email'), w.map((x) => x.json))
  check(`[${how}] …and nothing reached the Factory`, factoryCalls.length === before, factoryCalls.slice(before))
  const cs = await call('GET', '/api/admin/crm-status', { as: admin })
  check(`[${how}] Billing's crm-status says the CRM is there (no "Add the CRM" offer)`, cs.status === 200 && cs.json?.ready === true && cs.json?.crmUrl === 'https://pat-builds-api.onrender.com', cs.json)
  if (how === 'settings.crmUrl') await db.update(schema.settings).set({ crmUrl: null, crmReadyAt: null } as any)
  void s
}
{
  delete process.env.CRM_API_URL
  const cs = await call('GET', '/api/admin/crm-status', { as: admin })
  check('no CRM: crm-status not ready', cs.json?.ready === false && cs.json?.crmUrl === null, cs.json)
  process.env.CRM_API_URL = 'http://insecure.example.com'
  const insecure = await call('GET', '/api/admin/email-aliases', { as: admin })
  check('a non-https CRM_API_URL is not a CRM to send the owner to', insecure.json?.crmEmailUrl === null, insecure.json)
  delete process.env.CRM_API_URL
}

globalThis.fetch = realFetch
try { rmSync(dir, { recursive: true, force: true }) } catch { /* SQLite may still hold the file on Windows */ }
console.log(`\npremium-site-email: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
