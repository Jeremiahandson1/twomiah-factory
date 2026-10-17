// A deploy never deletes, reuses or writes to what is not the tenant's — and a signup is never handed a name in use.
// (Amber Inn, 10/17)
//
// A fresh signup took the slug "amber-inn". deployCustomer then deleted the GitHub repo amber-inn and the Render service
// amber-inn-site — the owner's hand-built site, never made by the Factory — to free the names, and booted the new CRM on
// amber-inn-db, a SUSPENDED database left by that old site ("reuse existing database"), which a rollback would also have
// deleted. The readiness wait logged NOT READY (update_failed) and the tenant went Active anyway.
//
// This runs the REAL deployCustomer against a fake GitHub + Render (global fetch replaced; git pushes and sleeps swapped
// through deployIo — nothing leaves the machine), the real slug allocator against fake lookups, and the readiness rule.
//   bun run tests/shared/deploy-ownership.test.ts
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

// No live service may be reachable from here: every credential the deploy reads is a fake, the rest are removed.
for (const k of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_MANAGEMENT_API_KEY', 'SUPABASE_ORG_ID', 'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY', 'VISION_SUPABASE_URL', 'VISION_SUPABASE_SERVICE_KEY', 'ANTHROPIC_API_KEY', 'RENDER_PROJECT_ENV_ID', 'STRIPE_SECRET_KEY',
  'GOOGLE_CALENDAR_CLIENT_ID', 'FACTORY_FROM_EMAIL', 'TWOMIAH_TWILIO_ACCOUNT_SID', 'TWOMIAH_RESEND_API_KEY', 'RESEND_API_KEY']) delete process.env[k]
process.env.RENDER_API_KEY = 'test-render'
process.env.RENDER_OWNER_ID = 'own-test'
process.env.GITHUB_TOKEN = 'test-gh'
process.env.GITHUB_ORG = 'twomiah-tenants'
const ORG = 'twomiah-tenants'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 600)) }
}
const read = (p: string) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8').split(String.fromCharCode(13, 10)).join(String.fromCharCode(10))

// ── a fake GitHub + Render ──────────────────────────────────────────────────
type Svc = { id: string; name: string; repo?: string; slug?: string; serviceDetails?: { url?: string } }
type Db = { id: string; name: string; status: string; suspended: string }
type World = { repos: Set<string>; services: Svc[]; dbs: Db[]; calls: string[]; failServiceCreate?: boolean; failLookup?: 'services' | 'postgres' | 'github'; repoDeleteRefused?: boolean }
let W: World
const newWorld = (w: Partial<World> = {}): World => ({ repos: new Set(), services: [], dbs: [], calls: [], ...w })
const svc = (id: string, name: string, repo?: string): Svc => ({ id, name, slug: name, repo, serviceDetails: { url: `https://${name}.onrender.com` } })
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
let seq = 0

