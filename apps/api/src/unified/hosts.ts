/**
 * The two hosts a unified tenant lives on: its GitHub repo and its Render web service. Every call goes through the
 * `fetch` it is given, so the build can be run against fakes (tests/unified/factory/build.test.ts).
 *
 * Lookups follow services/deploy.ts's rule: a lookup that cannot get an answer THROWS — "could not tell" is never
 * "nothing there".
 */
export type Fetch = (url: string, init?: RequestInit) => Promise<Response>
export type EnvVar = { key: string; value: string }

const RENDER_API = 'https://api.render.com/v1'
const GITHUB_API = 'https://api.github.com'
const TIMEOUT = 30_000

export interface HostConfig {
  renderApiKey: string
  renderOwnerId: string
  githubToken: string
  githubOrg: string
  region?: string
  /** The service's plan (Render 'starter' unless the Factory says otherwise). */
  plan?: string
  /** The Bun the service builds and runs with: the version the checks ran on (.github/workflows/unified.yml). */
  bunVersion: string
  /** Each tenant's own Postgres server: its plan and starting disk (the Factory's, as for the template tenants). */
  dbPlan: string
  dbDiskGB: number
}

export function hostConfigFromEnv(env = process.env): HostConfig {
  const missing = ['RENDER_API_KEY', 'RENDER_OWNER_ID', 'GITHUB_TOKEN', 'GITHUB_ORG'].filter((k) => !env[k])
  if (missing.length) throw new Error('not configured: ' + missing.join(', '))
  return {
    renderApiKey: env.RENDER_API_KEY!, renderOwnerId: env.RENDER_OWNER_ID!, githubToken: env.GITHUB_TOKEN!, githubOrg: env.GITHUB_ORG!,
    region: env.UNIFIED_REGION || 'ohio', plan: env.UNIFIED_SERVICE_PLAN || 'starter', bunVersion: env.UNIFIED_BUN_VERSION || '1.3.14',
    // What services/deploy.ts gives every template tenant today (createRenderDatabase).
    dbPlan: env.UNIFIED_DB_PLAN || 'basic_256mb', dbDiskGB: Number(env.UNIFIED_DB_DISK_GB) || 1,
  }
}

/** The service's commands. rootDir is apps/unified; the workspace root (and its lockfile) is two levels up. */
export function serviceCommands(bunVersion: string) {
  const bun = `curl -fsSL https://bun.sh/install | bash -s "bun-v${bunVersion}" && export PATH=$HOME/.bun/bin:$PATH`
  return {
    build: `${bun} && cd ../.. && bun install --frozen-lockfile && cd apps/unified && bun run build:web`,
    // Migrations first; a failed one stops the boot (server/db/migrate.ts), so a bad deploy never serves.
    start: 'export PATH=$HOME/.bun/bin:$PATH && bun run start',
  }
}

