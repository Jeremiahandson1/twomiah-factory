// A test signup through the Factory's unified build (apps/api/src/unified/build.ts, update.ts, teardown.ts), end to
// end on this machine: a real Postgres, the real tenant repo, the real install from its lockfile, the
// real screens build, the real migrations and server, the real provision call and the owner's real sign-in, then
// Update Code to a new version and the teardown. Only GitHub's and Render's APIs are stand-ins — and the Render
// stand-in builds and runs what was pushed, the way the service's commands would (hosts.ts serviceCommands).
//
// Each tenant's own database server is played by a database of its own, with its own login, on the test Postgres.
//
// Needs UNIFIED_TEST_PG: a superuser connection string to a Postgres the test may create roles and databases on (CI: the
// postgres service in .github/workflows/unified.yml). Without it the file says so and stops; CI sets it. Slow: three
// installs and three screens builds.
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { createRequire } from 'node:module'
import { buildUnifiedTenant, tenantEnv, type BuildIo, type Owned } from '../../../apps/api/src/unified/build'
import { updateUnifiedTenant } from '../../../apps/api/src/unified/update'
import { teardownUnifiedTenant } from '../../../apps/api/src/unified/teardown'
import { createHosts } from '../../../apps/api/src/unified/hosts'
import { engineVersion } from '../../../apps/api/src/unified/tree'

const SUPER = process.env.UNIFIED_TEST_PG
const ROOT = path.resolve(import.meta.dir, '../../..')
const pg = createRequire(path.join(ROOT, 'apps/api/package.json'))('pg')
const ORG = 'twomiah-test'

