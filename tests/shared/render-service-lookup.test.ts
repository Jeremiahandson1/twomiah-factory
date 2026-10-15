// findRenderServicesBySlug finds EVERY vertical's CRM backend — and prefers the tenant's stored URL. (10/14)
//
// Found writing the store E2E script: the lookup knew only "{slug}-api" and "{slug}-care-api", so for a store
// ({slug}-shop-api), a roofer (-roof-api), field service (-wrench-api) and every other suffixed vertical it found NO
// backend. A domain bought for one of them never had app.<domain> attached to its admin on Render (the CNAME pointed at
// a service that did not answer for that host). Runs the real function against a stubbed Render service list.
process.env.RENDER_API_KEY ||= 'test-render-key'
const { readFileSync } = await import('node:fs')

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}

let services: any[] = []
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(input?.url ?? input)
  if (!url.startsWith('https://api.render.com/v1/services?')) return realFetch(input, init)
  return new Response(JSON.stringify(services.map((s) => ({ cursor: 'c-' + s.id, service: s }))), { status: 200, headers: { 'content-type': 'application/json' } })
}) as any
const svc = (id: string, name: string) => ({ id, name, serviceDetails: { url: `https://${name}.onrender.com` } })

const D = await import(new URL('../../apps/api/src/services/deploy.ts', import.meta.url).href)

{
  services = [svc('srv-site', 'teststore-site'), svc('srv-shop', 'teststore-shop-api'), svc('srv-front', 'teststore-shop')]
  const r = await D.findRenderServicesBySlug('teststore')
  check('a STORE backend ({slug}-shop-api) is found — it was not, so its domain never reached the admin', r.backend === 'srv-shop' && r.site === 'srv-site', r)
}
for (const suffix of ['-roof-api', '-wrench-api', '-landscape-api', '-leaf-api', '-rv-api', '-vet-api', '-salon-api', '-events-api', '-basic-api', '-care-api', '-api']) {
  services = [svc('srv-b', 'acme' + suffix), svc('srv-s', 'acme-site')]
  check(`backend found for ${suffix}`, (await D.findRenderServicesBySlug('acme')).backend === 'srv-b')
}
{
  // "acme" (roofing) and "acme-roof" (contractor) collide by name: acme + -roof-api == acme-roof + -api.
  services = [svc('srv-acme-roof-tenant', 'acme-roof-api'), svc('srv-acme', 'acme-api')]
  const byUrl = await D.findRenderServicesBySlug('acme', { backendUrl: 'https://acme-api.onrender.com' })
  check('with the stored URL, the tenant\'s OWN backend wins over a look-alike name', byUrl.backend === 'srv-acme', byUrl)
  const byUrl2 = await D.findRenderServicesBySlug('acme', { backendUrl: 'https://acme-roof-api.onrender.com/' })
  check('…and the other way round (trailing slash and all)', byUrl2.backend === 'srv-acme-roof-tenant', byUrl2)
}
{
  services = [svc('srv-x', 'shopx-shop-api')]
  const stale = await D.findRenderServicesBySlug('shopx', { backendUrl: 'https://gone-api.onrender.com' })
  check('a stored URL that matches nothing falls back to the name — never worse than before', stale.backend === 'srv-x', stale)
}
{
  services = [svc('srv-other', 'zebra-shop-api')]
  check('another tenant\'s services are never returned', Object.keys(await D.findRenderServicesBySlug('acme')).length === 0)
}

// ── the list stays in step with the two places that NAME the backend
const deploySrc = readFileSync(new URL('../../apps/api/src/services/deploy.ts', import.meta.url), 'utf8')
const namingLine = deploySrc.split(/\r?\n/).find((l) => /const crmApiName = /.test(l)) || ''
const named = [...namingLine.matchAll(/slug \+ '(-[a-z]+-api|-api)'/g)].map((m) => m[1])
check('the deploy\'s naming line was found and names every vertical', named.length >= 12, named)
const missingFromDeploy = named.filter((s) => !D.CRM_API_SUFFIXES.includes(s))
check('every backend name the deploy creates is one the lookup knows', missingFromDeploy.length === 0, missingFromDeploy)
const routing = readFileSync(new URL('../../apps/api/src/config/industryRouting.ts', import.meta.url), 'utf8')
const fnBody = routing.slice(routing.indexOf('export function crmServiceSuffixFor'), routing.indexOf('export function buildCrmApiHost'))
const routed = [...fnBody.matchAll(/return '([a-z]*)'/g)].map((m) => (m[1] ? `-${m[1]}-api` : '-api'))
const missingFromRouting = routed.filter((s) => !D.CRM_API_SUFFIXES.includes(s))
check('…and every one industryRouting.crmServiceSuffixFor hands out', routed.length >= 10 && missingFromRouting.length === 0, { routed, missingFromRouting })

// ── the callers hand over the stored URL
const API = (p: string) => readFileSync(new URL('../../apps/api/src/' + p, import.meta.url), 'utf8')
const callers = ['routes/factory/admin.ts', 'routes/factory/billing.ts', 'routes/factory/deploy.ts', 'routes/factory/lifecycle.ts']
const bare = callers.filter((f) => /findRenderServicesBySlug\(tenant\.slug\)/.test(API(f)))
check('every route that has the tenant row passes its render_backend_url', bare.length === 0, bare)

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
