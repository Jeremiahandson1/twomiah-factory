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
    buildCommand: config.buildCommand || 'npm install',
    startCommand: config.startCommand || 'npm start',
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
      buildCommand: config.buildCommand || 'npm run build',
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

    // Step 3.5: Create Render project + environment for grouping
    const projectName = (factoryCustomer.name || slug)
    let environmentId: string | null = null
    const projectId = await createRenderProject(projectName)
    if (projectId) {
      results.steps.push({ step: 'render_project', status: 'ok', projectId })
      console.log('[Deploy] Created Render project:', projectName)
      environmentId = await createRenderEnvironment(projectId, 'production')
      if (environmentId) {
        results.steps.push({ step: 'render_environment', status: 'ok', environmentId })
      }
    }
    const deployedResourceIds: string[] = []

    // Step 4: Render Postgres (only for CRM products)
    let dbInfo: any = null
    if (products.includes('crm')) {
      try {
        const dbSlug = isHomeCare ? slug + '-care' : slug
        console.log('[Deploy] Creating DB:', dbSlug + '-db')
        const db = await createRenderDatabase(dbSlug, region, dbPlan, projectId)
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

        const crmApiName = isHomeCare ? slug + '-care-api' : slug + '-api'
        const backend = await createRenderWebService({
          name: crmApiName, repoFullName: repo.full_name, rootDir: 'crm/backend',
          buildCommand: 'npm install && npx prisma generate',
          preDeployCommand: 'npx prisma migrate deploy && node prisma/seed.js',
          startCommand: 'node src/index.js',
          envVars: backendEnvVars, plan, region, projectId,
        })
        console.log('[Deploy] Backend creation response:', JSON.stringify(backend, null, 2))
        results.steps.push({ step: 'render_backend', status: 'ok', serviceId: backend.service?.id })
        results.services.backend = backend.service
        if (backend.service?.id) {
          createdResources.push({ type: 'service', id: backend.service.id, name: crmApiName })
          deployedResourceIds.push(backend.service.id)
        }
        const backendUrl = getServiceUrl(backend)
        console.log('[Deploy] Resolved backend URL:', backendUrl)
        results.apiUrl = backendUrl

        const crmFrontName = isHomeCare ? slug + '-care' : slug + '-crm'
        const frontend = await createRenderStaticSite({
          name: crmFrontName, repoFullName: repo.full_name, rootDir: 'crm/frontend',
          buildCommand: 'npm install --include=dev && npm run build', publishPath: 'dist',
          envVars: [],
          projectId,
        })
        console.log('[Deploy] Frontend creation response:', JSON.stringify(frontend, null, 2))
        results.steps.push({ step: 'render_frontend', status: 'ok', serviceId: frontend.service?.id })
        results.services.frontend = frontend.service
        if (frontend.service?.id) {
          createdResources.push({ type: 'service', id: frontend.service.id, name: crmFrontName })
          deployedResourceIds.push(frontend.service.id)
          await addStaticSiteHeaders(frontend.service.id)
        }
        const frontendUrl = getServiceUrl(frontend)
        console.log('[Deploy] Resolved frontend URL:', frontendUrl)
        results.deployedUrl = frontendUrl

        // Now set cross-references using the real URLs from Render
        if (frontend.service?.id && backendUrl) {
          await updateRenderEnvVars(frontend.service.id, [{ key: 'VITE_API_URL', value: backendUrl }])
        }
        if (backend.service?.id && frontendUrl) {
          await updateRenderEnvVars(backend.service.id, [{ key: 'FRONTEND_URL', value: frontendUrl }])
        }
      } catch (err: any) {
        results.steps.push({ step: 'render_crm', status: 'error', error: err.message })
        results.errors.push('CRM: ' + err.message)
      }
    }

    // Step 7: Website service
    if (products.includes('website')) {
      try {
        const site = await createRenderWebService({
          name: slug + '-site', repoFullName: repo.full_name, rootDir: 'website',
          buildCommand: 'npm install && if [ -f admin/package.json ]; then cd admin && npm install && npm run build:quick && cd ..; fi',
          startCommand: 'NODE_ENV=production node server-static.js',
          envVars: [
            { key: 'NODE_ENV', value: 'production' },
            { key: 'PORT', value: '10000' },
            { key: 'JWT_SECRET', value: jwtSecret },
            { key: 'SITE_NAME', value: factoryCustomer.name || slug },
          ],
          plan, region, projectId,
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
        // Set SITE_URL using the real URL from Render
        if (site.service?.id && siteUrl) {
          await updateRenderEnvVars(site.service.id, [{ key: 'SITE_URL', value: siteUrl }])
        }
      } catch (err: any) {
        results.steps.push({ step: 'render_site', status: 'error', error: err.message })
        results.errors.push('Site: ' + err.message)
      }
    }

    // Assign all services to Render project environment
    if (environmentId && deployedResourceIds.length > 0) {
      await addResourcesToEnvironment(environmentId, deployedResourceIds)
      console.log('[Deploy] Assigned', deployedResourceIds.length, 'resources to environment')
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
