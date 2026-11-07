// A unified tenant's domain (apps/api/src/services/deploy.ts): its ONE service `<slug>-app` is the website and the app
// (apps/unified/server/app.ts serves the site at / and the admin at /login and /crm/* on every host), so @, www and
// app.<domain> all point at it, the three names are attached to it, and its SITE_URL becomes the domain.
// Render, Cloudflare and Resend are stand-ins (the global fetch); the functions are the real ones. A template tenant's
// lookup is unchanged and never sees the unified name.
import { test, expect, beforeEach } from 'bun:test'
import { stubFetch } from './stubs.ts'

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

stubFetch(async (input: any, init: any = {}) => {
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
})

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
  // No live DNS from a test: the domain's existing mail is read through stand-in lookups (none here).
  const noMail = { mx: async () => [], txt: async () => [], cname: async () => [] }
  const r = await D.wireDomainInfrastructure({ domain: 'acme.com', ...targets!, mailLookups: noMail })
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

// ─── A domain that already has email (11/06) ──────────────────────────────────
// The new zone starts empty; the owner's mail records are read from public DNS (stood in here) and copied in before anything else,
// or their mailbox stops receiving the moment they switch name servers. Shaped on the first real case: Google Workspace mail, an
// SPF include hosted under the domain itself (GoDaddy's _spfm), a Google DKIM key.
const googleMail = {
  mx: async (n: string) => (n === 'hobby.test' ? [{ exchange: 'smtp.google.com', priority: 1 }] : []),
  txt: async (n: string): Promise<string[][]> => ({
    'hobby.test': [['v=spf1 include:dc-abc._spfm.hobby.test ~all'], ['google-site-verification=xyz']],
    'dc-abc._spfm.hobby.test': [['v=spf1 include:_spf.google.com ~all']],
    'google._domainkey.hobby.test': [['v=DKIM1; k=rsa; p=MIIBIjAN', 'BgkqhkiG9w0']],
    '_dmarc.hobby.test': [['v=DMARC1; p=quarantine; rua=mailto:me@hobby.test']],
  } as Record<string, string[][]>)[n] || [],
  cname: async () => [] as string[],
}
const written = () => calls.filter((c) => c.method === 'POST' && c.url.endsWith('/zones/zone-1/dns_records')).map((c) => [c.body.type, c.body.name, c.body.content, c.body.priority])

test('a Web presence domain with Google mail: every mail record is copied in, beside the two Netlify names', async () => {
  const r = await D.wireDomainInfrastructure({ domain: 'hobby.test', mailLookups: googleMail, netlify: { target: 'twomiah-hobby.netlify.app', attach: async () => ({ ok: true }) } })
  expect(r.errors).toEqual([])
  expect(written()).toEqual([
    ['MX', '@', 'smtp.google.com', 1],
    ['TXT', '@', 'v=spf1 include:dc-abc._spfm.hobby.test ~all', undefined],
    ['TXT', '@', 'google-site-verification=xyz', undefined],
    ['TXT', 'dc-abc._spfm', 'v=spf1 include:_spf.google.com ~all', undefined],
    ['TXT', '_dmarc', 'v=DMARC1; p=quarantine; rua=mailto:me@hobby.test', undefined],
    ['TXT', 'google._domainkey', 'v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0', undefined],
    ['CNAME', '@', 'twomiah-hobby.netlify.app', undefined],
    ['CNAME', 'www', 'twomiah-hobby.netlify.app', undefined],
  ])
  expect(r.steps.find((s) => s.step === 'existing_mail')!.detail).toContain('smtp.google.com')
})

test('a full site on a domain with mail: no Email Routing, their SPF kept with our sender added, their DMARC kept', async () => {
  services = [svc('srv-u', 'hobby-app')]
  const targets = await D.unifiedDomainTargets({ slug: 'hobby', engine: 'unified', render_backend_url: 'https://hobby-app.onrender.com' })
  calls = []
  const r = await D.wireDomainInfrastructure({ domain: 'hobby.test', ...targets!, mailLookups: googleMail })
  expect(calls.some((c) => c.url.includes('/email/routing'))).toBe(false)
  expect(r.steps.find((s) => s.step === 'email_routing_enable')!.status).toBe('skipped')
  const spf = written().filter(([t, n, c]) => t === 'TXT' && n === '@' && String(c).startsWith('v=spf1')).map((x) => x[2])
  expect(spf.at(-1)).toBe('v=spf1 include:dc-abc._spfm.hobby.test include:_spf.resend.com ~all')
  expect(written().filter(([t, n]) => t === 'TXT' && n === '_dmarc').map((x) => x[2])).toEqual(['v=DMARC1; p=quarantine; rua=mailto:me@hobby.test'])
})

test("a domain with no mail is wired as before (Email Routing on); our own Routing MX read back on a retry is not the owner's mail", async () => {
  services = [svc('srv-u', 'acme-app')]
  const targets = await D.unifiedDomainTargets({ slug: 'acme', engine: 'unified', render_backend_url: 'https://acme-app.onrender.com' })
  const ours = { mx: async () => [{ exchange: 'route1.mx.cloudflare.net', priority: 5 }], txt: async () => [], cname: async () => [] }
  calls = []
  const r = await D.wireDomainInfrastructure({ domain: 'acme.com', ...targets!, mailLookups: ours })
  expect(r.steps.find((s) => s.step === 'email_routing_enable')!.status).toBe('ok')
  expect(written().some(([t]) => t === 'MX')).toBe(false)
})

test('mergeSpf: one record, our include before their qualifier, never twice', async () => {
  const { mergeSpf } = await import('../../../apps/api/src/services/existingMail')
  expect(mergeSpf('v=spf1 include:_spf.google.com ~all', 'include:_spf.resend.com')).toBe('v=spf1 include:_spf.google.com include:_spf.resend.com ~all')
  expect(mergeSpf('v=spf1 include:_spf.resend.com -all', 'include:_spf.resend.com')).toBe('v=spf1 include:_spf.resend.com -all')
  expect(mergeSpf('v=spf1 mx', 'include:x')).toBe('v=spf1 mx include:x')
})
