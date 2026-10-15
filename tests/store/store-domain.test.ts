// crm-store — the store owner buys or connects the store's domain, like every other business. (Owner, 10/15)
//
//   "store owners should be able to buy like everyone else. why the fuck wouldnt they?"
//
// The store had no Domain page: a store owner had to email support and have staff buy the address in the Factory.
// Now /api/admin/domain answers through the SAME Factory routes the premium sites' Domain page uses. The Factory is
// answered here; nothing leaves the machine.
process.env.FACTORY_URL = 'https://factory.test'
process.env.TENANT_ID = '525b38e3-491d-4d8e-95ec-39ba50f7a233'
process.env.FACTORY_SYNC_KEY = 'store-sync-key'
import { Hono } from 'hono'
import { readFileSync } from 'node:fs'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { users } from './db/schema.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}
await setupSchema()
const mk = async (role: string) => (await db.insert(users).values({ email: `${role}@domain.test`, passwordHash: 'x', name: role, role } as any).returning())[0]
const owner = await mk('owner'), manager = await mk('manager'), staff = await mk('staff')

type Call = { method: string; path: string; key: string | null; body: any }
const calls: Call[] = []
let answer: { status: number; body: any } | null = null
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(input?.url ?? input)
  if (!url.startsWith('https://factory.test/')) return realFetch(input, init)
  const path = url.slice('https://factory.test'.length)
  calls.push({ method: (init?.method || 'GET').toUpperCase(), path, key: new Headers(init?.headers).get('x-factory-key'), body: init?.body ? JSON.parse(init.body) : null })
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } })
  if (answer) { const a = answer; answer = null; return json(a.body, a.status) }
  if (path.startsWith('/api/v1/factory/internal/domain/status/')) return json({ status: 'unconfigured', domain: null, nameservers: [] })
  if (path === '/api/v1/factory/public/domain/check') return json({ domain: 'testshopco.com', available: true, quote: { firstYearCents: 1214, renewalCents: 1955, renewsHigher: false }, suggestions: [] })
  if (path.startsWith('/api/v1/factory/internal/domain/buy/')) return json({ url: 'https://checkout.stripe.test/s', sessionId: 'cs_1', priceCents: 1214, renewalCents: 1955 })
  if (path.startsWith('/api/v1/factory/internal/domain/attach/')) return json({ domain: 'mine.com', status: 'pending_nameservers', nameservers: ['a.ns.cloudflare.com', 'b.ns.cloudflare.com'] })
  return json({ error: 'not answered here' }, 404)
}) as any

