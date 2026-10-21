// A live business's move to the unified app, stage by stage (apps/api/src/unified/move.ts), against stand-ins for the
// Factory DB, Render, R2 and the DNS hosts: what each stage reads, what it changes, what it refuses — and that the
// rollback puts back exactly what the switch changed.
import { test, expect, describe, beforeEach } from 'bun:test'
import { fakeStore } from './fakeStore'
import { inspectMove, prepareMove, runMoveJob, switchMove, rollbackMove, kindOfService, type MoveDeps } from '../../../apps/api/src/unified/move'
import type { NamecheapHost } from '../../../apps/api/src/services/registrar/namecheap'

const OLD_DB_URL = 'postgresql://acme_user:pw@dpg-old-a/acme_db'

function world(over: { tenant?: Record<string, unknown>; crmEnv?: Record<string, string>; oldDbRegion?: string; namecheap?: boolean } = {}) {
  const tenant = {
    id: 't1', slug: 'acme', name: 'Acme Remodeling', industry: 'remodeling', engine: 'templates', status: 'active', products: ['website', 'crm'], features: ['contacts', 'jobs'],
    domain: 'acme.example', cloudflare_zone_id: over.namecheap ? null : 'z1', domain_registrar: 'namecheap',
    render_backend_url: 'https://acme-api.onrender.com', render_frontend_url: 'https://acme-api.onrender.com', database_url: 'postgresql://stale@dpg-stale-a/x',
    website_url: 'https://acme-site.onrender.com', r2_bucket_name: 'acme-media', factory_sync_key: 'old-key', ...over.tenant,
  }
  const db = fakeStore({ tenants: [tenant], factory_jobs: [], tenant_moves: [] })
  const services: Record<string, any> = {
    'srv-crm': { id: 'srv-crm', name: 'acme-api', suspended: 'not_suspended', serviceDetails: { url: 'https://acme-api.onrender.com', region: 'ohio' } },
    'srv-site': { id: 'srv-site', name: 'acme-site', suspended: 'not_suspended', repo: 'https://github.com/org/acme', branch: 'main', rootDir: 'website', serviceDetails: { url: 'https://acme-site.onrender.com', region: 'ohio' } },
  }
  const env: Record<string, Record<string, string>> = {
    'srv-crm': { DATABASE_URL: OLD_DB_URL, ENCRYPTION_KEY: 'old-encryption-key', R2_BUCKET_NAME: 'acme-media', ...over.crmEnv },
    'srv-site': { JWT_SECRET: 'site-secret' },
  }
  const domains: Record<string, string[]> = { 'srv-crm': ['app.acme.example'], 'srv-site': ['acme.example', 'www.acme.example'] }
  const r2 = new Map<string, Uint8Array>()
  const cf = [
    { id: 'r-www', type: 'CNAME', name: 'www.acme.example', content: 'acme-site.onrender.com' },
    { id: 'r-app', type: 'CNAME', name: 'app.acme.example', content: 'acme-api.onrender.com' },
    { id: 'r-mx', type: 'MX', name: 'acme.example', content: 'route1.mx.cloudflare.net' },
  ]
  let nc: { emailType: string; usingOurDns: boolean; hosts: NamecheapHost[] } = {
    emailType: 'FWD', usingOurDns: true, hosts: [
      { name: '@', type: 'A', address: '216.24.57.1', mxPref: '10', ttl: '1800' },
      { name: 'www', type: 'CNAME', address: 'acme-site.onrender.com.', mxPref: '10', ttl: '1800' },
      { name: 'app', type: 'CNAME', address: 'acme-api.onrender.com.', mxPref: '10', ttl: '1800' },
      { name: '@', type: 'TXT', address: 'v=spf1 include:spf.efwd.registrar-servers.com ~all', mxPref: '10', ttl: '1800' },
    ],
  }
  const log: string[] = []
  const built: any[] = []
  /** What the move job does with what it is given (run.ts): the test sets it. */
  let jobRuns: (cmd: string) => { status: string; report: any } = () => ({ status: 'succeeded', report: { ok: true, mode: 'check' } })
  const jobs = new Map<string, { status: string }>()
  const sitePackages: any[] = []

  const hosts: any = {
    region: () => 'ohio',
    findService: async (name: string) => Object.values(services).find((s) => s.name === name) ?? null,
    getService: async (id: string) => { if (!services[id]) throw new Error('no service'); return services[id] },
    getEnv: async (id: string) => ({ ...(env[id] || {}) }),
    getDatabase: async (id: string) => (id === 'dpg-old-a' ? { id, region: over.oldDbRegion ?? 'ohio', status: 'available' } : null),
    customDomains: async (id: string) => (domains[id] || []).map((name) => ({ name, verified: true })),
    addCustomDomain: async (id: string, name: string) => { log.push(`add ${name} → ${id}`); (domains[id] ||= []).includes(name) || domains[id].push(name) },
    removeCustomDomain: async (id: string, name: string) => { log.push(`remove ${name} from ${id}`); domains[id] = (domains[id] || []).filter((n) => n !== name) },
    suspend: async (id: string) => { log.push('suspend ' + id); services[id].suspended = 'suspended' },
    resume: async (id: string) => { log.push('resume ' + id); services[id].suspended = 'not_suspended' },
    deleteEnv: async (id: string, key: string) => { log.push(`delete ${key} on ${id}`); delete env[id][key] },
    deploy: async (id: string) => { log.push('deploy ' + id) },
    getRepoFile: async () => null,
    startJob: async (id: string, cmd: string) => {
      log.push(`job on ${id}: ${cmd.replace(/[0-9a-f]{32}/g, '<random>').replace(/-\d{13}-/g, '-<t>-')}`)
      const siteKey = /MOVE_SITE_KEY=(\S+)/.exec(cmd)?.[1]
      if (siteKey) sitePackages.push(JSON.parse(new TextDecoder().decode(r2.get('acme-media/' + siteKey)!)))
      const r = jobRuns(cmd)
      r2.set('acme-media/' + /MOVE_REPORT_KEY=(\S+)/.exec(cmd)![1], new TextEncoder().encode(JSON.stringify(r.report)))
      jobs.set('job-1', { status: r.status })
      return 'job-1'
    },
    getJob: async (_: string, jobId: string) => ({ status: jobs.get(jobId)!.status, finishedAt: '2026-10-21T12:00:00Z' }),
    jobLog: async () => ['the job\'s last lines'],
  }
  const d: MoveDeps = {
    db, hosts, io: { hosts, push: async () => 'c0ffee', sleep: async () => {} } as any,
    build: (async (input: any) => {
      built.push(input)
      const serviceUrl = 'https://acme-app.onrender.com'
      services['srv-new'] = { id: 'srv-new', name: 'acme-app', suspended: 'not_suspended', serviceDetails: { url: serviceUrl, region: 'ohio' } }
      env['srv-new'] = { DATABASE_URL: 'postgresql://new@dpg-new-a/acme', FACTORY_SYNC_KEY: 'new-key', ...Object.fromEntries(input.integrationEnv(serviceUrl).map((v: any) => [v.key, v.value])), ENCRYPTION_KEY: input.carry?.ENCRYPTION_KEY ?? 'made' }
      return { success: true, steps: [{ step: 'provision', status: 'skipped', detail: 'moving in' }], errors: [], record: { repo: 'org/acme-app', serviceId: 'srv-new', serviceUrl, databaseId: 'dpg-new-a', databaseUrl: 'postgresql://new@dpg-new-a/acme', commit: 'c0ffee', version: 'abc1234', factorySyncKey: 'new-key' } }
    }) as any,
    root: process.cwd(), version: 'abc1234', factoryUrl: 'https://factory.example',
    owned: async () => ({ repos: new Set(), serviceIds: new Set(), databaseIds: new Set(), hosts: new Set() }),
    integrationEnv: async () => (url: string) => [{ key: 'STRIPE_SECRET_KEY', value: 'sk_platform' }, { key: 'API_URL', value: url }],
    r2: {
      configured: () => true, ensureBucket: async (slug) => ({ bucketName: slug + '-media' }),
      envVars: (bucket) => [{ key: 'R2_BUCKET_NAME', value: bucket }, { key: 'R2_ACCESS_KEY_ID', value: 'factory-r2' }],
      put: async (b, k, body) => { r2.set(b + '/' + k, body) },
      get: async (b, k) => r2.get(b + '/' + k) ?? null,
      remove: async (b, k) => { r2.delete(b + '/' + k) },
    },
    dns: {
      cloudflare: {
        list: async () => cf.map((r) => ({ ...r })),
        add: async (_z, rec) => { const id = 'r-' + rec.name + '-new'; cf.push({ id, type: rec.type, name: rec.name + '.acme.example', content: rec.content }); return { id } },
        update: async (_z, id, content) => { log.push(`cf ${id} → ${content}`); cf.find((r) => r.id === id)!.content = content },
        remove: async (_z, id) => { cf.splice(cf.findIndex((r) => r.id === id), 1) },
      },
      namecheap: {
        get: async () => ({ ...nc, hosts: nc.hosts.map((h) => ({ ...h })) }),
        set: async (_d, emailType, hosts) => { log.push(`namecheap set ${emailType} ${hosts.length} records`); nc = { ...nc, emailType, hosts } },
      },
    },
    exportSite: async () => ({ tables: {}, notCarried: ['visitor counts'] }),
    buildSiteDb: () => new Uint8Array([1, 2, 3]),
    reconcileAliases: (t) => { log.push('aliases for ' + t.render_backend_url) },
    sleep: async () => {},
  }
  return { d, db, services, env, domains, r2, cf, nc: () => nc, log, built, sitePackages, setJob: (f: typeof jobRuns) => { jobRuns = f } }
}

