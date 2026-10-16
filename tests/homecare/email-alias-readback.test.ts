// crm-homecare — the branded addresses read back by the Factory (E2E Run 5, 10/16), through the real
// routes and email_alias table on PGlite. The same shared module is mounted by all twelve CRMs
// (scripts/check-email-alias-readback.ts holds the mounts); home care stands in for them here.
//   1. the onboarding wizard's save works with no domain: the Factory push is answered "deferred"
//   2. GET /api/internal/email-aliases: the Factory key only; only what a rule needs
//   3. GET /api/email-aliases/status: the Factory's report (asked with this tenant's id and key) — and a
//      named state, never a 500, when the Factory is down; office only
//   4. POST /api/email-aliases/resend-confirmation: only an inbox one of the addresses forwards to
import { Hono } from 'hono'
import { readFileSync } from 'node:fs'
import { setupSchema } from './setup.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 500)) }
}

process.env.FACTORY_URL = 'https://factory.test'
process.env.TENANT_ID = '0123abcd-0000-4000-8000-00000000beef'
process.env.FACTORY_SYNC_KEY = 'hc-alias-key'

// The Factory, faked: records every call; its answers are set per check.
const factoryCalls: Array<{ method: string; path: string; key: string | null; body: any }> = []
let statusAnswer: { status: number; body: any } = { status: 200, body: null }
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(input?.url ?? input)
  if (!url.startsWith(process.env.FACTORY_URL!)) return realFetch(input, init)
  const path = url.slice(process.env.FACTORY_URL!.length)
  factoryCalls.push({ method: init?.method || 'GET', path, key: init?.headers?.['X-Factory-Key'] ?? null, body: init?.body ? JSON.parse(init.body) : null })
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } })
  if (path.endsWith('/email-alias-sync')) return json({ success: true, action: 'deferred', reason: 'waiting_for_domain' })
  if (path.endsWith('/email-alias-status')) return json(statusAnswer.body, statusAnswer.status)
  if (path.endsWith('/email-alias-confirmation')) return json({ ok: true })
  return json({})
}) as any

await setupSchema()
const { db } = await import('./db/index.ts')
const { users } = await import('./db/schema.ts')
const mk = async (role: string, tag: string) => (await db.insert(users).values({ email: `${tag}-alias@test.local`, passwordHash: 'x', firstName: tag, lastName: 'U', role, isActive: true } as any).returning())[0]
const admin = await mk('admin', 'admin'), cg = await mk('caregiver', 'carol')

const routes = await import('./src/routes/emailAliases.ts')
const app = new Hono()
app.route('/api/email-aliases', routes.default)
app.route('/api/internal/email-aliases', routes.emailAliasesInternal) // as src/index.ts mounts it (asserted below)
const as = (u: any) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, { method, headers: { 'content-type': 'application/json', 'x-test-user': u.id, 'x-test-role': u.role, 'x-test-email': u.email }, body: body === undefined ? undefined : JSON.stringify(body) })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}
const A = as(admin), CG = as(cg)
const settle = () => new Promise((r) => setTimeout(r, 50)) // the push is fire-and-forget

// ── 1. the wizard's save, before any domain ────────────────────────────────────────────────────────
{
  const s = await A('POST', '/api/email-aliases', { localPart: 'support', routingMode: 'forward', forwardTo: 'owner@gmail.com' })
  const c = await A('POST', '/api/email-aliases', { localPart: 'care', routingMode: 'crm' })
  await settle()
  check(`the wizard saves its addresses with no domain (${s.status}, ${c.status})`, s.status === 201 && c.status === 201, { s: s.json, c: c.json })
  const pushes = factoryCalls.filter((x) => x.path.endsWith('/email-alias-sync'))
  check('…each is pushed to the Factory with this tenant\'s id and key', pushes.length === 2 && pushes.every((x) => x.path === '/api/v1/factory/customers/0123abcd-0000-4000-8000-00000000beef/email-alias-sync' && x.key === 'hc-alias-key'), pushes)
}

