/**
 * Builds a unified tenant, or builds it again: its own Postgres server, its repo at the current unified version, its
 * Render service, and — once the new code answers — the business itself, through the tenant's own
 * POST /api/internal/provision (docs/SPEC_UNIFIED_PRODUCT.md §0 decision 4: the Factory builds every tenant).
 *
 * Every tenant has a database server of its own (decision 2, the owner's yes 2026-10-18: "server per customer, do it
 * the safe way"): no tenant shares a machine, a connection limit or an outage with another.
 *
 * Ownership first, as services/deploy.ts preflightDeploy does it: every name is looked up before anything is made,
 * and a repo, service or database with the tenant's name that the Factory did not record for this tenant stops the
 * build with nothing touched (Amber Inn, 10/17).
 *
 * Run again on a built tenant it is safe: its own repo, service and database are reused, the service's secrets are
 * kept (a new ENCRYPTION_KEY would make every stored secret unreadable), and the provision call changes nothing.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { unifiedNames } from './names'
import { buildTenantTree } from './tree'
import type { Hosts, EnvVar } from './hosts'

export interface Step { step: string; status: 'ok' | 'skipped' | 'error'; detail?: string }

/** What the Factory has recorded as this tenant's (services/resourceOwnership.ts loadOwnedResources). */
export interface Owned { repos: Set<string>; serviceIds: Set<string>; databaseIds: Set<string> }

export interface BuildIo {
  hosts: Hosts
  /** Pushes `dir` to the repo's main branch and returns the commit it pushed. */
  push: (repoFullName: string, dir: string) => Promise<string>
  sleep: (ms: number) => Promise<void>
}

export interface BuildInput {
  tenant: { id: string; slug: string }
  /** The vertical's id (apps/unified/server/core/vertical.ts loadVertical). */
  vertical: string
  /**
   * The body of the tenant's POST /api/internal/provision (apps/unified/server/modules/provision.ts) — or null for a
   * business moving in from the templates (unified/move.ts): its records arrive by the move job instead, into the empty
   * database this build leaves. A function is called only once the new code answers: the body is made then, so what
   * goes into it (the AI's website, composed while the database and service were being made — services/signupSite.ts)
   * can finish during the build instead of before it.
   */
  provision: Record<string, unknown> | null | (() => Promise<Record<string, unknown>>)
  /**
   * Secrets the service must have exactly (a move: the old service's ENCRYPTION_KEY, which the moved rows were
   * encrypted with). They win over the service's own and over a new one.
   */
  carry?: Record<string, string>
  /**
   * The Factory's integration settings for this tenant (Twilio, email, maps…), computed by the caller — or computed from
   * the service's address, for the settings that carry it (QuickBooks' return address), since a new service's address is
   * Render's to give.
   */
  integrationEnv?: EnvVar[] | ((serviceUrl: string) => EnvVar[])
  /** The Factory's own address, for the tenant's calls back. */
  factoryUrl: string
  /**
   * The business's own domain (tenants.domain), when it has one: the website's public address (SITE_URL — canonical
   * links, the sitemap, the admin's app.<domain>). A rebuild must keep it; it used to reset SITE_URL to the Render address.
   */
  domain?: string | null
  /** What this tenant already owns; a rebuild finds its own repo, service and database here. */
  owned: Owned
  /** The monorepo, and the engine commit the tree is built from. */
  root: string
  version: string
  /** How long to wait for a new database to be ready, and for the new code to answer (Render builds take minutes). */
  waitMs?: number
}

export interface BuildResult {
  success: boolean
  steps: Step[]
  errors: string[]
  /** What to record as the tenant's (factory_jobs / tenants), so the next build and teardown know it. */
  record?: {
    repo: string
    serviceId: string
    serviceUrl: string
    databaseId: string
    /** The service's DATABASE_URL (Render's internal address), recorded as tenants.database_url as for a template tenant. */
    databaseUrl: string
    commit: string
    version: string
    factorySyncKey: string
  }
}

