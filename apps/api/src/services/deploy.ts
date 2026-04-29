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
import * as cloudflare from './cloudflare'
import * as sendgrid from './sendgrid'

const RENDER_API = 'https://api.render.com/v1'
const GITHUB_API = 'https://api.github.com'
const SUPABASE_MGMT_API = 'https://api.supabase.com/v1'
const CLOUDFLARE_API = 'https://api.cloudflare.com/client/v4'
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

function supabaseManagementHeaders(): Record<string, string> {
  return {
    'Authorization': 'Bearer ' + process.env.SUPABASE_MANAGEMENT_API_KEY,
    'Content-Type': 'application/json',
  }
}

function isSupabaseManagementConfigured(): boolean {
  return !!(process.env.SUPABASE_MANAGEMENT_API_KEY && process.env.SUPABASE_ORG_ID)
}

function cloudflareHeaders(): Record<string, string> {
  return {
    'Authorization': 'Bearer ' + process.env.CLOUDFLARE_API_TOKEN,
    'Content-Type': 'application/json',
  }
}

function isR2Configured(): boolean {
  return !!(process.env.CLOUDFLARE_API_TOKEN && process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY)
}

/**
 * Products that require an R2 media bucket for file storage (logos, photos, documents).
 * Products NOT in this list (e.g. vision-only, standalone pricing pages) skip bucket creation.
 */
const PRODUCTS_REQUIRING_R2 = [
  'crm',       // Twomiah Build (general CRM) — photo uploads, documents, logos
  'website',   // Full multi-page website with CMS — media uploads
  'cms',       // CMS product — content media
  'pricing',   // Pricing tool — product images
]

/** Check whether a tenant's selected products need an R2 media bucket */
function needsR2Bucket(products: string[]): boolean {
  return products.some(p => PRODUCTS_REQUIRING_R2.includes(p))
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
  if (!process.env.SUPABASE_MANAGEMENT_API_KEY) missing.push('SUPABASE_MANAGEMENT_API_KEY')
  if (!process.env.SUPABASE_ORG_ID) missing.push('SUPABASE_ORG_ID')
  if (!process.env.CLOUDFLARE_API_TOKEN) missing.push('CLOUDFLARE_API_TOKEN')
  if (!process.env.R2_ACCOUNT_ID) missing.push('R2_ACCOUNT_ID')
  if (!process.env.R2_ACCESS_KEY_ID) missing.push('R2_ACCESS_KEY_ID')
  if (!process.env.R2_SECRET_ACCESS_KEY) missing.push('R2_SECRET_ACCESS_KEY')
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

async function rollbackResources(resources: Array<{ type: 'repo' | 'service' | 'database' | 'supabase_project' | 'r2_bucket' | 'vision_tenant'; id: string; name?: string }>) {
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
        case 'supabase_project':
          console.log('[Deploy] Rollback: deleting Supabase project', resource.id)
          await deleteSupabaseProject(resource.id)
          break
        case 'r2_bucket':
          console.log('[Deploy] Rollback: deleting R2 bucket', resource.id)
          await deleteR2Bucket(resource.id)
          break
        case 'vision_tenant':
          console.log('[Deploy] Rollback: deleting Vision tenant', resource.id)
          await deleteVisionTenant(resource.id)
          break
      }
    } catch (e: any) {
      console.warn('[Deploy] Rollback failed for', resource.type, resource.id, ':', e.message)
    }
  }
}


// ─── Supabase Management API ─────────────────────────────────────────────────

/** Map Render regions to Supabase regions */
function toSupabaseRegion(renderRegion: string): string {
  const map: Record<string, string> = {
    'ohio': 'us-east-1',
    'oregon': 'us-west-1',
    'virginia': 'us-east-1',
    'frankfurt': 'eu-central-1',
    'singapore': 'ap-southeast-1',
  }
  return map[renderRegion] || 'us-east-1'
}

interface SupabaseProjectResult {
  ref: string
  dbPass: string
  region: string
  supabaseUrl: string
  anonKey: string
  serviceRoleKey: string
  connectionString: string
}

async function createSupabaseProject(slug: string, region = 'ohio', plan = 'free'): Promise<SupabaseProjectResult> {
  const dbPass = crypto.randomBytes(24).toString('base64url')
  const supabaseRegion = toSupabaseRegion(region)

  const res = await fetchWithTimeout(SUPABASE_MGMT_API + '/projects', {
    method: 'POST',
    headers: supabaseManagementHeaders(),
    body: JSON.stringify({
      name: slug,
      organization_id: process.env.SUPABASE_ORG_ID,
      db_pass: dbPass,
      region: supabaseRegion,
      plan,
    }),
  }, 60_000)

  if (!res.ok) {
    const err = await res.text()
    throw new Error('Supabase project creation failed (' + res.status + '): ' + err)
  }

  const project = await res.json() as any
  const ref = project.id
  console.log('[Deploy] Created Supabase project:', ref, 'region:', supabaseRegion)

  // Wait for project to become ready
  await waitForSupabaseProject(ref)

  // Fetch API keys
  const keys = await getSupabaseApiKeys(ref)

  const supabaseUrl = 'https://' + ref + '.supabase.co'
  const connectionString = 'postgresql://postgres.' + ref + ':' + encodeURIComponent(dbPass) + '@aws-0-' + supabaseRegion + '.pooler.supabase.com:6543/postgres'

  return {
    ref,
    dbPass,
    region: supabaseRegion,
    supabaseUrl,
    anonKey: keys.anonKey,
    serviceRoleKey: keys.serviceRoleKey,
    connectionString,
  }
}

async function waitForSupabaseProject(ref: string, maxAttempts = 30, intervalMs = 10_000): Promise<void> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const res = await fetchWithTimeout(SUPABASE_MGMT_API + '/projects/' + ref, {
      headers: supabaseManagementHeaders(),
    })
    if (res.ok) {
      const project = await res.json() as any
      console.log('[Deploy] Supabase project', ref, 'status:', project.status, '(attempt', attempt + 1 + ')')
      if (project.status === 'ACTIVE_HEALTHY') return
    }
    await sleep(intervalMs)
  }
  throw new Error('Supabase project ' + ref + ' did not become ready within ' + Math.round(maxAttempts * intervalMs / 1000) + 's')
}

async function getSupabaseApiKeys(ref: string): Promise<{ anonKey: string; serviceRoleKey: string }> {
  const res = await fetchWithTimeout(SUPABASE_MGMT_API + '/projects/' + ref + '/api-keys', {
    headers: supabaseManagementHeaders(),
  })
  if (!res.ok) throw new Error('Failed to fetch Supabase API keys for project ' + ref)
  const keys = await res.json() as any[]
  const anonKey = keys.find((k: any) => k.name === 'anon')?.api_key || ''
  const serviceRoleKey = keys.find((k: any) => k.name === 'service_role')?.api_key || ''
  if (!anonKey || !serviceRoleKey) throw new Error('Missing API keys for Supabase project ' + ref)
  return { anonKey, serviceRoleKey }
}

async function deleteSupabaseProject(ref: string): Promise<void> {
  try {
    const res = await fetchWithTimeout(SUPABASE_MGMT_API + '/projects/' + ref, {
      method: 'DELETE',
      headers: supabaseManagementHeaders(),
    })
    if (res.ok) console.log('[Deploy] Deleted Supabase project:', ref)
    else console.warn('[Deploy] Failed to delete Supabase project', ref, '- status:', res.status)
  } catch (e: any) {
    console.warn('[Deploy] Could not delete Supabase project:', ref, e.message)
  }
}


// ─── Cloudflare R2 Bucket Provisioning ───────────────────────────────────────