// ── 2. the Factory reads them back ─────────────────────────────────────────────────────────────────
{
  const none = await app.request('/api/internal/email-aliases')
  const wrong = await app.request('/api/internal/email-aliases', { headers: { 'X-Factory-Key': 'hc-alias-kez' } })
  check(`the internal list refuses no key and a wrong key (${none.status}, ${wrong.status})`, none.status === 401 && wrong.status === 401)
  const ok = await app.request('/api/internal/email-aliases', { headers: { 'X-Factory-Key': 'hc-alias-key' } })
  const body: any = await ok.json()
  const support = body.aliases?.find((a: any) => a.localPart === 'support')
  check('the Factory key reads both addresses from the real table', ok.status === 200 && body.aliases.length === 2 && support?.forwardTo === 'owner@gmail.com' && support?.enabled === true, body)
  check('…only what a rule needs (no ids, no timestamps)', body.aliases.every((a: any) => JSON.stringify(Object.keys(a).sort()) === JSON.stringify(['enabled', 'forwardTo', 'localPart', 'routingMode'])), body.aliases)
}

// ── 3. the status the address page shows ───────────────────────────────────────────────────────────
{
  statusAnswer = { status: 200, body: { state: 'waiting_for_nameservers', domain: 'pat-care.com', nameservers: ['ana.ns.cloudflare.com'], aliases: [{ localPart: 'support', address: 'support@pat-care.com', state: 'waiting_for_nameservers' }] } }
  const st = await A('GET', '/api/email-aliases/status')
  const call = factoryCalls.at(-1)
  check('the page\'s status is the Factory\'s report, passed through', st.status === 200 && st.json?.state === 'waiting_for_nameservers' && st.json?.aliases?.[0]?.address === 'support@pat-care.com', st.json)
  check('…asked of this tenant with its key', call?.method === 'GET' && call?.path === '/api/v1/factory/customers/0123abcd-0000-4000-8000-00000000beef/email-alias-status' && call?.key === 'hc-alias-key', call)
  statusAnswer = { status: 502, body: { error: 'Bad gateway' } }
  const down = await A('GET', '/api/email-aliases/status')
  check(`the Factory down: a named state, not a 500 (${down.status})`, down.status === 200 && down.json?.state === 'error' && /Bad gateway/.test(down.json?.detail || ''), down.json)
  const cgSt = await CG('GET', '/api/email-aliases/status')
  check(`a caregiver cannot read it (${cgSt.status})`, cgSt.status === 403, cgSt.json)
}

// ── 4. send the confirmation again ─────────────────────────────────────────────────────────────────
{
  const before = factoryCalls.length
  const stranger = await A('POST', '/api/email-aliases/resend-confirmation', { destination: 'someone@else.com' })
  check(`an inbox none of the addresses forwards to is refused (${stranger.status})`, stranger.status === 404 && factoryCalls.length === before, stranger.json)
  const ok = await A('POST', '/api/email-aliases/resend-confirmation', { destination: 'Owner@Gmail.com' })
  const call = factoryCalls.at(-1)
  check(`the owner's inbox is sent again (${ok.status})`, ok.status === 200 && call?.path.endsWith('/email-alias-confirmation') && call?.body?.destination === 'owner@gmail.com', { ok: ok.json, call })
}

// ── the mount the suite cannot run: src/index.ts ───────────────────────────────────────────────────
{
  const idx = readFileSync((process.env.FACTORY_ROOT || '') + 'templates/crm-homecare/backend/src/index.ts', 'utf8')
  check('src/index.ts mounts the read-back at /api/internal/email-aliases, without user auth', /app\.route\('\/api\/internal\/email-aliases', emailAliasesInternal\)/.test(idx) && /import emailAliasesRoutes, \{ emailAliasesInternal \} from '\.\/routes\/emailAliases\.ts'/.test(idx))
}

globalThis.fetch = realFetch
console.log(`\nhomecare-email-alias-readback: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
