/**
 * Factory test matrix runner.
 *
 * Spins up tenants flagged is_test_tenant=true, runs them through
 * generate (and optionally deploy), exercises a smoke check on the
 * result, then nukes everything via hardDeleteTestTenant — so we never
 * leave Render DBs piling up.
 *
 * Modes:
 *   smoke      6 tests, one per vertical, mixed plan/website/domain choices.
 *              Verifies every code path with minimal redundancy.
 *   full       108 tests — 6 verticals × 2 plans × 3 website modes × 3 domain modes.
 *              True full-coverage matrix. Expensive (~hours, many Render slots).
 *
 * Flags:
 *   --mode=<smoke|full>           default: smoke
 *   --with-deploy                 actually deploy to Render (skipped by default —
 *                                 default mode is generate-only, no Render slot used)
 *   --concurrency=<n>             default: 1. Stay low to respect Render concurrent
 *                                 service caps + Stripe/Cloudflare/etc rate limits.
 *   --audit-dir=<path>            default: scripts/test-audit/<timestamp>
 *   --pace-ms=<n>                 sleep between tests when --with-deploy
 *                                 is set, to dodge Render's API rate limit
 *                                 (default: 90s with deploy, 0 without).
 *
 * Usage:
 *   cd apps/api
 *   bun run scripts/test-factory-matrix.ts                  # smoke, generate-only
 *   bun run scripts/test-factory-matrix.ts --with-deploy    # smoke + real deploys
 *   bun run scripts/test-factory-matrix.ts --mode=full      # full matrix, gen-only
 *
 * SAFETY: every tenant we create is flagged is_test_tenant=true. Cleanup
 * refuses to act on rows without that flag, so this script can NEVER
 * delete a real customer. The 6h orphan-cleanup cron is a backstop in
 * case the in-script cleanup fails or the runner is killed mid-test.
 */
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const envPath = path.join(__dirname, '..', '.env')
for (const rawLine of fs.readFileSync(envPath, 'utf8').split('\n')) {
  const line = rawLine.replace(/\r$/, '')
  const m = line.match(/^([^#=]+)=(.*)$/)
  if (m && !process.env[m[1].trim()]) process.env[m[1].trim()] = m[2].trim()
}

import { supabase } from '../src/middleware/auth'
import { generate } from '../src/services/generator'
import { deployCustomer, isConfigured as isDeployConfigured, checkDeployStatus } from '../src/services/deploy'
import { hardDeleteTestTenant } from '../src/services/testCleanup'

const args = Object.fromEntries(
  process.argv.slice(2).map(a => {
    if (a.startsWith('--')) {
      const eq = a.indexOf('=')
      if (eq === -1) return [a.slice(2), 'true']
      return [a.slice(2, eq), a.slice(eq + 1)]
    }
    return [a, 'true']
  })
) as Record<string, string>

const MODE = args.mode === 'full' ? 'full' : 'smoke'
const WITH_DEPLOY = args['with-deploy'] === 'true'
const CONCURRENCY = parseInt(args.concurrency || '1', 10)
// --limit=n runs only the first n tests of the chosen matrix. Useful for
// probing Render rate-limit recovery without burning the whole budget.
const LIMIT = args.limit ? parseInt(args.limit, 10) : 0
// --cases=2,4,5 runs only the specified case numbers (1-indexed). Lets us
// re-probe specific failures after a fix without re-running the passers.
const CASES = args.cases ? args.cases.split(',').map(s => parseInt(s.trim(), 10) - 1) : null
const AUDIT_DIR = args['audit-dir'] || path.join(__dirname, 'test-audit', new Date().toISOString().replace(/[:.]/g, '-'))
// Render's API rate-limits resource creation. Premium tests now create
// 2 DBs each (CRM + site), which doubles quota burn — 90s pacing was
// enough for 1-DB tests but landscaping in probe-final-final hit a 429
// on its second DB creation. Bumping default to 180s for --with-deploy.
// Generate-only mode hits no external APIs, so pacing defaults to 0.
const PACE_MS = parseInt(args['pace-ms'] || (WITH_DEPLOY ? '180000' : '0'), 10)

// ── Matrix definitions ──────────────────────────────────────────────────

type Vertical = 'contractor' | 'fieldservice' | 'homecare' | 'roofing' | 'landscaping' | 'dispensary'
type WebsiteMode = 'none' | 'standard' | 'premium'
type DomainMode = 'skip' | 'byod' | 'buy'

interface TestCase {
  vertical: Vertical
  industry: string
  plan: 'entry' | 'top'
  websiteMode: WebsiteMode
  domainMode: DomainMode
}

const INDUSTRY_BY_VERTICAL: Record<Vertical, string> = {
  contractor: 'general_contractor',
  fieldservice: 'hvac',
  homecare: 'home_care',
  roofing: 'roofing',
  landscaping: 'landscaping',
  dispensary: 'dispensary',
}

const SMOKE_CASES: TestCase[] = [
  // One per vertical, rotating choices so every code path is hit at least once
  { vertical: 'contractor',   industry: 'general_contractor', plan: 'entry', websiteMode: 'standard', domainMode: 'buy' },
  { vertical: 'fieldservice', industry: 'hvac',               plan: 'top',   websiteMode: 'premium',  domainMode: 'byod' },
  { vertical: 'homecare',     industry: 'home_care',          plan: 'entry', websiteMode: 'none',     domainMode: 'skip' },
  { vertical: 'roofing',      industry: 'roofing',            plan: 'top',   websiteMode: 'standard', domainMode: 'byod' },
  { vertical: 'landscaping',  industry: 'landscaping',        plan: 'entry', websiteMode: 'premium',  domainMode: 'buy' },
  { vertical: 'dispensary',   industry: 'dispensary',         plan: 'top',   websiteMode: 'standard', domainMode: 'skip' },
]

function buildFullMatrix(): TestCase[] {
  const cases: TestCase[] = []
  const verticals: Vertical[] = ['contractor', 'fieldservice', 'homecare', 'roofing', 'landscaping', 'dispensary']
  const plans: Array<'entry' | 'top'> = ['entry', 'top']
  const webModes: WebsiteMode[] = ['none', 'standard', 'premium']
  const domModes: DomainMode[] = ['skip', 'byod', 'buy']
  for (const v of verticals) {
    for (const plan of plans) {
      for (const web of webModes) {
        for (const dom of domModes) {
          cases.push({ vertical: v, industry: INDUSTRY_BY_VERTICAL[v], plan, websiteMode: web, domainMode: dom })
        }
      }
    }
  }
  return cases
}

let MATRIX = MODE === 'full' ? buildFullMatrix() : SMOKE_CASES
if (CASES) MATRIX = CASES.map(i => MATRIX[i]).filter((c): c is TestCase => !!c)
if (LIMIT > 0) MATRIX = MATRIX.slice(0, LIMIT)

// ── Audit log ────────────────────────────────────────────────────────────

interface AuditEntry {
  testId: string
  case: TestCase
  steps: Array<{ step: string; status: 'ok' | 'warning' | 'error' | 'skipped'; detail?: string; ms?: number }>
  startedAt: string
  finishedAt?: string
  totalMs?: number
  tenantId?: string
  outcome: 'pass' | 'fail' | 'skip' | 'running'
}

if (!fs.existsSync(AUDIT_DIR)) fs.mkdirSync(AUDIT_DIR, { recursive: true })

function writeAuditFile(entry: AuditEntry) {
  fs.writeFileSync(path.join(AUDIT_DIR, entry.testId + '.json'), JSON.stringify(entry, null, 2))
}

// ── Per-test orchestration ─────────────────────────────────────────────

function buildConfig(caseSpec: TestCase, tenantId: string, slug: string): any {
  const products: string[] = ['crm']
  if (caseSpec.websiteMode !== 'none') products.push('website', 'cms')
  if (caseSpec.websiteMode === 'premium') products.push('website-premium')

  return {
    tenant_id: tenantId,
    tenant_name: 'Test ' + caseSpec.vertical,
    tenant_slug: slug,
    products,
    company: {
      name: 'Test ' + caseSpec.vertical + ' Co',
      email: 'twomiah14@gmail.com',
      phone: '+1-608-555-0142',
      address: '123 Test St',
      city: 'Madison',
      state: 'WI',
      stateFull: 'Wisconsin',
      zip: '53703',
      domain: caseSpec.domainMode === 'skip' ? '' : 'test-' + slug + '.com',
      domainMode: caseSpec.domainMode,
      purchaseYears: 1,
      ownerName: 'Test Owner',
      industry: caseSpec.industry,
      serviceRegion: 'Madison',
      nearbyCities: ['', '', '', ''],
    },
    branding: {
      primaryColor: '#f97316',
      secondaryColor: '#1e3a5f',
      logo: null,
      logoFilename: null,
      favicon: null,
      faviconFilename: null,
      heroPhoto: null,
      heroPhotoFilename: null,
    },
    features: { website: caseSpec.websiteMode === 'none' ? [] : ['contact_form'], crm: [], paid_ads: false },
    integrations: {
      twilio: { accountSid: '', authToken: '', phoneNumber: '' },
      sendgrid: { apiKey: '' },
      stripe: { secretKey: '', publishableKey: '', webhookSecret: '' },
      googleMaps: { apiKey: '' },
      sentry: { dsn: '' },
      nearmap: { apiKey: '' },
      replicate: { apiToken: '' },
    },
    content: { services: [], customServices: [], heroTagline: '', aboutText: '', ctaText: '', description: '' },
  }
}

async function runCase(caseSpec: TestCase, idx: number): Promise<AuditEntry> {
  const testId = `${String(idx + 1).padStart(3, '0')}-${caseSpec.vertical}-${caseSpec.plan}-${caseSpec.websiteMode}-${caseSpec.domainMode}`
  const slug = ('test-' + caseSpec.vertical + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6)).toLowerCase()
  const entry: AuditEntry = {
    testId,
    case: caseSpec,
    steps: [],
    startedAt: new Date().toISOString(),
    outcome: 'running',
  }
  writeAuditFile(entry)

  const time = (step: string, status: AuditEntry['steps'][0]['status'], detail?: string, ms?: number) => {
    entry.steps.push({ step, status, detail, ms })
    writeAuditFile(entry)
  }

  let tenantId: string | undefined

  try {
    // 1) Create the tenant row with is_test_tenant=true
    const t0 = Date.now()
    const { data: tenant, error: insertErr } = await supabase.from('tenants').insert({
      name: 'Test ' + caseSpec.vertical,
      slug,
      email: 'twomiah14@gmail.com',
      admin_email: 'twomiah14@gmail.com',
      industry: caseSpec.industry,
      city: 'Madison',
      state: 'WI',
      status: 'pending',
      products: caseSpec.websiteMode === 'none'
        ? ['crm']
        : caseSpec.websiteMode === 'premium'
          ? ['crm', 'website', 'website-premium', 'cms']
          : ['crm', 'website', 'cms'],
      is_test_tenant: true,
      domain: caseSpec.domainMode === 'skip' ? null : 'test-' + slug + '.com',
      domain_registrar: caseSpec.domainMode === 'buy' ? 'namecheap' : (caseSpec.domainMode === 'byod' ? 'byod' : null),
    }).select().single()

    if (insertErr || !tenant) {
      time('tenant_insert', 'error', insertErr?.message || 'unknown', Date.now() - t0)
      entry.outcome = 'fail'
      return entry
    }
    tenantId = tenant.id
    entry.tenantId = tenantId
    time('tenant_insert', 'ok', tenantId, Date.now() - t0)

    // 2) Generate
    const t1 = Date.now()
    const config = buildConfig(caseSpec, tenantId!, slug)
    let zipPath: string | undefined
    try {
      const result = await generate(config)
      zipPath = result.zipPath
      time('generate', 'ok', result.zipName + ' (' + result.buildId + ')', Date.now() - t1)
    } catch (e: any) {
      time('generate', 'error', e.message, Date.now() - t1)
      entry.outcome = 'fail'
      return entry
    }

    // 3) Deploy — only when --with-deploy is set AND deploy is configured
    if (!WITH_DEPLOY) {
      time('deploy', 'skipped', 'generate-only mode (use --with-deploy for full E2E)', 0)
      entry.outcome = 'pass'
      return entry
    }
    if (!isDeployConfigured()) {
      time('deploy', 'error', 'Deploy not configured — missing one of RENDER_API_KEY, GITHUB_TOKEN, GITHUB_ORG', 0)
      entry.outcome = 'fail'
      return entry
    }

    const t2 = Date.now()
    let deployedUrls: { siteUrl?: string; deployedUrl?: string; apiUrl?: string } = {}
    let renderServiceIds: Record<string, string> = {}
    try {
      const deployResult = await deployCustomer(
        { id: tenantId!, slug, name: config.tenant_name, industry: caseSpec.industry, products: config.products, config },
        zipPath!,
      )
      if (!deployResult.success) {
        time('deploy', 'error', deployResult.errors?.join('; ') || deployResult.status, Date.now() - t2)
        entry.outcome = 'fail'
        return entry
      }
      deployedUrls = { siteUrl: deployResult.siteUrl, deployedUrl: deployResult.deployedUrl, apiUrl: deployResult.apiUrl }
      // Build the role→serviceId map for checkDeployStatus polling. Only
      // include WEB SERVICES — Render Postgres uses a different API path
      // (/postgres/{id}) and polling it via /services/{id}/deploys returns
      // empty, which would keep us stuck at status='unknown' forever.
      // Also skip Supabase databases entirely (no Render id at all).
      const SERVICE_ROLES = ['backend', 'frontend', 'site', 'pricing', 'vision']
      const services = (deployResult as any).services || {}
      for (const role of SERVICE_ROLES) {
        const svc = (services as any)[role]
        const id = svc?.id
        if (typeof id === 'string') renderServiceIds[role] = id
      }
      time('deploy', 'ok', JSON.stringify(deployedUrls), Date.now() - t2)
    } catch (e: any) {
      time('deploy', 'error', e.message, Date.now() - t2)
      entry.outcome = 'fail'
      return entry
    }

    // 4) Wait for Render to actually mark services 'live' before smoking.
    // Polling Render's deploy status is much more accurate than hammering
    // the URL hoping it'll come up — services in 'build_in_progress' will
    // return 502 from the URL regardless of how many retries we throw at it.
    if (Object.keys(renderServiceIds).length > 0) {
      const tWait = Date.now()
      const liveResult = await waitForRenderLive(renderServiceIds)
      if (!liveResult.ok) {
        time('wait_for_live', 'error', `polled services: ${JSON.stringify(renderServiceIds)} | last statuses: ${JSON.stringify(liveResult.lastStatuses)}`, Date.now() - tWait)
        // Snapshot Render build logs for the failed service(s) so the user
        // can diagnose without having to keep the broken services around.
        await captureRenderBuildLogs(renderServiceIds, liveResult.lastStatuses, AUDIT_DIR, testId)
        time('captured_build_logs', 'ok', undefined, 0)
        entry.outcome = 'fail'
        return entry
      }
      time('wait_for_live', 'ok', JSON.stringify(liveResult.lastStatuses), Date.now() - tWait)
    }

    // 5) Smoke checks against the live URLs. Render services come up over
    // a few minutes — first request often hits a cold start. We do a short
    // bounded wait + a couple of retries; if it doesn't respond, the
    // deploy is still up but smoke fails this run.
    await smokeCheck(deployedUrls, caseSpec, time)

    // If smoke failed despite Render saying services were live, capture
    // runtime logs (not build) so we can see WHY the service isn't
    // responding. captureRenderBuildLogs honours the synthetic
    // 'live_but_smoke_failed' status to fetch logs for every service.
    const smokeFailed = entry.steps.some(s => s.status === 'error' && s.step.startsWith('smoke_'))
    if (smokeFailed && Object.keys(renderServiceIds).length > 0) {
      const synthetic: Record<string, string> = {}
      for (const role of Object.keys(renderServiceIds)) synthetic[role] = 'live_but_smoke_failed'
      await captureRenderBuildLogs(renderServiceIds, synthetic, AUDIT_DIR, testId)
      time('captured_runtime_logs', 'ok', undefined, 0)
    }

    entry.outcome = entry.steps.some(s => s.status === 'error') ? 'fail' : 'pass'
    return entry
  } finally {
    // 4) Cleanup — runs even on failure
    if (tenantId) {
      const t = Date.now()
      const cleanup = await hardDeleteTestTenant(tenantId)
      for (const s of cleanup.steps) {
        time('cleanup_' + s.step, s.status, s.detail)
      }
      time('cleanup_total_ms', cleanup.success ? 'ok' : 'warning', undefined, Date.now() - t)
    }
    entry.finishedAt = new Date().toISOString()
    entry.totalMs = Date.now() - new Date(entry.startedAt).getTime()
    if (entry.outcome === 'running') entry.outcome = 'fail'
    writeAuditFile(entry)
  }
}

// ── Render log capture ───────────────────────────────────────────────────
// On wait_for_live failure, fetch the latest deploy logs for any service
// in a terminal-failure state and write them to the audit dir. Cleanup
// nukes the service immediately after, so we can't fetch logs later.

async function captureRenderBuildLogs(serviceIds: Record<string, string>, lastStatuses: Record<string, string>, auditDir: string, testId: string) {
  const TERMINAL = new Set(['build_failed', 'update_failed', 'pre_deploy_failed', 'canceled'])
  // 'live_but_smoke_failed' is a synthetic status used by the smoke-fail
  // capture path; it tells us to grab logs even though Render says live.
  const CAPTURE = new Set([...TERMINAL, 'live_but_smoke_failed'])
  for (const [role, serviceId] of Object.entries(serviceIds)) {
    if (!CAPTURE.has(lastStatuses[role] || '')) continue
    try {
      // Get the latest deploy id to fetch its logs.
      const dr = await fetch(`https://api.render.com/v1/services/${serviceId}/deploys?limit=1`, {
        headers: { 'Authorization': 'Bearer ' + process.env.RENDER_API_KEY },
        signal: AbortSignal.timeout(30_000),
      })
      if (!dr.ok) continue
      const deploys = await dr.json() as any[]
      const deployId = deploys[0]?.deploy?.id
      const buildStatus = deploys[0]?.deploy?.status
      const commit = deploys[0]?.deploy?.commit?.message || ''

      // Render's /v1/logs endpoint requires ownerId + a time window. We
      // grab ownerId from the service details and request the last 30
      // minutes (more than enough for a failed build). Falls back to the
      // events endpoint (simpler shape) if logs returns non-2xx.
      const sd = await fetch(`https://api.render.com/v1/services/${serviceId}`, {
        headers: { 'Authorization': 'Bearer ' + process.env.RENDER_API_KEY },
        signal: AbortSignal.timeout(30_000),
      })
      const svcDetails = sd.ok ? await sd.json() as any : {}
      const ownerId = svcDetails.ownerId || svcDetails.owner?.id || ''
      const endTime = new Date().toISOString()
      const startTime = new Date(Date.now() - 30 * 60 * 1000).toISOString()

      let logBody = ''
      if (ownerId) {
        const lr = await fetch(`https://api.render.com/v1/logs?ownerId=${encodeURIComponent(ownerId)}&resource=${encodeURIComponent(serviceId)}&startTime=${encodeURIComponent(startTime)}&endTime=${encodeURIComponent(endTime)}&limit=1000&direction=backward`, {
          headers: { 'Authorization': 'Bearer ' + process.env.RENDER_API_KEY },
          signal: AbortSignal.timeout(60_000),
        })
        if (lr.ok) {
          const data = await lr.json() as any
          const lines = Array.isArray(data.logs) ? data.logs : (Array.isArray(data) ? data : [])
          logBody = lines.map((l: any) => `${l.timestamp || ''} ${l.message || l.text || JSON.stringify(l)}`).join('\n')
        } else {
          logBody = `(logs HTTP ${lr.status}: ${await lr.text().catch(() => '')})\n`
        }
      } else {
        logBody = '(no ownerId on service — cannot query /v1/logs)\n'
      }

      // Also grab the recent events on the service — failure reasons
      // often appear here in plain text even when logs are sparse.
      const er = await fetch(`https://api.render.com/v1/services/${serviceId}/events?limit=20`, {
        headers: { 'Authorization': 'Bearer ' + process.env.RENDER_API_KEY },
        signal: AbortSignal.timeout(30_000),
      })
      let eventsBody = ''
      if (er.ok) {
        const events = await er.json() as any[]
        eventsBody = events.map((e: any) => {
          const evt = e.event || e
          return `${evt.timestamp || ''} ${evt.type || ''} ${JSON.stringify(evt.details || {})}`
        }).join('\n')
      } else {
        eventsBody = `(events HTTP ${er.status})\n`
      }

      // Truncate if huge — keep tail since failures appear at the end.
      if (logBody.length > 200_000) logBody = '...(truncated head)...\n' + logBody.slice(-200_000)

      const header = `# ${testId} :: ${role} (service ${serviceId})\n# status: ${lastStatuses[role]} | latest deploy ${deployId} status: ${buildStatus}\n# commit: ${commit}\n# ownerId: ${ownerId}\n# fetched: ${new Date().toISOString()}\n\n`
      const body = `=== EVENTS ===\n${eventsBody}\n\n=== LOGS ===\n${logBody}\n`
      fs.writeFileSync(path.join(auditDir, `${testId}__${role}__buildlog.txt`), header + body)
    } catch (e: any) {
      fs.writeFileSync(path.join(auditDir, `${testId}__${role}__buildlog.txt`), `# log capture failed: ${e.message}\n`)
    }
  }
}

// ── Wait-for-live (Render deploy status polling) ───────────────────────
// Render returns 502 on a URL while build_in_progress; throwing retries at
// it doesn't help. Better: ask Render directly whether the latest deploy
// for each service is 'live'. Returns true when every service is live;
// false on timeout.

async function waitForRenderLive(serviceIds: Record<string, string>, opts: { maxMs?: number; pollMs?: number } = {}): Promise<{ ok: boolean; lastStatuses: Record<string, string> }> {
  // Realistic Render readiness is 2-5 min per service. Premium tests
  // wait on backend + site + db; with sequential build/start cycles
  // each service can independently take a few minutes. 15 min ceiling
  // gives enough slack for the slow end without letting a truly broken
  // build hang forever.
  const maxMs = opts.maxMs ?? 15 * 60 * 1000
  const pollMs = opts.pollMs ?? 15000          // poll every 15s
  const deadline = Date.now() + maxMs
  // Terminal failures we bail on. 'unknown' is NOT in here — Render returns
  // unknown briefly while the service is being created before the first
  // deploy record exists; bailing on it would race the deploy startup.
  const TERMINAL_FAILURES = new Set(['build_failed', 'update_failed', 'pre_deploy_failed', 'canceled'])
  let lastStatuses: Record<string, string> = {}
  while (Date.now() < deadline) {
    try {
      const result = await checkDeployStatus({ renderServiceIds: serviceIds })
      lastStatuses = {}
      for (const [role, info] of Object.entries(result.services)) {
        lastStatuses[role] = (info as any).status || 'unknown'
      }
      const allLive = Object.values(lastStatuses).every(s => s === 'live')
      if (allLive) return { ok: true, lastStatuses }
      // Conservative early-bail: ALL services must be terminal-failed before
      // we give up. A mix of 'live' + 'build_failed' would have been caught
      // by !allLive; a single transient 'unknown' shouldn't kill the test.
      const allTerminal = Object.values(lastStatuses).every(s => TERMINAL_FAILURES.has(s))
      if (allTerminal && Object.keys(lastStatuses).length > 0) return { ok: false, lastStatuses }
    } catch {
      // Transient Render API errors — keep waiting.
    }
    await new Promise(r => setTimeout(r, pollMs))
  }
  return { ok: false, lastStatuses }
}

// ── Smoke checks ────────────────────────────────────────────────────────
// Hit the deployed URLs to verify the build is reachable + responding.
// Bounded retries (Render cold-start can take a minute or two).

async function fetchWithRetry(url: string, opts: { timeoutMs?: number; retries?: number; delayMs?: number } = {}): Promise<{ ok: boolean; status?: number; error?: string }> {
  // After waitForRenderLive confirmed services are 'live', URL reachability
  // can still lag by another 2-3 min for brand-new Render services — DNS
  // propagation for {svc}.onrender.com isn't instant. Landscaping in the
  // syntax-fix probe showed the site responding to Render's own health
  // check (internal hostname) and "Your service is live", but my external
  // fetch from a different IP got connection-refused/timeout for the full
  // 60s window. 30 × 10s = 5 min is enough headroom for that case while
  // still bounding a truly broken service.
  const retries = opts.retries ?? 30
  const delayMs = opts.delayMs ?? 10000
  const timeoutMs = opts.timeoutMs ?? 30000
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
      if (res.ok || res.status === 401 || res.status === 403) {
        // 401/403 means the route exists and is responding (admin
        // login page returns 200, admin API returns 401 — both prove
        // the service is up).
        return { ok: true, status: res.status }
      }
      if (i < retries) await new Promise(r => setTimeout(r, delayMs))
    } catch (e: any) {
      if (i < retries) await new Promise(r => setTimeout(r, delayMs))
      else return { ok: false, error: e.message }
    }
  }
  return { ok: false, status: 0, error: 'exceeded retries' }
}