async function createR2Bucket(slug: string): Promise<string> {
  const accountId = process.env.R2_ACCOUNT_ID!
  const bucketName = slug + '-media'

  const res = await fetchWithTimeout(
    CLOUDFLARE_API + '/accounts/' + accountId + '/r2/buckets',
    {
      method: 'PUT',
      headers: cloudflareHeaders(),
      body: JSON.stringify({ name: bucketName }),
    },
  )

  if (!res.ok) {
    const body = await res.text()
    // Bucket already exists — not an error
    if (res.status === 409 || body.includes('already exists')) {
      console.log('[Deploy] R2 bucket already exists:', bucketName)
      return bucketName
    }
    throw new Error('R2 bucket creation failed (' + res.status + '): ' + body)
  }

  console.log('[Deploy] Created R2 bucket:', bucketName)
  return bucketName
}

async function deleteR2Bucket(bucketName: string): Promise<void> {
  const accountId = process.env.R2_ACCOUNT_ID
  if (!accountId || !process.env.CLOUDFLARE_API_TOKEN) return
  try {
    const res = await fetchWithTimeout(
      CLOUDFLARE_API + '/accounts/' + accountId + '/r2/buckets/' + bucketName,
      { method: 'DELETE', headers: cloudflareHeaders() },
    )
    if (res.ok) console.log('[Deploy] Deleted R2 bucket:', bucketName)
    else console.warn('[Deploy] Failed to delete R2 bucket', bucketName, '- status:', res.status)
  } catch (e: any) {
    console.warn('[Deploy] Could not delete R2 bucket:', bucketName, e.message)
  }
}

/** Returns the R2 env vars to inject into a deployed Render service */
function getR2EnvVars(bucketName: string): Array<{ key: string; value: string }> {
  const accountId = process.env.R2_ACCOUNT_ID!
  return [
    { key: 'R2_ACCOUNT_ID', value: accountId },
    { key: 'R2_ACCESS_KEY_ID', value: process.env.R2_ACCESS_KEY_ID! },
    { key: 'R2_SECRET_ACCESS_KEY', value: process.env.R2_SECRET_ACCESS_KEY! },
    { key: 'R2_BUCKET_NAME', value: bucketName },
    { key: 'R2_PUBLIC_URL', value: 'https://' + accountId + '.r2.cloudflarestorage.com/' + bucketName },
  ]
}


// ─── Render ───────────────────────────────────────────────────────────────────