globalThis.fetch = (async (input: any, init?: any) => {
  const url = new URL(String(input?.url ?? input))
  const method = String(init?.method || 'GET').toUpperCase()
  const p = url.pathname
  W.calls.push(method + ' ' + url.host + p)
  if (url.host === 'api.github.com') {
    if (W.failLookup === 'github') return json({ message: 'boom' }, 502)
    const m = p.match(/^\/repos\/([^/]+\/[^/]+)$/)
    if (m && method === 'GET') return W.repos.has(m[1]) ? json({ full_name: m[1] }) : json({ message: 'Not Found' }, 404)
    if (m && method === 'DELETE') { if (!W.repos.has(m[1])) return new Response(null, { status: 404 }); if (W.repoDeleteRefused) return json({ message: 'Must have admin rights' }, 403); W.repos.delete(m[1]); return new Response(null, { status: 204 }) }
    // createGitHubRepo falls back to /user/repos when the org create fails; here both answer for the one namespace.
    if ((p === '/orgs/' + ORG + '/repos' || p === '/user/repos') && method === 'POST') {
      const name = JSON.parse(init.body).name, full = ORG + '/' + name
      if (W.repos.has(full)) return json({ errors: [{ message: 'name already exists on this account' }] }, 422)
      W.repos.add(full); return json({ full_name: full, clone_url: 'https://github.com/' + full + '.git' }, 201)
    }
  }
  if (url.host === 'api.render.com') {
    const q = url.searchParams.get('name')
    if (p === '/v1/services' && method === 'GET') {
      if (W.failLookup === 'services') return json({ message: 'unavailable' }, 503)
      return json(W.services.filter((s) => !q || s.name === q).map((s) => ({ cursor: 'c-' + s.id, service: s })))
    }
    if (p === '/v1/postgres' && method === 'GET') {
      if (W.failLookup === 'postgres') return json({ message: 'unavailable' }, 503)
      return json(W.dbs.filter((d) => !q || d.name === q).map((d) => ({ cursor: 'c-' + d.id, postgres: d })))
    }
    if (p === '/v1/postgres' && method === 'POST') {
      const b = JSON.parse(init.body)
      if (W.dbs.some((d) => d.name === b.name)) return json({ message: 'name already in use' }, 409)
      const db = { id: 'dpg-new' + (++seq) + '-a', name: b.name, status: 'creating', suspended: 'not_suspended' }
      W.dbs.push(db); return json(db, 201)
    }
    let m = p.match(/^\/v1\/postgres\/([^/]+)\/connection-info$/)
    if (m) return json({ internalConnectionString: `postgresql://u:p@${m[1]}/db` })
    m = p.match(/^\/v1\/postgres\/([^/]+)$/)
    if (m && method === 'DELETE') { W.dbs = W.dbs.filter((d) => d.id !== m![1]); return new Response(null, { status: 204 }) }
    if (p === '/v1/services' && method === 'POST') {
      if (W.failServiceCreate) return json({ message: 'render is having a day' }, 500)
      const b = JSON.parse(init.body)
      const s = svc('srv-new' + (++seq), b.name, b.repo); W.services.push(s); return json({ service: s, deployId: 'dep-1' }, 201)
    }
    m = p.match(/^\/v1\/services\/([^/]+)$/)
    if (m && method === 'DELETE') { W.services = W.services.filter((s) => s.id !== m![1]); return new Response(null, { status: 204 }) }
    if (m && method === 'GET') { const s = W.services.find((x) => x.id === m![1]); return s ? json(s) : json({ message: 'not found' }, 404) }
    if (m && method === 'PATCH') return json({})
    if (/^\/v1\/services\/[^/]+\/env-vars(\/[^/]+)?$/.test(p)) return method === 'GET' ? json([]) : json({})
    if (/^\/v1\/services\/[^/]+\/deploys$/.test(p)) return json({ id: 'dep-2' }, 201)
  }
  throw new Error('test fetch: unexpected ' + method + ' ' + url.href)
}) as any

const D = await import(new URL('../../apps/api/src/services/deploy.ts', import.meta.url).href)
const O = await import(new URL('../../apps/api/src/services/resourceOwnership.ts', import.meta.url).href)
const R = await import(new URL('../../apps/api/src/services/deployReadiness.ts', import.meta.url).href)
const pushes: string[] = []
D.deployIo.sleep = async () => {}
D.deployIo.pushToGitHub = async (repo: string) => { pushes.push('push ' + repo) }
D.deployIo.pushAdditiveCrmToGitHub = async (repo: string) => { pushes.push('additive ' + repo) }

// A real (tiny) build zip, read the way the Factory reads it.
const AdmZip = createRequire(new URL('../../apps/api/package.json', import.meta.url))('adm-zip')
const TMP = mkdtempSync(path.join(tmpdir(), 'deploy-ownership-'))
const zipPath = path.join(TMP, 'build.zip')
{ const z = new AdmZip(); z.addFile('crm-bar/backend/package.json', Buffer.from('{}')); z.addFile('website/package.json', Buffer.from('{}')); z.writeZip(zipPath) }

const owns = (o: Partial<{ serviceIds: string[]; hosts: string[]; repos: string[]; databaseIds: string[] }>) => ({
  serviceIds: new Set(o.serviceIds || []), hosts: new Set(o.hosts || []), repos: new Set(o.repos || []), databaseIds: new Set(o.databaseIds || []),
})
const deploy = (slug: string, ownership: any, products = ['crm', 'website'], extra: any = {}) => {
  pushes.length = 0
  return D.deployCustomer({ id: 't-' + slug, slug, name: 'Test ' + slug, industry: 'bar_and_grill', products, config: { company: { email: 'o@test.local' } } }, zipPath, { products, ownership, ...extra })
}
const deletes = () => W.calls.filter((c) => c.startsWith('DELETE'))
const creates = () => W.calls.filter((c) => c.startsWith('POST') && /\/(repos|services|postgres)$/.test(c))