export function createHosts(cfg: HostConfig, fetchImpl: Fetch) {
  const call = (url: string, init: RequestInit = {}) => fetchImpl(url, { ...init, signal: init.signal ?? AbortSignal.timeout(TIMEOUT) })
  const render = (p: string, init: RequestInit = {}) => call(RENDER_API + p, {
    ...init, headers: { Authorization: 'Bearer ' + cfg.renderApiKey, Accept: 'application/json', 'Content-Type': 'application/json', ...(init.headers || {}) },
  })
  const github = (p: string, init: RequestInit = {}) => call(GITHUB_API + p, {
    ...init, headers: { Authorization: 'token ' + cfg.githubToken, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', ...(init.headers || {}) },
  })
  const fail = async (what: string, res: Response): Promise<never> => {
    const body = await res.text().catch(() => '')
    throw new Error(`${what}: ${res.status} ${body.slice(0, 300)}`)
  }

  return {
    repoFullName: (name: string) => cfg.githubOrg + '/' + name,
    /** The region every tenant service and database server is built in. */
    region: () => cfg.region || 'ohio',

    /** The repo, or null when GitHub says there is none. */
    async getRepo(fullName: string): Promise<any | null> {
      const res = await github('/repos/' + fullName)
      if (res.status === 404) return null
      if (!res.ok) return fail('GitHub repo lookup for ' + fullName, res)
      return res.json()
    },

    /** A new private repo in the org. A name that turns out to be taken is an error, never "use that one". */
    /** A file's text on a repo's branch, or null when it has none. */
    async getRepoFile(fullName: string, filePath: string, ref = 'main'): Promise<string | null> {
      const res = await github('/repos/' + fullName + '/contents/' + filePath.split('/').map(encodeURIComponent).join('/') + '?ref=' + encodeURIComponent(ref), { headers: { Accept: 'application/vnd.github.raw' } })
      if (res.status === 404) return null
      if (!res.ok) return fail('GitHub file ' + fullName + '/' + filePath, res)
      return res.text()
    },

    async createRepo(name: string, description: string): Promise<{ fullName: string }> {
      const request = JSON.stringify({ name, description, private: true })
      let res = await github('/orgs/' + cfg.githubOrg + '/repos', { method: 'POST', body: request })
      // GITHUB_ORG may be a personal account (Twomiah's is): GitHub answers 404 for /orgs/<a user>, and the repo is made
      // under the account the token belongs to, as services/deploy.ts createGitHubRepo does. Only on 404 — a taken name
      // or a refused token is still an error, never "try the other place".
      if (res.status === 404) res = await github('/user/repos', { method: 'POST', body: request })
      if (!res.ok) return fail('GitHub repo creation for ' + name, res)
      const body: any = await res.json()
      return { fullName: body.full_name }
    },

    async deleteRepo(fullName: string): Promise<boolean> {
      const res = await github('/repos/' + fullName, { method: 'DELETE' })
      if (res.status === 404 || res.status === 204) return true
      return fail('GitHub repo delete for ' + fullName, res)
    },

    /** The web service with exactly this name, or null. Pages through Render's list; ?name= only narrows it. */
    async findService(name: string): Promise<any | null> {
      let cursor = ''
      for (let page = 0; page < 50; page++) {
        const res = await render('/services?name=' + encodeURIComponent(name) + '&limit=100' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''))
        if (!res.ok) return fail('Render service lookup for ' + name, res)
        const list = await res.json() as any[]
        if (!Array.isArray(list)) throw new Error('Render service lookup for ' + name + ' answered no list')
        for (const item of list) { const svc = item.service || item; if (svc?.name === name) return svc }
        cursor = list[list.length - 1]?.cursor || ''
        if (!cursor || list.length < 100) return null
      }
      throw new Error('Render service lookup for ' + name + ' did not end')
    },

    async getService(id: string): Promise<any> {
      const res = await render('/services/' + id)
      if (!res.ok) return fail('Render service ' + id, res)
      const body: any = await res.json()
      return body.service || body
    },

    async createService(input: { name: string; repoFullName: string; envVars: EnvVar[] }): Promise<{ id: string; url: string }> {
      const cmd = serviceCommands(cfg.bunVersion)
      const res = await render('/services', {
        method: 'POST',
        body: JSON.stringify({
          type: 'web_service', name: input.name, ownerId: cfg.renderOwnerId,
          repo: 'https://github.com/' + input.repoFullName, branch: 'main', autoDeploy: 'yes', rootDir: 'apps/unified',
          serviceDetails: {
            runtime: 'node', plan: cfg.plan || 'starter', region: cfg.region || 'ohio', numInstances: 1,
            rootDir: 'apps/unified', healthCheckPath: '/health',
            envSpecificDetails: { buildCommand: cmd.build, startCommand: cmd.start },
          },
          envVars: input.envVars,
        }),
      })
      if (!res.ok) return fail('Render service creation for ' + input.name, res)
      const body: any = await res.json()
      const svc = body.service || body
      return { id: svc.id, url: svc.serviceDetails?.url || 'https://' + input.name + '.onrender.com' }
    },

    /** Brings an existing service's commands to this build's (Render freezes them at creation otherwise). */
    async updateServiceCommands(id: string): Promise<void> {
      const cmd = serviceCommands(cfg.bunVersion)
      const res = await render('/services/' + id, {
        method: 'PATCH',
        body: JSON.stringify({ rootDir: 'apps/unified', serviceDetails: { healthCheckPath: '/health', envSpecificDetails: { buildCommand: cmd.build, startCommand: cmd.start } } }),
      })
      if (!res.ok) await fail('Render service update for ' + id, res)
    },

    async getEnv(id: string): Promise<Record<string, string>> {
      const out: Record<string, string> = {}
      let cursor = ''
      for (let page = 0; page < 20; page++) {
        const res = await render('/services/' + id + '/env-vars?limit=100' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''))
        if (!res.ok) return fail('Render env lookup for ' + id, res)
        const list = await res.json() as any[]
        for (const item of list) { const v = item.envVar || item; out[String(v.key)] = String(v.value ?? '') }
        cursor = list[list.length - 1]?.cursor || ''
        if (!cursor || list.length < 100) return out
      }
      throw new Error('Render env lookup for ' + id + ' did not end')
    },

    /** Sets each variable (adding or replacing it); the others stay. */
    async setEnv(id: string, vars: EnvVar[]): Promise<void> {
      for (const v of vars) {
        const res = await render('/services/' + id + '/env-vars/' + encodeURIComponent(v.key), { method: 'PUT', body: JSON.stringify({ value: v.value }) })
        if (!res.ok) await fail('Render env ' + v.key + ' on ' + id, res)
      }
    },

    /** Removes one setting (absent already: done). */
    async deleteEnv(id: string, key: string): Promise<void> {
      const res = await render('/services/' + id + '/env-vars/' + encodeURIComponent(key), { method: 'DELETE' })
      if (!res.ok && res.status !== 404) await fail('Render env delete ' + key + ' on ' + id, res)
    },

    /** A one-off job on the service: its last build, its settings, the command given. Returns the job's id. */
    async startJob(id: string, startCommand: string): Promise<string> {
      const res = await render('/services/' + id + '/jobs', { method: 'POST', body: JSON.stringify({ startCommand }) })
      if (!res.ok) await fail('Render job on ' + id, res)
      return String(((await res.json()) as any).id)
    },

    /** The job's status ('pending' | 'running' | 'succeeded' | 'failed' | 'canceled') and when it finished. */
    async getJob(id: string, jobId: string): Promise<{ status: string; finishedAt: string | null }> {
      const res = await render('/services/' + id + '/jobs/' + jobId)
      if (!res.ok) await fail('Render job ' + jobId, res)
      const j = (await res.json()) as any
      return { status: String(j.status || 'unknown'), finishedAt: j.finishedAt || null }
    },

    /** The job's last log lines, oldest first (what a job that never wrote its report said before it stopped). */
    async jobLog(jobId: string, limit = 60): Promise<string[]> {
      const res = await render('/logs?ownerId=' + encodeURIComponent(cfg.renderOwnerId) + '&resource=' + encodeURIComponent(jobId) + '&limit=' + limit + '&direction=backward')
      if (!res.ok) return []
      return (((await res.json()) as any).logs || []).map((l: any) => String(l.message ?? '')).reverse()
    },

    /** Stops the service answering (its instances stop; nothing is deleted). Resume brings it back as it was. */
    async suspend(id: string): Promise<void> {
      const res = await render('/services/' + id + '/suspend', { method: 'POST' })
      if (!res.ok) await fail('Render suspend ' + id, res)
    },
    async resume(id: string): Promise<void> {
      const res = await render('/services/' + id + '/resume', { method: 'POST' })
      if (!res.ok) await fail('Render resume ' + id, res)
    },

    /** The custom domains on a service, by name. */
    async customDomains(id: string): Promise<{ name: string; verified: boolean }[]> {
      const res = await render('/services/' + id + '/custom-domains?limit=100')
      if (!res.ok) await fail('Render custom domains of ' + id, res)
      return ((await res.json()) as any[]).map((x) => x.customDomain || x).map((d) => ({ name: String(d.name).toLowerCase(), verified: d.verificationStatus === 'verified' }))
    },
    async addCustomDomain(id: string, name: string): Promise<void> {
      const res = await render('/services/' + id + '/custom-domains', { method: 'POST', body: JSON.stringify({ name }) })
      if (!res.ok && res.status !== 409) await fail('Render add ' + name + ' to ' + id, res)
    },
    async removeCustomDomain(id: string, name: string): Promise<void> {
      const res = await render('/services/' + id + '/custom-domains/' + encodeURIComponent(name), { method: 'DELETE' })
      if (!res.ok && res.status !== 404) await fail('Render remove ' + name + ' from ' + id, res)
    },

    /** A deploy of the newest commit (a changed setting reaches the service only through a deploy). */
    async deploy(id: string): Promise<void> {
      const res = await render('/services/' + id + '/deploys', { method: 'POST', body: JSON.stringify({ clearCache: 'do_not_clear' }) })
      if (!res.ok) await fail('Render deploy for ' + id, res)
    },

    async deleteService(id: string): Promise<boolean> {
      const res = await render('/services/' + id, { method: 'DELETE' })
      if (res.status === 404 || res.status === 204 || res.ok) return true
      return fail('Render service delete for ' + id, res)
    },

    /** The Postgres with exactly this name, or null. */
    async findDatabase(name: string): Promise<any | null> {
      let cursor = ''
      for (let page = 0; page < 50; page++) {
        const res = await render('/postgres?name=' + encodeURIComponent(name) + '&limit=100' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''))
        if (!res.ok) return fail('Render database lookup for ' + name, res)
        const list = await res.json() as any[]
        if (!Array.isArray(list)) throw new Error('Render database lookup for ' + name + ' answered no list')
        for (const item of list) { const db = item.postgres || item; if (db?.name === name) return db }
        cursor = list[list.length - 1]?.cursor || ''
        if (!cursor || list.length < 100) return null
      }
      throw new Error('Render database lookup for ' + name + ' did not end')
    },

    async getDatabase(id: string): Promise<any> {
      const res = await render('/postgres/' + id)
      if (!res.ok) return fail('Render database ' + id, res)
      const body: any = await res.json()
      return body.postgres || body
    },

    /**
     * The tenant's own Postgres server, in the service's region (it is reached on Render's private network only).
     * No address may reach it from outside: the allow list is empty.
     */
    async createDatabase(input: { name: string; database: string }): Promise<{ id: string }> {
      const res = await render('/postgres', {
        method: 'POST',
        body: JSON.stringify({
          name: input.name, ownerId: cfg.renderOwnerId, plan: cfg.dbPlan, region: cfg.region || 'ohio', version: '16',
          databaseName: input.database, databaseUser: input.database, diskSizeGB: cfg.dbDiskGB, ipAllowList: [],
        }),
      })
      if (!res.ok) return fail('Render database creation for ' + input.name, res)
      const body: any = await res.json()
      return { id: (body.postgres || body).id }
    },

    /** The address the tenant's service uses: Render's internal one. */
    async databaseUrl(id: string): Promise<string> {
      const res = await render('/postgres/' + id + '/connection-info')
      if (!res.ok) return fail('Render database address for ' + id, res)
      const body: any = await res.json()
      const url = body.internalConnectionString
      if (!url) throw new Error('Render gave no internal address for database ' + id)
      return url
    },

    async deleteDatabase(id: string): Promise<boolean> {
      const res = await render('/postgres/' + id, { method: 'DELETE' })
      if (res.status === 404 || res.status === 204 || res.ok) return true
      return fail('Render database delete for ' + id, res)
    },

    /** The tenant's /health, or null while it does not answer. */
    async health(url: string): Promise<{ commit: string | null; version: string | null } | null> {
      try {
        const res = await call(url.replace(/\/$/, '') + '/health', { signal: AbortSignal.timeout(10_000) })
        if (!res.ok) return null
        const body: any = await res.json()
        return { commit: body.commit ?? null, version: body.version ?? null }
      } catch { return null }
    },

    /** The Factory's call into the tenant: POST with its key. */
    async callTenant(url: string, path: string, key: string, body: unknown): Promise<{ status: number; body: any }> {
      const res = await call(url.replace(/\/$/, '') + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Factory-Key': key }, body: JSON.stringify(body) })
      return { status: res.status, body: await res.json().catch(() => null) }
    },
  }
}
export type Hosts = ReturnType<typeof createHosts>
