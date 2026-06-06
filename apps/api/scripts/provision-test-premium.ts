/**
 * Provisions one premium-website tenant for manual testing (PageSpeed,
 * smoke testing the Bookings UI, etc.) and leaves it standing.
 *
 * Prints the public site URL, admin URL, owner email/password, and
 * tenant id so you can drive it manually. When you're done:
 *
 *     bun run scripts/cleanup-test-premium.ts <tenantId>
 *
 * Tenant is flagged is_test_tenant=true so cleanup can hard-delete it.
 */
import crypto from 'crypto'
import { generate } from '../src/services/generator.ts'
import { deployCustomer } from '../src/services/deploy.ts'
import { createClient } from '@supabase/supabase-js'

const KNOWN_PASSWORD = 'Premium-test-pw-' + crypto.randomBytes(3).toString('hex') + '!'
const ADMIN_EMAIL = 'twomiah14@gmail.com'

async function main() {
  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const slug = 'premiumtest-' + Date.now().toString(36) + '-' + crypto.randomBytes(2).toString('hex')
  const tenantId = crypto.randomUUID()
  // 'website' is required: deploy.ts gates the site service block on
  // products.includes('website') and treats website-premium as an upgrade
  // within it. Passing just ['website-premium'] silently produces nothing.
  const products = ['website', 'website-premium']
  const config: any = {
    tenant_id: tenantId, tenant_name: 'Premium Test Co', tenant_slug: slug, products,
    company: {
      name: 'Premium Test Co', email: ADMIN_EMAIL, phone: '+1-608-555-0142',
      address: '123 Main St', city: 'Madison', state: 'WI', stateFull: 'Wisconsin', zip: '53703',
      domain: '', domainMode: 'skip', purchaseYears: 1,
      ownerName: 'Owner', industry: 'general_contractor', serviceRegion: 'Madison',
      nearbyCities: ['Sun Prairie', 'Fitchburg', 'Middleton', 'Verona'], defaultPassword: KNOWN_PASSWORD,
    },
    branding: { primaryColor: '#FF6B35', secondaryColor: '#1A365D', logo: null, logoFilename: null, favicon: null, faviconFilename: null, heroPhoto: null, heroPhotoFilename: null },
    features: { website: ['contact_form'], crm: [], paid_ads: false },
    integrations: { twilio: { accountSid: '', authToken: '', phoneNumber: '' }, sendgrid: { apiKey: '' }, stripe: { secretKey: '', publishableKey: '', webhookSecret: '' }, googleMaps: { apiKey: '' }, sentry: { dsn: '' }, nearmap: { apiKey: '' }, replicate: { apiToken: '' } },
    content: { services: [], customServices: [], heroTagline: '', aboutText: '', ctaText: '', description: '' },
  }
  await supabase.from('tenants').insert({
    id: tenantId, name: 'Premium Test Co', slug, email: ADMIN_EMAIL, admin_email: ADMIN_EMAIL,
    industry: 'general_contractor', city: 'Madison', state: 'WI', status: 'pending', products,
    is_test_tenant: true, domain: null, domain_registrar: null,
  })
  console.log('[provision] Generating zip…')
  const zip = await generate({ id: tenantId, ...config } as any)
  console.log('[provision] Deploying to Render (~2 min for build, ~3-5 min until live)…')
  const deploy = await deployCustomer(
    { id: tenantId, slug, name: 'Premium Test Co', industry: 'general_contractor', products, config },
    zip.zipPath,
    { products }
  )
  if (!deploy.siteUrl) {
    console.error('[provision] Deploy failed: status=' + deploy.status + ' errors=' + JSON.stringify(deploy.errors))
    process.exit(1)
  }
  // Write deploy outputs back to the tenant row — production sign-up flow
  // does this elsewhere; the bare provisioner has to do it itself or the
  // factory's OAuth/cron lookups for this tenant fail.
  const { error: updErr } = await supabase.from('tenants').update({
    factory_sync_key: deploy.factorySyncKey || null,
    status: 'active',
    website_url: deploy.siteUrl,
    render_frontend_url: deploy.siteUrl,
  }).eq('id', tenantId)
  if (updErr) console.warn('[provision] supabase post-deploy update failed:', updErr.message)
  console.log('')
  console.log('━'.repeat(64))
  console.log('Premium tenant provisioned. Wait ~2-3 min for first boot.')
  console.log('━'.repeat(64))
  console.log('Tenant ID:    ' + tenantId)
  console.log('Public site:  ' + deploy.siteUrl)
  console.log('Admin URL:    ' + deploy.siteUrl + '/admin')
  console.log('Owner email:  ' + ADMIN_EMAIL)
  console.log('Owner pw:     ' + KNOWN_PASSWORD)
  console.log('')
  console.log('PageSpeed:    https://pagespeed.web.dev/analysis?url=' + encodeURIComponent(deploy.siteUrl))
  console.log('')
  console.log('When done:    bun run scripts/cleanup-test-premium.ts ' + tenantId)
}

main().catch(e => { console.error('[provision] FAILED:', e); process.exit(1) })