async function run(conn: string, text: string, params?: unknown[]) {
  const c = new pg.Client({ connectionString: conn }); await c.connect()
  try { return (await c.query(text, params)).rows } finally { await c.end() }
}
const freePort = () => new Promise<number>((resolve) => { const s = net.createServer(); s.listen(0, () => { const p = (s.address() as any).port; s.close(() => resolve(p)) }) })
const sh = (cmd: string, args: string[], cwd: string, env: Record<string, string> = {}) => {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', env: { ...process.env, ...env }, timeout: 600_000, shell: process.platform === 'win32' })
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} in ${cwd}: ${(r.stderr || r.stdout).slice(-800)}`)
  return r.stdout
}

/** GitHub and Render, played locally. A push lands in a folder; a deploy installs, builds, migrates and starts it. */
function stage(work: string) {
  const repos = new Map<string, { dir: string; commit: string }>()
  const services = new Map<string, { id: string; name: string; repo: string; url: string; port: number; env: Record<string, string>; proc?: ChildProcess; deploys: number; commands: number }>()
  const calls: string[] = []
  const databases = new Map<string, { id: string; name: string; dbName: string; url: string; polls: number; body: any }>()

  const deployErrors: string[] = []
  const queue = new Map<string, Promise<void>>()
  /** Render runs one deploy of a service at a time; so does this. */
  const deploy = (id: string) => {
    const next = (queue.get(id) ?? Promise.resolve()).then(() => deployNow(id)).catch((e) => { deployErrors.push(String(e?.message || e)) })
    queue.set(id, next)
    return next
  }
  async function deployNow(id: string) {
    const svc = services.get(id)
    if (!svc) return
    const repo = repos.get(svc.repo.toLowerCase())!
    // What Render does: a fresh checkout of the commit, the build command, then the start command.
    const checkout = path.join(work, `${svc.name}-deploy-${++svc.deploys}`)
    fs.cpSync(repo.dir, checkout, { recursive: true, filter: (s) => !s.includes(`${path.sep}.git`) })
    sh('bun', ['install', '--frozen-lockfile'], checkout)
    const app = path.join(checkout, 'apps', 'unified')
    sh('bun', ['run', 'build:web'], app)
    const env = { ...svc.env, PORT: String(svc.port), RENDER_GIT_COMMIT: repo.commit }
    sh('bun', ['server/db/migrate.ts'], app, env)
    // The old instance stops only now, right before the new one takes the port.
    if (svc.proc) {
      const old = svc.proc
      await new Promise<void>((r) => { old.once('exit', () => r()); old.kill(); setTimeout(r, 5000) })
    }
    svc.proc = spawn('bun', ['server/index.ts'], { cwd: app, env: { ...process.env, ...env }, stdio: 'ignore' })
  }

  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  const fetchImpl = async (url: string, init: RequestInit = {}): Promise<Response> => {
    const method = (init.method || 'GET').toUpperCase()
    const u = new URL(url)
    const body = init.body ? JSON.parse(String(init.body)) : null
    if (u.host === 'api.github.com') {
      calls.push(`github ${method} ${u.pathname}`)
      let m = u.pathname.match(/^\/repos\/([^/]+\/[^/]+)$/)
      if (m && method === 'GET') return repos.has(m[1].toLowerCase()) ? json({ full_name: m[1] }) : json({ message: 'Not Found' }, 404)
      if (m && method === 'DELETE') { repos.delete(m[1].toLowerCase()); return new Response(null, { status: 204 }) }
      m = u.pathname.match(/^\/orgs\/([^/]+)\/repos$/)
      if (m && method === 'POST') {
        const full = `${m[1]}/${body.name}`
        if (repos.has(full.toLowerCase())) return json({ message: 'name already exists' }, 422)
        repos.set(full.toLowerCase(), { dir: '', commit: '' })
        return json({ full_name: full }, 201)
      }
    }
    if (u.host === 'api.render.com') {
      calls.push(`render ${method} ${u.pathname}`)
      const p = u.pathname.replace(/^\/v1/, '')
      if (p === '/services' && method === 'GET') {
        const name = u.searchParams.get('name')
        return json([...services.values()].filter((s) => s.name === name).map((s) => ({ service: { id: s.id, name: s.name, repo: 'https://github.com/' + s.repo, serviceDetails: { url: s.url } }, cursor: 'c' })))
      }
      if (p === '/services' && method === 'POST') {
        const id = 'srv-' + Math.random().toString(36).slice(2, 10)
        const port = await freePort()
        const svc = { id, name: body.name, repo: body.repo.replace('https://github.com/', ''), url: `http://127.0.0.1:${port}`, port, env: Object.fromEntries(body.envVars.map((v: any) => [v.key, v.value])), deploys: 0, commands: 0 }
        services.set(id, svc)
        void deploy(id)
        return json({ service: { id, name: svc.name, serviceDetails: { url: svc.url } } }, 201)
      }
      let m = p.match(/^\/services\/([^/]+)$/)
      if (m && method === 'GET') { const s = services.get(m[1]); return s ? json({ id: s.id, name: s.name, repo: 'https://github.com/' + s.repo }) : json({}, 404) }
      if (m && method === 'PATCH') { services.get(m[1])!.commands++; return json({}) }
      if (m && method === 'DELETE') { const s = services.get(m[1]); s?.proc?.kill(); services.delete(m[1]); return new Response(null, { status: 204 }) }
      m = p.match(/^\/services\/([^/]+)\/env-vars$/)
      if (m) return json(Object.entries(services.get(m[1])!.env).map(([key, value]) => ({ envVar: { key, value } })))
      m = p.match(/^\/services\/([^/]+)\/env-vars\/([^/]+)$/)
      if (m && method === 'PUT') { services.get(m[1])!.env[decodeURIComponent(m[2])] = body.value; return json({}) }
      m = p.match(/^\/services\/([^/]+)\/deploys$/)
      if (m && method === 'POST') { void deploy(m[1]); return json({}, 201) }
      if (p === '/postgres' && method === 'GET') {
        const name = u.searchParams.get('name')
        return json([...databases.values()].filter((d) => d.name === name).map((d) => ({ postgres: { id: d.id, name: d.name, status: 'available' }, cursor: 'c' })))
      }
      if (p === '/postgres' && method === 'POST') {
        // A server of its own: here, a database and login no other tenant has.
        const id = 'dpg-' + Math.random().toString(36).slice(2, 10)
        const dbName = body.databaseName, pw = 'pw' + Math.random().toString(36).slice(2, 12)
        await run(SUPER!, `CREATE ROLE "${body.databaseUser}" LOGIN PASSWORD '${pw}'`)
        await run(SUPER!, `CREATE DATABASE "${dbName}" OWNER "${body.databaseUser}"`)
        await run(SUPER!, `REVOKE ALL ON DATABASE "${dbName}" FROM PUBLIC`)
        const url = new URL(SUPER!); url.username = body.databaseUser; url.password = pw; url.pathname = '/' + dbName
        databases.set(id, { id, name: body.name, dbName, url: url.toString(), polls: 0, body })
        return json({ id, name: body.name, status: 'creating' }, 201)
      }
      m = p.match(/^\/postgres\/([^/]+)$/)
      if (m && method === 'GET') {
        const d = databases.get(m[1]); if (!d) return json({}, 404)
        // Not ready on the first look, as a new Render database is not.
        return json({ id: d.id, name: d.name, status: d.polls++ < 1 ? 'creating' : 'available' })
      }
      if (m && method === 'DELETE') {
        const d = databases.get(m[1])
        if (d) {
          await run(SUPER!, `DROP DATABASE "${d.dbName}" WITH (FORCE)`)
          await run(SUPER!, `DROP ROLE "${d.body.databaseUser}"`)
          databases.delete(m[1])
        }
        return new Response(null, { status: 204 })
      }
      m = p.match(/^\/postgres\/([^/]+)\/connection-info$/)
      if (m) return json({ internalConnectionString: databases.get(m[1])!.url })
    }
    if (u.hostname === '127.0.0.1') return fetch(url, init)
    throw new Error('the test stage has no answer for ' + method + ' ' + url)
  }

  const io: BuildIo = {
    hosts: createHosts({ renderApiKey: 'k', renderOwnerId: 'o', githubToken: 't', githubOrg: ORG, bunVersion: '1.3.14', dbPlan: 'basic_256mb', dbDiskGB: 1 }, fetchImpl as any),
    async push(fullName, dir) {
      const repo = repos.get(fullName.toLowerCase())
      if (!repo) throw new Error('push to a repo that does not exist: ' + fullName)
      const dest = path.join(work, 'repos', fullName.replace('/', '__'))
      fs.rmSync(dest, { recursive: true, force: true })
      fs.cpSync(dir, dest, { recursive: true })
      sh('git', ['init', '-q'], dest)
      sh('git', ['add', '-A'], dest)
      sh('git', ['-c', 'user.email=f@test', '-c', 'user.name=Factory', 'commit', '-q', '-m', 'build'], dest)
      repo.dir = dest
      repo.commit = sh('git', ['rev-parse', 'HEAD'], dest).trim()
      // autoDeploy: every service on this repo builds the push.
      for (const s of services.values()) if (s.repo.toLowerCase() === fullName.toLowerCase()) void deploy(s.id)
      return repo.commit
    },
    sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 2000))),
  }
  return { io, repos, services, databases, calls, deployErrors, stop: () => { for (const s of services.values()) s.proc?.kill() } }
}

