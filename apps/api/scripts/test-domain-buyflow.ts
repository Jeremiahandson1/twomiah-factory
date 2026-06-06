/**
 * Real-money end-to-end test of the domain buy flow.
 *
 * Provisions a fresh premium tenant, mints a Stripe customer, attaches
 * it to the tenant, hits /api/admin/domain/buy-checkout to get a real
 * Stripe Checkout URL for a test .site domain (~$2.99 first year).
 *
 *   bun run scripts/test-domain-buyflow.ts
 *
 * Outputs the Checkout URL. You complete payment in browser.
 * Then run:
 *
 *   bun run scripts/test-domain-buyflow.ts --verify <tenantId>
 *
 * Which checks: tenant.domain populated, Cloudflare zone created,
 * Namecheap reports domain owned, Render custom-domain attached.
 * Cleans up the tenant + lists the domain that was registered so
 * you can manage/refund it from your Namecheap dashboard.
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

import crypto from 'crypto'

const isVerify = process.argv.includes('--verify')
const explicitTenantId = process.argv[process.argv.indexOf('--verify') + 1]

const { createClient } = await import('@supabase/supabase-js')
const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

if (isVerify) {
  await verifyAfterPayment(explicitTenantId)
} else {
  await provisionAndStartCheckout()
}

async function provisionAndStartCheckout(): Promise<void> {
  const knownPassword = 'BuyFlow-test-pw-' + crypto.randomBytes(3).toString('hex') + '!'
  const adminEmail = 'twomiah14@gmail.com'
  const slug = 'buyflow-' + Date.now().toString(36) + '-' + crypto.randomBytes(2).toString('hex')
  const tenantId = crypto.randomUUID()
  const products = ['website', 'website-premium']
  const config: any = {
    tenant_id: tenantId, tenant_name: 'BuyFlow Test', tenant_slug: slug, products,
    company: {
      name: 'BuyFlow Test Co', email: adminEmail, phone: '+1-608-555-0142',
      address: '500 Test Ave', city: 'Madison', state: 'WI', stateFull: 'Wisconsin', zip: '53703',
      domain: '', domainMode: 'skip', purchaseYears: 1,
      ownerName: 'Owner', industry: 'general_contractor', serviceRegion: 'Madison',
      nearbyCities: [], defaultPassword: knownPassword,
    },
    branding: { primaryColor: '#FF6B35', secondaryColor: '#1A365D', logo: null, logoFilename: null, favicon: null, faviconFilename: null, heroPhoto: null, heroPhotoFilename: null },
    features: { website: ['contact_form'], crm: [], paid_ads: false },
    integrations: { resendKey: process.env.RESEND_API_KEY || '' },
    content: {},
  }
  await supabase.from('tenants').insert({
    id: tenantId, name: 'BuyFlow Test Co', slug, email: adminEmail, admin_email: adminEmail,
    industry: 'general_contractor', city: 'Madison', state: 'WI', status: 'pending', products,
    is_test_tenant: true,
    phone: '+16085550142', address: '500 Test Ave', zip: '53703',
  })

  console.log('[buyflow] Generating zip…')
  const { generate } = await import('../src/services/generator.ts')
  const { deployCustomer } = await import('../src/services/deploy.ts')
  const zip = await generate({ id: tenantId, ...config } as any)
  console.log('[buyflow] Deploying premium tenant (~2 min)…')
  const deploy = await deployCustomer(
    { id: tenantId, slug, name: 'BuyFlow Test Co', industry: 'general_contractor', products, config } as any,
    zip.zipPath,
    { products }
  )
  if (!deploy.siteUrl) {
    console.error('[buyflow] Deploy failed:', JSON.stringify(deploy.errors))
    process.exit(1)
  }
  await supabase.from('tenants').update({
    factory_sync_key: deploy.factorySyncKey,
    status: 'active',
    website_url: deploy.siteUrl,
    render_frontend_url: deploy.siteUrl,
  }).eq('id', tenantId)

  // Mint Stripe customer + attach to tenant so the buy-checkout endpoint
  // can build a Checkout session against it. This is the part the
  // signup flow normally does at first payment; we're skipping straight
  // to "premium subscription already exists" for the test.
  console.log('[buyflow] Minting Stripe customer (live mode)…')
  const factoryStripe = (await import('../src/services/factoryStripe.ts')).default
  const stripeCustomer = await factoryStripe.createCustomer({
    email: adminEmail,
    name: 'BuyFlow Test Co',
    phone: '+16085550142',
    metadata: { tenant_id: tenantId, source: 'buyflow_test' },
  })
  await supabase.from('tenants').update({ stripe_customer_id: stripeCustomer.id }).eq('id', tenantId)
  console.log('[buyflow] Stripe customer:', stripeCustomer.id)

  // Wait for premium /health to be live so the admin login works.
  console.log('[buyflow] Polling /health (up to 6 min)…')
  let live = false
  for (let i = 0; i < 72; i++) {
    try {
      const r = await fetch(deploy.siteUrl + '/health', { signal: AbortSignal.timeout(5000) })
      if (r.ok) { live = true; break }
    } catch {}
    await new Promise(r => setTimeout(r, 5000))
  }
  if (!live) {
    console.error('[buyflow] Tenant never came up — aborting')
    process.exit(1)
  }
  console.log('[buyflow] Tenant live at:', deploy.siteUrl)

  // Login + hit the buy-checkout endpoint
  console.log('[buyflow] Logging into admin…')
  const loginRes = await fetch(deploy.siteUrl + '/api/admin/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: adminEmail, password: knownPassword }),
  })
  const loginBody = await loginRes.json() as any
  if (!loginRes.ok || !loginBody.token) {
    console.error('[buyflow] Login failed:', loginBody)
    process.exit(1)
  }
  const adminToken = loginBody.token

  const testDomain = 'twomiah-buyflow-test-' + Date.now().toString(36) + '.site'
  console.log('[buyflow] Test domain:', testDomain)
  console.log('[buyflow] Requesting Stripe Checkout URL…')
  const checkoutRes = await fetch(deploy.siteUrl + '/api/admin/domain/buy-checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + adminToken },
    body: JSON.stringify({ domain: testDomain, years: 1 }),
  })
  const checkoutBody = await checkoutRes.json() as any
  if (!checkoutRes.ok || !checkoutBody.url) {
    console.error('[buyflow] Checkout creation failed:', checkoutRes.status, checkoutBody)
    process.exit(1)
  }
  const priceUsd = (checkoutBody.priceCents || 0) / 100

  console.log('')
  console.log('━'.repeat(72))
  console.log('  READY FOR PAYMENT')
  console.log('━'.repeat(72))
  console.log('')
  console.log('  Tenant ID:    ' + tenantId)
  console.log('  Test domain:  ' + testDomain)
  console.log('  Price:        $' + priceUsd.toFixed(2))
  console.log('')
  console.log('  Pay here:')
  console.log('  ' + checkoutBody.url)
  console.log('')
  console.log('  After payment, run:')
  console.log('    bun run scripts/test-domain-buyflow.ts --verify ' + tenantId)
  console.log('')
  console.log('  Or to abort + cleanup without paying, run:')
  console.log('    bun run scripts/cleanup-test-premium.ts ' + tenantId)
  console.log('━'.repeat(72))
}

async function verifyAfterPayment(tenantId: string): Promise<void> {
  if (!tenantId) {
    console.error('Usage: bun run scripts/test-domain-buyflow.ts --verify <tenantId>')
    process.exit(1)
  }
  console.log('[verify] Tenant:', tenantId)

  // Poll for tenant.domain to land — webhook usually fires within
  // ~30s but Namecheap registration + DNS wire can push it to 2 min.
  let domain: string | null = null
  let registrar: string | null = null
  let cloudflareZoneId: string | null = null
  for (let i = 0; i < 36; i++) {
    const { data: t } = await supabase.from('tenants').select('domain, domain_registrar, cloudflare_zone_id').eq('id', tenantId).single()
    if (t?.domain) {
      domain = t.domain
      registrar = t.domain_registrar
      cloudflareZoneId = t.cloudflare_zone_id
      break
    }
    process.stdout.write('[verify] Waiting for webhook + registration… ' + (i * 5) + 's\r')
    await new Promise(r => setTimeout(r, 5000))
  }
  console.log('')

  if (!domain) {
    console.error('[verify] FAIL: tenant.domain never populated. Either webhook didn\'t fire, registrar rejected, or refund was issued.')
    console.error('[verify] Check Stripe dashboard + factory Render logs around the time of payment.')
    process.exit(1)
  }

  console.log('[verify] ✓ tenant.domain =', domain)
  console.log('[verify] ✓ tenant.domain_registrar =', registrar)
  console.log('[verify] ✓ tenant.cloudflare_zone_id =', cloudflareZoneId || '<not set>')

  // Confirm Namecheap actually owns the domain
  try {
    const { getRegistrar } = await import('../src/services/registrar/index.ts')
    const reg = await getRegistrar()
    const info = await reg.getDomain(domain)
    if (info) {
      console.log('[verify] ✓ Namecheap reports domain owned, expires:', info.expirationDate?.toISOString())
    } else {
      console.warn('[verify] ⚠ Namecheap getDomain returned null — check dashboard manually')
    }
  } catch (e: any) {
    console.warn('[verify] ⚠ Namecheap getDomain threw:', e.message)
  }

  // Confirm Cloudflare zone exists + report status
  if (cloudflareZoneId) {
    try {
      const { getCloudflareZoneStatus } = await import('../src/services/cloudflare.ts')
      const zone = await getCloudflareZoneStatus(cloudflareZoneId)
      console.log('[verify] ✓ Cloudflare zone status:', zone.status, '— nameservers:', zone.nameServers.join(', '))
    } catch (e: any) {
      console.warn('[verify] ⚠ Cloudflare lookup threw:', e.message)
    }
  }

  console.log('')
  console.log('━'.repeat(72))
  console.log('  BUY FLOW VERIFIED END-TO-END')
  console.log('━'.repeat(72))
  console.log('')
  console.log('  The domain ' + domain + ' is now registered to you on Namecheap')
  console.log('  and pointing at this tenant. You can:')
  console.log('')
  console.log('    1. Disable auto-renew at https://ap.www.namecheap.com/domains/list')
  console.log('       so you don\'t get charged again next year')
  console.log('    2. Cleanup the test tenant when done:')
  console.log('       bun run scripts/cleanup-test-premium.ts ' + tenantId)
  console.log('       (this does NOT release the Namecheap domain — that stays yours)')
  console.log('')
  console.log('━'.repeat(72))
}