/** The service's settings: the ones this build owns, then the secrets it keeps once made. */
export function tenantEnv(input: { tenantId: string; vertical: string; databaseUrl: string; serviceUrl: string; factoryUrl: string; domain?: string | null; integrationEnv?: EnvVar[]; carry?: Record<string, string> }, current: Record<string, string>): { set: EnvVar[]; factorySyncKey: string } {
  const keep = (key: string, make: () => string) => input.carry?.[key] || current[key] || make()
  const secrets: Record<string, string> = {
    JWT_SECRET: keep('JWT_SECRET', () => crypto.randomBytes(48).toString('base64')),
    JWT_REFRESH_SECRET: keep('JWT_REFRESH_SECRET', () => crypto.randomBytes(48).toString('base64')),
    ENCRYPTION_KEY: keep('ENCRYPTION_KEY', () => crypto.randomBytes(32).toString('hex')),
    FACTORY_SYNC_KEY: keep('FACTORY_SYNC_KEY', () => crypto.randomBytes(32).toString('hex')),
    CRON_SECRET: keep('CRON_SECRET', () => crypto.randomBytes(32).toString('hex')),
  }
  const owned: Record<string, string> = {
    NODE_ENV: 'production',
    VERTICAL: input.vertical,
    TENANT_ID: input.tenantId,
    DATABASE_URL: input.databaseUrl,
    FACTORY_URL: input.factoryUrl,
    FRONTEND_URL: input.serviceUrl,
    SITE_URL: input.domain ? 'https://' + input.domain : input.serviceUrl,
    API_URL: input.serviceUrl,
    BACKEND_URL: input.serviceUrl,
  }
  const set = new Map<string, string>()
  // Integration settings never overwrite one the tenant already has (its own Stripe key, a verified sender).
  for (const v of input.integrationEnv || []) if (!(v.key in current)) set.set(v.key, v.value)
  for (const [k, v] of Object.entries({ ...secrets, ...owned })) if (current[k] !== v) set.set(k, v)
  return { set: [...set].map(([key, value]) => ({ key, value })), factorySyncKey: secrets.FACTORY_SYNC_KEY }
}

/** Waits until the service answers with `commit` (Render calls a deploy live while the old instance still answers). */
export async function waitForCommit(hosts: Hosts, sleep: (ms: number) => Promise<void>, url: string, commit: string, waitMs: number): Promise<{ ok: boolean; seen: string | null }> {
  const every = 15_000
  let seen: string | null = null
  for (let waited = 0; waited <= waitMs; waited += every) {
    const h = await hosts.health(url)
    seen = h?.commit ?? null
    if (seen === commit) return { ok: true, seen }
    await sleep(every)
  }
  return { ok: false, seen }
}

/**
 * Waits until Render says the database is available; its last status otherwise. A suspended database (Render's
 * `suspended` field, which can read 'suspended' while `status` still reads 'available') is not usable and is never
 * waited on — the same rule as services/resourceOwnership.ts databaseUsable, so the build stops and says so instead of
 * booting the tenant on a database that does not answer.
 */
export async function waitForDatabase(hosts: Hosts, sleep: (ms: number) => Promise<void>, id: string, waitMs: number): Promise<{ ok: boolean; status: string }> {
  const every = 10_000
  let status = 'unknown'
  for (let waited = 0; waited <= waitMs; waited += every) {
    const db = await hosts.getDatabase(id)
    status = String(db?.status || 'unknown')
    const suspended = db?.suspended !== undefined && db?.suspended !== null && db.suspended !== 'not_suspended'
    if (suspended) return { ok: false, status: 'suspended (' + String(db.suspended) + ')' }
    if (status === 'available') return { ok: true, status }
    if (/suspend|fail|error/i.test(status)) return { ok: false, status }
    await sleep(every)
  }
  return { ok: false, status }
}