const tenant = { id: 'tenant-e2e-1', slug: 'e2e-roofing' }
const PASSWORD = 'E2e-owner-pass-1'

if (!SUPER) {
  test.skip('UNIFIED_TEST_PG is not set: the build test needs a real Postgres (CI sets it)', () => {})
} else {
  let work: string
  let s: ReturnType<typeof stage>
  let owned: Owned
  let record: any
  let provision: any

  beforeAll(async () => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'unified-e2e-'))
    s = stage(work)
    for (const r of await run(SUPER, "SELECT datname FROM pg_database WHERE datname IN ('e2e_roofing', 'e2e_taken', 'e2e_squat')")) await run(SUPER, `DROP DATABASE "${r.datname}" WITH (FORCE)`)
    for (const r of await run(SUPER, "SELECT rolname FROM pg_roles WHERE rolname IN ('e2e_roofing', 'e2e_taken', 'e2e_squat')")) await run(SUPER, `DROP ROLE "${r.rolname}"`)
    provision = {
      company: { name: 'E2E Roofing', slug: tenant.slug, email: 'twomiah14@gmail.com', city: 'Eau Claire', state: 'WI' },
      owner: { email: 'twomiah14@gmail.com', passwordHash: await Bun.password.hash(PASSWORD, 'bcrypt'), firstName: 'Test', lastName: 'Owner' },
      features: ['contacts', 'jobs', 'quotes', 'invoices'],
      industry: 'Roofing',
      site: { tagline: 'Roofs, end to end', pages: [{ slug: 'home', title: 'Home', sections: [{ type: 'hero', variant: 'split', data: { title: 'Built by the Factory' } }] }] },
    }
  })

  afterAll(async () => {
    s?.stop()
    if (work) fs.rmSync(work, { recursive: true, force: true })
  })

  describe('a test signup, built by the Factory', () => {
    test('built: database, repo, service, live on the pushed commit, and provisioned', async () => {
      const r = await buildUnifiedTenant({
        tenant, vertical: 'contractor', provision, factoryUrl: 'http://factory.test', owned: { repos: new Set(), serviceIds: new Set(), databaseIds: new Set() },
        root: ROOT, version: engineVersion(ROOT), waitMs: 10 * 60_000,
      }, s.io)
      if (!r.success) console.log(r.steps)
      expect(r.success).toBe(true)
      expect(r.steps.map((x) => x.step)).toEqual(['preflight', 'database', 'repo', 'push', 'service', 'live', 'provision'])
      record = r.record
      expect(record.repo).toBe(`${ORG}/e2e-roofing-app`)
      // Its own database server, closed to every outside address.
      const db = s.databases.get(record.databaseId)!
      expect(db).toMatchObject({ name: 'e2e-roofing-app-db', dbName: 'e2e_roofing' })
      expect(db.body).toMatchObject({ plan: 'basic_256mb', version: '16', ipAllowList: [] })
      owned = { repos: new Set([record.repo.toLowerCase()]), serviceIds: new Set([record.serviceId]), databaseIds: new Set([record.databaseId]) }
    }, 900_000)

    test('the owner signs in, and the website is the business\'s', async () => {
      const login = await fetch(record.serviceUrl + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'twomiah14@gmail.com', password: PASSWORD }) })
      expect(login.status).toBe(200)
      const home = await (await fetch(record.serviceUrl + '/')).text()
      expect(home).toContain('Built by the Factory')
      expect(home).toContain('E2E Roofing')
      const health = await (await fetch(record.serviceUrl + '/health')).json()
      expect(health).toMatchObject({ commit: record.commit, version: engineVersion(ROOT) })
    })

    test('the service holds the settings the build owns, and none of the business\'s facts are in the repo', () => {
      const svc = s.services.get(record.serviceId)!
      expect(svc.env).toMatchObject({ VERTICAL: 'contractor', TENANT_ID: tenant.id, NODE_ENV: 'production', FRONTEND_URL: record.serviceUrl })
      expect(svc.env.DATABASE_URL).toBe(s.databases.get(record.databaseId)!.url)
      const repoDir = s.repos.get(record.repo.toLowerCase())!.dir
      // Only this signup's facts: the business's name and the owner's password hash (the seed wrote the hash into code).
      const grep = spawnSync('git', ['grep', '-l', '-F', '-e', 'E2E Roofing', '-e', provision.owner.passwordHash], { cwd: repoDir, encoding: 'utf8' })
      expect(grep.stdout.trim()).toBe('')
    })

    test('built again: the same database server, the same secrets, and nothing provisioned twice', async () => {
      const before = { ...s.services.get(record.serviceId)!.env }
      const r = await buildUnifiedTenant({
        tenant, vertical: 'contractor', provision, factoryUrl: 'http://factory.test', owned,
        root: ROOT, version: engineVersion(ROOT), waitMs: 10 * 60_000,
      }, s.io)
      if (!r.success) console.log(r.steps)
      expect(r.success).toBe(true)
      expect(r.steps.find((x) => x.step === 'database')!.detail).toBe("e2e-roofing-app-db (the tenant's own)")
      expect(s.databases.size).toBe(1)
      expect(r.steps.find((x) => x.step === 'provision')!.detail).toContain('Already provisioned')
      const after = s.services.get(record.serviceId)!.env
      for (const k of ['JWT_SECRET', 'JWT_REFRESH_SECRET', 'ENCRYPTION_KEY', 'FACTORY_SYNC_KEY', 'DATABASE_URL']) expect(after[k]).toBe(before[k])
      expect(r.record!.serviceId).toBe(record.serviceId)
      expect(r.record!.databaseId).toBe(record.databaseId)
      record = r.record
    }, 900_000)

    test('Update Code: a new version, pushed, and live on its commit', async () => {
      const r = await updateUnifiedTenant(
        { tenantId: tenant.id, slug: tenant.slug, repo: record.repo, serviceId: record.serviceId, serviceUrl: record.serviceUrl },
        owned, { root: ROOT, version: 'abcdef0123456789abcdef0123456789abcdef01', waitMs: 10 * 60_000 }, s.io,
      )
      if (!r.success) console.log(r.steps, s.deployErrors)
      expect(r.success).toBe(true)
      expect(s.deployErrors).toEqual([])
      const health = await (await fetch(record.serviceUrl + '/health')).json()
      expect(health).toMatchObject({ commit: r.commit, version: 'abcdef0123456789abcdef0123456789abcdef01' })
      const login = await fetch(record.serviceUrl + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'twomiah14@gmail.com', password: PASSWORD }) })
      expect(login.status).toBe(200)
    }, 900_000)

    test('a repo with the name that is not the tenant\'s stops the build before anything is made', async () => {
      await s.io.hosts.createRepo('e2e-taken-app', 'someone else')
      const before = s.calls.length
      const r = await buildUnifiedTenant({
        tenant: { id: 'tenant-e2e-2', slug: 'e2e-taken' }, vertical: 'contractor', provision, factoryUrl: 'http://factory.test',
        owned: { repos: new Set(), serviceIds: new Set(), databaseIds: new Set() }, root: ROOT, version: engineVersion(ROOT),
      }, s.io)
      expect(r.success).toBe(false)
      expect(r.errors[0]).toMatch(/GitHub repo twomiah-test\/e2e-taken-app exists and is not this tenant's — nothing was changed/)
      expect(s.calls.slice(before).every((c) => / GET /.test(c))).toBe(true)
      expect([...s.databases.values()].some((d) => d.name === 'e2e-taken-app-db')).toBe(false)
    })

    test('…and so does a database server with the name that is not the tenant\'s', async () => {
      await s.io.hosts.createDatabase({ name: 'e2e-squat-app-db', database: 'e2e_squat' })
      const before = s.calls.length
      const r = await buildUnifiedTenant({
        tenant: { id: 'tenant-e2e-3', slug: 'e2e-squat' }, vertical: 'contractor', provision, factoryUrl: 'http://factory.test',
        owned: { repos: new Set(), serviceIds: new Set(), databaseIds: new Set() }, root: ROOT, version: engineVersion(ROOT),
      }, s.io)
      expect(r.success).toBe(false)
      expect(r.errors[0]).toMatch(/Render database e2e-squat-app-db exists and is not this tenant's — nothing was changed/)
      expect(s.calls.slice(before).every((c) => / GET /.test(c))).toBe(true)
    })

    test('Update Code refuses a service that is not recorded as the tenant\'s', async () => {
      const r = await updateUnifiedTenant(
        { tenantId: tenant.id, slug: tenant.slug, repo: record.repo, serviceId: record.serviceId, serviceUrl: record.serviceUrl },
        { ...owned, serviceIds: new Set() }, { root: ROOT, version: engineVersion(ROOT) }, s.io,
      )
      expect(r.success).toBe(false)
      expect(r.errors[0]).toMatch(/not recorded as this tenant's/)
    })

    test('torn down: its service, repo and database server go; another\'s database server is left', async () => {
      const squat = [...s.databases.values()].find((d) => d.name === 'e2e-squat-app-db')!
      const r = await teardownUnifiedTenant({ tenantId: tenant.id, repo: record.repo, serviceId: record.serviceId, databaseId: record.databaseId }, owned, s.io)
      expect(r.errors).toEqual([])
      expect(r.removed).toEqual([`service ${record.serviceId}`, `repo ${record.repo}`, `database ${record.databaseId}`])
      expect((await run(SUPER, "SELECT 1 FROM pg_database WHERE datname = 'e2e_roofing'")).length).toBe(0)
      const refused = await teardownUnifiedTenant({ tenantId: tenant.id, databaseId: squat.id }, owned, s.io)
      expect(refused.left).toEqual([`database ${squat.id}: not recorded as this tenant's`])
      expect(s.databases.has(squat.id)).toBe(true)
      await s.io.hosts.deleteDatabase(squat.id)
    })
  })
}