async function smokeCheck(
  urls: { siteUrl?: string; deployedUrl?: string; apiUrl?: string },
  caseSpec: TestCase,
  time: (step: string, status: 'ok' | 'warning' | 'error' | 'skipped', detail?: string, ms?: number) => void,
) {
  // a) Website root (only when website is part of the build)
  if (urls.siteUrl && caseSpec.websiteMode !== 'none') {
    const t = Date.now()
    const r = await fetchWithRetry(urls.siteUrl)
    time('smoke_website_root', r.ok ? 'ok' : 'error', r.status ? 'HTTP ' + r.status : r.error, Date.now() - t)

    // b) Website admin (the SPA mount). 200 = SPA index served, 401 = API gate (also fine).
    const t2 = Date.now()
    const adminUrl = urls.siteUrl.replace(/\/+$/, '') + '/admin'
    const r2 = await fetchWithRetry(adminUrl, { retries: 2 })
    time('smoke_website_admin', r2.ok ? 'ok' : 'warning', r2.status ? 'HTTP ' + r2.status : r2.error, Date.now() - t2)
  }

  // c) CRM (always part of the test build)
  if (urls.deployedUrl) {
    const t = Date.now()
    const r = await fetchWithRetry(urls.deployedUrl)
    time('smoke_crm_root', r.ok ? 'ok' : 'error', r.status ? 'HTTP ' + r.status : r.error, Date.now() - t)
  }

  // d) CRM API health
  if (urls.apiUrl) {
    const t = Date.now()
    const r = await fetchWithRetry(urls.apiUrl.replace(/\/+$/, '') + '/health', { retries: 2 })
    time('smoke_crm_api_health', r.ok ? 'ok' : 'warning', r.status ? 'HTTP ' + r.status : r.error, Date.now() - t)
  }
}