export async function buildUnifiedTenant(input: BuildInput, io: BuildIo): Promise<BuildResult> {
  const steps: Step[] = []
  const errors: string[] = []
  const stop = (step: string, detail: string): BuildResult => { steps.push({ step, status: 'error', detail }); errors.push(detail); return { success: false, steps, errors } }
  const { hosts } = io
  const waitMs = input.waitMs ?? 20 * 60_000

  let names
  try { names = unifiedNames(input.tenant.slug) } catch (e: any) { return stop('names', e.message) }
  const repoFullName = hosts.repoFullName(names.repo)

  // 1. Every name, looked up and judged before anything is made.
  let repo: any, service: any, db: any
  let current: Record<string, string> = {}
  try {
    repo = await hosts.getRepo(repoFullName)
    service = await hosts.findService(names.service)
    db = await hosts.findDatabase(names.database)
    if (service && input.owned.serviceIds.has(service.id)) current = await hosts.getEnv(service.id)
  } catch (e: any) { return stop('preflight', 'could not check the names (' + e.message + ') — nothing was changed') }
  const problems: string[] = []
  if (repo && !input.owned.repos.has(repoFullName.toLowerCase())) problems.push(`GitHub repo ${repoFullName} exists and is not this tenant's`)
  if (service && !input.owned.serviceIds.has(service.id)) problems.push(`Render service ${names.service} exists and is not this tenant's`)
  if (db && !input.owned.databaseIds.has(db.id)) problems.push(`Render database ${names.database} exists and is not this tenant's`)
  if (problems.length) return stop('preflight', problems.join('; ') + ' — nothing was changed')
  const mine = (x: unknown) => (x ? "is the tenant's" : 'free')
  steps.push({ step: 'preflight', status: 'ok', detail: `repo ${mine(repo)}, service ${mine(service)}, database ${mine(db)}` })

  // 2. The tenant's own database server: made, or its own found; ready before anything connects to it.
  let databaseId: string, databaseUrl: string
  try {
    databaseId = db ? db.id : (await hosts.createDatabase({ name: names.database, database: names.databaseName })).id
    const ready = await waitForDatabase(hosts, io.sleep, databaseId, waitMs)
    if (!ready.ok) return stop('database', `${names.database} is ${ready.status}, not available`)
    databaseUrl = await hosts.databaseUrl(databaseId)
    steps.push({ step: 'database', status: 'ok', detail: `${names.database} (${db ? "the tenant's own" : 'made'})` })
  } catch (e: any) { return stop('database', e.message) }

  // 3. The code and the service. A service that exists gets this build's commands and settings BEFORE the push, so
  // the deploy the push starts is the only one and carries them; a new service is made after it, from the pushed code.
  const dir = path.join(os.tmpdir(), `unified-${input.tenant.slug}-${Date.now()}`)
  const integrationFor = (serviceUrl: string) => typeof input.integrationEnv === 'function' ? input.integrationEnv(serviceUrl) : input.integrationEnv
  const envFor = (serviceUrl: string, now: Record<string, string>) =>
    tenantEnv({ tenantId: input.tenant.id, vertical: input.vertical, databaseUrl, serviceUrl, factoryUrl: input.factoryUrl, domain: input.domain, integrationEnv: integrationFor(serviceUrl), carry: input.carry }, now)
  let commit: string
  let serviceId = '', serviceUrl = '', factorySyncKey = ''
  try {
    buildTenantTree(input.root, dir, input.version)
    if (!repo) {
      await hosts.createRepo(names.repo, `Twomiah — ${input.tenant.slug}`)
      steps.push({ step: 'repo', status: 'ok', detail: 'made ' + repoFullName })
    } else steps.push({ step: 'repo', status: 'ok', detail: 'the tenant\'s own ' + repoFullName })

    if (service) {
      serviceId = service.id
      serviceUrl = service.serviceDetails?.url || `https://${names.service}.onrender.com`
      const env = envFor(serviceUrl, current)
      factorySyncKey = env.factorySyncKey
      await hosts.updateServiceCommands(serviceId)
      await hosts.setEnv(serviceId, env.set)
      steps.push({ step: 'service', status: 'ok', detail: `the tenant's own ${names.service}; set ${env.set.map((v) => v.key).join(', ') || 'nothing'}` })
    }

    commit = await io.push(repoFullName, dir)
    steps.push({ step: 'push', status: 'ok', detail: `${input.version.slice(0, 9)} as ${commit.slice(0, 9)}` })

    if (!service) {
      // The address is the service's name until Render says otherwise.
      const guessUrl = `https://${names.service}.onrender.com`
      const env = envFor(guessUrl, {})
      const made = await hosts.createService({ name: names.service, repoFullName, envVars: env.set })
      serviceId = made.id; serviceUrl = made.url; factorySyncKey = env.factorySyncKey
      if (made.url !== guessUrl) {
        // Its own address differs: corrected, and deployed again so the service runs with it — the integration settings
        // that carry the address too (they were given the guess, and tenantEnv never overwrites an integration setting).
        const guessed = new Map((integrationFor(guessUrl) || []).map((v) => [v.key, v.value]))
        const moved = (integrationFor(made.url) || []).filter((v) => guessed.get(v.key) !== v.value)
        const fixed = envFor(made.url, Object.fromEntries(env.set.map((v) => [v.key, v.value]))).set
        await hosts.setEnv(serviceId, [...fixed, ...moved.filter((v) => !fixed.some((f) => f.key === v.key))])
        await hosts.deploy(serviceId)
      }
      steps.push({ step: 'service', status: 'ok', detail: 'made ' + names.service + ' at ' + serviceUrl })
    }
  } catch (e: any) {
    return stop(serviceId ? 'service' : 'code', e.message)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }

  const record = { repo: repoFullName, serviceId, serviceUrl, databaseId, databaseUrl, commit, version: input.version, factorySyncKey }

  // 4. Live: the commit just pushed answers (not merely a deploy called live).
  const live = await waitForCommit(hosts, io.sleep, serviceUrl, commit, waitMs)
  if (!live.ok) { const r = stop('live', `${serviceUrl} did not answer with ${commit.slice(0, 9)} in time (last seen: ${live.seen ? live.seen.slice(0, 9) : 'no answer'})`); return { ...r, record } }
  steps.push({ step: 'live', status: 'ok', detail: serviceUrl + ' runs ' + commit.slice(0, 9) })

  // 5. The business — unless it is moving in: then the database stays empty for the move job (unified/move.ts).
  if (!input.provision) {
    steps.push({ step: 'provision', status: 'skipped', detail: 'moving in: the records come by the move job' })
    return { success: true, steps, errors, record }
  }
  // The call is safe to repeat (a provisioned tenant answers "already provisioned"), so a gateway answer
  // — no answer, 502, 503, 504, as while Render swaps the instance that just went live — is asked again, a few times,
  // before it fails the build. (The first home-care build on Render, 2026-10-19: live, then a 502 on this call.)
  const retryable = (status: number) => status === 0 || status === 502 || status === 503 || status === 504
  let body: Record<string, unknown>
  try { body = typeof input.provision === 'function' ? await input.provision() : input.provision } catch (e: any) {
    const r = stop('provision', 'the provision body could not be made: ' + (e?.message || e))
    return { ...r, record }
  }
  let p: { status: number; body: any } = { status: 0, body: {} }
  for (let attempt = 1; attempt <= 6; attempt++) {
    p = await hosts.callTenant(serviceUrl, '/api/internal/provision', factorySyncKey, body).catch((e: any) => ({ status: 0, body: { error: e.message } }))
    if (!retryable(p.status) || attempt === 6) break
    steps.push({ step: 'provision', status: 'skipped', detail: `attempt ${attempt}: the tenant answered ${p.status || 'nothing'}; asking again` })
    await io.sleep(15_000)
  }
  if (p.status !== 201 && p.status !== 200) {
    const r = stop('provision', `the tenant answered ${p.status}: ${p.body?.error || 'no answer'}${p.body?.fields ? ' ' + JSON.stringify(p.body.fields) : ''}`)
    return { ...r, record }
  }
  steps.push({ step: 'provision', status: 'ok', detail: p.status === 201 ? 'the business, its owner and its site are in' : p.body?.message || 'already provisioned' })
  return { success: true, steps, errors, record }
}
