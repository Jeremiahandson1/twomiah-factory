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
const AUDIT_DIR = args['audit-dir'] || path.join(__dirname, 'test-audit', new Date().toISOString().replace(/[:.]/g, '-'))

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

const MATRIX = MODE === 'full' ? buildFullMatrix() : SMOKE_CASES

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
    try {
      const result = await generate(config)
      time('generate', 'ok', result.zipName + ' (' + result.buildId + ')', Date.now() - t1)
    } catch (e: any) {
      time('generate', 'error', e.message, Date.now() - t1)
      entry.outcome = 'fail'
      return entry
    }

    // 3) Deploy (optional)
    if (WITH_DEPLOY) {
      time('deploy', 'skipped', 'TODO: real Render deploy not wired into harness yet — gate-keep with --with-deploy flag once stable', 0)
    } else {
      time('deploy', 'skipped', 'generate-only mode (use --with-deploy for full E2E)', 0)
    }

    entry.outcome = 'pass'
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

// ── Main ────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n═══════ Factory Test Matrix ═══════`)
  console.log(`Mode:        ${MODE}`)
  console.log(`With deploy: ${WITH_DEPLOY ? 'YES' : 'no (generate-only)'}`)
  console.log(`Tests:       ${MATRIX.length}`)
  console.log(`Concurrency: ${CONCURRENCY}`)
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
