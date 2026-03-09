/**
 * Twomiah Factory — Deploy Service
 * Ported from TwomiahBuild/backend/src/services/factory/deploy.js
 * 
 * Pipeline: Generate zip → Push to GitHub → Create Render DB → Create Render Services
 */

import crypto from 'crypto'
import { spawnSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import AdmZip from 'adm-zip'

const RENDER_API = 'https://api.render.com/v1'
const GITHUB_API = 'https://api.github.com'
const FETCH_TIMEOUT = 30_000 // 30s timeout for API calls

function fetchWithTimeout(url: string, options: RequestInit = {}, timeout = FETCH_TIMEOUT): Promise<Response> {
  return fetch(url, { ...options, signal: AbortSignal.timeout(timeout) })
}

function renderHeaders(): Record<string, string> {
  return {
    'Authorization': 'Bearer ' + process.env.RENDER_API_KEY,
    'Content-Type': 'application/json',
  }
}

function githubHeaders(): Record<string, string> {
  return {
    'Authorization': 'token ' + process.env.GITHUB_TOKEN,
    'Content-Type': 'application/json',
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }
}

export function isConfigured(): boolean {
  return !!(
    process.env.RENDER_API_KEY &&
    process.env.RENDER_OWNER_ID &&
    process.env.GITHUB_TOKEN &&
    process.env.GITHUB_ORG
  )
}

export function getMissingConfig(): string[] {
  const missing: string[] = []
  if (!process.env.RENDER_API_KEY) missing.push('RENDER_API_KEY')
  if (!process.env.RENDER_OWNER_ID) missing.push('RENDER_OWNER_ID')
  if (!process.env.GITHUB_TOKEN) missing.push('GITHUB_TOKEN')
  if (!process.env.GITHUB_ORG) missing.push('GITHUB_ORG')
  return missing
}


// ─── GitHub ───────────────────────────────────────────────────────────────────

async function deleteGitHubRepo(repoFullName: string) {
  try {
    const res = await fetchWithTimeout(GITHUB_API + '/repos/' + repoFullName, { method: 'DELETE', headers: githubHeaders() })
    if (res.status === 204) {
      console.log('[Deploy] Deleted existing repo', repoFullName)
      for (let i = 0; i < 10; i++) {
        await sleep(3000)
        const check = await fetchWithTimeout(GITHUB_API + '/repos/' + repoFullName, { headers: githubHeaders() })
        if (check.status === 404) { console.log('[Deploy] Repo deletion confirmed'); return }
      }
    }
  } catch (e: any) { console.warn('[Deploy] Could not delete repo:', e.message) }
}

async function createGitHubRepo(slug: string, description: string): Promise<{ full_name: string; clone_url: string }> {
  const org = process.env.GITHUB_ORG

  let res = await fetchWithTimeout(GITHUB_API + '/orgs/' + org + '/repos', {
    method: 'POST', headers: githubHeaders(),
    body: JSON.stringify({ name: slug, description, private: true, auto_init: true }),
  })

  if (!res.ok) {
    res = await fetchWithTimeout(GITHUB_API + '/user/repos', {
      method: 'POST', headers: githubHeaders(),
      body: JSON.stringify({ name: slug, description, private: true, auto_init: true }),
    })
  }

  if (!res.ok) {
    const err = await res.json() as any
    if (err.errors?.[0]?.message?.includes('already exists')) {
      return { full_name: org + '/' + slug, clone_url: 'https://github.com/' + org + '/' + slug + '.git' }
    }
    throw new Error('GitHub repo creation failed: ' + JSON.stringify(err))
  }

  return await res.json() as any
}

export async function pushToGitHub(repoFullName: string, extractDir: string) {
  const token = process.env.GITHUB_TOKEN

  // Use credential helper to avoid embedding the token in .git/config
  const cmds = [
    ['git', 'init'],
    ['git', 'checkout', '-b', 'main'],
    ['git', 'config', 'user.email', 'factory@twomiah.app'],
    ['git', 'config', 'user.name', 'Twomiah Factory'],
    ['git', 'config', 'credential.helper', ''],
    ['git', 'remote', 'add', 'origin', 'https://github.com/' + repoFullName + '.git'],
    ['git', 'add', '-A'],
    ['git', 'commit', '-m', 'Initial Twomiah Factory deployment'],
    ['git', 'push', 'origin', 'main', '--force'],
  ]

  for (const [cmd, ...args] of cmds) {
    const env = { ...process.env } as Record<string, string>
    // Pass credentials via GIT_ASKPASS so the token is never persisted in .git/config
    if (cmd === 'git' && args[0] === 'push') {
      env.GIT_ASKPASS = 'echo'
      env.GIT_TERMINAL_PROMPT = '0'
      // Use the header-based auth approach — no token in URL
      const extraHeader = 'Authorization: Basic ' + Buffer.from('x-access-token:' + token).toString('base64')
      args.unshift('-c', 'http.extraHeader=' + extraHeader)
    }
    const result = spawnSync(cmd, args, { cwd: extractDir, stdio: ['pipe', 'pipe', 'pipe'], env })
    if (result.status !== 0) {
      const stderr = result.stderr?.toString() || ''
      if (cmd === 'git' && args.includes('remote') && stderr.includes('already exists')) continue
      throw new Error('Git command failed: ' + cmd + ' ' + args.join(' ') + '\n' + stderr)
    }
  }

  return { success: true }
}

async function rollbackResources(resources: Array<{ type: 'repo' | 'service' | 'database'; id: string; name?: string }>) {
  for (const resource of resources.reverse()) {
    try {
      switch (resource.type) {
        case 'repo':
          console.log('[Deploy] Rollback: deleting GitHub repo', resource.id)
          await fetchWithTimeout(GITHUB_API + '/repos/' + resource.id, { method: 'DELETE', headers: githubHeaders() })
          break
        case 'service':
          console.log('[Deploy] Rollback: deleting Render service', resource.name || resource.id)
          await fetchWithTimeout(RENDER_API + '/services/' + resource.id, { method: 'DELETE', headers: renderHeaders() })
          break
        case 'database':
          console.log('[Deploy] Rollback: deleting Render database', resource.name || resource.id)
          await fetchWithTimeout(RENDER_API + '/postgres/' + resource.id, { method: 'DELETE', headers: renderHeaders() })
          break
      }
    } catch (e: any) {
      console.warn('[Deploy] Rollback failed for', resource.type, resource.id, ':', e.message)
    }
  }
}


// ─── Render ───────────────────────────────────────────────────────────────────

async function findAndDeleteRenderService(name: string): Promise<void> {
  try {
    // List services owned by us and find by name
    const res = await fetchWithTimeout(RENDER_API + '/services?type=web_service,static_site&limit=50', { headers: renderHeaders() })
    if (!res.ok) return
    const list = await res.json() as any[]
    for (const item of list) {
      const svc = item.service || item
      if (svc.name === name) {
        console.log('[Deploy] Deleting existing Render service:', name, svc.id)
        await fetchWithTimeout(RENDER_API + '/services/' + svc.id, { method: 'DELETE', headers: renderHeaders() })
        // Wait for deletion to propagate so the name is freed
        await sleep(5000)
        return
      }
    }
  } catch (e: any) {
    console.warn('[Deploy] Could not clean up existing service:', name, e.message)
  }
}

async function createRenderProject(name: string): Promise<string | null> {
  const res = await fetchWithTimeout(RENDER_API + '/projects', {
    method: 'POST', headers: renderHeaders(),
    body: JSON.stringify({ name, ownerId: process.env.RENDER_OWNER_ID }),
  })
  if (!res.ok) {
    console.log('[Deploy] Could not create Render project:', await res.text())
    return null
  }
  const data = await res.json() as any
  return data.id || data.project?.id || null
}

async function createRenderEnvironment(projectId: string, name = 'production'): Promise<string | null> {
  const res = await fetchWithTimeout(RENDER_API + '/environments', {
    method: 'POST', headers: renderHeaders(),
    body: JSON.stringify({ projectId, name }),
  })
  if (!res.ok) {
    console.log('[Deploy] Could not create Render environment:', await res.text())
    return null
  }
  const data = await res.json() as any
  return data.id || data.environment?.id || null
}

async function addResourcesToEnvironment(environmentId: string, resourceIds: string[]) {
  const resources = resourceIds.map(id => ({ id }))
  const res = await fetchWithTimeout(RENDER_API + '/environments/' + environmentId + '/resources', {
    method: 'POST', headers: renderHeaders(),
    body: JSON.stringify({ resources }),
  })
  if (!res.ok) {
    console.log('[Deploy] Could not add resources to environment:', await res.text())
  }
  return res.ok
}

async function findExistingDatabase(name: string): Promise<any> {
  const res = await fetchWithTimeout(RENDER_API + '/postgres?limit=20', { headers: renderHeaders() })
  if (!res.ok) return null
  const list = await res.json() as any[]
  const match = list.find((item: any) => (item.postgres || item).name === name)
  return match ? (match.postgres || match) : null
}

async function createRenderDatabase(slug: string, region = 'ohio', dbPlan = 'basic_256mb', projectId?: string | null): Promise<any> {
  const dbName = slug + '-db'
  const body: any = {
    databaseName: slug.replace(/-/g, '_'),
    databaseUser: slug.replace(/-/g, '_'),
    name: dbName,
    ownerId: process.env.RENDER_OWNER_ID,
    plan: dbPlan, region, version: '16',
  }
  if (projectId) body.projectId = projectId

  const res = await fetchWithTimeout(RENDER_API + '/postgres', {
    method: 'POST', headers: renderHeaders(),
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json() as any
    if (res.status === 400 || res.status === 409 || JSON.stringify(err).includes('already')) {
      const existing = await findExistingDatabase(dbName)
      if (existing) return existing
    }
    throw new Error('Render DB creation failed (' + res.status + '): ' + JSON.stringify(err))
  }
  return await res.json()
}

async function getDatabaseConnectionInfo(databaseId: string): Promise<any> {
  const res = await fetchWithTimeout(RENDER_API + '/postgres/' + databaseId + '/connection-info', { headers: renderHeaders() })
  if (!res.ok) throw new Error('Failed to get DB connection info')
  const data = await res.json() as any
  return {
    internalConnectionString: data.internalConnectionString || data.internal_connection_string || data.connectionString,
    externalConnectionString: data.externalConnectionString || data.external_connection_string,
    ...data,
  }
}

async function createRenderWebService(config: {
  name: string; repoFullName: string; rootDir?: string
  buildCommand?: string; preDeployCommand?: string; startCommand?: string; envVars?: Array<{ key: string; value: string }>
  plan?: string; region?: string; projectId?: string | null
}): Promise<any> {
  const envSpecificDetails: any = {
    buildCommand: config.buildCommand || 'bun install',
    startCommand: config.startCommand || 'bun start',
  }
  if (config.preDeployCommand) envSpecificDetails.preDeployCommand = config.preDeployCommand
  const body: any = {
    type: 'web_service', name: config.name,
    ownerId: process.env.RENDER_OWNER_ID,
    repo: 'https://github.com/' + config.repoFullName,
    autoDeploy: 'yes', branch: 'main', rootDir: config.rootDir || '',
    serviceDetails: {
      envSpecificDetails,
      plan: config.plan || 'starter', region: config.region || 'ohio', runtime: 'node', numInstances: 1,
    },
    envVars: (config.envVars || []).map(ev => ({ key: ev.key, value: ev.value })),
  }
  if (config.projectId) body.projectId = config.projectId
  const res = await fetchWithTimeout(RENDER_API + '/services', {
    method: 'POST', headers: renderHeaders(), body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json()
    throw new Error('Render service creation failed: ' + JSON.stringify(err))
  }
  return await res.json()
}

async function createRenderStaticSite(config: {
  name: string; repoFullName: string; rootDir?: string
  buildCommand?: string; publishPath?: string; envVars?: Array<{ key: string; value: string }>
  projectId?: string | null
}): Promise<any> {
  const body: any = {
    type: 'static_site', name: config.name,
    ownerId: process.env.RENDER_OWNER_ID,
    repo: 'https://github.com/' + config.repoFullName,
    autoDeploy: 'yes', branch: 'main', rootDir: config.rootDir || '',
    serviceDetails: {
      buildCommand: config.buildCommand || 'bun run build',
      publishPath: config.publishPath || 'dist',
      routes: [{ type: 'rewrite', source: '/*', destination: '/index.html' }],
    },
    envVars: (config.envVars || []).map(ev => ({ key: ev.key, value: ev.value })),
  }
  if (config.projectId) body.projectId = config.projectId
  const res = await fetchWithTimeout(RENDER_API + '/services', {
    method: 'POST', headers: renderHeaders(), body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json()
    throw new Error('Render static site creation failed: ' + JSON.stringify(err))
  }
  return await res.json()
}

async function updateRenderEnvVars(serviceId: string, envVars: Array<{ key: string; value: string }>) {
  // Fetch existing env vars first so we don't wipe them (PUT replaces all)
  const existing: Array<{ key: string; value: string }> = []
  try {
    const getRes = await fetchWithTimeout(RENDER_API + '/services/' + serviceId + '/env-vars', {
      method: 'GET', headers: renderHeaders(),
    })
    if (getRes.ok) {
      const data = await getRes.json()
      const items = Array.isArray(data) ? data : []
      for (const item of items) {
        const ev = item.envVar || item
        if (ev.key) existing.push({ key: ev.key, value: ev.value })
      }
    }
  } catch (e: any) {
    console.warn('[Deploy] Failed to fetch existing env vars:', e.message)
  }
  // Merge: new values override existing
  const updateKeys = new Set(envVars.map(ev => ev.key))
  const merged = [
    ...existing.filter(ev => !updateKeys.has(ev.key)),
    ...envVars,
  ]
  const res = await fetchWithTimeout(RENDER_API + '/services/' + serviceId + '/env-vars', {
    method: 'PUT', headers: renderHeaders(),
    body: JSON.stringify(merged.map(ev => ({ key: ev.key, value: ev.value }))),
  })
  return res.ok
}

function getServiceUrl(renderResponse: any): string {
  // Render API returns { service: { serviceDetails: { url }, slug, ... } }
  const svc = renderResponse?.service
  if (svc?.serviceDetails?.url) return svc.serviceDetails.url
  if (svc?.slug) return 'https://' + svc.slug + '.onrender.com'
  return ''
}

async function addStaticSiteHeaders(serviceId: string) {
  const headers = [
    { path: '/assets/*.css', name: 'Content-Type', value: 'text/css' },
    { path: '/assets/*.js', name: 'Content-Type', value: 'application/javascript' },
  ]
  for (const h of headers) {
    try {
      const res = await fetchWithTimeout(RENDER_API + '/services/' + serviceId + '/headers', {
        method: 'POST', headers: renderHeaders(),
        body: JSON.stringify(h),
      })
      if (!res.ok) console.warn('[Deploy] Failed to add header for', h.path, '- status:', res.status)
    } catch (e: any) {
      console.warn('[Deploy] Failed to add header for', h.path, '-', e.message)
    }
  }
}

async function getServiceDeploys(serviceId: string, limit = 5): Promise<any[]> {
  const res = await fetchWithTimeout(RENDER_API + '/services/' + serviceId + '/deploys?limit=' + limit, { headers: renderHeaders() })
  if (!res.ok) return []
  return await res.json() as any[]
}

export async function updateRenderServiceSettings(serviceId: string, settings: {
  rootDir?: string; buildCommand?: string; startCommand?: string; publishPath?: string
}): Promise<boolean> {
  const serviceDetails: Record<string, any> = {}
  if (settings.buildCommand) serviceDetails.buildCommand = settings.buildCommand
  if (settings.startCommand) serviceDetails.startCommand = settings.startCommand
  if (settings.publishPath) serviceDetails.publishPath = settings.publishPath

  const body: Record<string, any> = { serviceDetails }
  if (settings.rootDir !== undefined) body.rootDir = settings.rootDir

  const res = await fetchWithTimeout(RENDER_API + '/services/' + serviceId, {
    method: 'PATCH', headers: renderHeaders(),
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    console.warn('[Deploy] Failed to update service', serviceId, '- status:', res.status, await res.text())
    return false
  }
  console.log('[Deploy] Updated service settings for', serviceId)
  return true
}

async function triggerManualDeploy(serviceId: string): Promise<boolean> {
  const res = await fetchWithTimeout(RENDER_API + '/services/' + serviceId + '/deploys', {
    method: 'POST', headers: renderHeaders(),
    body: JSON.stringify({ clearCache: 'do_not_clear' }),
  })
  if (!res.ok) {
    console.warn('[Deploy] Failed to trigger manual deploy for', serviceId, '- status:', res.status)
    return false
  }
  console.log('[Deploy] Triggered manual redeploy for service', serviceId)
  return true
}


// ─── Full Pipeline ────────────────────────────────────────────────────────────

export interface DeployResult {
  success: boolean
  status: string
  steps: Array<{ step: string; status: string; [key: string]: any }>
  services: Record<string, any>
  errors: string[]
  repoUrl?: string
  apiUrl?: string
  deployedUrl?: string
  siteUrl?: string
  visionUrl?: string
  adsUrl?: string
}

export async function deployCustomer(
  factoryCustomer: {
    id: string; slug: string; name?: string; industry?: string
    products?: string[]; config?: any; planId?: string
  },
  zipPath: string,
  options: { region?: string; plan?: string; dbPlan?: string; products?: string[] } = {}
): Promise<DeployResult> {
  const { region = 'ohio', plan = 'starter', dbPlan = 'basic_256mb', products = factoryCustomer.products || ['crm'] } = options
  const slug = factoryCustomer.slug
  const isHomeCare = factoryCustomer.industry === 'home_care' || factoryCustomer.config?.company?.industry === 'home_care'
  const isAutomotive = factoryCustomer.industry === 'automotive' || factoryCustomer.config?.company?.industry === 'automotive'
  const results: DeployResult = { success: false, status: 'starting', steps: [], services: {}, errors: [] }

  const jwtSecret = crypto.randomBytes(48).toString('base64')
  const jwtRefreshSecret = crypto.randomBytes(48).toString('base64')
  const encryptionKey = crypto.randomBytes(32).toString('hex')

  // Collect created resource IDs for rollback on failure
  const createdResources: Array<{ type: 'repo' | 'service' | 'database'; id: string; name?: string }> = []

  let extractDir = ''
  try {
    // Step 1: Extract zip
    const tmpBase = process.env.TEMP || process.env.TMP || (process.platform === 'win32' ? 'C:\\Windows\\Temp' : '/tmp')
    extractDir = path.join(tmpBase, 'deploy-' + slug + '-' + Date.now())
    fs.mkdirSync(extractDir, { recursive: true })
    const zip = new AdmZip(zipPath)
    zip.extractAllTo(extractDir, true)
    results.steps.push({ step: 'extract', status: 'ok' })

    // Step 2: GitHub repo
    const org = process.env.GITHUB_ORG || process.env.GITHUB_USER
    if (!org) throw new Error('GITHUB_ORG or GITHUB_USER must be set')
    await deleteGitHubRepo(org + '/' + slug)
    const repo = await createGitHubRepo(slug, 'Twomiah Factory: ' + (factoryCustomer.name || slug))
    createdResources.push({ type: 'repo', id: org + '/' + slug, name: repo.full_name })
    results.steps.push({ step: 'github_repo', status: 'ok', repo: repo.full_name })
    results.repoUrl = 'https://github.com/' + repo.full_name

    // Step 3: Push code
    await pushToGitHub(repo.full_name, extractDir)
    results.steps.push({ step: 'github_push', status: 'ok' })

    // Use the Twomiah project environment so services appear grouped in the Render dashboard.
    // We assign services after creation via PATCH (avoids random name suffixes from project-scoped creation).
    const twomiahEnvId = process.env.RENDER_PROJECT_ENV_ID || null
    const deployedResourceIds: string[] = []

    // Step 4: Render Postgres (only for CRM products)
    let dbInfo: any = null
    if (products.includes('crm')) {
      try {
        const dbSlug = isHomeCare ? slug + '-care' : isAutomotive ? slug + '-drive' : slug
        console.log('[Deploy] Creating DB:', dbSlug + '-db')
        const db = await createRenderDatabase(dbSlug, region, dbPlan)
        createdResources.push({ type: 'database', id: db.id, name: dbSlug + '-db' })
        results.steps.push({ step: 'render_db', status: 'ok', dbId: db.id })
        results.services.database = db
        if (db.id) deployedResourceIds.push(db.id)

        console.log('[Deploy] Waiting for DB to be ready...')
        let dbReady = false
        for (let attempt = 0; attempt < 20; attempt++) {
          await sleep(15000)
          try {
            const connInfo = await getDatabaseConnectionInfo(db.id)
            if (connInfo?.internalConnectionString) { dbInfo = connInfo; dbReady = true; break }
          } catch (_e) { /* not ready yet */ }
        }
        if (!dbReady) throw new Error('DB did not become ready in time')
      } catch (dbErr: any) {
        results.steps.push({ step: 'render_db', status: 'error', error: dbErr.message })
        results.errors.push('Database creation failed: ' + dbErr.message)
        results.success = false; results.status = 'failed'
        await rollbackResources(createdResources)
        return results
      }
    }

    // Build integration env vars from config
    const integrationEnvVars: Array<{ key: string; value: string }> = []
    const integrations = factoryCustomer.config?.integrations
    if (integrations?.twilio?.accountSid) {
      integrationEnvVars.push({ key: 'TWILIO_ACCOUNT_SID', value: integrations.twilio.accountSid })
      if (integrations.twilio.authToken) integrationEnvVars.push({ key: 'TWILIO_AUTH_TOKEN', value: integrations.twilio.authToken })
      if (integrations.twilio.phoneNumber) integrationEnvVars.push({ key: 'TWILIO_PHONE_NUMBER', value: integrations.twilio.phoneNumber })
    }
    if (integrations?.sendgrid?.apiKey) integrationEnvVars.push({ key: 'SENDGRID_API_KEY', value: integrations.sendgrid.apiKey })
    if (integrations?.stripe?.secretKey) {
      integrationEnvVars.push({ key: 'STRIPE_SECRET_KEY', value: integrations.stripe.secretKey })
      if (integrations.stripe.publishableKey) integrationEnvVars.push({ key: 'STRIPE_PUBLISHABLE_KEY', value: integrations.stripe.publishableKey })
      if (integrations.stripe.webhookSecret) integrationEnvVars.push({ key: 'STRIPE_WEBHOOK_SECRET', value: integrations.stripe.webhookSecret })
    }
    if (integrations?.googleMaps?.apiKey) integrationEnvVars.push({ key: 'GOOGLE_MAPS_API_KEY', value: integrations.googleMaps.apiKey })
    if (integrations?.sentry?.dsn) integrationEnvVars.push({ key: 'SENTRY_DSN', value: integrations.sentry.dsn })

    // Step 5 & 6: CRM backend + frontend
    if (products.includes('crm')) {
      try {
        const backendEnvVars = [
          { key: 'NODE_ENV', value: 'production' },
          { key: 'JWT_SECRET', value: jwtSecret },
          { key: 'JWT_REFRESH_SECRET', value: jwtRefreshSecret },
          { key: 'ENCRYPTION_KEY', value: encryptionKey },
          { key: 'PORT', value: '10000' },
          ...integrationEnvVars,
        ]
        if (dbInfo?.internalConnectionString) backendEnvVars.push({ key: 'DATABASE_URL', value: dbInfo.internalConnectionString })

        const crmApiName = isHomeCare ? slug + '-care-api' : isAutomotive ? slug + '-drive-api' : slug + '-api'
        const crmFrontName = isHomeCare ? slug + '-care' : isAutomotive ? slug + '-drive' : slug + '-crm'
        const crmRootDir = isHomeCare ? 'crm-homecare' : isAutomotive ? 'crm-automotive' : 'crm'

        // Delete existing services so names are available (avoids random suffixes)
        await findAndDeleteRenderService(crmApiName)
        await findAndDeleteRenderService(crmFrontName) // clean up legacy static sites

        // Single service: backend builds frontend and serves it (no CDN cache issues)
        const bunSetup = 'curl -fsSL https://bun.sh/install | bash && export PATH=$HOME/.bun/bin:$PATH'
        const backendBuild = bunSetup + ' && cd ../frontend && bun install && VITE_API_URL="" bun run build && cp -r dist ../backend/frontend-dist && cd ../backend && bun install'
        const backendStart = 'export PATH=$HOME/.bun/bin:$PATH && bun db/migrate.ts && bun db/seed.ts && bun src/index.ts'
        const backend = await createRenderWebService({
          name: crmApiName, repoFullName: repo.full_name, rootDir: crmRootDir + '/backend',
          buildCommand: backendBuild,
          startCommand: backendStart,
          envVars: backendEnvVars, plan, region,
        })
        console.log('[Deploy] Backend creation response:', JSON.stringify(backend, null, 2))
        const backendSvc = backend.service || backend
        results.steps.push({ step: 'render_backend', status: 'ok', serviceId: backendSvc.id })
        results.services.backend = backendSvc
        if (backendSvc.id) {
          createdResources.push({ type: 'service', id: backendSvc.id, name: crmApiName })
          deployedResourceIds.push(backendSvc.id)
        }

        const actualApiSlug = backendSvc.slug || crmApiName
        console.log('[Deploy] Backend slug resolution:', { 'service.slug': backend.service?.slug, 'slug': backend.slug, resolved: actualApiSlug })
        const backendUrl = 'https://' + actualApiSlug + '.onrender.com'
        results.apiUrl = backendUrl
        // Frontend is served by the same backend service — same URL
        results.deployedUrl = backendUrl
        results.steps.push({ step: 'render_frontend', status: 'ok', note: 'served by backend' })
      } catch (err: any) {
        results.steps.push({ step: 'render_crm', status: 'error', error: err.message })
        results.errors.push('CRM: ' + err.message)
      }
    }

    // Step 7: Website service
    if (products.includes('website')) {
      try {
        await findAndDeleteRenderService(slug + '-site')
        const siteBunSetup = 'curl -fsSL https://bun.sh/install | bash && export PATH=$HOME/.bun/bin:$PATH'
        const site = await createRenderWebService({
          name: slug + '-site', repoFullName: repo.full_name, rootDir: 'website',
          buildCommand: siteBunSetup + ' && bun install && if [ -f admin/package.json ]; then cd admin && bun install && bun run build:quick && cd ..; fi',
          startCommand: 'export PATH=$HOME/.bun/bin:$PATH && NODE_ENV=production bun server-static.ts',
          envVars: [
            { key: 'NODE_ENV', value: 'production' },
            { key: 'PORT', value: '10000' },
            { key: 'JWT_SECRET', value: jwtSecret },
            { key: 'SITE_NAME', value: factoryCustomer.name || slug },
          ],
          plan, region,
        })
        console.log('[Deploy] Website creation response:', JSON.stringify(site, null, 2))
        results.steps.push({ step: 'render_site', status: 'ok', serviceId: site.service?.id })
        results.services.site = site.service
        if (site.service?.id) {
          createdResources.push({ type: 'service', id: site.service.id, name: slug + '-site' })
          deployedResourceIds.push(site.service.id)
        }
        const siteUrl = getServiceUrl(site)
        console.log('[Deploy] Resolved website URL:', siteUrl)
        results.siteUrl = siteUrl
        // Set SITE_URL and CRM integration env vars
        if (site.service?.id) {
          const siteEnvUpdates: Array<{ key: string; value: string }> = []
          if (siteUrl) siteEnvUpdates.push({ key: 'SITE_URL', value: siteUrl })
          if (results.apiUrl) {
            siteEnvUpdates.push({ key: 'CRM_API_URL', value: results.apiUrl })
            siteEnvUpdates.push({ key: 'WEBHOOK_SECRET', value: jwtSecret })
          }
          if (siteEnvUpdates.length > 0) await updateRenderEnvVars(site.service.id, siteEnvUpdates)
        }
      } catch (err: any) {
        results.steps.push({ step: 'render_site', status: 'error', error: err.message })
        results.errors.push('Site: ' + err.message)
      }
    }

    // Step 8: Vision service
    if (products.includes('vision')) {
      try {
        const visionName = slug + '-vision'
        await findAndDeleteRenderService(visionName)
        const visionBuildCmd = 'npm install --include=dev && npm run build'
        const visionStartCmd = 'npm start'
        const visionEnvVars: Array<{ key: string; value: string }> = [
          { key: 'NODE_ENV', value: 'production' },
          { key: 'PORT', value: '10000' },
        ]
        // Add Vision-specific env vars from customer config/integrations if available
        const integrations = factoryCustomer.config?.integrations || {} as any
        if (integrations.supabaseUrl) visionEnvVars.push({ key: 'NEXT_PUBLIC_SUPABASE_URL', value: integrations.supabaseUrl })
        if (integrations.supabaseAnonKey) visionEnvVars.push({ key: 'NEXT_PUBLIC_SUPABASE_ANON_KEY', value: integrations.supabaseAnonKey })
        if (integrations.supabaseServiceKey) visionEnvVars.push({ key: 'SUPABASE_SERVICE_ROLE_KEY', value: integrations.supabaseServiceKey })
        if (integrations.openaiKey) visionEnvVars.push({ key: 'OPENAI_API_KEY', value: integrations.openaiKey })
        if (integrations.stripeSecretKey) visionEnvVars.push({ key: 'STRIPE_SECRET_KEY', value: integrations.stripeSecretKey })
        if (integrations.stripePublishableKey) visionEnvVars.push({ key: 'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY', value: integrations.stripePublishableKey })
        if (integrations.stripeWebhookSecret) visionEnvVars.push({ key: 'STRIPE_WEBHOOK_SECRET', value: integrations.stripeWebhookSecret })
        if (integrations.resendKey) visionEnvVars.push({ key: 'RESEND_API_KEY', value: integrations.resendKey })

        const vision = await createRenderWebService({
          name: visionName, repoFullName: repo.full_name, rootDir: 'vision',
          buildCommand: visionBuildCmd, startCommand: visionStartCmd,
          envVars: visionEnvVars,
          plan: 'standard', region,
        })
        console.log('[Deploy] Vision creation response:', JSON.stringify(vision, null, 2))
        const visionSvc = vision.service || vision
        results.steps.push({ step: 'render_vision', status: 'ok', serviceId: visionSvc.id })
        results.services.vision = visionSvc
        if (visionSvc.id) {
          createdResources.push({ type: 'service', id: visionSvc.id, name: visionName })
          deployedResourceIds.push(visionSvc.id)
        }
        const visionSlug = visionSvc.slug || visionName
        const visionUrl = 'https://' + visionSlug + '.onrender.com'
        results.visionUrl = visionUrl
        // Set NEXT_PUBLIC_BASE_URL on the vision service now that we know the actual URL
        if (visionSvc.id) {
          await updateRenderEnvVars(visionSvc.id, [{ key: 'NEXT_PUBLIC_BASE_URL', value: visionUrl }])
        }
        // Set VISION_URL on the website service so /visualize redirects work
        if (results.services.site?.id) {
          await updateRenderEnvVars(results.services.site.id, [{ key: 'VISION_URL', value: visionUrl }])
        }
      } catch (err: any) {
        results.steps.push({ step: 'render_vision', status: 'error', error: err.message })
        results.errors.push('Vision: ' + err.message)
      }
    }

    // Register tenant with shared home-visualizer so /visualize embed works
    if (products.includes('website') && (factoryCustomer.config?.features?.website || []).includes('visualizer')) {
      try {
        await registerVisualizerTenant(slug, factoryCustomer.name || slug, factoryCustomer.config?.company)
        results.steps.push({ step: 'visualizer_tenant', status: 'ok' })
      } catch (err: any) {
        // Non-critical — tenant can be registered manually later
        console.warn('[Deploy] Could not register visualizer tenant:', err.message)
        results.steps.push({ step: 'visualizer_tenant', status: 'warning', error: err.message })
      }
    }

    // Register tenant with shared Twomiah Ads service
    if (factoryCustomer.config?.features?.paid_ads) {
      try {
        const adsTenantUrl = await registerAdsTenant(slug, factoryCustomer.name || slug, factoryCustomer.config?.company)
        results.adsUrl = adsTenantUrl
        results.steps.push({ step: 'ads_tenant', status: 'ok', url: adsTenantUrl })
        // Set ADS_URL on the CRM backend so it can link to the ads dashboard
        if (results.services.backend?.id) {
          await updateRenderEnvVars(results.services.backend.id, [
            { key: 'ADS_URL', value: adsTenantUrl },
          ])
        }
      } catch (err: any) {
        // Non-critical — tenant can be registered manually later
        console.warn('[Deploy] Could not register ads tenant:', err.message)
        results.steps.push({ step: 'ads_tenant', status: 'warning', error: err.message })
      }
    }

    // Assign all created services to the Twomiah project so they appear in the Render dashboard
    if (twomiahEnvId && deployedResourceIds.length > 0) {
      for (const resourceId of deployedResourceIds) {
        try {
          await fetchWithTimeout(RENDER_API + '/services/' + resourceId, {
            method: 'PATCH', headers: renderHeaders(),
            body: JSON.stringify({ environmentId: twomiahEnvId }),
          })
        } catch (_e) { /* non-critical */ }
      }
      console.log('[Deploy] Assigned', deployedResourceIds.length, 'services to project environment')
    }

    results.success = results.errors.length === 0
    results.status = results.success ? 'deployed' : 'partial'

    // Rollback if completely failed (all services errored)
    if (!results.success && !results.apiUrl && !results.siteUrl && !results.deployedUrl) {
      console.log('[Deploy] All services failed — rolling back')
      await rollbackResources(createdResources)
    }

  } catch (err: any) {
    results.success = false
    results.status = 'failed'
    results.errors.push(err.message)
    await rollbackResources(createdResources)
  } finally {
    // Always clean up temp directory
    if (extractDir) {
      try { fs.rmSync(extractDir, { recursive: true, force: true }) } catch (_e) { /* ignore */ }
    }
  }

  return results
}


export async function checkDeployStatus(factoryCustomer: { renderServiceIds?: Record<string, string> }) {
  const statuses: Record<string, any> = {}
  const serviceIds = factoryCustomer.renderServiceIds
  if (!serviceIds) return { status: 'no_services', services: {}, overallStatus: 'no_services' }
  for (const [role, serviceId] of Object.entries(serviceIds)) {
    try {
      const deploys = await getServiceDeploys(serviceId, 1)
      const latest = deploys[0]
      statuses[role] = { serviceId, status: latest?.deploy?.status || 'unknown', finishedAt: latest?.deploy?.finishedAt }
    } catch (err: any) { statuses[role] = { serviceId, status: 'error', error: err.message } }
  }
  const allStatuses = Object.values(statuses).map((s: any) => s.status)
  const overallStatus = allStatuses.every(s => s === 'live') ? 'live'
    : allStatuses.some(s => s === 'build_in_progress') ? 'deploying'
    : 'unknown'
  return { services: statuses, overallStatus, status: overallStatus }
}

export async function redeployCustomer(factoryCustomer: { renderServiceIds?: Record<string, string> }) {
  const serviceIds = factoryCustomer.renderServiceIds
  if (!serviceIds) throw new Error('No services to redeploy')
  const results: Record<string, any> = {}
  for (const [role, serviceId] of Object.entries(serviceIds)) {
    try {
      const res = await fetchWithTimeout(RENDER_API + '/services/' + serviceId + '/deploys', { method: 'POST', headers: renderHeaders(), body: JSON.stringify({}) })
      if (res.ok) { const deploy = await res.json() as any; results[role] = { status: 'triggered', deployId: deploy.id } }
      else { results[role] = { status: 'failed' } }
    } catch (err: any) { results[role] = { status: 'error', error: err.message } }
  }
  return results
}

export async function findRenderServicesBySlug(slug: string): Promise<Record<string, string>> {
  const serviceIds: Record<string, string> = {}
  try {
    const res = await fetchWithTimeout(RENDER_API + '/services?type=web_service,static_site&limit=100', { headers: renderHeaders() })
    if (!res.ok) return serviceIds
    const list = await res.json() as any[]
    const suffixes: Record<string, string> = {
      '-api': 'backend', '-care-api': 'backend',
      '-frontend': 'frontend', '-care': 'frontend',
      '-site': 'site',
      '-vision': 'vision',
    }
    for (const item of list) {
      const svc = item.service || item
      const name: string = svc.name || ''
      if (!name.startsWith(slug)) continue
      for (const [suffix, role] of Object.entries(suffixes)) {
        if (name === slug + suffix || name.startsWith(slug + suffix + '-')) {
          serviceIds[role] = svc.id
          break
        }
      }
    }
  } catch (e: any) {
    console.warn('[Deploy] Could not look up services by slug:', e.message)
  }
  return serviceIds
}

export async function addCustomDomain(serviceId: string, domain: string): Promise<{ success: boolean; error?: string }> {
  if (!process.env.RENDER_API_KEY) return { success: false, error: 'Render not configured' }
  try {
    const res = await fetchWithTimeout(RENDER_API + '/services/' + serviceId + '/custom-domains', {
      method: 'POST', headers: renderHeaders(),
      body: JSON.stringify({ name: domain }),
    })
    if (!res.ok) {
      const err = await res.json() as any
      return { success: false, error: err.message || JSON.stringify(err) }
    }
    return { success: true }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function registerVisualizerTenant(slug: string, companyName: string, company?: any) {
  const supabaseUrl = process.env.VISUALIZER_SUPABASE_URL
  const supabaseKey = process.env.VISUALIZER_SUPABASE_KEY
  if (!supabaseUrl || !supabaseKey) {
    console.log('[Deploy] Skipping visualizer tenant registration — VISUALIZER_SUPABASE_URL/KEY not set')
    return
  }

  const body = {
    slug,
    company_name: companyName,
    phone: company?.phone || '',
    email: company?.email || '',
    website: company?.domain ? 'https://' + company.domain : '',
    active: true,
    plan: 'starter',
    monthly_gen_limit: 50,
  }

  const res = await fetchWithTimeout(supabaseUrl + '/rest/v1/tenants', {
    method: 'POST',
    headers: {
      'apikey': supabaseKey,
      'Authorization': 'Bearer ' + supabaseKey,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify(body),
  })

  if (res.status === 409 || res.status === 400) {
    // Tenant likely already exists (unique constraint on slug)
    console.log('[Deploy] Visualizer tenant already exists:', slug)
    return
  }

  if (!res.ok) {
    throw new Error('Supabase insert failed (' + res.status + '): ' + await res.text())
  }

  console.log('[Deploy] Registered visualizer tenant:', slug)
}

async function registerAdsTenant(slug: string, companyName: string, company?: any): Promise<string> {
  const adsUrl = process.env.TWOMIAH_ADS_URL || 'https://twomiah-ads.onrender.com'
  const webhookSecret = process.env.ADS_WEBHOOK_SECRET || 'twomiah_factory_secret_2026'

  const body = {
    slug,
    company_name: companyName,
    email: company?.email || '',
    website: company?.domain ? 'https://' + company.domain : '',
    phone: company?.phone || '',
  }

  const res = await fetchWithTimeout(adsUrl + '/api/tenants/register', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Factory-Secret': webhookSecret,
    },
    body: JSON.stringify(body),
  })

  if (res.status === 409) {
    // Tenant already exists — not an error
    console.log('[Deploy] Ads tenant already exists:', slug)
    return adsUrl + '/t/' + slug
  }

  if (!res.ok) {
    throw new Error('Ads tenant registration failed (' + res.status + '): ' + await res.text())
  }

  console.log('[Deploy] Registered ads tenant:', slug)
  return adsUrl + '/t/' + slug
}
