/**
 * Provisions ONE throwaway STORE test tenant (crm-store shop back-office +
 * website-store storefront) through the real Factory pipeline, with AI-composed
 * storefront content + on-theme Pexels imagery (same path runDeploy uses) and
 * the Google Business Profile feature. Uses First Feeder's real intake data so
 * it validates exactly what First Feeder's live deploy would produce.
 *
 * is_test_tenant=true. Tear down with the generic cleanup:
 *     cd apps/api && bun run scripts/cleanup-events-test.ts <tenantId>
 *
 * Run from apps/api so bun auto-loads .env:
 *     cd apps/api && bun run scripts/provision-store-test.ts
 */
import crypto from 'crypto'
import { generate } from '../src/services/generator.ts'
import { deployCustomer } from '../src/services/deploy.ts'
import { getFeaturesForTemplate } from '../src/config/featureRegistry.ts'
import { deployProductsForVertical } from '../src/config/industryRouting.ts'
import { generateWebsiteContent } from '../src/services/contentGenerator.ts'
import { createClient } from '@supabase/supabase-js'

const KNOWN_PASSWORD = 'Store-test-pw-' + crypto.randomBytes(3).toString('hex') + '!'
const ADMIN_EMAIL = 'twomiah14@gmail.com'
const FIRST_FEEDER_ID = 'db71a136-d190-4683-9aaa-4b4f7417e038'

async function main() {
  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  // Pull First Feeder's real intake so the test store is representative.
  const { data: ff } = await supabase.from('tenants').select('intake_data,primary_color').eq('id', FIRST_FEEDER_ID).maybeSingle()
  const intake = (ff?.intake_data && (ff.intake_data as any).intake) || {}
  const services: string[] = Array.isArray(intake.services) ? intake.services : []
  const description: string = intake.description || 'A starter store for new birders.'

  const slug = 'storetest-' + Date.now().toString(36) + '-' + crypto.randomBytes(2).toString('hex')
  const tenantId = crypto.randomUUID()
  const NAME = 'First Feeder (test)'
  const industry = 'dropshipping'
  const products = deployProductsForVertical(industry, [])        // ['crm','website']
  const storeFeatures = getFeaturesForTemplate('crm-store').map(f => f.id)
  console.log('[provision] products →', JSON.stringify(products))
  console.log('[provision] store features →', storeFeatures.join(', '))

  const city = intake.city || 'Eau Claire', state = intake.state || 'WI'
  const primaryColor = intake.branding?.primaryColor || ff?.primary_color || '#4f46e5'

  // Compose the storefront content (store-aware contentGenerator + Pexels imagery),
  // exactly as runDeploy does, and pass it as content.aiGenerated so generate()
  // writes it into website/data — otherwise the storefront ships skeleton copy.
  console.log('[provision] Composing storefront content (AI + Pexels)…')
  const aiGenerated = await generateWebsiteContent({
    businessName: NAME, businessType: industry,
    location: { city, state, stateFull: intake.stateFull || 'Wisconsin' },
    services, description, nearbyCities: [], phone: intake.phone, email: ADMIN_EMAIL, ownerName: intake.ownerName,
  }).catch((e: any) => { console.warn('[provision] content compose failed (deploys skeleton):', e?.message); return undefined })

  const config: any = {
    tenant_id: tenantId, tenant_name: NAME, tenant_slug: slug, products,
    company: {
      name: NAME, email: ADMIN_EMAIL, phone: intake.phone || '', address: '', city, state, stateFull: intake.stateFull || 'Wisconsin', zip: '',
      domain: '', domainMode: 'skip', ownerName: intake.ownerName || 'Owner', industry,
      defaultPassword: KNOWN_PASSWORD, description,
    },
    branding: { primaryColor, secondaryColor: '#1e3a5f', logo: null, logoFilename: null, favicon: null, faviconFilename: null, heroPhoto: null, heroPhotoFilename: null },
    // features.website MUST stay [] (stripWebsiteFeatures wipes site content otherwise).
    features: { crm: storeFeatures, website: [], paid_ads: false },
    integrations: { twilio: { accountSid: '', authToken: '', phoneNumber: '' }, sendgrid: { apiKey: '' }, stripe: { secretKey: '', publishableKey: '', webhookSecret: '' }, googleMaps: { apiKey: '' }, sentry: { dsn: '' }, nearmap: { apiKey: '' }, replicate: { apiToken: '' } },
    content: { services: [], customServices: [], heroTagline: '', aboutText: '', ctaText: '', description, aiGenerated },
  }

  await supabase.from('tenants').insert({
    id: tenantId, name: NAME, slug, email: ADMIN_EMAIL, admin_email: ADMIN_EMAIL,
    industry, city, state, status: 'pending', products, plan: 'starter', is_test_tenant: true, domain: null,
  })

  console.log('[provision] Generating crm-store + website-store zip…')
  const zip = await generate({ id: tenantId, ...config } as any)

  console.log('[provision] Deploying to Render (GitHub + shop-api + storefront + Postgres + migrate + seed, ~5-10 min)…')
  const deploy = await deployCustomer(
    { id: tenantId, slug, name: NAME, industry, products, config } as any,
    zip.zipPath,
    { products },
  )

  const crmUrl = deploy.apiUrl || deploy.deployedUrl
  if (!crmUrl) {
    console.error('[provision] Deploy FAILED: status=' + deploy.status + ' errors=' + JSON.stringify(deploy.errors))
    console.error('[provision] tenantId (for cleanup): ' + tenantId)
    process.exit(1)
  }

  await supabase.from('tenants').update({
    factory_sync_key: deploy.factorySyncKey || null, status: 'active',
    render_backend_url: deploy.apiUrl || null, render_frontend_url: deploy.deployedUrl || deploy.apiUrl || null,
    website_url: deploy.siteUrl || null, admin_password: KNOWN_PASSWORD,
  }).eq('id', tenantId)

  console.log('')
  console.log('━'.repeat(64))
  console.log('STORE test tenant deployed. Wait ~2-3 min for first boot.')
  console.log('━'.repeat(64))
  console.log('Tenant ID:    ' + tenantId)
  console.log('Shop back-office (CRM): ' + crmUrl)
  console.log('Storefront (site):      ' + (deploy.siteUrl || 'n/a'))
  console.log('Repo:         ' + (deploy.repoUrl || 'n/a'))
  console.log('Owner email:  ' + ADMIN_EMAIL)
  console.log('Owner pw:     ' + KNOWN_PASSWORD)
  console.log('')
  console.log('Verify: storefront hero = composed birding copy (not "Quality products, delivered");')
  console.log('        CRM → Google Reviews → Connect Google (sign in as twomiah14, the listing owner).')
  console.log('Teardown:     cd apps/api && bun run scripts/cleanup-events-test.ts ' + tenantId)
  console.log('STORETEST_RESULT ' + JSON.stringify({ tenantId, crmUrl, siteUrl: deploy.siteUrl, repoUrl: deploy.repoUrl, email: ADMIN_EMAIL, password: KNOWN_PASSWORD }))
}

main().catch(e => { console.error('[provision] FAILED:', e?.message || e); process.exit(1) })
