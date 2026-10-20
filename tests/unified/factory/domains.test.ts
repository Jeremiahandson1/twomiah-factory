// A unified tenant's domain (apps/api/src/services/deploy.ts): its ONE service `<slug>-app` is the website and the app
// (apps/unified/server/app.ts serves the site at / and the admin at /login and /crm/* on every host), so @, www and
// app.<domain> all point at it, the three names are attached to it, and its SITE_URL becomes the domain.
// Render, Cloudflare and Resend are stand-ins (the global fetch); the functions are the real ones. A template tenant's
// lookup is unchanged and never sees the unified name.
import { test, expect, beforeEach } from 'bun:test'

process.env.RENDER_API_KEY = 'test-render'
process.env.CLOUDFLARE_API_TOKEN = 'test-cf'
process.env.CLOUDFLARE_ACCOUNT_ID = 'test-cf-account'
process.env.RESEND_API_KEY = 'test-resend'
delete process.env.TWOMIAH_APP_ZONE_ID

type Call = { method: string; url: string; body: any }
let calls: Call[] = []
let services: any[] = []
let renderListStatus = 200
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } })
const svc = (id: string, name: string, url = `https://${name}.onrender.com`) => ({ id, name, slug: name, serviceDetails: { url } })

globalThis.fetch = (async (input: any, init: any = {}) => {
  const url = String(input?.url ?? input)
  const method = String(init.method || 'GET').toUpperCase()
  const body = init.body ? JSON.parse(String(init.body)) : null
  calls.push({ method, url, body })
  if (url.startsWith('https://api.render.com/v1/services?')) {
    if (renderListStatus !== 200) return json({ message: 'down' }, renderListStatus)
    return json(services.map((s) => ({ cursor: 'c-' + s.id, service: s })))
  }
  if (url.startsWith('https://api.render.com/v1/services/')) return json({})
  if (url === 'https://api.cloudflare.com/client/v4/zones' && method === 'POST') return json({ success: true, result: { id: 'zone-1', name: body.name, name_servers: ['a.ns.cloudflare.com', 'b.ns.cloudflare.com'], status: 'pending' } })
  if (url.startsWith('https://api.cloudflare.com/client/v4/zones/zone-1/dns_records?')) return json({ success: true, result: [] })
  if (url.startsWith('https://api.cloudflare.com/')) return json({ success: true, result: { id: 'rec-' + calls.length } })
  if (url === 'https://api.resend.com/domains' && method === 'POST') return json({ id: 'rs-1', records: [] })
  throw new Error('unexpected fetch ' + method + ' ' + url)
}) as any

const D = await import('../../../apps/api/src/services/deploy')

beforeEach(() => { calls = []; services = []; renderListStatus = 200 })

test('the lookup finds a unified tenant\'s one service in all three roles — by its stored URL first', async () => {
  services = [svc('srv-u', 'acme-app'), svc('srv-other', 'acme-app-2-app')]
  expect(await D.findRenderServicesBySlug('acme', { engine: 'unified' })).toEqual({ app: 'srv-u', backend: 'srv-u', site: 'srv-u' })
  // Render gave the service an address with a suffix: the stored URL names it.
  services = [svc('srv-u', 'acme-app', 'https://acme-app-x7k2.onrender.com'), svc('srv-decoy', 'zz', 'https://zz.onrender.com')]
  expect(await D.findRenderServicesBySlug('acme', { engine: 'unified', backendUrl: 'https://acme-app-x7k2.onrender.com/' })).toEqual({ app: 'srv-u', backend: 'srv-u', site: 'srv-u' })
  // Only the exact name: a template tenant's `acme-api` or another tenant's `acme-2-app` is never it.
  services = [svc('srv-api', 'acme-api'), svc('srv-site', 'acme-site'), svc('srv-2', 'acme-2-app')]
  expect(await D.findRenderServicesBySlug('acme', { engine: 'unified' })).toEqual({})
})

test('the unified lookup throws when Render cannot be read — "could not tell" is never "no service"', async () => {
  renderListStatus = 503
  await expect(D.findRenderServicesBySlug('acme', { engine: 'unified' })).rejects.toThrow('Render service list answered 503')
})