const app = new Hono()
app.route('/api/admin/domain', (await import('./src/routes/domain.ts')).default)
const as = (who: any) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request('/api/admin/domain' + path, { method, headers: { 'content-type': 'application/json', 'x-test-user': who.id }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}
const O = as(owner), M = as(manager), S = as(staff)
const TID = process.env.TENANT_ID

{
  const c0 = calls.length
  const st = await O('GET', '/status')
  check(`status: the owner reads it from the Factory, on the store's key (${st.status})`, st.status === 200 && st.json?.status === 'unconfigured' && calls[c0]?.path === `/api/v1/factory/internal/domain/status/${TID}` && calls[c0].key === 'store-sync-key', calls[c0])
  const ck = await O('POST', '/check', { domain: ' TestShopCo.com ' })
  check('check: the name goes to the same availability check as the premium sites, cleaned — with both prices back', ck.status === 200 && calls.at(-1)?.path === '/api/v1/factory/public/domain/check' && calls.at(-1)?.body?.domain === 'testshopco.com' && ck.json?.quote?.renewalCents === 1955, { call: calls.at(-1), r: ck.json })
  const buy = await O('POST', '/buy-checkout', { domain: 'testshopco.com' })
  const bc = calls.at(-1)
  check(`buy: a Stripe checkout from the Factory's buy route, returning the owner to THIS admin's /domain (${buy.status})`, buy.status === 200 && buy.json?.url === 'https://checkout.stripe.test/s' && bc?.path === `/api/v1/factory/internal/domain/buy/${TID}` && bc.body?.returnTo === 'admin' && bc.body?.returnPath === '/domain' && bc.body?.years === 1 && bc.key === 'store-sync-key', bc)
  const at = await O('POST', '/attach', { domain: 'mine.com' })
  check('connect: a domain the owner already owns goes to the Factory\'s attach as their own (byod), with the nameservers back', at.status === 200 && calls.at(-1)?.path === `/api/v1/factory/internal/domain/attach/${TID}` && calls.at(-1)?.body?.mode === 'byod' && at.json?.nameservers?.length === 2)
}
{
  const c0 = calls.length
  const bad = await O('POST', '/buy-checkout', { domain: 'not a domain' })
  check('a malformed name is refused here — the Factory is never asked', bad.status === 400 && calls.length === c0)
  answer = { status: 422, body: { error: 'To register a domain we need your business street address. Email support@twomiah.com and we will add them and register it for you — nothing has been charged.', code: 'registrant_incomplete', missing: ['street address'] } }
  const gap = await O('POST', '/buy-checkout', { domain: 'testshopco.com' })
  check(`a Factory refusal reaches the owner in its own words and status (${gap.status} ${gap.json?.code})`, gap.status === 422 && gap.json?.code === 'registrant_incomplete' && /street address/.test(gap.json?.error), gap.json)
  answer = { status: 503, body: { error: 'We could not get the current price' } }
  const down = await O('POST', '/buy-checkout', { domain: 'testshopco.com' })
  check('a Factory that cannot answer is a 502, not a pass-through 5xx', down.status === 502)
  answer = { status: 401, body: { error: 'Unauthorized' } }
  const key = await O('GET', '/status')
  check("a Factory 401 (the store's key) is a 502 — never a 401 that would sign the owner out", key.status === 502, key)
}
{
  // A store with no Factory link: "no domain yet", and the actions refuse in words — never a 500.
  const saved = process.env.FACTORY_SYNC_KEY; delete process.env.FACTORY_SYNC_KEY
  const c0 = calls.length
  const st = await O('GET', '/status'), buy = await O('POST', '/buy-checkout', { domain: 'testshopco.com' })
  check(`unlinked: status is "unconfigured" (${st.status}); buying refuses with factory_not_linked (${buy.status})`, st.status === 200 && st.json?.status === 'unconfigured' && buy.status === 503 && buy.json?.code === 'factory_not_linked' && calls.length === c0)
  process.env.FACTORY_SYNC_KEY = saved
}
{
  const c0 = calls.length
  const rs = await Promise.all([M('GET', '/status'), S('GET', '/status'), M('POST', '/buy-checkout', { domain: 'testshopco.com' }), S('POST', '/attach', { domain: 'mine.com' })])
  check(`seats: the domain is the owner's — managers and staff are refused, the Factory never asked (${rs.map((r) => r.status).join(',')})`, rs.every((r) => r.status === 403) && calls.length === c0)
}
{
  const ROOT = (process.env.FACTORY_ROOT || '').replace(/\\/g, '/').replace(/\/?$/, '/')
  const idx = readFileSync(ROOT + 'templates/crm-store/backend/src/index.ts', 'utf8')
  check('mounted: /api/admin/domain is served', /app\.route\('\/api\/admin\/domain', domainRoutes\)/.test(idx))
  const nav = readFileSync(ROOT + 'templates/crm-store/frontend/src/components/layout/AppLayout.tsx', 'utf8')
  check('sidebar: a Domain entry for the seat the API answers (settings:update)', /\{ to: '\/domain', label: 'Domain', icon: Globe, permission: 'settings:update' \}/.test(nav))
  const appSrc = readFileSync(ROOT + 'templates/crm-store/frontend/src/App.tsx', 'utf8')
  check('route: /domain opens the Domain page', /<Route path="domain" element={<DomainPage \/>} \/>/.test(appSrc))
  const page = readFileSync(ROOT + 'templates/crm-store/frontend/src/pages/DomainPage.tsx', 'utf8')
  check('page: both prices, the renewal in bold, a warning when it jumps, no Register without a price — as the premium page',
    /<strong>\{usd\(check\.quote\.renewalCents\)\} a year<\/strong>/.test(page) && /check\.quote\.renewsHigher &&/.test(page) && /disabled=\{submitting \|\| !check\.quote\}/.test(page))
  check('page: a domain bought through Twomiah is not asked to change nameservers the owner cannot reach', /const ours = !!status\.registrar && status\.registrar !== 'byod'/.test(page) && /there's nothing for you to do/.test(page))
  const fac = readFileSync(ROOT + 'apps/api/src/routes/factory/lifecycle.ts', 'utf8')
  check("Factory: the buy route returns to the tenant's admin app on returnTo 'admin', on a checked path only", /const toAdmin = body\.returnTo === 'admin'/.test(fac) && /toAdmin \? tenant\.render_backend_url/.test(fac) && /\/\^\\\/\[a-z0-9\/_-\]\{0,60\}\$\/i\.test\(askedPath\)/.test(fac))
  check('Factory: the status says who holds the domain, so the page words a bought one right', /registrar: tenant\.domain_registrar \|\| null/.test(fac))
}

globalThis.fetch = realFetch
console.log(`\nstore domain: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
