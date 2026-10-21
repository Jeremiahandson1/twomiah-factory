/**
 * Moves a live business from the templates to the unified app (owner, 2026-10-21: Higgs, 547 and Amber Inn), in stages
 * staff run one at a time — each refuses to run out of order, and none is taken without the business owner's yes:
 *
 *   inspect   read-only: the old CRM service, its database (same region — the move job reads it on Render's private
 *             network), the old site, the domain's DNS; what would stop the move
 *   prepare   the new repo, service and database server, built as a signup's are (unified/build.ts) but NOT
 *             provisioned — the move fills the database. The new service carries the old one's ENCRYPTION_KEY (home
 *             care's stored SSNs and Sandata password were encrypted with it) and the business's one storage bucket
 *             (the CRM's files are keyed by company id, which the move keeps). Recorded on a tenant_moves row, never
 *             as a factory_jobs row while the business still runs on the templates.
 *   run       the move job on the new service (apps/unified/server/move/run.ts): 'check' copies everything in one
 *             transaction and rolls it back — the rehearsal, nothing kept; 'move' first suspends the old CRM (nothing
 *             changes under the copy), then copies for real. A failed move resumes the old CRM: nothing was kept.
 *   switch    the business's domains to the new service (Render's custom domains; the www/app records — the apex is
 *             Render's address already), the tenant row and the factory_jobs row to the new service, the move's
 *             settings off the new service, the old site suspended. The old services stay, suspended, for a rollback.
 *   rollback  every switch step undone from what the switch recorded, the old services resumed.
 *
 * The website: 'fresh' — the new site a signup of this business would get (factory.ts provisionSite), written after
 * the records; 'premium' — the old premium site as it is (siteExport.ts → the template's site.db → move/site.ts).
 */
import crypto from 'node:crypto'
import path from 'node:path'
import { buildUnifiedTenant, type BuildIo, type Step } from './build'
import type { Hosts, EnvVar } from './hosts'
import { unifiedNames } from './names'
import { unifiedVerticalFor, provisionSite, wantsWebsite } from './factory'
import { databaseIdOf, hostOf, type OwnedResources } from '../services/resourceOwnership'
import type { SiteExport } from './siteExport'
import type { NamecheapHost } from '../services/registrar/namecheap'

export type MoveKind = 'crm' | 'crm-bar' | 'homecare'
export type MoveSite = 'fresh' | 'premium' | 'none'

/** The old CRM's template, by its service name (services/resourceOwnership.ts CRM_API_SUFFIXES): the three the move knows. */
export function kindOfService(name: string, slug: string): MoveKind | null {
  if (name === slug + '-care-api') return 'homecare'
  if (name === slug + '-bar-api') return 'crm-bar'
  if (name === slug + '-api') return 'crm'
  return null
}

/** The premium site templates whose database layout the move reads (move/site.ts), by vertical. */
const PREMIUM_TEMPLATE: Record<string, string> = { bar: 'website-premium-bar', contractor: 'website-premium-contractor', homecare: 'website-premium-homecare' }

export interface MoveDeps {
  /** The Factory database (Supabase client or the tests' stand-in). */
  db: any
  hosts: Hosts
  io: BuildIo
  /** unified/build.ts buildUnifiedTenant (the tests give theirs). */
  build: typeof buildUnifiedTenant
  root: string
  version: string
  factoryUrl: string
  owned: (tenantId: string) => Promise<OwnedResources>
  integrationEnv: (tenant: any, config: any, opts: { factoryUrl: string; guessUrl: string }) => Promise<(serviceUrl: string) => EnvVar[]>
  r2: {
    configured: () => boolean
    ensureBucket: (slug: string) => Promise<{ bucketName: string }>
    envVars: (bucket: string) => EnvVar[]
    put: (bucket: string, key: string, body: Uint8Array, contentType: string) => Promise<void>
    get: (bucket: string, key: string) => Promise<Uint8Array | null>
    remove: (bucket: string, key: string) => Promise<void>
  }
  dns: {
    cloudflare: {
      list: (zoneId: string) => Promise<Array<{ id: string; type: string; name: string; content: string }>>
      add: (zoneId: string, rec: { type: string; name: string; content: string; proxied?: boolean }) => Promise<{ id: string }>
      update: (zoneId: string, id: string, content: string) => Promise<void>
      remove: (zoneId: string, id: string) => Promise<void>
    }
    namecheap: {
      get: (domain: string) => Promise<{ emailType: string; usingOurDns: boolean; hosts: NamecheapHost[] }>
      set: (domain: string, emailType: string, hosts: NamecheapHost[]) => Promise<void>
    }
  }
  exportSite: (o: { baseUrl: string; jwtSecret: string; only?: 'leads' }) => Promise<SiteExport>
  buildSiteDb: (templateDir: string, ex: SiteExport) => Uint8Array
  /** The business's email aliases, set again for the new service (services/emailAliasSync.ts). */
  reconcileAliases: (tenant: any) => void
  sleep: (ms: number) => Promise<void>
  waitMs?: number
}

