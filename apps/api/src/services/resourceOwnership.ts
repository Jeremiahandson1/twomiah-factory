/**
 * Which GitHub repos, Render services and Render databases are a tenant's OWN — and which names are free for a new one.
 *
 * Why (Amber Inn, 10/17): a fresh signup took the slug `amber-inn`. The deploy then deleted the GitHub repo
 * `amber-inn` and the Render service `amber-inn-site` — the owner's hand-built website, never made by the Factory —
 * because the deploy deleted "whatever has this name" to free the name. It reused the suspended database `amber-inn-db`
 * left from that old site ("Reuse existing database if it exists"), so the new CRM could not boot, and would have
 * deleted that database on a rollback. The slug was handed out because signup only looked at the tenants table.
 *
 * The rule: a resource is this tenant's own ONLY when the Factory recorded it for this tenant id —
 *   • a Render service: its id is in one of the tenant's factory_jobs.render_service_ids, or its host is one the Factory
 *     wrote for the tenant (tenants.render_backend_url / render_frontend_url, factory_jobs.render_url), or it is built
 *     from a repo that is the tenant's own (it is running the tenant's code);
 *   • a repo: it is a factory_jobs.github_repo of the tenant, or it is the repo of a service owned by id/host above;
 *   • a Render Postgres: its id is the `database` of a job's render_service_ids, or the host of tenants.database_url
 *     (Render's internal host IS the database id, dpg-…-a).
 * tenants.website_url is NOT a record: the intake form writes the customer's CURRENT website there, which is exactly
 * the kind of site this rule protects.
 *
 * Anything else with the name is someone else's: never deleted, never reused, never written to. A deploy that meets one
 * stops before it touches anything (deploy.ts preflightDeploy) and staff are told why.
 */

/** Every name a CRM backend is given at deploy (deploy.ts crmApiName): slug + one of these. */
export const CRM_API_SUFFIXES = ['-api', '-care-api', '-wrench-api', '-drive-api', '-roof-api', '-landscape-api', '-leaf-api', '-rv-api', '-vet-api', '-salon-api', '-bar-api', '-events-api', '-shop-api', '-basic-api'] as const
/** The legacy frontend/static names (deploy.ts crmFrontName) — the deploy cleans these up when they are the tenant's. */
export const CRM_FRONT_SUFFIXES = ['-crm', '-care', '-wrench', '-drive', '-roof', '-landscape', '-leaf', '-rv', '-vet', '-salon', '-bar', '-events', '-shop', '-basic'] as const
/** The database slug's suffix per vertical (deploy.ts dbSlug); the database is <dbSlug>-db. */
export const DB_SLUG_SUFFIXES = ['', '-care', '-wrench', '-drive', '-roof', '-landscape', '-leaf', '-shop'] as const

export type OwnedResources = {
  serviceIds: Set<string>
  hosts: Set<string>
  repos: Set<string>
  databaseIds: Set<string>
}

export type TenantRecord = { render_backend_url?: string | null; render_frontend_url?: string | null; database_url?: string | null }
export type JobRecord = { render_service_ids?: Record<string, string> | null; github_repo?: string | null; render_url?: string | null }

export function emptyOwnership(): OwnedResources {
  return { serviceIds: new Set(), hosts: new Set(), repos: new Set(), databaseIds: new Set() }
}