async function findAndDeleteRenderService(name: string): Promise<void> {
  try {
    // Paginate through all services to find by name
    let cursor = ''
    for (let page = 0; page < 10; page++) {
      const url = RENDER_API + '/services?type=web_service,static_site&limit=100' + (cursor ? '&cursor=' + cursor : '')
      const res = await fetchWithTimeout(url, { headers: renderHeaders() })
      if (!res.ok) return
      const list = await res.json() as any[]
      if (!list.length) return
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
      // Use last item's cursor for next page
      const lastItem = list[list.length - 1]
      const lastSvc = lastItem.service || lastItem
      cursor = lastSvc.cursor || lastSvc.id || ''
      if (list.length < 100) return // last page
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
  const res = await fetchWithTimeout(RENDER_API + '/postgres?limit=100', { headers: renderHeaders() })
  if (!res.ok) return null
  const list = await res.json() as any[]
  const match = list.find((item: any) => (item.postgres || item).name === name)
  return match ? (match.postgres || match) : null
}

async function findAndDeleteRenderDatabase(name: string): Promise<void> {
  try {
    const existing = await findExistingDatabase(name)
    if (existing && existing.id) {
      console.log('[Deploy] Deleting existing Render database:', name, existing.id)
      await fetchWithTimeout(RENDER_API + '/postgres/' + existing.id, { method: 'DELETE', headers: renderHeaders() })
      await sleep(5000)
    }
  } catch (e: any) {
    console.warn('[Deploy] Could not clean up existing database:', name, e.message)
  }
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
  const rootDir = config.rootDir || ''
  const body: any = {
    type: 'web_service', name: config.name,
    ownerId: process.env.RENDER_OWNER_ID,
    repo: 'https://github.com/' + config.repoFullName,
    autoDeploy: 'yes', branch: 'main', rootDir,
    serviceDetails: {
      envSpecificDetails,
      rootDir,
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
  const rootDir = config.rootDir || ''
  const body: any = {
    type: 'static_site', name: config.name,
    ownerId: process.env.RENDER_OWNER_ID,
    repo: 'https://github.com/' + config.repoFullName,
    autoDeploy: 'yes', branch: 'main', rootDir,
    serviceDetails: {
      buildCommand: config.buildCommand || 'bun run build',
      publishPath: config.publishPath || 'dist',
      rootDir,
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
    body: JSON.stringify({ clearCache: 'clear' }),
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
  supabaseProjectRef?: string
  r2BucketName?: string
  dbConnectionString?: string
  factorySyncKey?: string
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
  let ind = factoryCustomer.industry || factoryCustomer.config?.company?.industry || ''
  // Normalize industry variants (e.g., home_care_nonmedical → home_care, hvac → field_service)
  if (ind.startsWith('home_care')) ind = 'home_care'
  if (['hvac', 'plumbing', 'electrical'].includes(ind) || ind.startsWith('field_service')) ind = 'field_service'
  const isHomeCare = ind === 'home_care'
  const isFieldService = ind === 'field_service'
  const isAutomotive = ind === 'automotive'
  const isRoofing = ind === 'roofing'
  const isDispensary = ind === 'dispensary'
  const results: DeployResult = { success: false, status: 'starting', steps: [], services: {}, errors: [] }

  const jwtSecret = crypto.randomBytes(48).toString('base64')
  const jwtRefreshSecret = crypto.randomBytes(48).toString('base64')
  const encryptionKey = crypto.randomBytes(32).toString('hex')
  const factorySyncKey = crypto.randomBytes(32).toString('hex')

  // Collect created resource IDs for rollback on failure
  const createdResources: Array<{ type: 'repo' | 'service' | 'database' | 'supabase_project' | 'r2_bucket' | 'vision_tenant'; id: string; name?: string }> = []

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

    // Step 4: Database provisioning (only for CRM products)
    // Prefer dedicated Supabase project per customer; fall back to Render Postgres
    let dbConnectionString: string | null = null
    let supabaseProject: SupabaseProjectResult | null = null
    if (products.some(p => p === 'crm' || p.startsWith('crm-'))) {
      const dbSlug = isHomeCare ? slug + '-care' : isFieldService ? slug + '-wrench' : isAutomotive ? slug + '-drive' : isRoofing ? slug + '-roof' : isDispensary ? slug + '-leaf' : slug

      if (isSupabaseManagementConfigured()) {
        // ── Dedicated Supabase project per customer ──
        try {
          console.log('[Deploy] Creating dedicated Supabase project:', dbSlug)
          supabaseProject = await createSupabaseProject(dbSlug, region)
          createdResources.push({ type: 'supabase_project', id: supabaseProject.ref, name: dbSlug })
          results.steps.push({ step: 'supabase_project', status: 'ok', ref: supabaseProject.ref })
          results.services.database = { type: 'supabase', ref: supabaseProject.ref, url: supabaseProject.supabaseUrl }
          results.supabaseProjectRef = supabaseProject.ref
          dbConnectionString = supabaseProject.connectionString
        } catch (sbErr: any) {
          results.steps.push({ step: 'supabase_project', status: 'error', error: sbErr.message })
          results.errors.push('Supabase project creation failed: ' + sbErr.message)
          results.success = false; results.status = 'failed'
          await rollbackResources(createdResources)
          return results
        }
      } else {
        // ── Fallback: Render Postgres ──
        try {
          // Reuse existing database if it exists (preserves data across redeploys)
          const existingDb = await findExistingDatabase(dbSlug + '-db')
          if (existingDb) {
            console.log('[Deploy] Reusing existing Render DB:', dbSlug + '-db', existingDb.id)
            createdResources.push({ type: 'database', id: existingDb.id, name: dbSlug + '-db' })
            results.steps.push({ step: 'render_db', status: 'ok', dbId: existingDb.id, reused: true })
            results.services.database = existingDb
            if (existingDb.id) deployedResourceIds.push(existingDb.id)
            // Fetch connection string from Render API (not on the list response)
            const connInfo = await getDatabaseConnectionInfo(existingDb.id)
            if (connInfo?.internalConnectionString) {
              dbConnectionString = connInfo.internalConnectionString
            } else {
              console.warn('[Deploy] Could not get connection string for existing DB — will create new')
            }
          }
          if (!existingDb || !dbConnectionString) {
            console.log('[Deploy] Creating Render DB:', dbSlug + '-db')
            const db = await createRenderDatabase(dbSlug, region, dbPlan)
            createdResources.push({ type: 'database', id: db.id, name: dbSlug + '-db' })
            results.steps.push({ step: 'render_db', status: 'ok', dbId: db.id })
            results.services.database = db
            if (db.id) deployedResourceIds.push(db.id)

            console.log('[Deploy] Waiting for DB connection string from Render...')
            // Restored to pre-Phase-0 behavior: poll Render's API until it returns a
            // connection string, then hand it to the deployed backend service. The Phase 0
            // pg.connect()+SELECT 1 probe was belt-and-suspenders that broke deploys when
            // the factory couldn't reach the DB (region mismatch / SSL termination quirks).
            // The actual race-condition fix lives in the deployed backend's db/migrate.ts,
            // which retries connection 20× / 10s on boot — that's the real defense against
            // "DB returned by API before it's listening".
            let dbReady = false
            for (let attempt = 0; attempt < 20; attempt++) {
              await sleep(15000)
              try {
                const connInfo = await getDatabaseConnectionInfo(db.id)
                if (connInfo?.internalConnectionString) {
                  dbConnectionString = connInfo.internalConnectionString
                  dbReady = true
                  console.log('[Deploy] DB connection string received (attempt ' + (attempt + 1) + ')')
                  break
                }
              } catch (_e) { /* not ready yet */ }
            }
            if (!dbReady) throw new Error('DB did not become ready in time')
          }
        } catch (dbErr: any) {
          results.steps.push({ step: 'render_db', status: 'error', error: dbErr.message })
          results.errors.push('Database creation failed: ' + dbErr.message)
          results.success = false; results.status = 'failed'
          await rollbackResources(createdResources)
          return results
        }
      }
    }

    // Step 4b: R2 media bucket (shared credentials, per-customer bucket)
    // Only create a bucket when the tenant's products actually require file storage.
    let r2BucketName: string | null = null
    let r2EnvVars: Array<{ key: string; value: string }> = []
    if (!isR2Configured()) {
      console.log('[Deploy] R2 not configured — skipping media bucket creation')
    } else if (!needsR2Bucket(products)) {
      console.log('[Deploy] R2 bucket skipped — no file storage required for products:', products.join(', '))
      results.steps.push({ step: 'r2_bucket', status: 'skipped', reason: 'no products require file storage' })
    } else {
      try {
        const bucketSlug = isHomeCare ? slug + '-care' : isFieldService ? slug + '-wrench' : isAutomotive ? slug + '-drive' : isRoofing ? slug + '-roof' : isDispensary ? slug + '-leaf' : slug
        r2BucketName = await createR2Bucket(bucketSlug)
        createdResources.push({ type: 'r2_bucket', id: r2BucketName })
        r2EnvVars = getR2EnvVars(r2BucketName)
        results.steps.push({ step: 'r2_bucket', status: 'ok', bucket: r2BucketName })
        results.r2BucketName = r2BucketName
      } catch (r2Err: any) {
        // Non-critical — services can still run without media storage
        console.warn('[Deploy] R2 bucket creation failed (non-blocking):', r2Err.message)
        results.steps.push({ step: 'r2_bucket', status: 'warning', error: r2Err.message })
      }
    }

    // Build integration env vars from config.
    // Pattern: tenant-provided key wins; fall back to a shared factory key when set.
    // Stripe is intentionally NOT fallback'd — tenant Stripe collects payments from
    // the tenant's customers into the tenant's bank. Factory Stripe bills the tenant
    // their $599/mo. Mixing them would route customer payments to us.
    const integrationEnvVars: Array<{ key: string; value: string }> = []
    const integrations = factoryCustomer.config?.integrations
    const twilioSid = integrations?.twilio?.accountSid || process.env.TWOMIAH_TWILIO_ACCOUNT_SID || ''
    const twilioToken = integrations?.twilio?.authToken || process.env.TWOMIAH_TWILIO_AUTH_TOKEN || ''
    const twilioPhone = integrations?.twilio?.phoneNumber || process.env.TWOMIAH_TWILIO_PHONE || ''
    if (twilioSid) integrationEnvVars.push({ key: 'TWILIO_ACCOUNT_SID', value: twilioSid })
    if (twilioToken) integrationEnvVars.push({ key: 'TWILIO_AUTH_TOKEN', value: twilioToken })
    if (twilioPhone) integrationEnvVars.push({ key: 'TWILIO_PHONE_NUMBER', value: twilioPhone })
    const sendgridKey = integrations?.sendgrid?.apiKey || process.env.TWOMIAH_SENDGRID_API_KEY || ''
    if (sendgridKey) integrationEnvVars.push({ key: 'SENDGRID_API_KEY', value: sendgridKey })
    if (integrations?.stripe?.secretKey) {
      integrationEnvVars.push({ key: 'STRIPE_SECRET_KEY', value: integrations.stripe.secretKey })
      if (integrations.stripe.publishableKey) integrationEnvVars.push({ key: 'STRIPE_PUBLISHABLE_KEY', value: integrations.stripe.publishableKey })
      if (integrations.stripe.webhookSecret) integrationEnvVars.push({ key: 'STRIPE_WEBHOOK_SECRET', value: integrations.stripe.webhookSecret })
    }
    const googleMapsKey = integrations?.googleMaps?.apiKey || process.env.TWOMIAH_GOOGLE_MAPS_KEY || ''
    if (googleMapsKey) integrationEnvVars.push({ key: 'GOOGLE_MAPS_API_KEY', value: googleMapsKey })
    if (integrations?.sentry?.dsn) integrationEnvVars.push({ key: 'SENTRY_DSN', value: integrations.sentry.dsn })
    // Roof estimator: Nearmap high-res imagery + SAM 2 AI segmentation (shared factory keys)
    const nearmapKey = integrations?.nearmap?.apiKey || process.env.TWOMIAH_NEARMAP_KEY || ''
    if (nearmapKey) integrationEnvVars.push({ key: 'NEARMAP_API_KEY', value: nearmapKey })
    const replicateToken = integrations?.replicate?.apiToken || process.env.TWOMIAH_REPLICATE_TOKEN || ''
    if (replicateToken) integrationEnvVars.push({ key: 'REPLICATE_API_TOKEN', value: replicateToken })

    // Pre-compute visualizer flag so we can include VISION_URL in initial env vars for both CRM and website
    const hasVisualizerFeature = products.includes('vision') || (factoryCustomer.config?.features?.website || []).includes('visualizer') || (factoryCustomer.config?.features?.crm || []).includes('visualizer')
    const sharedVisionUrl = process.env.TWOMIAH_VISION_URL || 'https://home-visualizer.onrender.com'

    // Step 5 & 6: CRM backend + frontend
    if (products.some(p => p === 'crm' || p.startsWith('crm-'))) {
      try {
        const tenantPlan = factoryCustomer.planId || factoryCustomer.config?.company?.plan || factoryCustomer.config?.plan || 'starter'
        const backendEnvVars = [
          { key: 'NODE_ENV', value: 'production' },
          { key: 'JWT_SECRET', value: jwtSecret },
          { key: 'JWT_REFRESH_SECRET', value: jwtRefreshSecret },
          { key: 'ENCRYPTION_KEY', value: encryptionKey },
          { key: 'PORT', value: '10000' },
          { key: 'FEATURE_PACKAGE', value: tenantPlan },
          { key: 'FACTORY_SYNC_KEY', value: factorySyncKey },
          { key: 'TENANT_ID', value: factoryCustomer.id },
          { key: 'FACTORY_URL', value: process.env.TWOMIAH_FACTORY_URL || process.env.FACTORY_PUBLIC_URL || 'https://twomiah-factory.onrender.com' },
          ...integrationEnvVars,
          ...r2EnvVars,
        ]
        if (hasVisualizerFeature) {
          backendEnvVars.push({ key: 'VISION_URL', value: sharedVisionUrl })
        }
        // Always include ADS_URL so the ads page works from first deploy
        backendEnvVars.push({ key: 'ADS_URL', value: process.env.TWOMIAH_ADS_URL || 'https://twomiah-ads.onrender.com' })
        if (dbConnectionString) backendEnvVars.push({ key: 'DATABASE_URL', value: dbConnectionString })
        if (supabaseProject) {
          backendEnvVars.push({ key: 'SUPABASE_URL', value: supabaseProject.supabaseUrl })
          backendEnvVars.push({ key: 'SUPABASE_ANON_KEY', value: supabaseProject.anonKey })
          backendEnvVars.push({ key: 'SUPABASE_SERVICE_ROLE_KEY', value: supabaseProject.serviceRoleKey })
        }

        const crmApiName = isHomeCare ? slug + '-care-api' : isFieldService ? slug + '-wrench-api' : isAutomotive ? slug + '-drive-api' : isRoofing ? slug + '-roof-api' : isDispensary ? slug + '-leaf-api' : slug + '-api'
        const crmFrontName = isHomeCare ? slug + '-care' : isFieldService ? slug + '-wrench' : isAutomotive ? slug + '-drive' : isRoofing ? slug + '-roof' : isDispensary ? slug + '-leaf' : slug + '-crm'
        const crmRootDir = isHomeCare ? 'crm-homecare' : isFieldService ? 'crm-fieldservice' : isAutomotive ? 'crm-automotive' : isRoofing ? 'crm-roof' : isDispensary ? 'crm-dispensary' : 'crm'

        // Delete existing services so names are available (avoids random suffixes)
        await findAndDeleteRenderService(crmApiName)
        await findAndDeleteRenderService(crmFrontName) // clean up legacy static sites
        // Also clean up the generic service name in case a previous deploy used the default
        if (crmApiName !== slug + '-api') await findAndDeleteRenderService(slug + '-api')
        if (crmFrontName !== slug + '-crm') await findAndDeleteRenderService(slug + '-crm')

        // Single service: backend builds frontend and serves it (no CDN cache issues)
        const bunSetup = 'curl -fsSL https://bun.sh/install | bash && export PATH=$HOME/.bun/bin:$PATH'
        const backendBuild = bunSetup + ' && cd ../frontend && bun install --no-verify && VITE_API_URL="" VITE_GOOGLE_MAPS_API_KEY="$GOOGLE_MAPS_API_KEY" bun run build && cp -r dist ../backend/frontend-dist && cd ../backend && bun install --no-verify'
        const backendStart = 'export PATH=$HOME/.bun/bin:$PATH && bun db/migrate.ts && bun db/seed.ts && bun src/index.ts'
        const backend = await createRenderWebService({
          name: crmApiName, repoFullName: repo.full_name, rootDir: crmRootDir + '/backend',
          buildCommand: backendBuild,
          startCommand: backendStart,
          envVars: backendEnvVars, plan, region,
        })
        console.log('[Deploy] Backend creation response:', JSON.stringify(backend, null, 2))
        const backendSvc = backend.service || backend
        // Ensure rootDir is set correctly (Render API sometimes ignores top-level rootDir on create)
        if (backendSvc.id) {
          await updateRenderServiceSettings(backendSvc.id, { rootDir: crmRootDir + '/backend' })
        }
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

    // Step 6b: Pricing service (Twomiah Price)
    if (products.includes('pricing')) {
      // Pricing requires its own database — create one if CRM didn't already
      if (!dbConnectionString) {
        try {
          const pricingDbSlug = slug + '-pricing'
          if (isSupabaseManagementConfigured()) {
            supabaseProject = await createSupabaseProject(pricingDbSlug, region)
            createdResources.push({ type: 'supabase_project', id: supabaseProject.ref, name: pricingDbSlug })
            results.steps.push({ step: 'pricing_supabase', status: 'ok', ref: supabaseProject.ref })
            dbConnectionString = supabaseProject.connectionString
          } else {
            const pdb = await createRenderDatabase(pricingDbSlug, region, dbPlan)
            createdResources.push({ type: 'database', id: pdb.id, name: pricingDbSlug + '-db' })
            results.steps.push({ step: 'pricing_render_db', status: 'ok', dbId: pdb.id })
            if (pdb.id) deployedResourceIds.push(pdb.id)
            let dbReady = false
            for (let attempt = 0; attempt < 20; attempt++) {
              await sleep(15000)
              try {
                const connInfo = await getDatabaseConnectionInfo(pdb.id)
                if (connInfo?.internalConnectionString) { dbConnectionString = connInfo.internalConnectionString; dbReady = true; break }
              } catch (_e) { /* not ready yet */ }
            }
            if (!dbReady) throw new Error('Pricing DB did not become ready in time')
          }
        } catch (pdbErr: any) {
          results.steps.push({ step: 'pricing_db', status: 'error', error: pdbErr.message })
          results.errors.push('Pricing DB: ' + pdbErr.message)
        }
      }

      try {
        const pricingApiName = slug + '-pricing-api'
        await findAndDeleteRenderService(pricingApiName)
        const bunSetup = 'curl -fsSL https://bun.sh/install | bash && export PATH=$HOME/.bun/bin:$PATH'
        const pricingBuild = bunSetup + ' && cd ../frontend && bun install --no-verify && VITE_API_URL="" bun run build && cp -r dist ../backend/frontend-dist && cd ../backend && bun install --no-verify'
        const pricingStart = 'export PATH=$HOME/.bun/bin:$PATH && bun db/migrate.ts && bun db/seed.ts && bun src/index.ts'
        const pricingEnvVars = [
          { key: 'NODE_ENV', value: 'production' },
          { key: 'JWT_SECRET', value: jwtSecret },
          { key: 'PORT', value: '10000' },
          ...r2EnvVars,
        ]
        if (dbConnectionString) pricingEnvVars.push({ key: 'DATABASE_URL', value: dbConnectionString })
        if (supabaseProject) {
          pricingEnvVars.push({ key: 'SUPABASE_URL', value: supabaseProject.supabaseUrl })
          pricingEnvVars.push({ key: 'SUPABASE_ANON_KEY', value: supabaseProject.anonKey })
        }
        // Link to CRM if also deploying CRM
        if (results.apiUrl) pricingEnvVars.push({ key: 'CRM_API_URL', value: results.apiUrl })

        const pricing = await createRenderWebService({
          name: pricingApiName, repoFullName: repo.full_name, rootDir: 'pricing/backend',
          buildCommand: pricingBuild,
          startCommand: pricingStart,
          envVars: pricingEnvVars, plan, region,
        })
        const pricingSvc = pricing.service || pricing
        results.steps.push({ step: 'render_pricing', status: 'ok', serviceId: pricingSvc.id })
        results.services.pricing = pricingSvc
        if (pricingSvc.id) {
          createdResources.push({ type: 'service', id: pricingSvc.id, name: pricingApiName })
          deployedResourceIds.push(pricingSvc.id)
        }
        const pricingUrl = 'https://' + (pricingSvc.slug || pricingApiName) + '.onrender.com'
        results.pricingUrl = pricingUrl
        if (!results.deployedUrl) results.deployedUrl = pricingUrl
      } catch (err: any) {
        results.steps.push({ step: 'render_pricing', status: 'error', error: err.message })
        results.errors.push('Pricing: ' + err.message)
      }
    }

    // Step 7: Website service
    if (products.includes('website')) {
      try {
        await findAndDeleteRenderService(slug + '-site')
        const siteBunSetup = 'curl -fsSL https://bun.sh/install | bash && export PATH=$HOME/.bun/bin:$PATH'
        const siteEnvVars: Array<{ key: string; value: string }> = [
            { key: 'NODE_ENV', value: 'production' },
            { key: 'PORT', value: '10000' },
            { key: 'JWT_SECRET', value: jwtSecret },
            { key: 'SITE_NAME', value: factoryCustomer.name || slug },
            { key: 'TENANT_SLUG', value: slug },
            ...r2EnvVars,
        ]
        if (hasVisualizerFeature) {
          siteEnvVars.push({ key: 'VISION_URL', value: sharedVisionUrl })
        }
        const hasEstimatorFeature = (factoryCustomer.config?.features?.crm || []).includes('instant_estimator') || (factoryCustomer.config?.features?.website || []).includes('instant_estimator')
        if (hasEstimatorFeature) {
          siteEnvVars.push({ key: 'HAS_ESTIMATOR', value: 'true' })
        }
        if (results.apiUrl) {
          siteEnvVars.push({ key: 'CRM_API_URL', value: results.apiUrl })
          siteEnvVars.push({ key: 'WEBHOOK_SECRET', value: jwtSecret })
        }
        const site = await createRenderWebService({
          name: slug + '-site', repoFullName: repo.full_name, rootDir: 'website',
          buildCommand: siteBunSetup + ' && bun install --no-verify && if [ -f admin/package.json ]; then cd admin && bun install --no-verify && bun run build:quick && cd ..; fi',
          startCommand: 'export PATH=$HOME/.bun/bin:$PATH && NODE_ENV=production bun server-static.ts',
          envVars: siteEnvVars,
          plan, region,
        })
        console.log('[Deploy] Website creation response:', JSON.stringify(site, null, 2))
        const siteSvc = site.service || site
        results.steps.push({ step: 'render_site', status: 'ok', serviceId: siteSvc.id })
        results.services.site = siteSvc
        if (siteSvc.id) {
          createdResources.push({ type: 'service', id: siteSvc.id, name: slug + '-site' })
          deployedResourceIds.push(siteSvc.id)
          await updateRenderServiceSettings(siteSvc.id, { rootDir: 'website' })
        }
        const siteUrl = getServiceUrl(site)
        console.log('[Deploy] Resolved website URL:', siteUrl)
        results.siteUrl = siteUrl
        // Set SITE_URL and CRM integration env vars
        if (siteSvc.id) {
          const siteEnvUpdates: Array<{ key: string; value: string }> = []
          if (siteUrl) siteEnvUpdates.push({ key: 'SITE_URL', value: siteUrl })
          if (results.apiUrl) {
            siteEnvUpdates.push({ key: 'CRM_API_URL', value: results.apiUrl })
            siteEnvUpdates.push({ key: 'WEBHOOK_SECRET', value: jwtSecret })
          }
          if (siteEnvUpdates.length > 0) await updateRenderEnvVars(siteSvc.id, siteEnvUpdates)
        }
      } catch (err: any) {
        results.steps.push({ step: 'render_site', status: 'error', error: err.message })
        results.errors.push('Site: ' + err.message)
      }
    }

    // Step 8: Vision
    // Standalone (vision only, no website) → create a separate Render service.
    // Bundled with website → embedded in the contractor template, no separate service.
    if (products.includes('vision') && !products.includes('website')) {
      // Standalone Vision — separate Render service
      try {
        const visionName = slug + '-vision'
        await findAndDeleteRenderService(visionName)
        const visionBuildCmd = 'npm install --include=dev && npm run build'
        const visionStartCmd = 'npm start'
        const visionEnvVars: Array<{ key: string; value: string }> = [
          { key: 'NODE_ENV', value: 'production' },
          { key: 'PORT', value: '10000' },
        ]
        const visionIntegrations = factoryCustomer.config?.integrations || {} as any
        if (visionIntegrations.supabaseUrl) visionEnvVars.push({ key: 'NEXT_PUBLIC_SUPABASE_URL', value: visionIntegrations.supabaseUrl })
        if (visionIntegrations.supabaseAnonKey) visionEnvVars.push({ key: 'NEXT_PUBLIC_SUPABASE_ANON_KEY', value: visionIntegrations.supabaseAnonKey })
        if (visionIntegrations.supabaseServiceKey) visionEnvVars.push({ key: 'SUPABASE_SERVICE_ROLE_KEY', value: visionIntegrations.supabaseServiceKey })
        if (visionIntegrations.openaiKey) visionEnvVars.push({ key: 'OPENAI_API_KEY', value: visionIntegrations.openaiKey })
        if (visionIntegrations.stripeSecretKey) visionEnvVars.push({ key: 'STRIPE_SECRET_KEY', value: visionIntegrations.stripeSecretKey })
        if (visionIntegrations.stripePublishableKey) visionEnvVars.push({ key: 'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY', value: visionIntegrations.stripePublishableKey })
        if (visionIntegrations.stripeWebhookSecret) visionEnvVars.push({ key: 'STRIPE_WEBHOOK_SECRET', value: visionIntegrations.stripeWebhookSecret })
        if (visionIntegrations.resendKey) visionEnvVars.push({ key: 'RESEND_API_KEY', value: visionIntegrations.resendKey })

        const vision = await createRenderWebService({
          name: visionName, repoFullName: repo.full_name, rootDir: 'vision',
          buildCommand: visionBuildCmd, startCommand: visionStartCmd,
          envVars: visionEnvVars,
          plan: 'standard', region,
        })
        console.log('[Deploy] Vision (standalone) creation response:', JSON.stringify(vision, null, 2))
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
        if (visionSvc.id) {
          await updateRenderEnvVars(visionSvc.id, [{ key: 'NEXT_PUBLIC_BASE_URL', value: visionUrl }])
        }
      } catch (err: any) {
        results.steps.push({ step: 'render_vision', status: 'error', error: err.message })
        results.errors.push('Vision: ' + err.message)
      }
    }

    // Bundled Vision — register with shared Vision backend and set VISION_URL on CRM backend.
    // VISION_URL is already included in the website service's initial env vars above.
    if (hasVisualizerFeature) {
      try {
        await registerVisualizerTenant(slug, factoryCustomer.name || slug, factoryCustomer.config?.company)
        createdResources.push({ type: 'vision_tenant', id: slug })
        results.steps.push({ step: 'visualizer_tenant', status: 'ok' })

        results.visionUrl = sharedVisionUrl
        if (results.services.backend?.id) {
          await updateRenderEnvVars(results.services.backend.id, [{ key: 'VISION_URL', value: sharedVisionUrl }])
        }
      } catch (err: any) {
        console.warn('[Deploy] Could not register visualizer tenant:', err.message)
        results.steps.push({ step: 'visualizer_tenant', status: 'warning', error: err.message })
      }
    }

    // Always set ADS_URL on every CRM deploy so the ads page works
    const adsUrl = process.env.TWOMIAH_ADS_URL || 'https://twomiah-ads.onrender.com'
    if (results.services.backend?.id) {
      const adsEnvVars: { key: string; value: string }[] = [
        { key: 'ADS_URL', value: adsUrl },
      ]

      // Try to register tenant with ads service for API key
      const crmFeatures = factoryCustomer.config?.features?.crm || []
      const hasPaidAds = factoryCustomer.config?.features?.paid_ads || crmFeatures.includes('paid_ads') || crmFeatures.includes('ads')
      if (hasPaidAds) {
        try {
          const adsResult = await registerAdsTenant(slug, factoryCustomer.name || slug, factoryCustomer.config?.company)
          if (adsResult.apiKey) {
            adsEnvVars.push({ key: 'ADS_API_KEY', value: adsResult.apiKey })
            results.steps.push({ step: 'ads_tenant', status: 'ok', url: adsUrl })
          } else {
            results.steps.push({ step: 'ads_tenant', status: 'partial', note: 'ADS_URL set but no API key — tenant registration failed or skipped' })
          }
        } catch (err: any) {
          console.warn('[Deploy] Could not register ads tenant:', err.message)
          results.steps.push({ step: 'ads_tenant', status: 'warning', error: err.message })
        }
      }

      // ADS_URL is always set regardless of provisioning success
      await updateRenderEnvVars(results.services.backend.id, adsEnvVars)
      results.adsUrl = adsUrl
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

    if (dbConnectionString) results.dbConnectionString = dbConnectionString
    results.factorySyncKey = factorySyncKey
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
      const res = await fetchWithTimeout(RENDER_API + '/services/' + serviceId + '/deploys', { method: 'POST', headers: renderHeaders(), body: JSON.stringify({ clearCache: 'clear' }) })
      if (res.ok) { const deploy = await res.json() as any; results[role] = { status: 'triggered', deployId: deploy.id } }
      else { results[role] = { status: 'failed' } }
    } catch (err: any) { results[role] = { status: 'error', error: err.message } }
  }
  return results
}

/**
 * Update code for an existing customer WITHOUT destroying anything.
 *
 * Safe update flow:
 * 1. Extract new code from zip
 * 2. Push to EXISTING GitHub repo (no delete/recreate)
 * 3. Trigger Render redeploy (existing service, existing DB)
 * 4. Render runs: migrate (additive only) → seed (idempotent) → start
 *
 * Database is NEVER touched. Service URL is NEVER changed.
 * Only the code is updated.
 */
export async function updateCustomerCode(
  factoryCustomer: {
    id: string
    slug: string
    name?: string
    renderServiceIds?: Record<string, string>
  },
  zipPath: string,
): Promise<{ success: boolean; steps: Array<{ step: string; status: string; detail?: string }>; errors: string[] }> {
  const slug = factoryCustomer.slug
  const steps: Array<{ step: string; status: string; detail?: string }> = []
  const errors: string[] = []

  const org = process.env.GITHUB_ORG || process.env.GITHUB_USER
  if (!org) return { success: false, steps, errors: ['GITHUB_ORG or GITHUB_USER must be set'] }

  const repoFullName = org + '/' + slug
  let extractDir = ''

  try {
    // Step 1: Verify the GitHub repo exists (do NOT create or delete)
    const repoCheck = await fetchWithTimeout(GITHUB_API + '/repos/' + repoFullName, { headers: githubHeaders() })
    if (repoCheck.status === 404) {
      return { success: false, steps, errors: [`GitHub repo ${repoFullName} not found. Use deployCustomer() for first-time deploys.`] }
    }
    steps.push({ step: 'verify_repo', status: 'ok', detail: repoFullName })

    // Step 2: Extract zip to temp directory
    const tmpBase = process.env.TEMP || process.env.TMP || (process.platform === 'win32' ? 'C:\\Windows\\Temp' : '/tmp')
    extractDir = path.join(tmpBase, 'update-' + slug + '-' + Date.now())
    fs.mkdirSync(extractDir, { recursive: true })
    const zip = new AdmZip(zipPath)
    zip.extractAllTo(extractDir, true)
    steps.push({ step: 'extract', status: 'ok' })

    // Step 3: Push new code to existing repo
    // Uses force push on main — the repo is Factory-managed, not manually edited
    const token = process.env.GITHUB_TOKEN
    const cmds: string[][] = [
      ['git', 'init'],
      ['git', 'checkout', '-b', 'main'],
      ['git', 'config', 'user.email', 'factory@twomiah.app'],
      ['git', 'config', 'user.name', 'Twomiah Factory'],
      ['git', 'config', 'credential.helper', ''],
      ['git', 'remote', 'add', 'origin', 'https://github.com/' + repoFullName + '.git'],
      ['git', 'add', '-A'],
      ['git', 'commit', '-m', 'Code update from Twomiah Factory — ' + new Date().toISOString().split('T')[0]],
      ['git', 'push', 'origin', 'main', '--force'],
    ]

    for (const [cmd, ...args] of cmds) {
      const env = { ...process.env } as Record<string, string>
      if (cmd === 'git' && args[0] === 'push') {
        env.GIT_ASKPASS = 'echo'
        env.GIT_TERMINAL_PROMPT = '0'
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
    steps.push({ step: 'push_code', status: 'ok', detail: 'Force pushed to ' + repoFullName })

    // Step 4: Trigger Render redeploy if we have service IDs
    // If Render has autoDeploy enabled, this happens automatically from the git push.
    // We trigger manually as a fallback.
    const serviceIds = factoryCustomer.renderServiceIds
    if (serviceIds && Object.keys(serviceIds).length > 0) {
      for (const [role, serviceId] of Object.entries(serviceIds)) {
        try {
          const res = await fetchWithTimeout(RENDER_API + '/services/' + serviceId + '/deploys', {
            method: 'POST',
            headers: renderHeaders(),
            body: JSON.stringify({ clearCache: 'clear' }),
          })
          if (res.ok) {
            steps.push({ step: 'redeploy_' + role, status: 'ok', detail: serviceId })
          } else {
            steps.push({ step: 'redeploy_' + role, status: 'warning', detail: 'Render returned ' + res.status + ' — autoDeploy may handle it' })
          }
        } catch (err: any) {
          steps.push({ step: 'redeploy_' + role, status: 'warning', detail: err.message })
        }
      }
    } else {
      steps.push({ step: 'redeploy', status: 'skipped', detail: 'No renderServiceIds — Render autoDeploy will pick up the git push' })
    }

    return { success: true, steps, errors }
  } catch (err: any) {
    errors.push(err.message)
    return { success: false, steps, errors }
  } finally {
    // Cleanup temp directory
    if (extractDir && fs.existsSync(extractDir)) {
      try { fs.rmSync(extractDir, { recursive: true, force: true }) } catch {}
    }
  }
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


// ─── Domain Infrastructure Wiring ────────────────────────────────────────────
// Called after a tenant's Render services exist AND tenants.domain is set.
// Creates the Cloudflare zone, writes all DNS records (DNS-only, never
// proxied — see cloudflare.ts header for why), enables Email Routing,
// authenticates the domain with SendGrid for outbound DKIM/SPF, and attaches
// the custom domain to the Render services for TLS termination.
//
// Safe to call repeatedly: zone creation checks for existing zone, DNS writes
// swallow "already exists" errors, SendGrid domain auth can be re-polled.
// On partial failure, returns steps/errors so the caller can decide whether
// to retry or surface to the admin.

export interface WireDomainOptions {
  domain: string
  // Render service slugs (NOT IDs) for CNAME targets (e.g. "tenant-api")
  backendSlug?: string
  siteSlug?: string
  // Render service IDs for addCustomDomain attachment
  backendServiceId?: string
  siteServiceId?: string
  // Admin email used for DMARC aggregate reports (rua). Falls back to dmarc@<domain>.
  adminEmailForDmarc?: string
  // Existing IDs so we don't re-create on retry
  existingCloudflareZoneId?: string
  existingSendgridDomainAuthId?: number
}

export interface WireDomainResult {
  success: boolean
  domain: string
  cloudflareZoneId?: string
  cloudflareNameServers?: string[]
  sendgridDomainAuthId?: number
  steps: Array<{ step: string; status: string; detail?: string }>
  errors: string[]
}

export async function wireDomainInfrastructure(opts: WireDomainOptions): Promise<WireDomainResult> {
  const result: WireDomainResult = { success: false, domain: opts.domain, steps: [], errors: [] }

  if (!cloudflare.isCloudflareConfigured()) {
    result.errors.push('Cloudflare not configured')
    return result
  }
  if (!sendgrid.isSendGridConfigured()) {
    result.errors.push('SendGrid not configured')
    return result
  }

  // ─── 1. Cloudflare zone ──────────────────────────────────────────────────
  let zoneId = opts.existingCloudflareZoneId
  try {
    if (!zoneId) {
      const zone = await cloudflare.createZone(opts.domain)
      zoneId = zone.zoneId
      result.cloudflareNameServers = zone.nameServers
      result.steps.push({ step: 'cloudflare_zone', status: 'ok', detail: zoneId })
    } else {
      result.steps.push({ step: 'cloudflare_zone', status: 'ok', detail: 'reused ' + zoneId })
    }
    result.cloudflareZoneId = zoneId
  } catch (e: any) {
    // "Zone already exists" on Cloudflare means another account owns it, OR we've already created it but lost the ID. Surface cleanly.
    result.steps.push({ step: 'cloudflare_zone', status: 'error', detail: e.message })
    result.errors.push('Cloudflare zone: ' + e.message)
    return result
  }

  // Helper: write a record and swallow "already exists" style errors
  const writeRecord = async (spec: cloudflare.DnsRecordSpec, label: string) => {
    try {
      await cloudflare.addDnsRecord(zoneId!, spec)
      result.steps.push({ step: 'dns_' + label, status: 'ok', detail: spec.type + ' ' + spec.name })
    } catch (e: any) {
      const msg = String(e.message || '')
      if (msg.toLowerCase().includes('already exists') || msg.includes('identical record') || msg.includes('81057') || msg.includes('81058')) {
        result.steps.push({ step: 'dns_' + label, status: 'ok', detail: 'already present' })
      } else {
        result.steps.push({ step: 'dns_' + label, status: 'error', detail: msg })
        result.errors.push('DNS ' + label + ': ' + msg)
      }
    }
  }

  // ─── 2. DNS: apex + www + app (CNAME flattening) ─────────────────────────
  // Cloudflare supports CNAME at apex via CNAME flattening — no Render IP
  // pinning needed. Target the website slug if deployed, else the backend.
  const apexTarget = opts.siteSlug ? opts.siteSlug + '.onrender.com' : (opts.backendSlug ? opts.backendSlug + '.onrender.com' : '')
  if (apexTarget) {
    await writeRecord({ type: 'CNAME', name: '@', content: apexTarget, proxied: false }, 'apex')
    await writeRecord({ type: 'CNAME', name: 'www', content: apexTarget, proxied: false }, 'www')
  } else {
    result.steps.push({ step: 'dns_apex', status: 'skipped', detail: 'no website/backend slug provided' })
  }

  if (opts.backendSlug) {
    await writeRecord({ type: 'CNAME', name: 'app', content: opts.backendSlug + '.onrender.com', proxied: false }, 'app')
  }

  // ─── 3. Cloudflare Email Routing (writes MX automatically) ───────────────
  try {
    await cloudflare.enableEmailRouting(zoneId)
    result.steps.push({ step: 'email_routing_enable', status: 'ok' })
  } catch (e: any) {
    const msg = String(e.message || '')
    if (msg.toLowerCase().includes('already enabled')) {
      result.steps.push({ step: 'email_routing_enable', status: 'ok', detail: 'already enabled' })
    } else {
      result.steps.push({ step: 'email_routing_enable', status: 'warning', detail: msg })
    }
  }

  // ─── 4. SendGrid domain authentication ──────────────────────────────────
  let sgId = opts.existingSendgridDomainAuthId
  try {
    if (!sgId) {
      const auth = await sendgrid.authenticateDomain(opts.domain)
      sgId = auth.id
      result.sendgridDomainAuthId = auth.id
      // Write each returned CNAME to Cloudflare — these are the SPF/DKIM records SendGrid checks
      for (const rec of auth.records) {
        // SendGrid's host field includes the full FQDN — strip the base domain so
        // Cloudflare treats it as a relative record under the zone.
        const rel = rec.host.endsWith('.' + opts.domain) ? rec.host.slice(0, -(opts.domain.length + 1)) : rec.host
        if (rec.type === 'cname') {
          await writeRecord({ type: 'CNAME', name: rel, content: rec.data, proxied: false }, 'sendgrid_' + rel)
        } else if (rec.type === 'txt') {
          await writeRecord({ type: 'TXT', name: rel, content: rec.data }, 'sendgrid_txt_' + rel)
        } else if (rec.type === 'mx') {
          // MX is managed by Cloudflare Email Routing for the apex; SendGrid's inbound-parse MX lives on a dedicated hostname we run factory-wide. Skip per-tenant SendGrid MX.
          result.steps.push({ step: 'sendgrid_mx_' + rel, status: 'skipped', detail: 'factory-wide parse MX handles this' })
        }
      }
      result.steps.push({ step: 'sendgrid_authenticate', status: 'ok', detail: 'id=' + auth.id })
    } else {
      result.sendgridDomainAuthId = sgId
      result.steps.push({ step: 'sendgrid_authenticate', status: 'ok', detail: 'reused id=' + sgId })
    }
  } catch (e: any) {
    result.steps.push({ step: 'sendgrid_authenticate', status: 'error', detail: e.message })
    result.errors.push('SendGrid: ' + e.message)
  }

  // ─── 5. SPF + DMARC ─────────────────────────────────────────────────────
  // SPF is additive to whatever SendGrid's CNAMEs publish — this consolidated
  // TXT at the apex advertises SendGrid as the only authorized sender.
  await writeRecord({ type: 'TXT', name: '@', content: 'v=spf1 include:sendgrid.net -all' }, 'spf')

  // DMARC p=none per plan decision: monitor-only for the first 30 days so we
  // can tighten to quarantine/reject after clean reports come in.
  const dmarcRua = opts.adminEmailForDmarc || ('dmarc@' + opts.domain)
  const dmarcValue = 'v=DMARC1; p=none; rua=mailto:' + dmarcRua + '; ruf=mailto:' + dmarcRua + '; sp=none; aspf=r;'
  await writeRecord({ type: 'TXT', name: '_dmarc', content: dmarcValue }, 'dmarc')

  // ─── 6. Attach custom domains to Render services ────────────────────────
  const siteSvc = opts.siteServiceId || opts.backendServiceId
  if (siteSvc) {
    const r1 = await addCustomDomain(siteSvc, opts.domain)
    result.steps.push({ step: 'render_custom_apex', status: r1.success || r1.error?.includes('already') ? 'ok' : 'warning', detail: r1.error })
    const r2 = await addCustomDomain(siteSvc, 'www.' + opts.domain)
    result.steps.push({ step: 'render_custom_www', status: r2.success || r2.error?.includes('already') ? 'ok' : 'warning', detail: r2.error })
  }
  if (opts.backendServiceId) {
    const r3 = await addCustomDomain(opts.backendServiceId, 'app.' + opts.domain)
    result.steps.push({ step: 'render_custom_app', status: r3.success || r3.error?.includes('already') ? 'ok' : 'warning', detail: r3.error })
  }

  result.success = result.errors.length === 0
  return result
}


// ─── R2 Upgrade Path ─────────────────────────────────────────────────────────

/**
 * Provision an R2 bucket for an existing tenant that didn't get one initially
 * (e.g. tenant started on a vision-only product and later upgraded to a CRM).
 *
 * Creates the bucket, updates the tenant record with r2_bucket_name,
 * pushes updated R2 env vars to all of the tenant's Render services,
 * and triggers a redeploy so the new env vars take effect.
 */
export async function provisionR2ForExistingTenant(
  tenantId: string,
  supabase: any,
): Promise<{ success: boolean; bucketName?: string; error?: string }> {
  if (!isR2Configured()) {
    return { success: false, error: 'R2 is not configured on this Factory instance' }
  }

  // 1. Fetch tenant
  const { data: tenant, error: fetchErr } = await supabase
    .from('tenants')
    .select('id, slug, industry, r2_bucket_name, render_service_ids')
    .eq('id', tenantId)
    .single()

  if (fetchErr || !tenant) {
    return { success: false, error: 'Tenant not found: ' + (fetchErr?.message || tenantId) }
  }

  if (tenant.r2_bucket_name) {
    console.log('[Deploy] Tenant', tenant.slug, 'already has R2 bucket:', tenant.r2_bucket_name)
    return { success: true, bucketName: tenant.r2_bucket_name }
  }

  // 2. Create bucket
  const ind = tenant.industry || ''
  const bucketSlug = ind === 'home_care' ? tenant.slug + '-care'
    : ['field_service', 'hvac', 'plumbing', 'electrical'].includes(ind) ? tenant.slug + '-wrench'
    : ind === 'automotive' ? tenant.slug + '-drive'
    : ind === 'roofing' ? tenant.slug + '-roof'
    : ind === 'dispensary' ? tenant.slug + '-leaf'
    : tenant.slug

  let bucketName: string
  try {
    bucketName = await createR2Bucket(bucketSlug)
    console.log('[Deploy] Provisioned R2 bucket for existing tenant', tenant.slug, ':', bucketName)
  } catch (err: any) {
    return { success: false, error: 'R2 bucket creation failed: ' + err.message }
  }

  // 3. Update tenant record
  const { error: updateErr } = await supabase
    .from('tenants')
    .update({ r2_bucket_name: bucketName })
    .eq('id', tenantId)

  if (updateErr) {
    console.warn('[Deploy] Failed to update tenant record with R2 bucket:', updateErr.message)
  }

  // 4. Push R2 env vars to all Render services
  const r2Env = getR2EnvVars(bucketName)
  const serviceIds = tenant.render_service_ids as Record<string, string> | null
  if (serviceIds) {
    for (const [role, serviceId] of Object.entries(serviceIds)) {
      try {
        await updateRenderEnvVars(serviceId, r2Env)
        console.log('[Deploy] Updated R2 env vars on', role, 'service:', serviceId)
      } catch (err: any) {
        console.warn('[Deploy] Failed to update env vars for', role, ':', err.message)
      }
    }

    // 5. Trigger redeploy on all services
    for (const [role, serviceId] of Object.entries(serviceIds)) {
      try {
        await fetchWithTimeout(RENDER_API + '/services/' + serviceId + '/deploys', {
          method: 'POST', headers: renderHeaders(), body: JSON.stringify({}),
        })
        console.log('[Deploy] Triggered redeploy for', role, ':', serviceId)
      } catch (err: any) {
        console.warn('[Deploy] Failed to trigger redeploy for', role, ':', err.message)
      }
    }
  }

  return { success: true, bucketName }
}

async function deleteVisionTenant(slug: string) {
  const supabaseUrl = process.env.VISION_SUPABASE_URL
  const supabaseKey = process.env.VISION_SUPABASE_SERVICE_KEY
  if (!supabaseUrl || !supabaseKey) return

  const res = await fetchWithTimeout(supabaseUrl + '/rest/v1/tenants?slug=eq.' + encodeURIComponent(slug), {
    method: 'DELETE',
    headers: {
      'apikey': supabaseKey,
      'Authorization': 'Bearer ' + supabaseKey,
      'Content-Type': 'application/json',
    },
  })

  if (!res.ok && res.status !== 404) {
    throw new Error('Vision tenant delete failed (' + res.status + '): ' + await res.text())
  }
  console.log('[Deploy] Deleted Vision tenant:', slug)
}

async function registerVisualizerTenant(slug: string, companyName: string, company?: any) {
  const supabaseUrl = process.env.VISION_SUPABASE_URL
  const supabaseKey = process.env.VISION_SUPABASE_SERVICE_KEY
  if (!supabaseUrl || !supabaseKey) {
    console.log('[Deploy] Skipping visualizer tenant registration — VISION_SUPABASE_URL/SERVICE_KEY not set')
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

async function registerAdsTenant(slug: string, companyName: string, company?: any): Promise<{ url: string; apiKey: string }> {
  const adsUrl = process.env.TWOMIAH_ADS_URL || 'https://twomiah-ads.onrender.com'
  const webhookSecret = process.env.ADS_WEBHOOK_SECRET || process.env.CRON_SECRET
  if (!webhookSecret) {
    console.warn('[Deploy] No ADS_WEBHOOK_SECRET or CRON_SECRET — skipping ads tenant registration for:', slug)
    return { url: '', apiKey: '' }
  }

  const body = {
    tenantName: companyName,
    industry: company?.industry || 'general',
    subdomain: slug,
    factoryInstanceId: slug,
    clientData: {
      business_name: companyName,
      phone: company?.phone || '',
      website_url: company?.domain ? 'https://' + company.domain : '',
      city: company?.city || '',
      state: company?.state || '',
    },
  }

  // Wake up the ads service first (it's on free tier and may be sleeping)
  try { await fetchWithTimeout(adsUrl + '/health', {}, 60_000) } catch {}

  const res = await fetchWithTimeout(adsUrl + '/factory/provision', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Factory-Signature': webhookSecret,
    },
    body: JSON.stringify(body),
  }, 60_000)

  if (res.status === 409) {
    // Tenant exists — fetch the API key from the response body
    try {
      const existing = await res.json()
      console.log('[Deploy] Ads tenant already exists:', slug, 'apiKey:', existing.apiKey ? 'present' : 'missing')
      return { url: adsUrl, apiKey: existing.apiKey || '' }
    } catch {
      console.log('[Deploy] Ads tenant already exists:', slug, '(no body)')
      return { url: adsUrl, apiKey: '' }
    }
  }

  if (!res.ok) {
    throw new Error('Ads tenant registration failed (' + res.status + '): ' + await res.text())
  }

  const data = await res.json()
  console.log('[Deploy] Registered ads tenant:', slug, 'tenantId:', data.tenantId)
  return { url: adsUrl, apiKey: data.apiKey || '' }
}