// ─── inspect ───────────────────────────────────────────────────────────────────

export interface MoveFacts {
  tenant: any
  kind: MoveKind | null
  vertical: string | null
  oldCrm: { id: string; name: string; url: string; region: string; suspended: string } | null
  oldDb: { id: string; region: string; status: string } | null
  oldSite: { id: string; name: string; url: string; region: string } | null
  /** Which of the old CRM's settings the new service takes (names only). */
  carried: string[]
  bucket: string | null
  domain: string | null
  /** Where the domain's records live, and what www and app point at now. */
  dns: { at: 'cloudflare' | 'namecheap' | 'unknown'; www: string | null; app: string | null }
  /** The custom domains on the old services, by service. */
  domains: Record<string, string[]>
  problems: string[]
}

/** Values the steps need that are never reported (connection strings, keys). */
interface Secrets { sourceDatabaseUrl: string; encryptionKey: string | null; siteJwtSecret: string | null }

const firstLabel = (u: string) => hostOf(u).split('.')[0]

async function gather(tenantId: string, o: { site: MoveSite; oldSiteServiceId?: string | null }, d: MoveDeps): Promise<{ facts: MoveFacts; secrets: Secrets }> {
  const problems: string[] = []
  const { data: tenant, error } = await d.db.from('tenants').select('*').eq('id', tenantId).single()
  if (error || !tenant) throw new Error('tenant not found: ' + (error?.message || tenantId))
  const facts: MoveFacts = {
    tenant, kind: null, vertical: unifiedVerticalFor(tenant.industry), oldCrm: null, oldDb: null, oldSite: null, carried: [], bucket: null,
    domain: tenant.domain || null, dns: { at: 'unknown', www: null, app: null }, domains: {}, problems,
  }
  const secrets: Secrets = { sourceDatabaseUrl: '', encryptionKey: null, siteJwtSecret: null }
  if (tenant.engine === 'unified') problems.push('the business already runs the unified app')
  if (!facts.vertical) problems.push(`industry '${tenant.industry}' has no unified vertical`)
  const region = d.hosts.region()

  // The old CRM: the service at the address the Factory recorded for this tenant (tenants.render_backend_url).
  const crmName = firstLabel(tenant.render_backend_url || '')
  const crm = crmName ? await d.hosts.findService(crmName) : null
  if (!crm) problems.push(`no CRM service at the recorded address ${tenant.render_backend_url || '(none)'}`)
  else {
    facts.kind = kindOfService(crm.name, tenant.slug)
    if (!facts.kind) problems.push(`the CRM ${crm.name} is not one the move knows (crm, crm-bar, homecare)`)
    facts.oldCrm = { id: crm.id, name: crm.name, url: crm.serviceDetails?.url || '', region: crm.serviceDetails?.region || '', suspended: crm.suspended || '' }
    if (facts.oldCrm.suspended !== 'not_suspended') problems.push(`the CRM ${crm.name} is ${facts.oldCrm.suspended || 'in an unknown state'}`)
    const env = await d.hosts.getEnv(crm.id)
    // The database the CRM RUNS on (its own setting), not tenants.database_url — a recorded value can be stale (Amber Inn's).
    secrets.sourceDatabaseUrl = env.DATABASE_URL || ''
    const dbId = databaseIdOf(secrets.sourceDatabaseUrl)
    if (!dbId) problems.push(`the CRM ${crm.name} has no Render database in its settings`)
    else {
      const db = await d.hosts.getDatabase(dbId)
      facts.oldDb = { id: dbId, region: String(db?.region || ''), status: String(db?.status || 'unknown') }
      // The move job runs on the new service and reads the old database on Render's private network: same region only.
      if (facts.oldDb.region !== region) problems.push(`the old database is in ${facts.oldDb.region}, the new service builds in ${region}: the job could not reach it`)
      if (facts.oldDb.status !== 'available') problems.push(`the old database is ${facts.oldDb.status}`)
    }
    if (env.ENCRYPTION_KEY) { secrets.encryptionKey = env.ENCRYPTION_KEY; facts.carried.push('ENCRYPTION_KEY') }
    if (env.R2_BUCKET_NAME) { facts.bucket = env.R2_BUCKET_NAME; facts.carried.push('the storage bucket ' + env.R2_BUCKET_NAME) }
    facts.domains[crm.name] = (await d.hosts.customDomains(crm.id)).map((x) => x.name)
  }

  // The old site: named by staff (the Factory recorded none for these businesses' sites — 547's is not even named by slug).
  if (o.oldSiteServiceId) {
    const s = await d.hosts.getService(o.oldSiteServiceId).catch(() => null)
    if (!s) problems.push(`no service ${o.oldSiteServiceId}`)
    else {
      facts.oldSite = { id: s.id, name: s.name, url: s.serviceDetails?.url || '', region: s.serviceDetails?.region || '' }
      facts.domains[s.name] = (await d.hosts.customDomains(s.id)).map((x) => x.name)
      if (o.site === 'premium') secrets.siteJwtSecret = (await d.hosts.getEnv(s.id)).JWT_SECRET || null
    }
  }
  if (o.site === 'premium' && !facts.oldSite) problems.push('a premium site moves from its old service: name it')
  if (o.site === 'premium' && facts.oldSite && !secrets.siteJwtSecret) problems.push(`the site ${facts.oldSite.name} has no JWT_SECRET to read its admin API with`)
  if (o.site === 'premium' && facts.vertical && !PREMIUM_TEMPLATE[facts.vertical]) problems.push(`no premium template the move reads for the ${facts.vertical} vertical`)
  if (o.site === 'fresh' && !wantsWebsite(tenant)) problems.push('a fresh site for a business that bought no website')

  // The domain: every name it has must be on a service this move takes over, or on none.
  if (facts.domain) {
    const ours = new Set([facts.domain, 'www.' + facts.domain, 'app.' + facts.domain])
    for (const [svc, names] of Object.entries(facts.domains)) for (const n of names) if (!ours.has(n)) problems.push(`${svc} also answers ${n}, which this move does not carry`)
    if (tenant.cloudflare_zone_id) {
      facts.dns.at = 'cloudflare'
      const recs = await d.dns.cloudflare.list(tenant.cloudflare_zone_id)
      facts.dns.www = recs.find((r) => r.type === 'CNAME' && r.name === 'www.' + facts.domain)?.content ?? null
      facts.dns.app = recs.find((r) => r.type === 'CNAME' && r.name === 'app.' + facts.domain)?.content ?? null
    } else if (tenant.domain_registrar === 'namecheap') {
      const h = await d.dns.namecheap.get(facts.domain)
      if (!h.usingOurDns) problems.push(`${facts.domain} does not use Namecheap's DNS; its records are kept elsewhere`)
      else {
        facts.dns.at = 'namecheap'
        facts.dns.www = h.hosts.find((x) => x.type === 'CNAME' && x.name === 'www')?.address ?? null
        facts.dns.app = h.hosts.find((x) => x.type === 'CNAME' && x.name === 'app')?.address ?? null
        if (!h.emailType) problems.push(`${facts.domain}'s mail setting could not be read; its records cannot be rewritten safely`)
      }
    } else problems.push(`${facts.domain}'s records are neither on the Factory's Cloudflare nor on its Namecheap account`)
  }
  return { facts, secrets }
}

