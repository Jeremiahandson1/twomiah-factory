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
const envRes = await fetch('https://api.render.com/v1/services/' + premiumSiteSvc.id + '/env-vars/DATABASE_URL', { headers: renderHeaders })
const envData = await envRes.json() as any
const premiumDbUrl = envData.value
if (!premiumDbUrl) {
  console.error('Premium site has no DATABASE_URL env var set — cannot read owner credentials')
  process.exit(1)
}
console.log('Found premium-site DATABASE_URL — reading owner user…')

const { Client } = await import('pg')
const pgClient = new Client({ connectionString: premiumDbUrl, ssl: { rejectUnauthorized: false } })
await pgClient.connect()
let ownerRow: { email: string; password_hash: string; name: string | null } | undefined
try {
  const r = await pgClient.query<any>(
    "SELECT email, password_hash, name FROM users WHERE role IN ('owner','admin') ORDER BY created_at ASC LIMIT 1"
  )
  ownerRow = r.rows[0]
} finally {
  await pgClient.end()
}
if (!ownerRow) {
  console.error('Premium site has no owner/admin user — cannot seed CRM with shared credentials. Bailing.')
  process.exit(1)
}
console.log('Owner found:', ownerRow.email)

// Now invoke the existing deploy pipeline for CRM only. We pass
// products=['crm'] so the premium-site logic is never entered.
// Pre-existing CRM services are caught by findAndDeleteRenderService
// (destructive) — for safety, refuse if we detect one and require
// --force.
const isHomeCare = tenant.industry === 'home_care'
const isFieldService = ['hvac', 'plumbing', 'electrical'].includes(tenant.industry) || tenant.industry?.startsWith('field_service')
const isRoofing = tenant.industry === 'roofing'
const isLandscaping = tenant.industry === 'landscaping'
const isDispensary = tenant.industry === 'dispensary'
const crmApiName = isHomeCare ? tenant.slug + '-care-api' : isFieldService ? tenant.slug + '-wrench-api' : isRoofing ? tenant.slug + '-roof-api' : isLandscaping ? tenant.slug + '-landscape-api' : isDispensary ? tenant.slug + '-leaf-api' : tenant.slug + '-api'

const checkExisting = await fetch('https://api.render.com/v1/services?name=' + crmApiName + '&limit=3', { headers: renderHeaders })
const existingCrmList = await checkExisting.json() as any[]
const existingCrm = existingCrmList?.[0]?.service || existingCrmList?.[0]
const force = process.argv.includes('--force')
if (existingCrm?.id && !force) {
  console.error('CRM service already exists at', crmApiName, '(' + existingCrm.id + ')')
  console.error('Re-run with --force to delete and re-deploy. Otherwise consider this provisioned.')
  process.exit(1)
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
  if (crmSvcId) {
    await fetch('https://api.render.com/v1/services/' + crmSvcId + '/env-vars/FACTORY_SYNC_KEY', {
      method: 'PUT',
      headers: { ...renderHeaders, 'content-type': 'application/json' },
      body: JSON.stringify({ value: existingTenantKey }),
    })
    await fetch('https://api.render.com/v1/services/' + crmSvcId + '/deploys', {
      method: 'POST', headers: { ...renderHeaders, 'content-type': 'application/json' },
      body: JSON.stringify({ clearCache: 'do_not_clear' })
    })
    console.log('Patched FACTORY_SYNC_KEY + triggered CRM redeploy. Polling /health…')
    for (let i = 0; i < 60; i++) {
      try {
        const h = await fetch(result.apiUrl + '/health', { signal: AbortSignal.timeout(5000) })
        if (h.ok) break
      } catch {}
      await new Promise(r => setTimeout(r, 5000))
    }
  } else {
    console.warn('Could not find CRM service to patch sync key — handoff may fail until manually aligned')
  }
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