test('template tenants: the lookup is as before, and never takes the unified name', async () => {
  services = [svc('srv-api', 'acme-api'), svc('srv-site', 'acme-site'), svc('srv-u', 'acme-app')]
  expect(await D.findRenderServicesBySlug('acme')).toEqual({ backend: 'srv-api', site: 'srv-site' })
  expect(await D.findRenderServicesBySlug('acme', { engine: 'templates', backendUrl: 'https://acme-api.onrender.com' })).toEqual({ backend: 'srv-api', site: 'srv-site' })
  // A failing Render list still answers "nothing found" for a template tenant, as before.
  renderListStatus = 503
  expect(await D.findRenderServicesBySlug('acme')).toEqual({})
})

test('unifiedDomainTargets: null for a template tenant, without asking Render', async () => {
  services = [svc('srv-u', 'acme-app')]
  expect(await D.unifiedDomainTargets({ slug: 'acme', render_backend_url: 'https://acme-api.onrender.com' })).toBeNull()
  expect(await D.unifiedDomainTargets({ slug: 'acme', engine: 'templates' })).toBeNull()
  expect(calls.length).toBe(0)
})

test('unifiedDomainTargets: the one service for site and app, at its own Render host; throws when it is not there', async () => {
  services = [svc('srv-u', 'acme-app', 'https://acme-app-x7k2.onrender.com')]
  expect(await D.unifiedDomainTargets({ slug: 'acme', engine: 'unified', render_backend_url: 'https://acme-app-x7k2.onrender.com' }))
    .toEqual({ siteServiceId: 'srv-u', backendServiceId: 'srv-u', siteSlug: 'acme-app-x7k2', backendSlug: 'acme-app-x7k2' })
  services = []
  await expect(D.unifiedDomainTargets({ slug: 'acme', engine: 'unified' })).rejects.toThrow('the unified service for acme was not found on Render')
})

test('wireDomainInfrastructure with the unified targets: @, www and app at the one service, all three attached, SITE_URL the domain', async () => {
  services = [svc('srv-u', 'acme-app')]
  const targets = await D.unifiedDomainTargets({ slug: 'acme', engine: 'unified', render_backend_url: 'https://acme-app.onrender.com' })
  calls = []
  const r = await D.wireDomainInfrastructure({ domain: 'acme.com', ...targets! })
  expect(r.errors).toEqual([])
  expect(r.success).toBe(true)
  const cnames = calls.filter((c) => c.method === 'POST' && c.url.endsWith('/zones/zone-1/dns_records') && c.body.type === 'CNAME').map((c) => [c.body.name, c.body.content, c.body.proxied])
  expect(cnames).toEqual([['@', 'acme-app.onrender.com', false], ['www', 'acme-app.onrender.com', false], ['app', 'acme-app.onrender.com', false]])
  const attached = calls.filter((c) => c.method === 'POST' && /\/custom-domains$/.test(c.url)).map((c) => [c.url.split('/services/')[1].split('/')[0], c.body.name])
  expect(attached).toEqual([['srv-u', 'acme.com'], ['srv-u', 'www.acme.com'], ['srv-u', 'app.acme.com']])
  const env = calls.filter((c) => c.method === 'PUT' && c.url.includes('/env-vars/')).map((c) => [c.url.split('/services/')[1].split('/')[0], decodeURIComponent(c.url.split('/env-vars/')[1]), c.body.value])
  expect(env).toEqual([['srv-u', 'SITE_URL', 'https://acme.com']])
})

test('attachTwomiahSubdomain takes the unified service as the website (soft no-op without the zone, as for every tenant)', async () => {
  expect(await D.attachTwomiahSubdomain({ slug: 'acme', websiteServiceId: 'srv-u', websiteRenderHost: 'acme-app.onrender.com' }))
    .toEqual({ error: 'twomiah subdomain not configured (need CLOUDFLARE_API_TOKEN + TWOMIAH_APP_ZONE_ID + RENDER_API_KEY)' })
  expect(calls.length).toBe(0)
})