export async function inspectMove(tenantId: string, o: { site: MoveSite; oldSiteServiceId?: string | null }, d: MoveDeps): Promise<MoveFacts> {
  return (await gather(tenantId, o, d)).facts
}

// ─── the move's record ─────────────────────────────────────────────────────────

async function moveRow(d: MoveDeps, id: string): Promise<any> {
  const { data, error } = await d.db.from('tenant_moves').select('*').eq('id', id).single()
  if (error || !data) throw new Error('move not found: ' + (error?.message || id))
  return data
}

async function record(d: MoveDeps, id: string, patch: Record<string, unknown>, rep?: Record<string, unknown>) {
  const row = rep ? await moveRow(d, id) : null
  const update: Record<string, unknown> = { ...patch, updated_at: new Date().toISOString() }
  if (rep) update.reports = [...(row.reports || []), { at: new Date().toISOString(), ...rep }]
  const { error } = await d.db.from('tenant_moves').update(update).eq('id', id)
  if (error) throw new Error('could not record the move: ' + error.message)
}

const need = (row: any, allowed: string[], what: string) => {
  if (!allowed.includes(row.status)) throw new Error(`${what} needs the move ${allowed.join(' or ')}; it is ${row.status}`)
}

// ─── prepare ───────────────────────────────────────────────────────────────────

