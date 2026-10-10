// crm-store — Settings › Email Domain reaches the Factory. (2026-10-10)
//
// The page called /api/email-domain/status and /verify and the store mounted neither: every request was a
// 404, which the page reads as "no domain set up" — so a store WITH a branded domain was told it had none,
// and Verify could never work. The route is now mounted, behind settings:update like the branded
// addresses beside it.
//
// No live calls: a stand-in Factory on a local port answers, and records what the store sent — which
// tenant, which path, and the sync key — so the proxy is proven end to end, not just "it returned 200".
import { Hono } from 'hono'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { users } from './db/schema.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}

const seen: { method: string; path: string; key: string | null }[] = []
let answer: { status: number; body: unknown } = { status: 200, body: { status: 'verified', domain: 'shop.example', records: [] } }
const factory = Bun.serve({
  port: 0,
  fetch(req) {
    const u = new URL(req.url)
    seen.push({ method: req.method, path: u.pathname, key: req.headers.get('x-factory-key') })
    return new Response(JSON.stringify(answer.body), { status: answer.status, headers: { 'content-type': 'application/json' } })
  },
})
const TENANT = '11111111-2222-4333-8444-555555555555'
process.env.FACTORY_URL = `http://127.0.0.1:${factory.port}`
process.env.TENANT_ID = TENANT
process.env.FACTORY_SYNC_KEY = 'store-sync-key-for-the-test'

await setupSchema()
const mk = async (role: string, name: string) => (await db.insert(users).values({ email: `${name}@domain.test`, passwordHash: 'x', name, role } as any).returning())[0]
const owner = await mk('owner', 'owner'), manager = await mk('manager', 'manager'), staff = await mk('staff', 'staff')

// The REAL index.ts mount, not the route file on its own — the defect was the missing mount.
const indexSrc = await Bun.file(new URL('./src/index.ts', import.meta.url)).text()
check("index.ts mounts the route at /api/email-domain", /app\.route\('\/api\/email-domain', emailDomainRoutes\)/.test(indexSrc))
check('…from routes/emailDomain.ts', /import emailDomainRoutes from '\.\/routes\/emailDomain\.ts'/.test(indexSrc))

const app = new Hono()
app.route('/api/email-domain', (await import('./src/routes/emailDomain.ts')).default)
const as = (who: any) => async (method: string, path: string) => {
  const res = await app.request(path, { method, headers: { 'x-test-user': who.id } })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}

const st = await as(owner)('GET', '/api/email-domain/status')
check('owner: status answers with what the Factory said', st.status === 200 && st.json?.status === 'verified' && st.json?.domain === 'shop.example', st)
check("…asked of THIS tenant's Factory record", seen.at(-1)?.path === `/api/v1/factory/customers/${TENANT}/email-domain/status` && seen.at(-1)?.method === 'GET', seen.at(-1))
check('…with the sync key', seen.at(-1)?.key === 'store-sync-key-for-the-test', seen.at(-1))

const vf = await as(owner)('POST', '/api/email-domain/verify')
check('owner: verify reaches the Factory', vf.status === 200 && seen.at(-1)?.path === `/api/v1/factory/customers/${TENANT}/email-domain/verify` && seen.at(-1)?.method === 'POST', { vf, last: seen.at(-1) })

answer = { status: 200, body: { status: 'unconfigured', records: [] } }
const none = await as(owner)('GET', '/api/email-domain/status')
check('owner: a store with no domain is told so by the Factory, not by a 404', none.status === 200 && none.json?.status === 'unconfigured', none)

answer = { status: 401, body: { error: 'Unauthorized' } }
const bad = await as(owner)('GET', '/api/email-domain/status')
check('a refused sync key is a configuration state (424), never a 500', bad.status === 424, bad)

const calls = seen.length
const m = await as(manager)('GET', '/api/email-domain/status'), s = await as(staff)('POST', '/api/email-domain/verify')
check('manager: refused (settings:update is the owner\'s)', m.status === 403, m)
check('staff: refused', s.status === 403, s)
check('…and neither refusal reached the Factory', seen.length === calls, seen.slice(calls))

factory.stop(true)
console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