test('the old CRM\'s template, by its service name — only the three the move knows', () => {
  expect(kindOfService('acme-api', 'acme')).toBe('crm')
  expect(kindOfService('acme-bar-api', 'acme')).toBe('crm-bar')
  expect(kindOfService('acme-care-api', 'acme')).toBe('homecare')
  expect(kindOfService('acme-roof-api', 'acme')).toBeNull()
})

describe('inspect', () => {
  test('reads the CRM the business RUNS on — its own database setting, not the stale tenant row — and names, never values', async () => {
    const w = world()
    const f = await inspectMove('t1', { site: 'fresh', oldSiteServiceId: 'srv-site' }, w.d)
    expect(f.problems).toEqual([])
    expect(f.kind).toBe('crm')
    expect(f.vertical).toBe('contractor')
    expect(f.oldDb).toEqual({ id: 'dpg-old-a', region: 'ohio', status: 'available' })
    expect(f.carried).toEqual(['ENCRYPTION_KEY', 'the storage bucket acme-media'])
    expect(f.dns).toEqual({ at: 'cloudflare', www: 'acme-site.onrender.com', app: 'acme-api.onrender.com' })
    expect(JSON.stringify(f)).not.toContain('old-encryption-key')
    expect(JSON.stringify(f)).not.toContain(':pw@')
  })

  test('refuses what the job could not do: a database in another region, a CRM it does not know, a domain name it would leave behind', async () => {
    const w = world({ oldDbRegion: 'oregon' })
    w.services['srv-crm'].name = 'acme-roof-api'
    w.domains['srv-site'].push('shop.acme.example')
    w.d.hosts.findService = async () => w.services['srv-crm']
    const f = await inspectMove('t1', { site: 'fresh', oldSiteServiceId: 'srv-site' }, w.d)
    expect(f.problems.join(' | ')).toContain('the old database is in oregon, the new service builds in ohio')
    expect(f.problems.join(' | ')).toContain('acme-roof-api is not one the move knows')
    expect(f.problems.join(' | ')).toContain('also answers shop.acme.example')
  })

  test('a business already on the unified app is not moved again', async () => {
    const f = await inspectMove('t1', { site: 'none' }, world({ tenant: { engine: 'unified' } }).d)
    expect(f.problems).toContain('the business already runs the unified app')
  })
})

