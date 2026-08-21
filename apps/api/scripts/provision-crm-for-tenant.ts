/**
 * Manually provision a CRM for an existing premium-website tenant.
 *
 * Path A++ V1 — the customer pays via Stripe Checkout for the
 * STRIPE_PRICE_PREMIUM_CRM_ADDON SKU, you get a notification email,
 * you run this script when you're ready (within 24h SLA).
 *
 *   bun run scripts/provision-crm-for-tenant.ts <tenantId>
 *
 * What it does:
 *  1. Reads the tenant row from Supabase
 *  2. Verifies status='active' and products includes 'website-premium'
 *     but NOT 'crm' yet (safety — refuses to clobber an existing CRM)
 *  3. Fetches the premium owner's email + bcrypt password hash from
 *     the premium site's Postgres
 *  4. Calls deployCustomer with products=['crm'] (NOT premium) so the
 *     premium-site service is never touched
 *  5. After deploy, seeds the new CRM's admin user with the premium
 *     credentials so the customer logs in with the same email/password
 *  6. Updates tenants.products to include 'crm'
 *  7. Sends a "your CRM is ready" email
 *
 * Idempotent on retry — if a CRM service already exists, the script
 * skips the deploy and only re-runs the seed + email steps.
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

const tenantId = process.argv[2]
if (!tenantId) {
  console.error('Usage: bun run scripts/provision-crm-for-tenant.ts <tenantId>')
  process.exit(1)
}

const { createClient } = await import('@supabase/supabase-js')
const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

const { data: tenant, error: tErr } = await supabase
  .from('tenants').select('*').eq('id', tenantId).maybeSingle()
if (tErr || !tenant) {
  console.error('Tenant lookup failed:', tErr?.message || 'not found')
  process.exit(1)
}

console.log('Tenant:', tenant.slug, '— status:', tenant.status, '— products:', JSON.stringify(tenant.products))

if (!tenant.products?.includes('website-premium')) {
  console.error('Refusing: this tenant does not have website-premium. addCrmToTenant is a premium-only upgrade path in V1.')
  process.exit(1)
}
if (tenant.products?.includes('crm')) {
  console.log('Tenant already has CRM in products list. Re-running idempotently to verify deploy + seed.')
}

// Pull premium owner credentials from the premium-site Postgres so the
// CRM admin user matches password + email. The premium site's
// DATABASE_URL is set in Render env — we find it via the API.
const premiumSiteName = tenant.slug + '-site'
const RENDER_API_KEY = process.env.RENDER_API_KEY!
const renderHeaders = { Authorization: 'Bearer ' + RENDER_API_KEY, accept: 'application/json' }
const sLookup = await fetch('https://api.render.com/v1/services?name=' + premiumSiteName + '&limit=3', { headers: renderHeaders })
const sList = await sLookup.json() as any[]
const premiumSiteSvc = sList?.[0]?.service || sList?.[0]
if (!premiumSiteSvc?.id) {
  console.error('Could not find premium-site Render service named', premiumSiteName)
  process.exit(1)
}
// Fetch owner credentials via HTTP — Render gives services internal-only
// DATABASE_URLs that we can't reach from this script's host. Premium
// exposes /api/internal/owner-credentials (X-Factory-Key gated) for
// exactly this purpose.
const premiumSiteUrl = tenant.website_url || ('https://' + premiumSiteSvc.name + '.onrender.com')
const premiumSyncKey = tenant.factory_sync_key
if (!premiumSyncKey) {
  console.error('Tenant row has no factory_sync_key — cannot authenticate to premium site. Bailing.')
  process.exit(1)
}
console.log('Fetching premium owner credentials via', premiumSiteUrl + '/api/internal/owner-credentials')
const credRes = await fetch(premiumSiteUrl.replace(/\/+$/, '') + '/api/internal/owner-credentials', {
  headers: { 'X-Factory-Key': premiumSyncKey },
  signal: AbortSignal.timeout(15000),
})
if (!credRes.ok) {
  console.error('Owner credentials lookup failed:', credRes.status, await credRes.text().catch(() => ''))
  console.error('Bailing — without the owner email + hash we cannot set up shared sign-in.')
  process.exit(1)
}
const credJson = await credRes.json() as { email: string; passwordHash: string; name: string | null }
const ownerRow = { email: credJson.email, password_hash: credJson.passwordHash, name: credJson.name }
console.log('Owner found:', ownerRow.email)

// Now invoke the existing deploy pipeline for CRM only. We pass
// products=['crm'] so the premium-site logic is never entered.
// Service name must match what deploy.ts will actually create — use
// the central routing config so e.g. cleaning → wrench, not just
// the narrow hvac/plumbing/electrical set.
const { buildCrmApiHost, crmApiHostCandidates } = await import('../src/config/industryRouting.ts')
const crmApiName = buildCrmApiHost(tenant.slug, tenant.industry || '').replace('.onrender.com', '')

// Guard under every historical name, not just the current one — a vertical
// rename (salon/events/rv) would otherwise hide an existing CRM from this
// check and this script would provision a duplicate beside it.
const force = process.argv.includes('--force')
for (const host of crmApiHostCandidates(tenant.slug, tenant.industry || '')) {
  const candidate = host.replace('.onrender.com', '')
  const checkExisting = await fetch('https://api.render.com/v1/services?name=' + candidate + '&limit=3', { headers: renderHeaders })
  const existingCrmList = await checkExisting.json() as any[]
  const existingCrm = existingCrmList?.[0]?.service || existingCrmList?.[0]
  if (existingCrm?.id && existingCrm?.name === candidate && !force) {
    console.error('CRM service already exists at', candidate, '(' + existingCrm.id + ')')
    console.error('Re-run with --force to delete and re-deploy. Otherwise consider this provisioned.')
    process.exit(1)
  }
}

console.log('Generating CRM zip…')
const { generate } = await import('../src/services/generator.ts')
const config = {
  tenant_id: tenant.id,
  tenant_name: tenant.name,
  tenant_slug: tenant.slug,
  products: ['crm'],
  company: {
    name: tenant.name,
    email: tenant.admin_email || tenant.email,
    industry: tenant.industry,
    city: tenant.city || '',
    state: tenant.state || '',
    zip: tenant.zip || '',
    phone: tenant.phone || '',
    domain: '', domainMode: 'skip',
  },
  branding: {
    primaryColor: tenant.primary_color || '#FF6B35',
    secondaryColor: tenant.secondary_color || '#1A365D',
  },
  features: {},
  integrations: { resendKey: process.env.TWOMIAH_RESEND_API_KEY || process.env.RESEND_API_KEY || '' },
  content: {},
}
const zip = await generate({ id: tenant.id, ...config } as any)

console.log('Deploying CRM to Render…')
const { deployCustomer } = await import('../src/services/deploy.ts')
const result = await deployCustomer(
  { id: tenant.id, slug: tenant.slug, name: tenant.name, industry: tenant.industry, products: ['crm'], config } as any,
  zip.zipPath,
  { products: ['crm'] }
)

if (!result.apiUrl) {
  console.error('CRM deploy failed:', result.status, JSON.stringify(result.errors))
  process.exit(1)
}
console.log('CRM deployed:', result.apiUrl)

// Seed the CRM admin user with the premium credentials. We POST to
// the CRM's /api/internal/seed-from-premium endpoint with the
// factory_sync_key. That endpoint INSERTs (or UPDATEs by email) the
// owner row using the bcrypt hash directly — no rehash, so the
// existing password works as-is.
console.log('Polling /health until CRM is live…')
const maxPoll = 60
for (let i = 0; i < maxPoll; i++) {
  try {
    const h = await fetch(result.apiUrl + '/health', { signal: AbortSignal.timeout(5000) })
    if (h.ok) { console.log('CRM /health responded after ' + (i * 5) + 's'); break }
  } catch {}
  await new Promise(r => setTimeout(r, 5000))
  if (i === maxPoll - 1) console.warn('CRM /health never responded within ' + (maxPoll * 5) + 's — continuing anyway')
}

// CRITICAL for SSO handoff: the factory signs handoff tokens with
// tenant.factory_sync_key, the CRM verifies with its own
// FACTORY_SYNC_KEY env var — these MUST match. deployCustomer just
// generated a fresh key for this CRM; if the tenant already had one
// (it does — premium was deployed earlier), we must overwrite the
// CRM's env to the existing key + redeploy. Otherwise handoff fails.
const existingTenantKey = tenant.factory_sync_key
const freshlyGeneratedKey = result.factorySyncKey
let factorySyncKey: string
if (existingTenantKey && freshlyGeneratedKey && existingTenantKey !== freshlyGeneratedKey) {
  console.log('CRM was deployed with a new sync key — aligning to existing tenant key for SSO handoff…')
  const crmSvcLookup = await fetch('https://api.render.com/v1/services?name=' + crmApiName + '&limit=3', { headers: renderHeaders })
  const crmList = await crmSvcLookup.json() as any[]
  const crmSvcId = (crmList?.[0]?.service?.id || crmList?.[0]?.id) as string | undefined
  if (!crmSvcId) {
    console.error('Could not find CRM service named "' + crmApiName + '" — alignment skipped, SSO handoff will fail.')
    console.error('Bailing — seeding the CRM with a key it does not have leaves the customer permanently broken.')
    process.exit(1)
  }
  const putEnvRes = await fetch('https://api.render.com/v1/services/' + crmSvcId + '/env-vars/FACTORY_SYNC_KEY', {
    method: 'PUT',
    headers: { ...renderHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({ value: existingTenantKey }),
  })
  if (!putEnvRes.ok) {
    console.error('PUT FACTORY_SYNC_KEY failed: status=' + putEnvRes.status + ' body=' + await putEnvRes.text().catch(() => ''))
    process.exit(1)
  }
  // Trigger a fresh deploy and capture its id so we can poll it
  // specifically — not whatever 'latest' deploy is when we ask, since
  // the original deploy is already 'live' from a few seconds ago.
  const triggerRes = await fetch('https://api.render.com/v1/services/' + crmSvcId + '/deploys', {
    method: 'POST', headers: { ...renderHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({ clearCache: 'do_not_clear' })
  })
  if (!triggerRes.ok) {
    console.error('POST /deploys failed: status=' + triggerRes.status + ' body=' + await triggerRes.text().catch(() => ''))
    process.exit(1)
  }
  // Render's response shape varies — sometimes { id }, sometimes
  // { deploy: { id } }, sometimes { deployId }, sometimes null body
  // (202 with no payload). Read as text first so we can debug, parse
  // best-effort, fall back to polling the latest deploy id.
  const triggerText = await triggerRes.text()
  let triggerJson: any = null
  try { triggerJson = triggerText ? JSON.parse(triggerText) : null } catch {}
  let newDeployId: string | undefined =
    triggerJson?.id || triggerJson?.deploy?.id || triggerJson?.deployId
  if (!newDeployId) {
    // Fallback: look up the most recent deploy on this service.
    // This works because the POST /deploys we just made is the
    // freshest event in Render's queue — its id is whatever the
    // service's deploys list returns first.
    await new Promise(r => setTimeout(r, 3000))  // brief settle
    const lookupRes = await fetch('https://api.render.com/v1/services/' + crmSvcId + '/deploys?limit=1', { headers: renderHeaders })
    const lookupJson = await lookupRes.json() as any[]
    newDeployId = lookupJson?.[0]?.deploy?.id || lookupJson?.[0]?.id
    console.log('Trigger response was empty (' + triggerText.length + ' bytes); falling back to latest deploy id:', newDeployId)
  }
  if (!newDeployId) {
    console.error('Could not determine new deploy id. Trigger body:', triggerText.slice(0, 300))
    process.exit(1)
  }
  console.log('Patched FACTORY_SYNC_KEY + triggered CRM redeploy ' + newDeployId + '. Polling specifically for it to go live…')
  let redeployedOk = false
  for (let i = 0; i < 72; i++) {
    try {
      const dr = await fetch('https://api.render.com/v1/services/' + crmSvcId + '/deploys/' + newDeployId, { headers: renderHeaders })
      const dj = await dr.json() as any
      const status = dj?.status
      if (status === 'live') { console.log('CRM redeploy live (with aligned key) after ' + (i * 5) + 's'); redeployedOk = true; break }
      if (status && /failed|canceled|deactivated/.test(status)) {
        console.error('CRM redeploy ended with status=' + status)
        process.exit(1)
      }
    } catch {}
    await new Promise(r => setTimeout(r, 5000))
  }
  if (!redeployedOk) {
    console.error('CRM redeploy did not reach live within 6min — bailing to avoid key mismatch')
    process.exit(1)
  }
  // Diagnostic: read the env var back from Render and confirm it
  // actually persisted to existingTenantKey. If not, the deploy
  // succeeded but with stale env — we'd hit a 401 storm downstream.
  const verifyRes = await fetch('https://api.render.com/v1/services/' + crmSvcId + '/env-vars/FACTORY_SYNC_KEY', { headers: renderHeaders })
  const verifyJson = await verifyRes.json() as any
  const persistedVal = verifyJson?.value || verifyJson?.envVar?.value
  if (persistedVal !== existingTenantKey) {
    console.error('Render shows FACTORY_SYNC_KEY="' + (persistedVal ? persistedVal.slice(0,12) + '…' : '<empty>') + '" but expected "' + existingTenantKey.slice(0,12) + '…" — PUT silently failed')
    process.exit(1)
  }
  console.log('Verified env var persisted on Render')
  // Wait a beat for the new container's load-balancer slot to fully
  // take over from the old one (Render reports 'live' on the new
  // deploy slightly before in-flight requests stop hitting the old).
  await new Promise(r => setTimeout(r, 10000))
  factorySyncKey = existingTenantKey
} else {
  factorySyncKey = freshlyGeneratedKey || existingTenantKey || ''
}
console.log('Seeding CRM owner from premium credentials…')
if (!factorySyncKey) {
  console.warn('No factory_sync_key — skipping seed. Customer will need to use forgot-password flow.')
} else {
  try {
    const seedRes = await fetch(result.apiUrl + '/api/internal/seed-from-premium', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Factory-Key': factorySyncKey },
      body: JSON.stringify({ email: ownerRow.email, passwordHash: ownerRow.password_hash, name: ownerRow.name || tenant.name }),
    })
    if (seedRes.ok) console.log('CRM owner seeded with shared credentials')
    else console.warn('Seed call returned', seedRes.status, await seedRes.text().catch(() => ''))
  } catch (e: any) {
    console.warn('Seed call failed:', e?.message)
  }
}

// Update tenants.products
const newProducts = Array.from(new Set([...(tenant.products || []), 'crm']))
await supabase.from('tenants').update({
  products: newProducts,
  factory_sync_key: factorySyncKey || tenant.factory_sync_key,
}).eq('id', tenant.id)
console.log('Updated tenants.products →', JSON.stringify(newProducts))

// Tell the premium site where its new CRM lives so the BillingPage
// can show the "Open CRM →" button and the SSO handoff knows the
// destination. We POST through the premium's own internal endpoint
// (gated by FACTORY_SYNC_KEY) so this works even on existing tenants
// whose deploy.ts wasn't yet aware of this column.
if (factorySyncKey && tenant.website_url) {
  try {
    const r = await fetch(tenant.website_url.replace(/\/+$/, '') + '/api/internal/set-crm-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Factory-Key': factorySyncKey },
      body: JSON.stringify({ crmUrl: result.apiUrl })
    })
    if (r.ok) console.log('Notified premium site of CRM URL')
    else console.warn('set-crm-url returned', r.status, await r.text().catch(() => ''))
  } catch (e: any) {
    console.warn('Could not notify premium site:', e?.message)
  }
}

// Notify the customer
const { sendEmail } = await import('../src/services/email.ts')
if (tenant.admin_email || tenant.email) {
  const to = tenant.admin_email || tenant.email
  await sendEmail(to,
    'Your Twomiah CRM is ready',
    '<p>Hi ' + (tenant.name || 'there') + ',</p>' +
    '<p>Your CRM is live at <a href="' + result.apiUrl + '/crm">' + result.apiUrl + '/crm</a>.</p>' +
    '<p>Sign in with the same email and password you use for your Premium Website admin — we set them up to match so you only have to remember one set of credentials.</p>' +
    '<p>If you have any questions, just reply to this email.</p>'
  )
  console.log('Sent "CRM ready" email to', to)
}

console.log('')
console.log('━'.repeat(60))
console.log('CRM provisioned for', tenant.slug)
console.log('CRM URL:', result.apiUrl + '/crm')
console.log('Owner email:', ownerRow.email)
console.log('Login: same password as Premium admin')
console.log('━'.repeat(60))
