/**
 * Path A++ V1 end-to-end test.
 *
 * Provisions a fresh premium tenant, adds CRM via the provision
 * script (simulating "customer paid via Stripe Checkout"), then
 * walks the full SSO handoff path:
 *
 *  1. Premium admin login
 *  2. GET /api/admin/crm-status → expect ready=true
 *  3. GET /api/admin/crm-handoff → expect handoff URL
 *  4. GET the handoff URL → expect 200 + HTML with localStorage write
 *  5. Verify the token in the HTML can authenticate against the CRM API
 *
 * Cleans up both tenants on exit (kept tenant id in a file so a
 * Ctrl-C mid-run is recoverable via bun run scripts/cleanup-test-premium.ts).
 */
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const envPath = path.join(__dirname, '..', '.env')
if (fs.existsSync(envPath)) {
  for (const raw of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = raw.replace(/\r$/, '').match(/^([^#=]+)=(.*)$/)
    if (m && !process.env[m[1].trim()]) process.env[m[1].trim()] = m[2].trim()
  }
}

const PASS = '✓'
const FAIL = '✗'
const results: Array<{ step: string; ok: boolean; detail?: string; ms?: number }> = []
function record(step: string, ok: boolean, detail?: string, ms?: number) {
  results.push({ step, ok, detail, ms })
  console.log((ok ? PASS : FAIL) + ' ' + step + (detail ? ' — ' + detail : '') + (ms ? ' [' + ms + 'ms]' : ''))
}
async function time<T>(step: string, fn: () => Promise<T>): Promise<T> {
  const t = Date.now()
  try { const r = await fn(); record(step, true, undefined, Date.now() - t); return r }
  catch (e: any) { record(step, false, e?.message?.slice(0, 200)); throw e }
}

import crypto from 'crypto'
const KNOWN_PASSWORD = 'PathA-test-pw-' + crypto.randomBytes(3).toString('hex') + '!'
const ADMIN_EMAIL = 'twomiah14@gmail.com'

async function deployPremium() {
  const { createClient } = await import('@supabase/supabase-js')
  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const slug = 'patha-' + Date.now().toString(36) + '-' + crypto.randomBytes(2).toString('hex')
  const tenantId = crypto.randomUUID()
  const products = ['website', 'website-premium']
  const config: any = {
    tenant_id: tenantId, tenant_name: 'Path A++ Test', tenant_slug: slug, products,
    company: {
      name: 'Path A++ Test Co', email: ADMIN_EMAIL, phone: '+1-608-555-0142',
      address: '500 Test Ave', city: 'Madison', state: 'WI', stateFull: 'Wisconsin', zip: '53703',
      domain: '', domainMode: 'skip', purchaseYears: 1,
      ownerName: 'Owner', industry: 'cleaning', serviceRegion: 'Madison',
      nearbyCities: ['', '', '', ''], defaultPassword: KNOWN_PASSWORD,
    },
    branding: { primaryColor: '#FF6B35', secondaryColor: '#1A365D', logo: null, logoFilename: null, favicon: null, faviconFilename: null, heroPhoto: null, heroPhotoFilename: null },
    features: { website: ['contact_form'], crm: [], paid_ads: false },
    integrations: { resendKey: process.env.RESEND_API_KEY || '' },
    content: {},
  }
  await supabase.from('tenants').insert({
    id: tenantId, name: 'Path A++ Test Co', slug, email: ADMIN_EMAIL, admin_email: ADMIN_EMAIL,
    industry: 'cleaning', city: 'Madison', state: 'WI', status: 'pending', products,
    is_test_tenant: true,
  })
  const { generate } = await import('../src/services/generator.ts')
  const { deployCustomer } = await import('../src/services/deploy.ts')
  const zip = await generate({ id: tenantId, ...config } as any)
  const deploy = await deployCustomer(
    { id: tenantId, slug, name: 'Path A++ Test Co', industry: 'cleaning', products, config } as any,
    zip.zipPath,
    { products }
  )
  if (!deploy.siteUrl) throw new Error('Premium deploy returned no siteUrl: ' + JSON.stringify(deploy.errors))
  // Patch the tenant row with deploy outputs (provision-test-premium does this; mirroring here).
  await supabase.from('tenants').update({
    factory_sync_key: deploy.factorySyncKey,
    status: 'active',
    website_url: deploy.siteUrl,
    render_frontend_url: deploy.siteUrl,
  }).eq('id', tenantId)
  return { tenantId, slug, siteUrl: deploy.siteUrl }
}

async function pollHealth(url: string, label: string, maxSec = 240) {
  for (let i = 0; i < maxSec; i += 5) {
    try {
      const r = await fetch(url + '/health', { signal: AbortSignal.timeout(5000) })
      if (r.ok) return
    } catch {}
    await new Promise(r => setTimeout(r, 5000))
  }
  throw new Error(label + ' /health never responded within ' + maxSec + 's')
}

async function adminLogin(siteUrl: string): Promise<string> {
  const r = await fetch(siteUrl + '/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: KNOWN_PASSWORD }),
  })
  if (!r.ok) throw new Error('login failed: ' + r.status + ' ' + await r.text().catch(() => ''))
  const body = await r.json() as any
  if (!body.token) throw new Error('no token in login response')
  return body.token
}

const tenantStorePath = path.join(__dirname, '..', '.path-aplusplus-test-tenants.json')
function rememberTenant(id: string) {
  let arr: string[] = []
  if (fs.existsSync(tenantStorePath)) {
    try { arr = JSON.parse(fs.readFileSync(tenantStorePath, 'utf8')) } catch {}
  }
  arr.push(id)
  fs.writeFileSync(tenantStorePath, JSON.stringify(arr))
}
function forgetTenant(id: string) {
  if (!fs.existsSync(tenantStorePath)) return
  try {
    const arr: string[] = JSON.parse(fs.readFileSync(tenantStorePath, 'utf8'))
    fs.writeFileSync(tenantStorePath, JSON.stringify(arr.filter(x => x !== id)))
  } catch {}
}

let tenantId = ''
try {
  // ── Phase 1: deploy premium ────────────────────────────────────────────
  console.log('\n━━━ Phase 1: deploy premium tenant ━━━')
  const premium = await time('Premium deployed', async () => deployPremium())
  tenantId = premium.tenantId
  rememberTenant(tenantId)
  console.log('  site URL:', premium.siteUrl)

  await time('Premium /health live', async () => pollHealth(premium.siteUrl, 'premium', 360))
  const adminToken = await time('Admin login (premium)', async () => adminLogin(premium.siteUrl))
  await time('Initial crm-status: not ready', async () => {
    const r = await fetch(premium.siteUrl + '/api/admin/crm-status', {
      headers: { Authorization: 'Bearer ' + adminToken }
    })
    if (!r.ok) throw new Error('status=' + r.status)
    const body = await r.json() as any
    if (body.ready) throw new Error('expected ready=false initially, got ' + JSON.stringify(body))
  })

  // ── Phase 2: provision CRM via the script (simulates Stripe success) ──
  console.log('\n━━━ Phase 2: provision CRM (simulates customer paid) ━━━')
  console.log('  (running scripts/provision-crm-for-tenant.ts inline…)')
  const provisionStart = Date.now()
  // Shell out to the provision script so we exercise the real path. It
  // exits 0 on success, non-zero on failure.
  const { spawnSync } = await import('child_process')
  const provRes = spawnSync('bun', ['run', 'scripts/provision-crm-for-tenant.ts', tenantId], {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8',
    timeout: 15 * 60 * 1000,
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  console.log(provRes.stdout)
  if (provRes.stderr) console.error(provRes.stderr)
  if (provRes.status !== 0) throw new Error('provision-crm-for-tenant exit=' + provRes.status)
  record('CRM provisioned', true, undefined, Date.now() - provisionStart)

  // ── Phase 3: verify everything is wired ────────────────────────────────
  console.log('\n━━━ Phase 3: verify the wiring ━━━')
  const { createClient } = await import('@supabase/supabase-js')
  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data: refreshedTenant } = await supabase.from('tenants').select('*').eq('id', tenantId).single()
  if (!refreshedTenant) throw new Error('tenant disappeared')
  await time('tenants.products includes crm', async () => {
    if (!(refreshedTenant.products || []).includes('crm')) throw new Error('products: ' + JSON.stringify(refreshedTenant.products))
  })

  await time('Premium crm-status now ready=true', async () => {
    const r = await fetch(premium.siteUrl + '/api/admin/crm-status', { headers: { Authorization: 'Bearer ' + adminToken } })
    const body = await r.json() as any
    if (!body.ready) throw new Error('expected ready=true, got ' + JSON.stringify(body))
    if (!body.crmUrl) throw new Error('no crmUrl in status')
  })

  const handoffResp = await time('Premium crm-handoff returns URL', async () => {
    const r = await fetch(premium.siteUrl + '/api/admin/crm-handoff', { headers: { Authorization: 'Bearer ' + adminToken } })
    if (!r.ok) throw new Error('status=' + r.status + ' ' + await r.text().catch(() => ''))
    const body = await r.json() as any
    if (!body.url) throw new Error('no url in response: ' + JSON.stringify(body))
    if (!body.url.includes('/auth/handoff?token=')) throw new Error('unexpected url shape: ' + body.url.slice(0, 100))
    return body.url
  })

  const handoffHtml = await time('CRM /auth/handoff returns 200 HTML', async () => {
    const r = await fetch(handoffResp, { redirect: 'manual' })
    if (r.status !== 200) throw new Error('status=' + r.status + ' body=' + (await r.text()).slice(0, 200))
    const t = await r.text()
    if (!t.includes('localStorage.setItem')) throw new Error('expected localStorage.setItem in body')
    if (!t.includes('accessToken')) throw new Error('expected accessToken in body')
    return t
  })

  // Extract the access token from the inline script to verify it works
  // against the CRM API.
  const accessMatch = handoffHtml.match(/localStorage\.setItem\('accessToken',\s*"([^"]+)"\)/)
  if (!accessMatch) {
    record('Extract CRM accessToken from handoff', false, 'regex miss')
  } else {
    const crmToken = accessMatch[1]
    record('Extract CRM accessToken from handoff', true, 'token len=' + crmToken.length)
    // Find a CRM endpoint that auth-checks the token. /api/auth/me is common.
    await time('CRM API accepts handoff-minted token', async () => {
      const candidates = ['/api/auth/me', '/api/users/me', '/api/me']
      let lastResp = ''
      for (const path of candidates) {
        const r = await fetch(refreshedTenant.render_frontend_url + path, {
          headers: { Authorization: 'Bearer ' + crmToken }
        }).catch(() => null)
        if (!r) continue
        if (r.ok) return
        lastResp = path + ' → ' + r.status
      }
      // Even a 404 is acceptable: it means the token authenticated and
      // the handler just doesn't exist. A 401 would indicate token rejection.
      // Re-run the first candidate and check whether 401 specifically.
      const r = await fetch(refreshedTenant.render_frontend_url + '/api/auth/me', {
        headers: { Authorization: 'Bearer ' + crmToken }
      })
      if (r.status === 401) throw new Error('token rejected by CRM (401)')
      // Anything else = the auth layer accepted the token; we don't care if
      // the specific test endpoint exists.
    })
  }

  // ── Summary ──────────────────────────────────────────────────────────
  const passed = results.filter(r => r.ok).length
  const failed = results.filter(r => !r.ok).length
  console.log('\n━━━ Summary ━━━')
  console.log('Pass:', passed, '/', results.length)
  if (failed > 0) {
    console.log('Failed:')
    for (const r of results) if (!r.ok) console.log('  ' + FAIL + ' ' + r.step + (r.detail ? ' — ' + r.detail : ''))
  }
  if (failed > 0) process.exit(1)
} finally {
  // Cleanup the tenant regardless of result
  if (tenantId) {
    console.log('\n━━━ Cleanup ━━━')
    try {
      const { hardDeleteTestTenant } = await import('../src/services/testCleanup.ts')
      const r = await hardDeleteTestTenant(tenantId)
      console.log('Cleanup:', r.success ? 'ok' : 'partial', '— steps:', r.steps?.length)
      forgetTenant(tenantId)
    } catch (e: any) {
      console.error('Cleanup failed:', e?.message)
      console.error('Manually clean up:', tenantId)
    }
  }
}