// ── 1. Amber Inn, replayed: a fresh signup whose names are held by a hand-built repo, site and old database ────
{
  W = newWorld({
    repos: new Set([ORG + '/amber-inn']),
    services: [svc('srv-dafmbv740ujc73bu9rjg', 'amber-inn-site', 'https://github.com/' + ORG + '/amber-inn')],
    dbs: [{ id: 'dpg-old1-a', name: 'amber-inn-db', status: 'suspended', suspended: 'suspended' }],
  })
  const r = await deploy('amber-inn', O.emptyOwnership())
  check('Amber Inn: the deploy stops (status blocked, not success)', r.status === 'blocked' && !r.success, r.status)
  check('…NOTHING was deleted — not the repo, not amber-inn-site, not the database', deletes().length === 0, deletes())
  check('…nothing was created, pushed or reused', creates().length === 0 && pushes.length === 0 && !r.services.database, { creates: creates(), pushes })
  check('…the hand-built repo, site and database are all still there', W.repos.has(ORG + '/amber-inn') && W.services.some((s) => s.id === 'srv-dafmbv740ujc73bu9rjg') && W.dbs.some((d) => d.id === 'dpg-old1-a'))
  const why = (r.blocked || []).join(' | ')
  check('…and the reason names each collision', /name collision: GitHub repo twomiah-tenants\/amber-inn exists and is not this tenant's/.test(why)
    && /name collision: Render service amber-inn-site exists and is not this tenant's \(srv-dafmbv740ujc73bu9rjg\)/.test(why)
    && /name collision: Render Postgres amber-inn-db exists and is not this tenant's/.test(why), why)
  check('…the errors carry the same reason (runDeploy marks the job failed and alerts staff with result.errors)', r.errors.join(' | ') === why)
}
// A database that IS the tenant's but suspended is still unusable.
{
  W = newWorld({ dbs: [{ id: 'dpg-mine-a', name: 'acme-db', status: 'suspended', suspended: 'suspended' }] })
  const r = await deploy('acme', owns({ databaseIds: ['dpg-mine-a'] }))
  check('the tenant\'s OWN database, suspended: the deploy stops — a backend is never handed it', r.status === 'blocked' && /acme-db is this tenant's but cannot be used \(status suspended, suspended\)/.test(r.errors.join()), r.errors)
  check('…and nothing was touched', deletes().length === 0 && creates().length === 0 && pushes.length === 0, W.calls)
}
{
  W = newWorld({ dbs: [{ id: 'dpg-mine-a', name: 'acme-db', status: 'unavailable', suspended: 'not_suspended' }] })
  const r = await deploy('acme', owns({ databaseIds: ['dpg-mine-a'] }))
  check('…same for one Render reports unavailable', r.status === 'blocked' && /cannot be used \(status unavailable\)/.test(r.errors.join()), r.errors)
}
// A lookup that fails is never "nothing there".
for (const which of ['services', 'postgres', 'github'] as const) {
  W = newWorld({ failLookup: which })
  const r = await deploy('acme', O.emptyOwnership())
  check(`a failing ${which} lookup stops the deploy before anything is touched`, r.status === 'blocked' && /could not check/.test(r.errors.join()) && deletes().length === 0 && creates().length === 0, { e: r.errors, calls: W.calls })
}

// ── 2. A redeploy of the tenant's OWN resources: replaced and reused exactly as before ─────────────────────────
{
  W = newWorld({
    repos: new Set([ORG + '/acme']),
    services: [
      svc('srv-api-old', 'acme-bar-api', 'https://github.com/' + ORG + '/acme'),
      svc('srv-site-old', 'acme-site', 'https://github.com/' + ORG + '/acme'),
      svc('srv-other', 'acme-api', 'https://github.com/someone/acme'),   // a legacy name held by someone else
    ],
    dbs: [{ id: 'dpg-acme-a', name: 'acme-db', status: 'available', suspended: 'not_suspended' }],
  })
  // Records: the job's ids and repo, the database by tenants.database_url.
  const owned = O.ownershipFromRecords({ database_url: 'postgresql://u:p@dpg-acme-a/acme' }, [{ render_service_ids: { backend: 'srv-api-old', site: 'srv-site-old' }, github_repo: 'https://github.com/' + ORG + '/acme' }])
  const r = await deploy('acme', owned)
  check('redeploy: it goes through', r.success && r.status === 'deployed', { s: r.status, e: r.errors })
  check('…the tenant\'s own repo and services are replaced (deleted, then created again)',
    W.calls.includes('DELETE api.github.com/repos/' + ORG + '/acme') && W.calls.includes('DELETE api.render.com/v1/services/srv-api-old') && W.calls.includes('DELETE api.render.com/v1/services/srv-site-old') && pushes.includes('push ' + ORG + '/acme'), deletes())
  check('…its database is REUSED (data kept): not deleted, no new one made, the backend points at it',
    !W.calls.includes('DELETE api.render.com/v1/postgres/dpg-acme-a') && !W.calls.includes('POST api.render.com/v1/postgres') && r.services.database?.id === 'dpg-acme-a' && /dpg-acme-a/.test(r.dbConnectionString || ''), r.services.database)
  check('…a same-named legacy service that is NOT the tenant\'s is left alone, and does not block', !W.calls.includes('DELETE api.render.com/v1/services/srv-other') && W.services.some((s) => s.id === 'srv-other'))
}
{
  // Ownership through the URL the Factory saved (tenants.render_backend_url), and a site built from the tenant's repo.
  W = newWorld({ repos: new Set([ORG + '/acme']), services: [svc('srv-api-x', 'acme-bar-api', 'https://github.com/' + ORG + '/acme'), svc('srv-site-x', 'acme-site', 'https://github.com/' + ORG + '/acme')] })
  const owned = O.ownershipFromRecords({ render_backend_url: 'https://acme-bar-api.onrender.com' }, [])
  const r = await deploy('acme', owned)
  check('records lost but the backend URL saved: the backend, its repo and the site built from that repo are the tenant\'s', r.success, r.errors)
}
{
  // website_url is NOT a record: the intake writes the customer's CURRENT site there.
  const owned = O.ownershipFromRecords({ website_url: 'https://amber-inn-site.onrender.com' } as any, [])
  check('a customer-typed website_url owns nothing', !O.ownsService(owned, svc('srv-h', 'amber-inn-site')))
}

// ── 3. Rollback deletes only what THIS run created ───────────────────────────────────────────────────────────
{
  W = newWorld({ dbs: [{ id: 'dpg-keep-a', name: 'acme-db', status: 'available', suspended: 'not_suspended' }], failServiceCreate: true })
  const r = await deploy('acme', owns({ databaseIds: ['dpg-keep-a'] }), ['crm'])
  check('every service fails: the run rolls back', !r.success && W.calls.includes('DELETE api.github.com/repos/' + ORG + '/acme'), W.calls)
  check('…the REUSED database (the tenant\'s, from before this run) is NOT deleted', !W.calls.includes('DELETE api.render.com/v1/postgres/dpg-keep-a') && W.dbs.some((d) => d.id === 'dpg-keep-a'), deletes())
}
{
  // The tenant's own repo could not be deleted, so the run reused it — it is not this run's to delete either.
  W = newWorld({ repos: new Set([ORG + '/acme']), failServiceCreate: true, repoDeleteRefused: true })
  const r = await deploy('acme', owns({ repos: [ORG + '/acme'] }), ['crm'])
  check('…a repo the run REUSED (its own, undeletable) is not deleted by the rollback either', !r.success && pushes.includes('push ' + ORG + '/acme') && W.calls.filter((c) => c === 'DELETE api.github.com/repos/' + ORG + '/acme').length === 1 && W.repos.has(ORG + '/acme'), { calls: W.calls.filter((c) => c.includes('github')) })
}
{
  W = newWorld({ failServiceCreate: true })
  const r = await deploy('acme', O.emptyOwnership(), ['crm'])
  const made = r.services.database?.id
  check('…while a database THIS run created is deleted with the repo it created', !!made && W.calls.includes('DELETE api.render.com/v1/postgres/' + made) && W.calls.includes('DELETE api.github.com/repos/' + ORG + '/acme'), { made, d: deletes() })
}

// ── 4. CRM add-on / flip: the shared repo and site must be the tenant's ──────────────────────────────────────
{
  W = newWorld({ repos: new Set([ORG + '/acme']), services: [svc('srv-site-1', 'acme-site', 'https://github.com/' + ORG + '/acme')] })
  const r = await deploy('acme', owns({ serviceIds: ['srv-site-1'] }), ['crm'], { additiveCrm: true })
  check('add-on to the tenant\'s own website: proceeds, never deletes the shared repo, links the site', r.success && pushes.includes('additive ' + ORG + '/acme') && !deletes().some((c) => c.includes('github')) && W.calls.includes('PUT api.render.com/v1/services/srv-site-1/env-vars/CRM_API_URL'), { e: r.errors, d: deletes() })
}
{
  W = newWorld({ repos: new Set([ORG + '/acme']), services: [svc('srv-site-2', 'acme-site', 'https://github.com/someone/acme')] })
  const r = await deploy('acme', O.emptyOwnership(), ['crm'], { additiveCrm: true })
  check('add-on where the repo and site are NOT the tenant\'s: stopped, nothing pushed, the site\'s settings untouched',
    r.status === 'blocked' && pushes.length === 0 && !W.calls.some((c) => c.includes('srv-site-2/')), { e: r.errors, calls: W.calls })
}

// ── 5. A code update only pushes to / redeploys what is the tenant's ─────────────────────────────────────────
{
  W = newWorld({ services: [svc('srv-a', 'acme-bar-api', 'https://github.com/' + ORG + '/acme'), svc('srv-b', 'acme-site', 'https://github.com/someone/acme')] })
  const owned = O.ownershipFromRecords({ render_backend_url: 'https://acme-bar-api.onrender.com' }, [])
  const ok = await D.checkUpdateOwnership('t', ORG + '/acme', { backend: 'srv-a' }, owned)
  check('update: the backend by its saved URL, and the repo it builds from, pass', ok.length === 0, ok)
  const bad = await D.checkUpdateOwnership('t', ORG + '/acme', { backend: 'srv-a', site: 'srv-b' }, owned)
  check('…a site found by name that is someone else\'s stops the update', bad.length === 1 && /acme-site \(site\) is not this tenant's/.test(bad[0]), bad)
  const none = await D.checkUpdateOwnership('t', ORG + '/amber-inn', {}, O.emptyOwnership())
  check('…a repo with no record stops it (no force-push to a repo the Factory never made)', none.length === 1 && /amber-inn is not this tenant's/.test(none[0]), none)
  const f = await D.filterOwnedServiceIds('t', { backend: 'srv-a', site: 'srv-b' }, owned)
  check('redeploy by name: only the tenant\'s own services are kept (and so saved to the job)', JSON.stringify(f.owned) === JSON.stringify({ backend: 'srv-a' }) && f.refused.includes('acme-site'), f)
  const route = read('apps/api/src/routes/factory/deploy.ts')
  const redeploy = route.slice(route.indexOf("factory.post('/customers/:id/redeploy'"), route.indexOf("factory.post('/customers/:id/update-code'"))
  check('…and the redeploy route filters a by-name lookup before it saves or redeploys', /filterOwnedServiceIds\(String\(id\), byName\)/.test(redeploy) && redeploy.indexOf('serviceIds = owned') < redeploy.indexOf("update({ render_service_ids: serviceIds })"))
}

// ── 6. Slug allocation: free only when no tenant, repo, service or database holds the names ──────────────────
{
  const fake = (taken: { tenants?: string[]; repos?: string[]; services?: string[]; dbs?: string[] }, throwOn: string[] = []) => ({
    tenantSlugTaken: async (s: string) => { if (throwOn.includes('tenant:' + s)) throw new Error('db down'); return (taken.tenants || []).includes(s) },
    repoExists: async (n: string) => { if (throwOn.includes('repo:' + n)) throw new Error('github 502'); return (taken.repos || []).includes(n) },
    serviceExists: async (n: string) => { if (throwOn.includes('service:' + n)) throw new Error('render 503'); return (taken.services || []).includes(n) },
    databaseExists: async (n: string) => (taken.dbs || []).includes(n),
  })
  const alloc = async (l: any) => (await O.allocateSlug(O.signupSlugCandidates('amber-inn'), l))
  check('Amber Inn\'s name, held by a repo: the signup gets amber-inn-2', (await alloc(fake({ repos: ['amber-inn'] }))).slug === 'amber-inn-2')
  check('…held by the Render site amber-inn-site: amber-inn-2', (await alloc(fake({ services: ['amber-inn-site'] }))).slug === 'amber-inn-2')
  check('…held by the old database amber-inn-db: amber-inn-2', (await alloc(fake({ dbs: ['amber-inn-db'] }))).slug === 'amber-inn-2')
  check('…a bar backend amber-inn-bar-api and a bare service amber-inn are names too', (await alloc(fake({ services: ['amber-inn-bar-api'] }))).slug === 'amber-inn-2' && (await alloc(fake({ services: ['amber-inn'] }))).slug === 'amber-inn-2')
  check('…a vertical database (amber-inn-care-db) too', (await alloc(fake({ dbs: ['amber-inn-care-db'] }))).slug === 'amber-inn-2')
  check('…taken twice over: the next suffix after that', (await alloc(fake({ repos: ['amber-inn'], services: ['amber-inn-2-site'] }))).slug === 'amber-inn-3')
  check('nothing holds it: the name itself', (await alloc(fake({}))).slug === 'amber-inn')
  const err = await alloc(fake({}, ['repo:amber-inn']))
  check('a lookup that ERRORS makes the name taken, never free — the next suffix is used', err.slug === 'amber-inn-2' && /lookup failed/.test(err.skipped[0]?.reason || ''), err)
  check('every lookup failing: no slug at all (the signup is refused, not handed a name)', (await O.allocateSlug(['a', 'b'], fake({}, ['tenant:a', 'tenant:b']))).slug === null)

  // The live lookups fail safe too: Render answering 503 / no credentials is "taken".
  W = newWorld({ failLookup: 'services' })
  const live = O.liveSlugLookups({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) })
  check('live lookups: Render down → the slug is not free', (await O.slugIsFree('zz-new', live)).free === false)
  W = newWorld()
  check('live lookups: nothing anywhere → free (one GitHub check, Render listed once per kind)', (await O.slugIsFree('zz-new', O.liveSlugLookups({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) }))).free === true
    && W.calls.filter((c) => c.includes('/v1/services')).length === 1 && W.calls.filter((c) => c.includes('/v1/postgres')).length === 1, W.calls)
  const key = process.env.RENDER_API_KEY; delete process.env.RENDER_API_KEY
  W = newWorld()
  check('live lookups: Render not configured → not free', (await O.slugIsFree('zz-new', O.liveSlugLookups({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) }))).free === false)
  process.env.RENDER_API_KEY = key
}
// Every name the deploy gives is one the allocator checks — read from deploy.ts's naming lines, so they cannot drift.
{
  const src = read('apps/api/src/services/deploy.ts')
  const line = (re: RegExp) => src.split('\n').find((l) => re.test(l)) || ''
  const suffixes = (l: string) => [...l.matchAll(/slug \+ '(-[a-z-]+)'/g)].map((m) => m[1])
  const names = O.externalNamesForSlug('s')
  const api = suffixes(line(/const crmApiName = /)), front = suffixes(line(/const crmFrontName = /)), db = suffixes(line(/const dbSlug = /))
  check('every CRM backend name is checked at signup', api.length >= 12 && api.every((x) => names.services.includes('s' + x)), api)
  check('every legacy frontend name too', front.length >= 12 && front.every((x) => names.services.includes('s' + x)), front)
  check('every database name too', db.length >= 6 && db.every((x) => names.databases.includes('s' + x + '-db')) && names.databases.includes('s-db'), db)
  check('…and the site, pricing, vision and bare names', ['s', 's-site', 's-pricing-api', 's-vision'].every((n) => names.services.includes(n)) && names.repo === 's')
}

// ── 7. The routes use it ──────────────────────────────────────────────────────────────────────────────────────
{
  const intake = read('apps/api/src/routes/factory/intake.ts')
  const signup = intake.slice(intake.indexOf("factory.post('/public/signup'"), intake.indexOf("factory.get('/public/signup/:id/next'"))
  check('signup allocates through the allocator with the live lookups, and uses what it returns',
    /const allocated = await allocateSlug\(signupSlugCandidates\(baseSlug\), liveSlugLookups\(supabase\)\)/.test(signup) && /const slug = allocated\.slug/.test(signup) && /if \(!allocated\.slug\) \{\s*return c\.json\([^)]*503\)/.test(signup))
  check('the intake form too', /await allocateSlug\(\[baseSlug \+ '-intake'/.test(intake) && /const slug = intakeSlug\.slug/.test(intake))
  const dep = read('apps/api/src/services/deploy.ts')
  const dc = dep.slice(dep.indexOf('export async function deployCustomer'), dep.indexOf('export async function checkDeployStatus'))
  check('deployCustomer runs the preflight BEFORE the first delete/create/push', dc.indexOf('await preflightDeploy(') > 0
    && ['deleteGitHubRepo(', 'createGitHubRepo(', 'deployIo.push', 'createRenderDatabase(', 'createRenderWebService(', 'deleteOwnedRenderService('].every((s) => dc.indexOf(s) > dc.indexOf('await preflightDeploy(')))
  check('no deploy path deletes by name any more', !/findAndDeleteRender|findExistingDatabase/.test(dep))
  check('updateCustomerCode checks ownership before it extracts or pushes — and returns on a problem', (() => { const u = dep.slice(dep.indexOf('export async function updateCustomerCode')); return u.indexOf('checkUpdateOwnership(') > 0 && u.indexOf('checkUpdateOwnership(') < u.indexOf("'git', 'push'") && u.indexOf('checkUpdateOwnership(') < u.indexOf('carryCommittedEnvToRender(')
    && /if \(gate\.length\) \{\s*steps\.push\(\{ step: 'ownership', status: 'error'[^\n]*\n\s*return \{ success: false, steps, errors: gate \}/.test(u) })())
  const route = read('apps/api/src/routes/factory/deploy.ts')
  check('the cleanup cron keeps the jobs that record what a tenant owns', /\.is\('github_repo', null\)\s*\.is\('render_service_ids', null\)/.test(route))
  check('a stopped run does not wipe the repo a previous run recorded on the job', /if \(result\.repoUrl\) jobUpdate\.github_repo = result\.repoUrl/.test(route) && !/github_repo: result\.repoUrl \|\| null/.test(route))
}

// ── 8. Active, the ready email and the feature sync only when the readiness wait passed ──────────────────────
{
  const notReady = { ready: false, reason: 'a deploy failed: srv-x=update_failed', waitedMs: 321_000, services: [], probes: {} }
  const o = R.deployOutcome(notReady)
  check('NOT READY (update_failed): not Active, no ready email', !o.active && !o.sendReadyEmail && /NOT READY — a deploy failed: srv-x=update_failed/.test(o.reason), o)
  check('NOT READY (timed out): the same', !R.deployOutcome({ ...notReady, reason: 'not serving after 30 min' }).active)
  check('nothing waited on: not Active', !R.deployOutcome(null).active && !R.deployOutcome(null).sendReadyEmail)
  check('READY: Active and the email', R.deployOutcome({ ...notReady, ready: true, reason: 'live' }).active && R.deployOutcome({ ...notReady, ready: true, reason: 'live' }).sendReadyEmail)
  const route = read('apps/api/src/routes/factory/deploy.ts')
  const rd = route.slice(route.indexOf('export async function runDeploy'), route.indexOf('\n}\n', route.indexOf('export async function runDeploy')))
  check('runDeploy: Active is written only inside `if (outcome.active)`', /outcome = deployOutcome\(readiness\)\s*if \(outcome\.active\) \{\s*const \{ error: activeErr \} = await supabase\.from\('tenants'\)\.update\(\{ status: 'active' \}\)/.test(rd))
  check('…the ready email only on outcome.sendReadyEmail; otherwise deploy_failed + notifyDeployFailed (staff alert first)',
    /if \(outcome\.sendReadyEmail\) \{[\s\S]{0,1200}notifyDeployComplete\(/.test(rd) && /\} else \{[\s\S]{0,700}status: 'deploy_failed'[\s\S]{0,1200}notifyDeployFailed\(tenant, reason\)/.test(rd)
    && /notifyProvisionFailure\(tenant, 'Deploy', error\)/.test(read('apps/api/src/services/email.ts')))
  check('…the feature sync only to a serving CRM', /if \(outcome\.active && syncKey && backendUrl/.test(rd))
  const addon = read('apps/api/src/services/crmAddonProvision.ts')
  check('CRM add-on: no "CRM is ready" email unless the wait passed — staff alerted instead',
    addon.indexOf('const outcome = deployOutcome(readiness)') > 0 && addon.indexOf("if (!outcome.sendReadyEmail) {") < addon.indexOf("'Your Twomiah CRM is ready'") && /if \(!outcome\.sendReadyEmail\) \{\s*await alertStaff\(/.test(addon))
}

rmSync(TMP, { recursive: true, force: true })
console.log(`\ndeploy-ownership: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