describe('prepare', () => {
  test('builds without provisioning, with the old encryption key, the one bucket and the move\'s settings — recorded as a move, not a job', async () => {
    const w = world()
    const r = await prepareMove('t1', { site: 'fresh', oldSiteServiceId: 'srv-site' }, w.d)
    expect(r.success).toBe(true)
    const input = w.built[0]
    expect(input.provision).toBeNull()
    expect(input.carry).toEqual({ ENCRYPTION_KEY: 'old-encryption-key' })
    expect(input.vertical).toBe('contractor')
    const env = Object.fromEntries(input.integrationEnv('https://acme-app.onrender.com').map((v: any) => [v.key, v.value]))
    expect(env.MOVE_SOURCE_DATABASE_URL).toBe(OLD_DB_URL)
    expect(env.MOVE_KIND).toBe('crm')
    expect(env.R2_BUCKET_NAME).toBe('acme-media')
    expect(env.STRIPE_SECRET_KEY).toBe('sk_platform')
    expect(w.db.tables.factory_jobs).toEqual([])
    const [m] = w.db.tables.tenant_moves
    expect(m).toMatchObject({ status: 'ready', kind: 'crm', vertical: 'contractor', site: 'fresh', render_service_ids: { backend: 'srv-new', database: 'dpg-new-a' }, render_url: 'https://acme-app.onrender.com' })
    expect(m.old_resources).toMatchObject({ crmServiceId: 'srv-crm', siteServiceId: 'srv-site', databaseId: 'dpg-old-a', bucket: 'acme-media' })
    // The tenant row is untouched until the switch.
    expect(w.db.tables.tenants[0].render_backend_url).toBe('https://acme-api.onrender.com')
  })

  test('again, it builds the same move again — one move per business', async () => {
    const w = world()
    const a = await prepareMove('t1', { site: 'fresh', oldSiteServiceId: 'srv-site' }, w.d)
    const b = await prepareMove('t1', { site: 'fresh', oldSiteServiceId: 'srv-site' }, w.d)
    expect(b.moveId).toBe(a.moveId)
    expect(w.db.tables.tenant_moves.length).toBe(1)
  })

  test('with a problem, nothing is built', async () => {
    const w = world({ oldDbRegion: 'oregon' })
    const r = await prepareMove('t1', { site: 'fresh', oldSiteServiceId: 'srv-site' }, w.d)
    expect(r.success).toBe(false)
    expect(w.built).toEqual([])
  })
})