describe('the settings the build owns', () => {
  test('secrets are made once and kept; integration settings never overwrite the tenant\'s own', () => {
    const first = tenantEnv({ tenantId: 't', vertical: 'bar', databaseUrl: 'postgres://a', serviceUrl: 'https://x', factoryUrl: 'https://f', integrationEnv: [{ key: 'STRIPE_SECRET_KEY', value: 'platform' }] }, {})
    const current = Object.fromEntries(first.set.map((v) => [v.key, v.value]))
    current.STRIPE_SECRET_KEY = 'the-tenants-own'
    const again = tenantEnv({ tenantId: 't', vertical: 'bar', databaseUrl: 'postgres://a', serviceUrl: 'https://x', factoryUrl: 'https://f', integrationEnv: [{ key: 'STRIPE_SECRET_KEY', value: 'platform' }] }, current)
    expect(again.set).toEqual([])
    expect(again.factorySyncKey).toBe(current.FACTORY_SYNC_KEY)
    const moved = tenantEnv({ tenantId: 't', vertical: 'bar', databaseUrl: 'postgres://b', serviceUrl: 'https://x', factoryUrl: 'https://f' }, current)
    expect(moved.set).toEqual([{ key: 'DATABASE_URL', value: 'postgres://b' }])
  })

  test('a business with its own domain keeps it as the site address through a rebuild', () => {
    const base = { tenantId: 't', vertical: 'crm', databaseUrl: 'postgres://a', serviceUrl: 'https://x.onrender.com', factoryUrl: 'https://f' }
    const fresh = tenantEnv(base, {})
    expect(fresh.set.find((v) => v.key === 'SITE_URL')?.value).toBe('https://x.onrender.com')
    // wired: the domain is the site address; the service's own addresses stay Render's
    const wired = Object.fromEntries(fresh.set.map((v) => [v.key, v.value]))
    wired.SITE_URL = 'https://acme.com'
    const rebuilt = tenantEnv({ ...base, domain: 'acme.com' }, wired)
    expect(rebuilt.set).toEqual([])
    // the old rule: a rebuild without the domain put the Render address back
    expect(tenantEnv(base, wired).set).toEqual([{ key: 'SITE_URL', value: 'https://x.onrender.com' }])
    expect(tenantEnv({ ...base, domain: 'acme.com' }, {}).set.find((v) => v.key === 'FRONTEND_URL')?.value).toBe('https://x.onrender.com')
  })
})