export function hostOf(u?: string | null): string {
  return String(u || '').trim().replace(/^[a-z]+:\/\//i, '').replace(/^[^@/]*@/, '').split(/[/?#]/)[0].split(':')[0].toLowerCase()
}

/** "https://github.com/Org/Name.git", "github.com/org/name", "org/name" → "org/name". '' when it is not a repo name. */
export function repoKey(u?: string | null): string {
  const s = String(u || '').trim().replace(/^[a-z]+:\/\//i, '').replace(/^(www\.)?github\.com\//i, '').replace(/\.git$/i, '').replace(/\/+$/, '')
  const parts = s.split('/')
  return parts.length === 2 && parts[0] && parts[1] ? (parts[0] + '/' + parts[1]).toLowerCase() : ''
}

/** The Render Postgres id a connection string points at: its host's first label when that is a Render id (dpg-…). */
export function databaseIdOf(connectionString?: string | null): string {
  const first = hostOf(connectionString).split('.')[0]
  return /^dpg-[a-z0-9]+(-[a-z])?$/.test(first) ? first : ''
}

export function ownershipFromRecords(tenant: TenantRecord | null | undefined, jobs: JobRecord[] | null | undefined): OwnedResources {
  const o = emptyOwnership()
  for (const u of [tenant?.render_backend_url, tenant?.render_frontend_url]) if (hostOf(u)) o.hosts.add(hostOf(u))
  const dbId = databaseIdOf(tenant?.database_url)
  if (dbId) o.databaseIds.add(dbId)
  for (const job of jobs || []) {
    for (const [role, id] of Object.entries(job?.render_service_ids || {})) {
      if (!id || typeof id !== 'string') continue
      if (role === 'database') o.databaseIds.add(id)
      else o.serviceIds.add(id)
    }
    if (repoKey(job?.github_repo)) o.repos.add(repoKey(job?.github_repo))
    if (hostOf(job?.render_url)) o.hosts.add(hostOf(job?.render_url))
  }
  return o
}

/** Reads the tenant's records from the Factory DB. Throws when they cannot be read — the caller must not guess. */
export async function loadOwnedResources(tenantId: string, db?: any): Promise<OwnedResources> {
  const supabase = db || (await import('../middleware/auth')).supabase
  const { data: tenant, error: tErr } = await supabase.from('tenants').select('render_backend_url, render_frontend_url, database_url').eq('id', tenantId).maybeSingle()
  if (tErr) throw new Error('tenant records unreadable: ' + tErr.message)
  const { data: jobs, error: jErr } = await supabase.from('factory_jobs').select('render_service_ids, github_repo, render_url').eq('tenant_id', tenantId)
  if (jErr) throw new Error('job records unreadable: ' + jErr.message)
  return ownershipFromRecords(tenant, jobs || [])
}

type ServiceLike = { id?: string; name?: string; slug?: string; repo?: string | null; serviceDetails?: { url?: string | null } | null }

/** Owned by the Factory's id/host records alone (no repo inference). */
export function ownsServiceDirectly(owned: OwnedResources, svc: ServiceLike | null | undefined): boolean {
  if (!svc) return false
  if (svc.id && owned.serviceIds.has(svc.id)) return true
  const h = hostOf(svc.serviceDetails?.url)
  if (h && owned.hosts.has(h)) return true
  if (svc.slug && owned.hosts.has((svc.slug + '.onrender.com').toLowerCase())) return true
  return false
}

/** A repo is the tenant's own when a job recorded it, or a service owned by id/host is built from it. */
export function ownsRepo(owned: OwnedResources, fullName: string, knownServices: ServiceLike[] = []): boolean {
  const key = repoKey(fullName)
  if (!key) return false
  if (owned.repos.has(key)) return true
  return knownServices.some((s) => ownsServiceDirectly(owned, s) && repoKey(s.repo) === key)
}

/** Owned by record, or built from a repo that is the tenant's own (it runs the tenant's code). */
export function ownsService(owned: OwnedResources, svc: ServiceLike | null | undefined, knownServices: ServiceLike[] = []): boolean {
  if (!svc) return false
  if (ownsServiceDirectly(owned, svc)) return true
  return !!svc.repo && ownsRepo(owned, String(svc.repo), knownServices)
}

export function ownsDatabase(owned: OwnedResources, dbRow: { id?: string } | null | undefined): boolean {
  return !!dbRow?.id && owned.databaseIds.has(dbRow.id)
}

/** A database a backend can boot on: Render reports it available and not suspended. Anything else is unusable. */
export function databaseUsable(dbRow: { status?: string; suspended?: string } | null | undefined): boolean {
  return !!dbRow && dbRow.status === 'available' && (dbRow.suspended === undefined || dbRow.suspended === 'not_suspended')
}

// ─── Slug allocation ─────────────────────────────────────────────────────────

/** Every external name a tenant with this slug could be given by a deploy, across all verticals. */
export function externalNamesForSlug(slug: string): { repo: string; services: string[]; databases: string[] } {
  const services = new Set<string>([slug, slug + '-site', slug + '-pricing-api', slug + '-vision'])
  for (const s of CRM_API_SUFFIXES) services.add(slug + s)
  for (const s of CRM_FRONT_SUFFIXES) services.add(slug + s)
  const databases = new Set<string>([slug + '-pricing-db'])
  for (const s of DB_SLUG_SUFFIXES) databases.add(slug + s + '-db')
  return { repo: slug, services: [...services], databases: [...databases] }
}

/** Each lookup answers "does something with this name exist?" — and THROWS when it cannot tell. */
export type SlugLookups = {
  tenantSlugTaken: (slug: string) => Promise<boolean>
  repoExists: (name: string) => Promise<boolean>
  serviceExists: (name: string) => Promise<boolean>
  databaseExists: (name: string) => Promise<boolean>
}

/** Free only when every lookup answered "nothing there". A lookup that errors makes the slug taken, never free. */
export async function slugIsFree(slug: string, lookups: SlugLookups): Promise<{ free: boolean; reason?: string }> {
  try {
    if (await lookups.tenantSlugTaken(slug)) return { free: false, reason: 'a tenant has it' }
    const names = externalNamesForSlug(slug)
    if (await lookups.repoExists(names.repo)) return { free: false, reason: 'GitHub repo ' + names.repo + ' exists' }
    for (const n of names.services) if (await lookups.serviceExists(n)) return { free: false, reason: 'Render service ' + n + ' exists' }
    for (const n of names.databases) if (await lookups.databaseExists(n)) return { free: false, reason: 'Render Postgres ' + n + ' exists' }
    return { free: true }
  } catch (e: any) {
    return { free: false, reason: 'lookup failed: ' + (e?.message || String(e)) }
  }
}

/** The signup's candidates: the name itself, then -2, -3 … */
export function signupSlugCandidates(base: string, count = 10): string[] {
  const out = [base]
  for (let i = 2; i <= count; i++) out.push(base + '-' + i)
  return out
}

/** The first free candidate, or null when none is (every one taken, or every lookup failing). */
export async function allocateSlug(candidates: string[], lookups: SlugLookups): Promise<{ slug: string | null; skipped: Array<{ slug: string; reason: string }> }> {
  const skipped: Array<{ slug: string; reason: string }> = []
  for (const slug of candidates) {
    const r = await slugIsFree(slug, lookups)
    if (r.free) return { slug, skipped }
    skipped.push({ slug, reason: r.reason || 'taken' })
  }
  return { slug: null, skipped }
}

/**
 * The live lookups: the Factory's tenants table, GitHub, and Render (services and Postgres listed once per allocation and
 * matched by exact name). Not configured, or any non-OK answer, THROWS — slugIsFree turns that into "taken".
 */
export function liveSlugLookups(db?: any): SlugLookups {
  const RENDER_API = 'https://api.render.com/v1'
  const renderHeaders = () => ({ Authorization: 'Bearer ' + process.env.RENDER_API_KEY, Accept: 'application/json' })
  const listAll = async (path: string, key: 'service' | 'postgres'): Promise<Set<string>> => {
    if (!process.env.RENDER_API_KEY) throw new Error('RENDER_API_KEY not set')
    const names = new Set<string>()
    let cursor = ''
    for (let page = 0; page < 50; page++) {
      const res = await fetch(RENDER_API + path + (path.includes('?') ? '&' : '?') + 'limit=100' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''), { headers: renderHeaders(), signal: AbortSignal.timeout(30_000) })
      if (!res.ok) throw new Error('Render ' + path + ' answered ' + res.status)
      const batch = await res.json() as any[]
      if (!Array.isArray(batch)) throw new Error('Render ' + path + ' answered no list')
      for (const item of batch) { const name = (item?.[key] || item)?.name; if (name) names.add(String(name)) }
      cursor = batch[batch.length - 1]?.cursor || ''
      if (!cursor || batch.length < 100) return names
    }
    throw new Error('Render ' + path + ' list did not end')
  }
  let services: Promise<Set<string>> | null = null
  let databases: Promise<Set<string>> | null = null
  return {
    tenantSlugTaken: async (slug) => {
      const supabase = db || (await import('../middleware/auth')).supabase
      const { data, error } = await supabase.from('tenants').select('id').eq('slug', slug).maybeSingle()
      if (error) throw new Error('tenants lookup failed: ' + error.message)
      return !!data
    },
    repoExists: async (name) => {
      const org = process.env.GITHUB_ORG || process.env.GITHUB_USER
      if (!org || !process.env.GITHUB_TOKEN) throw new Error('GITHUB_ORG/GITHUB_TOKEN not set')
      const res = await fetch('https://api.github.com/repos/' + org + '/' + encodeURIComponent(name), {
        headers: { Authorization: 'token ' + process.env.GITHUB_TOKEN, Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(30_000),
      })
      if (res.status === 404) return false
      if (res.ok) return true
      throw new Error('GitHub answered ' + res.status + ' for ' + name)
    },
    serviceExists: async (name) => (await (services ||= listAll('/services', 'service'))).has(name),
    databaseExists: async (name) => (await (databases ||= listAll('/postgres', 'postgres'))).has(name),
  }
}