describe('the job', () => {
  async function ready() {
    const w = world()
    const { moveId } = await prepareMove('t1', { site: 'fresh', oldSiteServiceId: 'srv-site' }, w.d)
    return { w, moveId }
  }

  test('the rehearsal runs the job with the fresh site, reads its report, and leaves no package or report behind', async () => {
    const { w, moveId } = await ready()
    w.setJob(() => ({ status: 'succeeded', report: { ok: true, mode: 'check', tables: [{ table: 'contact', source: 3, moved: 3 }] } }))
    const r = await runMoveJob(moveId, 'check', w.d)
    expect(r.ok).toBe(true)
    expect(r.report.tables[0]).toEqual({ table: 'contact', source: 3, moved: 3 })
    expect(w.log).toContain(`job on srv-new: MOVE_MODE=check MOVE_SITE_KEY=moves/${moveId}/check-<t>-<random>-site.json MOVE_REPORT_KEY=moves/${moveId}/check-<t>-<random>-report.json bun server/move/run.ts`)
    expect(w.sitePackages[0].fresh.pages.length).toBeGreaterThan(0)
    expect([...w.r2.keys()]).toEqual([])
    expect(w.log.some((l) => l.startsWith('suspend'))).toBe(false)
    expect(w.db.tables.tenant_moves[0].status).toBe('rehearsed')
  })

  test("a fresh site carries the old site's enquiries — read from the site, its layout checked against the template", async () => {
    const { w, moveId } = await ready()
    const fs = await import('node:fs')
    const asked: string[] = []
    w.d.exportSite = async (o) => { asked.push(o.only ?? 'all'); return { tables: { settings: [{}], leads: [{ id: 'l1' }, { id: 'l2' }], users: [] }, notCarried: [] } }
    w.d.hosts.getRepoFile = async (_repo: string, file: string) => (file.startsWith('website/') ? fs.readFileSync('templates/website-premium-contractor/' + file.slice('website/'.length), 'utf8') : null)
    w.d.buildSiteDb = (dir) => { asked.push(dir.replace(/\\/g, '/').split('/').slice(-1)[0]); return new Uint8Array([7, 7]) }
    await runMoveJob(moveId, 'check', w.d)
    expect(asked).toEqual(['leads', 'website-premium-contractor'])
    expect(w.sitePackages[0].leadsFrom).toEqual({ siteDb: Buffer.from([7, 7]).toString('base64') })
    expect(w.sitePackages[0].fresh.pages.length).toBeGreaterThan(0)
  })

  test('an old site with no enquiries sends none, and its layout is not even read', async () => {
    const { w, moveId } = await ready()
    let read = 0
    w.d.exportSite = async () => ({ tables: { settings: [{}], leads: [], users: [] }, notCarried: [] })
    w.d.hosts.getRepoFile = async () => { read++; return null }
    await runMoveJob(moveId, 'check', w.d)
    expect(w.sitePackages[0].leadsFrom).toBeUndefined()
    expect(read).toBe(0)
  })

  test("enquiries in a site whose layout is not the template's: refused, not guessed at", async () => {
    const { w, moveId } = await ready()
    w.d.exportSite = async () => ({ tables: { settings: [{}], leads: [{ id: 'l1' }], users: [] }, notCarried: [] })
    const r = await runMoveJob(moveId, 'check', w.d)
    expect(r.ok).toBe(false)
    expect(r.report.error).toMatch(/db\/schema.ts is not website-premium-contractor's/)
    expect(w.db.tables.tenant_moves[0].status).toBe('ready')
  })

  test('the move needs a rehearsal first', async () => {
    const { w, moveId } = await ready()
    await expect(runMoveJob(moveId, 'move', w.d)).rejects.toThrow(/needs the move rehearsed; it is ready/)
  })

  test('the move suspends the old CRM BEFORE it copies; a failed one resumes it, and the move can be run again', async () => {
    const { w, moveId } = await ready()
    await runMoveJob(moveId, 'check', w.d)
    w.setJob(() => ({ status: 'failed', report: { ok: false, error: 'The move did not match: contact: 3 in the old, 2 in the new' } }))
    const r = await runMoveJob(moveId, 'move', w.d)
    expect(r.ok).toBe(false)
    expect(r.log).toEqual(['the job\'s last lines'])
    const order = w.log.filter((l) => /^(suspend|resume|job)/.test(l)).map((l) => l.split(':')[0])
    expect(order).toEqual(['job on srv-new', 'suspend srv-crm', 'job on srv-new', 'resume srv-crm'])
    expect(w.services['srv-crm'].suspended).toBe('not_suspended')
    expect(w.db.tables.tenant_moves[0].status).toBe('rehearsed')
    w.setJob(() => ({ status: 'succeeded', report: { ok: true, mode: 'move' } }))
    expect((await runMoveJob(moveId, 'move', w.d)).ok).toBe(true)
    expect(w.services['srv-crm'].suspended).toBe('suspended')
    expect(w.db.tables.tenant_moves[0].status).toBe('moved')
  })

  test('a job that leaves no report is a failure, with its log', async () => {
    const { w, moveId } = await ready()
    w.d.r2.get = async () => null
    const r = await runMoveJob(moveId, 'check', w.d)
    expect(r.ok).toBe(false)
    expect(r.report.error).toMatch(/left no report/)
    expect(w.db.tables.tenant_moves[0].status).toBe('ready')
  })
})

describe('switch and rollback', () => {
  async function moved(opts: Parameters<typeof world>[0] = {}) {
    const w = world(opts)
    const { moveId } = await prepareMove('t1', { site: 'fresh', oldSiteServiceId: 'srv-site' }, w.d)
    await runMoveJob(moveId, 'check', w.d)
    w.setJob(() => ({ status: 'succeeded', report: { ok: true, mode: 'move' } }))
    await runMoveJob(moveId, 'move', w.d)
    return { w, moveId }
  }

  test('the switch: every name onto the new service, www and app records in place, the tenant row and its job, the move\'s settings off', async () => {
    const { w, moveId } = await moved()
    const r = await switchMove(moveId, w.d)
    expect(r.ok).toBe(true)
    expect(w.domains['srv-new'].sort()).toEqual(['acme.example', 'app.acme.example', 'www.acme.example'])
    expect(w.domains['srv-crm']).toEqual([])
    expect(w.domains['srv-site']).toEqual([])
    // Updated in place (no moment without a record); the mail record untouched.
    expect(w.log).toContain('cf r-www → acme-app.onrender.com')
    expect(w.log).toContain('cf r-app → acme-app.onrender.com')
    expect(w.cf.find((r) => r.id === 'r-mx')!.content).toBe('route1.mx.cloudflare.net')
    expect(w.db.tables.tenants[0]).toMatchObject({ engine: 'unified', render_backend_url: 'https://acme-app.onrender.com', database_url: 'postgresql://new@dpg-new-a/acme', factory_sync_key: 'new-key', website_url: 'https://acme.example', r2_bucket_name: 'acme-media' })
    expect(w.db.tables.factory_jobs).toHaveLength(1)
    expect(w.db.tables.factory_jobs[0]).toMatchObject({ template: 'unified', status: 'complete', render_url: 'https://acme-app.onrender.com', render_service_ids: { backend: 'srv-new', database: 'dpg-new-a' } })
    expect(w.env['srv-new'].MOVE_SOURCE_DATABASE_URL).toBeUndefined()
    expect(w.log).toContain('deploy srv-new')
    expect(w.services['srv-site'].suspended).toBe('suspended')
    expect(w.services['srv-crm'].suspended).toBe('suspended')
    expect(w.log).toContain('aliases for https://acme-app.onrender.com')
    expect(w.db.tables.tenant_moves[0].status).toBe('switched')
  })

  test('on Namecheap: the whole record set written back with the same mail setting — only www and app changed', async () => {
    const { w, moveId } = await moved({ namecheap: true })
    await switchMove(moveId, w.d)
    expect(w.nc().emailType).toBe('FWD')
    expect(w.nc().hosts).toEqual([
      { name: '@', type: 'A', address: '216.24.57.1', mxPref: '10', ttl: '1800' },
      { name: 'www', type: 'CNAME', address: 'acme-app.onrender.com.', mxPref: '10', ttl: '1800' },
      { name: 'app', type: 'CNAME', address: 'acme-app.onrender.com.', mxPref: '10', ttl: '1800' },
      { name: '@', type: 'TXT', address: 'v=spf1 include:spf.efwd.registrar-servers.com ~all', mxPref: '10', ttl: '1800' },
    ])
  })

  test('the switch needs the move done', async () => {
    const w = world()
    const { moveId } = await prepareMove('t1', { site: 'fresh', oldSiteServiceId: 'srv-site' }, w.d)
    await expect(switchMove(moveId, w.d)).rejects.toThrow(/needs the move moved; it is ready/)
  })

  test('the rollback puts back exactly what the switch changed, and the old services answer again', async () => {
    const { w, moveId } = await moved()
    const tenantBefore = { ...w.db.tables.tenants[0] }
    await switchMove(moveId, w.d)
    const r = await rollbackMove(moveId, w.d)
    expect(r.ok).toBe(true)
    expect(w.domains['srv-new']).toEqual([])
    expect(w.domains['srv-crm']).toEqual(['app.acme.example'])
    expect(w.domains['srv-site'].sort()).toEqual(['acme.example', 'www.acme.example'])
    expect(w.cf.find((r) => r.id === 'r-www')!.content).toBe('acme-site.onrender.com')
    expect(w.cf.find((r) => r.id === 'r-app')!.content).toBe('acme-api.onrender.com')
    expect(w.db.tables.tenants[0]).toEqual(tenantBefore)
    expect(w.db.tables.factory_jobs).toEqual([])
    expect(w.services['srv-crm'].suspended).toBe('not_suspended')
    expect(w.services['srv-site'].suspended).toBe('not_suspended')
    expect(w.db.tables.tenant_moves[0].status).toBe('rolled_back')
  })

  test('on Namecheap the rollback restores the records too', async () => {
    const { w, moveId } = await moved({ namecheap: true })
    const before = w.nc().hosts.map((h) => ({ ...h }))
    await switchMove(moveId, w.d)
    await rollbackMove(moveId, w.d)
    expect(w.nc().hosts).toEqual(before)
    expect(w.nc().emailType).toBe('FWD')
  })
})