export async function prepareMove(tenantId: string, o: { site: MoveSite; oldSiteServiceId?: string | null }, d: MoveDeps): Promise<{ moveId: string; success: boolean; steps: Step[]; errors: string[]; facts: MoveFacts }> {
  const { facts, secrets } = await gather(tenantId, o, d)
  const t = facts.tenant
  // One open move per business: an earlier one is built again (its own resources, found by ownership), not doubled.
  const { data: open } = await d.db.from('tenant_moves').select('*').eq('tenant_id', tenantId).order('created_at', { ascending: false })
  const live = (open || []).find((m: any) => !['failed', 'rolled_back'].includes(m.status))
  // A rehearsed move may be built again (new code on the new service) — and is then 'ready': new code, new rehearsal.
  if (live && !['preparing', 'ready', 'rehearsed'].includes(live.status)) throw new Error(`a move for ${t.slug} is already ${live.status}`)
  if (facts.problems.length) return { moveId: live?.id || '', success: false, steps: [], errors: facts.problems, facts }

  let moveId: string = live?.id
  if (!moveId) {
    const { data, error } = await d.db.from('tenant_moves').insert({
      tenant_id: tenantId, status: 'preparing', kind: facts.kind, vertical: facts.vertical, site: o.site,
      old_resources: { crmServiceId: facts.oldCrm!.id, crmName: facts.oldCrm!.name, databaseId: facts.oldDb!.id, siteServiceId: facts.oldSite?.id || null, siteName: facts.oldSite?.name || null, siteUrl: facts.oldSite?.url || null },
    }).select().single()
    if (error || !data) throw new Error('could not record the move: ' + (error?.message || 'no row'))
    moveId = data.id
  }

  const names = unifiedNames(t.slug)
  const guessUrl = `https://${names.service}.onrender.com`
  const { data: job } = await d.db.from('factory_jobs').select('config').eq('tenant_id', tenantId).order('created_at', { ascending: false }).limit(1).maybeSingle()
  const base = await d.integrationEnv(t, job?.config || {}, { factoryUrl: d.factoryUrl, guessUrl })
  // The business's ONE bucket: the old CRM's (its files are keyed by company id, which the move keeps), else a new one.
  const bucket = facts.bucket || (d.r2.configured() ? (await d.r2.ensureBucket(names.service)).bucketName : null)
  const r2 = bucket ? d.r2.envVars(bucket) : []
  const moveEnv: EnvVar[] = [
    { key: 'MOVE_SOURCE_DATABASE_URL', value: secrets.sourceDatabaseUrl },
    { key: 'MOVE_KIND', value: facts.kind! },
  ]
  const integrationEnv = (serviceUrl: string) => {
    const out = base(serviceUrl)
    return [...out, ...[...r2, ...moveEnv].filter((v) => !out.some((x) => x.key === v.key))]
  }
  let owned: OwnedResources
  try { owned = await d.owned(tenantId) } catch { owned = { repos: new Set(), serviceIds: new Set(), databaseIds: new Set(), hosts: new Set() } }
  const result = await d.build({
    tenant: { id: t.id, slug: t.slug }, vertical: facts.vertical!, provision: null, integrationEnv, factoryUrl: d.factoryUrl,
    domain: t.domain || null, owned, root: d.root, version: d.version, waitMs: d.waitMs,
    carry: secrets.encryptionKey ? { ENCRYPTION_KEY: secrets.encryptionKey } : undefined,
  }, d.io)
  const rec = result.record
  await record(d, moveId, {
    status: result.success ? 'ready' : 'preparing',
    ...(rec ? { render_service_ids: { backend: rec.serviceId, database: rec.databaseId }, github_repo: 'https://github.com/' + rec.repo, render_url: rec.serviceUrl } : {}),
    old_resources: { ...(await moveRow(d, moveId)).old_resources, bucket },
  }, { step: 'prepare', ok: result.success, steps: result.steps, errors: result.errors })
  return { moveId, success: result.success, steps: result.steps, errors: result.errors, facts }
}

// ─── run ───────────────────────────────────────────────────────────────────────