// ── Main ────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n═══════ Factory Test Matrix ═══════`)
  console.log(`Mode:        ${MODE}`)
  console.log(`With deploy: ${WITH_DEPLOY ? 'YES' : 'no (generate-only)'}`)
  console.log(`Tests:       ${MATRIX.length}`)
  console.log(`Concurrency: ${CONCURRENCY}`)
  console.log(`Pacing:      ${PACE_MS / 1000}s between tests`)
  console.log(`Audit dir:   ${AUDIT_DIR}\n`)

  const results: AuditEntry[] = []
  // Sequential by default; small concurrent batches if requested.
  for (let i = 0; i < MATRIX.length; i += CONCURRENCY) {
    const batch = MATRIX.slice(i, i + CONCURRENCY).map((c, j) => runCase(c, i + j))
    const batchResults = await Promise.all(batch)
    results.push(...batchResults)
    for (const r of batchResults) {
      const icon = r.outcome === 'pass' ? '✅' : r.outcome === 'skip' ? '⏭' : '❌'
      const errSteps = r.steps.filter(s => s.status === 'error').map(s => s.step).join(', ')
      console.log(`${icon} ${r.testId.padEnd(60)} ${r.totalMs}ms ${errSteps ? '  errors: ' + errSteps : ''}`)
    }
    // Pace the next batch so Render's API quota doesn't bite. Skip on
    // the last iteration since there's no next test to throttle for.
    if (PACE_MS > 0 && i + CONCURRENCY < MATRIX.length) {
      console.log(`  …pacing ${PACE_MS / 1000}s before next test`)
      await new Promise(r => setTimeout(r, PACE_MS))
    }
  }

  // Summary CSV
  const csv = [
    'testId,vertical,plan,websiteMode,domainMode,outcome,totalMs,errorSteps',
    ...results.map(r => [
      r.testId,
      r.case.vertical,
      r.case.plan,
      r.case.websiteMode,
      r.case.domainMode,
      r.outcome,
      r.totalMs ?? '',
      '"' + r.steps.filter(s => s.status === 'error').map(s => s.step).join(';') + '"',
    ].join(',')),
  ].join('\n')
  fs.writeFileSync(path.join(AUDIT_DIR, 'summary.csv'), csv)

  const passes = results.filter(r => r.outcome === 'pass').length
  const fails = results.filter(r => r.outcome === 'fail').length
  console.log(`\n═══════ Summary ═══════`)
  console.log(`Pass:  ${passes}/${results.length}`)
  console.log(`Fail:  ${fails}/${results.length}`)
  console.log(`Audit: ${AUDIT_DIR}\n`)

  process.exit(fails === 0 ? 0 : 1)
}

main().catch(e => {
  console.error('Matrix runner crashed:', e)
  process.exit(1)
})