/** The old site's code must be the template's: its database is rebuilt in that template's layout (siteExport.ts). */
async function checkSiteTemplate(old: any, vertical: string, d: MoveDeps): Promise<string> {
  const template = PREMIUM_TEMPLATE[vertical]
  if (!template) throw new Error(`no premium template the move reads for the ${vertical} vertical`)
  const svc = await d.hosts.getService(old.siteServiceId)
  const repo = String(svc.repo || '').replace(/^https:\/\/github\.com\//, '')
  const rootDir = String(svc.rootDir ?? svc.serviceDetails?.rootDir ?? '').replace(/^\/+|\/+$/g, '')
  const fs = await import('node:fs')
  for (const f of ['db/schema.ts', 'db/migrations/meta/_journal.json']) {
    const theirs = await d.hosts.getRepoFile(repo, (rootDir ? rootDir + '/' : '') + f, svc.branch || 'main')
    const ours = fs.readFileSync(path.join(d.root, 'templates', template, f), 'utf8')
    if (theirs == null || theirs.replace(/\r\n/g, '\n') !== ours.replace(/\r\n/g, '\n')) throw new Error(`the site's ${f} is not ${template}'s; its database cannot be rebuilt in that layout`)
  }
  return template
}

/**
 * The package the job reads (move/siteSource.ts SitePackage), for the move's website choice. A fresh site still carries
 * the old site's enquiries when it took any — a site whose forward to the CRM failed, or that never had one (547's),
 * kept them only on its own disk, and the old site is suspended at the switch.
 */
async function sitePackage(row: any, tenant: any, d: MoveDeps): Promise<Record<string, unknown> | null> {
  const old = row.old_resources
  if (row.site === 'fresh') {
    const fresh = provisionSite(tenant)
    if (!old.siteServiceId) return { fresh }
    const env = await d.hosts.getEnv(old.siteServiceId)
    if (!env.JWT_SECRET) throw new Error(`the old site ${old.siteName} has no JWT_SECRET: its enquiries cannot be read, and suspending it would strand them`)
    const ex = await d.exportSite({ baseUrl: old.siteUrl, jwtSecret: env.JWT_SECRET, only: 'leads' })
    if (!ex.tables.leads?.length) return { fresh }
    const template = await checkSiteTemplate(old, row.vertical, d)
    return { fresh, leadsFrom: { siteDb: Buffer.from(d.buildSiteDb(path.join(d.root, 'templates', template), ex)).toString('base64') }, notCarried: ex.notCarried }
  }
  if (row.site !== 'premium') return null
  const env = await d.hosts.getEnv(old.siteServiceId)
  if (!env.JWT_SECRET) throw new Error(`the site ${old.siteName} has no JWT_SECRET`)
  const template = await checkSiteTemplate(old, row.vertical, d)
  const ex = await d.exportSite({ baseUrl: old.siteUrl, jwtSecret: env.JWT_SECRET })
  const bytes = d.buildSiteDb(path.join(d.root, 'templates', template), ex)
  return { premium: { siteDb: Buffer.from(bytes).toString('base64'), filesBase: String(old.siteUrl).replace(/\/+$/, '') }, notCarried: ex.notCarried }
}

export interface MoveJobResult { ok: boolean; report: any; log?: string[] }

/** The move job, 'check' (the rehearsal: nothing kept) or 'move' (the old CRM suspended first). */
export async function runMoveJob(moveId: string, mode: 'check' | 'move', d: MoveDeps): Promise<MoveJobResult> {
  const row = await moveRow(d, moveId)
  need(row, mode === 'check' ? ['ready', 'rehearsed'] : ['rehearsed'], mode === 'check' ? 'a rehearsal' : 'the move')
  const { data: tenant } = await d.db.from('tenants').select('*').eq('id', row.tenant_id).single()
  const bucket = row.old_resources?.bucket
  if (!bucket) throw new Error('the move has no storage bucket to pass its package and report through')
  const serviceId = row.render_service_ids?.backend
  const old = row.old_resources

  // Unguessable names: the package holds the business's site and its customers' records in transit.
  const tag = `moves/${moveId}/${mode}-${Date.now()}-${crypto.randomBytes(16).toString('hex')}`
  // The website package first — before anything is suspended: a site that cannot be read stops the run with nothing changed.
  let pkg: Record<string, unknown> | null
  try {
    pkg = await sitePackage(row, tenant, d)
  } catch (e: any) {
    const report = { ok: false, error: e?.message || String(e) }
    await record(d, moveId, {}, { step: mode === 'check' ? 'rehearsal' : 'move', ok: false, report, note: 'the website package could not be made; nothing was changed' })
    return { ok: false, report }
  }
  const siteKey = pkg ? tag + '-site.json' : null
  const reportKey = tag + '-report.json'
  if (siteKey) await d.r2.put(bucket, siteKey, new TextEncoder().encode(JSON.stringify(pkg)), 'application/json')

  if (mode === 'move') {
    await record(d, moveId, { status: 'moving' })
    await d.hosts.suspend(old.crmServiceId)
  }
  let result: MoveJobResult
  try {
    const cmd = `MOVE_MODE=${mode}${siteKey ? ` MOVE_SITE_KEY=${siteKey}` : ''} MOVE_REPORT_KEY=${reportKey} bun server/move/run.ts`
    const jobId = await d.hosts.startJob(serviceId, cmd)
    const waitMs = d.waitMs ?? 45 * 60_000
    let status = 'pending'
    for (let waited = 0; waited <= waitMs; waited += 10_000) {
      const j = await d.hosts.getJob(serviceId, jobId)
      status = j.status
      if (j.finishedAt) break
      await d.sleep(10_000)
    }
    const stored = await d.r2.get(bucket, reportKey)
    const report = stored ? JSON.parse(new TextDecoder().decode(stored)) : null
    const ok = status === 'succeeded' && report?.ok === true
    result = { ok, report: report ?? { ok: false, error: `the job ended ${status} and left no report` }, log: ok ? undefined : await d.hosts.jobLog(jobId) }
  } catch (e: any) {
    result = { ok: false, report: { ok: false, error: e?.message || String(e) } }
  } finally {
    await d.r2.remove(bucket, reportKey).catch(() => {})
    if (siteKey) await d.r2.remove(bucket, siteKey).catch(() => {})
  }
  if (pkg?.notCarried) result.report = { ...result.report, siteNotCarried: pkg.notCarried }

  if (mode === 'move' && !result.ok) {
    // Nothing was kept (one transaction): the old CRM goes back to work as it was.
    await d.hosts.resume(old.crmServiceId)
    await record(d, moveId, { status: 'rehearsed' }, { step: 'move', ok: false, report: result.report, log: result.log, note: 'the old CRM was resumed; nothing changed' })
    return result
  }
  await record(d, moveId, { status: result.ok ? (mode === 'check' ? 'rehearsed' : 'moved') : row.status }, { step: mode === 'check' ? 'rehearsal' : 'move', ok: result.ok, report: result.report, log: result.log })
  return result
}

// ─── switch & rollback ─────────────────────────────────────────────────────────

const renderHost = (url: string) => hostOf(url)

/** Points www and app at `target` where the domain's records live; returns what they pointed at before. */
async function pointRecords(tenant: any, target: string, d: MoveDeps, only?: Record<string, string | null>): Promise<Record<string, string | null>> {
  const domain = tenant.domain
  const before: Record<string, string | null> = {}
  const wanted = only ?? { www: target, app: target }
  if (tenant.cloudflare_zone_id) {
    const zone = tenant.cloudflare_zone_id
    const recs = await d.dns.cloudflare.list(zone)
    for (const [sub, to] of Object.entries(wanted)) {
      const name = sub + '.' + domain
      const cur = recs.filter((r) => r.name === name && r.type === 'CNAME')
      if (cur.length > 1) throw new Error(`${name} has ${cur.length} CNAME records; refusing to guess which one is meant`)
      before[sub] = cur[0]?.content ?? null
      const target = to ? to.replace(/\.$/, '') : ''
      if (cur[0] && target && cur[0].content !== target) await d.dns.cloudflare.update(zone, cur[0].id, target)
      else if (cur[0] && !target) await d.dns.cloudflare.remove(zone, cur[0].id)
      else if (!cur[0] && target) await d.dns.cloudflare.add(zone, { type: 'CNAME', name: sub, content: target, proxied: false })
    }
    return before
  }
  // Namecheap: the whole set, read and written back with the same mail setting (registrar/namecheap.ts setDnsHosts).
  const h = await d.dns.namecheap.get(domain)
  const hosts = h.hosts.map((x) => ({ ...x }))
  for (const [sub, to] of Object.entries(wanted)) {
    const i = hosts.findIndex((x) => x.name === sub && x.type === 'CNAME')
    before[sub] = i >= 0 ? hosts[i].address : null
    if (i >= 0 && to) hosts[i].address = to.endsWith('.') ? to : to + '.'
    else if (i >= 0) hosts.splice(i, 1)
    else if (to) hosts.push({ name: sub, type: 'CNAME', address: to + '.', mxPref: '10', ttl: '1800' })
  }
  await d.dns.namecheap.set(domain, h.emailType, hosts)
  return before
}

/** Custom domains: off each old service, onto the new one. Returns which service each name was on. */
async function moveDomains(names: string[], fromIds: string[], toId: string, d: MoveDeps): Promise<Record<string, string>> {
  const was: Record<string, string> = {}
  for (const id of fromIds) {
    for (const cd of await d.hosts.customDomains(id)) if (names.includes(cd.name)) {
      was[cd.name] = id
      await d.hosts.removeCustomDomain(id, cd.name)
    }
  }
  for (const n of names) await d.hosts.addCustomDomain(toId, n)
  return was
}

export async function switchMove(moveId: string, d: MoveDeps): Promise<{ ok: boolean; steps: Step[] }> {
  const row = await moveRow(d, moveId)
  need(row, ['moved'], 'the switch')
  const { data: tenant } = await d.db.from('tenants').select('*').eq('id', row.tenant_id).single()
  const old = row.old_resources
  const newId = row.render_service_ids.backend
  const newUrl = row.render_url
  const steps: Step[] = []
  const undo: Record<string, unknown> = {}
  const step = (s: string, detail: string) => steps.push({ step: s, status: 'ok', detail })
  try {
    // The tenant row as it was, for the rollback — then the new service's.
    const tenantBefore = { engine: tenant.engine, render_backend_url: tenant.render_backend_url, render_frontend_url: tenant.render_frontend_url, database_url: tenant.database_url, factory_sync_key: tenant.factory_sync_key, website_url: tenant.website_url, r2_bucket_name: tenant.r2_bucket_name }
    undo.tenantBefore = tenantBefore
    const env = await d.hosts.getEnv(newId)
    if (tenant.domain) {
      const names = [tenant.domain, 'www.' + tenant.domain, 'app.' + tenant.domain]
      undo.domains = await moveDomains(names, [old.crmServiceId, old.siteServiceId].filter(Boolean), newId, d)
      step('domains', names.join(', ') + ' → ' + renderHost(newUrl))
      undo.records = await pointRecords(tenant, renderHost(newUrl), d)
      step('records', `www and app → ${renderHost(newUrl)} (were ${JSON.stringify(undo.records)})`)
    }
    const { error: tErr } = await d.db.from('tenants').update({
      engine: 'unified', render_backend_url: newUrl, render_frontend_url: newUrl, database_url: env.DATABASE_URL, factory_sync_key: env.FACTORY_SYNC_KEY,
      ...(wantsWebsite(tenant) ? { website_url: tenant.domain ? 'https://' + tenant.domain : newUrl } : {}),
      ...(old.bucket ? { r2_bucket_name: old.bucket } : {}),
    }).eq('id', tenant.id)
    if (tErr) throw new Error('the tenant row: ' + tErr.message)
    step('tenant', 'engine unified, addresses and keys of ' + renderHost(newUrl))
    // The Factory's build record, now the latest job — what Redeploy, Update Code and the teardown read.
    const { data: jobRow, error: jErr } = await d.db.from('factory_jobs').insert({
      tenant_id: tenant.id, template: 'unified', deployment_model: tenant.deployment_model || 'saas', status: 'complete', features: tenant.features || [],
      github_repo: row.github_repo, render_url: newUrl, render_service_ids: row.render_service_ids,
    }).select().single()
    if (jErr || !jobRow) throw new Error('the job record: ' + (jErr?.message || 'no row'))
    undo.jobId = jobRow.id
    step('job', 'factory_jobs ' + jobRow.id)
    // The features: the Factory's list, as every build ends (factory.ts deployUnifiedTenant) — not the old database's,
    // which can be empty while the template read its package from elsewhere (547's agency held none).
    const features: string[] = Array.isArray(tenant.features) ? tenant.features : []
    if (!features.length) throw new Error('the Factory has no feature list for this business; the new app would show nothing')
    const sync = await d.hosts.callTenant(newUrl, '/api/internal/sync-features', env.FACTORY_SYNC_KEY, { features })
    if (sync.status !== 200) throw new Error(`the new service answered ${sync.status} to the feature sync: ${sync.body?.error || ''}`)
    step('features', `${features.length} from the Factory's record`)
    // The move's settings leave the new service (the old database's address among them), with the deploy that applies it.
    await d.hosts.deleteEnv(newId, 'MOVE_SOURCE_DATABASE_URL')
    await d.hosts.deleteEnv(newId, 'MOVE_KIND')
    await d.hosts.deploy(newId)
    step('settings', 'MOVE_SOURCE_DATABASE_URL and MOVE_KIND removed; deploying')
    if (old.siteServiceId) { await d.hosts.suspend(old.siteServiceId); step('old site', 'suspended ' + old.siteName) }
    d.reconcileAliases({ ...tenant, engine: 'unified', render_backend_url: newUrl, factory_sync_key: env.FACTORY_SYNC_KEY })
    await record(d, moveId, { status: 'switched', old_resources: { ...old, undo } }, { step: 'switch', ok: true, steps })
    return { ok: true, steps }
  } catch (e: any) {
    steps.push({ step: 'switch', status: 'error', detail: e?.message || String(e) })
    await record(d, moveId, { old_resources: { ...old, undo } }, { step: 'switch', ok: false, steps, note: 'run the rollback: it undoes what is recorded' })
    return { ok: false, steps }
  }
}

export async function rollbackMove(moveId: string, d: MoveDeps): Promise<{ ok: boolean; steps: Step[] }> {
  const row = await moveRow(d, moveId)
  need(row, ['switched', 'moved', 'moving'], 'the rollback')
  const { data: tenant } = await d.db.from('tenants').select('*').eq('id', row.tenant_id).single()
  const old = row.old_resources
  const undo = old.undo || {}
  const newId = row.render_service_ids?.backend
  const steps: Step[] = []
  const step = (s: string, detail: string) => steps.push({ step: s, status: 'ok', detail })
  if (undo.domains) {
    const names = Object.keys(undo.domains)
    for (const n of names) await d.hosts.removeCustomDomain(newId, n)
    for (const [n, id] of Object.entries(undo.domains as Record<string, string>)) await d.hosts.addCustomDomain(id, n)
    step('domains', names.join(', ') + ' back')
  }
  if (undo.records) { await pointRecords(tenant, '', d, undo.records); step('records', 'www and app back to ' + JSON.stringify(undo.records)) }
  if (undo.tenantBefore) {
    const { error } = await d.db.from('tenants').update(undo.tenantBefore).eq('id', tenant.id)
    if (error) throw new Error('the tenant row: ' + error.message)
    step('tenant', 'as it was')
  }
  if (undo.jobId) { await d.db.from('factory_jobs').delete().eq('id', undo.jobId); step('job', 'the move\'s factory_jobs row removed') }
  await d.hosts.resume(old.crmServiceId); step('old CRM', 'resumed ' + old.crmName)
  if (old.siteServiceId) { await d.hosts.resume(old.siteServiceId); step('old site', 'resumed ' + old.siteName) }
  await record(d, moveId, { status: 'rolled_back' }, { step: 'rollback', ok: true, steps, note: 'the new service keeps the copied records; it is not the business\'s' })
  return { ok: true, steps }
}

// ─── What the move talks to ────────────────────────────────────────────────────

/** The live services, from the Factory's own settings (run where they are: unified/moveBusiness.ts on the Factory). */
export async function liveMoveDeps(): Promise<MoveDeps> {
  const [{ liveUnifiedDeps }, s3, cf, nc, site] = await Promise.all([
    import('./factory'), import('@aws-sdk/client-s3'), import('../services/cloudflare'), import('../services/registrar/namecheap'), import('./siteExport'),
  ])
  const u = await liveUnifiedDeps()
  const client = new s3.S3Client({
    region: 'auto', endpoint: 'https://' + process.env.R2_ACCOUNT_ID + '.r2.cloudflarestorage.com',
    credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID!, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY! },
  })
  return {
    db: u.db, hosts: u.io.hosts, io: u.io, build: buildUnifiedTenant, root: u.root, version: u.version, factoryUrl: u.factoryUrl, owned: u.owned, integrationEnv: u.integrationEnv,
    r2: {
      configured: u.r2.configured, ensureBucket: u.r2.ensureBucket, envVars: u.r2.envVars,
      put: async (Bucket, Key, Body, ContentType) => { await client.send(new s3.PutObjectCommand({ Bucket, Key, Body, ContentType })) },
      get: async (Bucket, Key) => {
        try {
          const r = await client.send(new s3.GetObjectCommand({ Bucket, Key }))
          return await r.Body!.transformToByteArray()
        } catch (e: any) {
          if (e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404) return null
          throw e
        }
      },
      remove: async (Bucket, Key) => { await client.send(new s3.DeleteObjectCommand({ Bucket, Key })) },
    },
    dns: {
      cloudflare: { list: cf.listDnsRecords, add: cf.addDnsRecord as any, update: cf.updateDnsRecord, remove: cf.deleteDnsRecord },
      namecheap: { get: nc.getDnsHosts, set: nc.setDnsHosts },
    },
    exportSite: (o) => site.exportPremiumSite(o),
    buildSiteDb: site.buildSiteDb,
    reconcileAliases: u.domains.reconcileAliases,
    sleep: u.io.sleep,
  }
}
