/**
 * Provisions ONE throwaway contractor CRM (crm, the base template) test tenant
 * through the real Factory pipeline. Flagged is_test_tenant=true.
 * Teardown: cd apps/api && bun run scripts/cleanup-test-premium.ts <tenantId>
 * Run:      cd apps/api && bun run scripts/provision-contractor-test.ts
 */
import crypto from 'crypto'
import { generate } from '../src/services/generator.ts'
import { deployCustomer } from '../src/services/deploy.ts'
import { getFeaturesForTemplate } from '../src/config/featureRegistry.ts'
import { createClient } from '@supabase/supabase-js'

const KNOWN_PASSWORD = 'Contractor-test-pw-' + crypto.randomBytes(3).toString('hex') + '!'
const ADMIN_EMAIL = 'twomiah14@gmail.com'
const NAME = 'Cedar Ridge Builders (test)'

async function main() {
  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const slug = 'gctest-' + Date.now().toString(36) + '-' + crypto.randomBytes(2).toString('hex')
  const tenantId = crypto.randomUUID()
  const products = ['crm']
  const crmFeatures = getFeaturesForTemplate('crm').map(f => f.id)
  console.log('[provision] Contractor features →', crmFeatures.length, 'ids')

  const config: any = {
    tenant_id: tenantId, tenant_name: NAME, tenant_slug: slug, products,
    company: {
      name: NAME, email: ADMIN_EMAIL, phone: '+1-608-555-0188',
      address: '77 Ridge Rd', city: 'Madison', state: 'WI', stateFull: 'Wisconsin', zip: '53703',
      domain: '', domainMode: 'skip', ownerName: 'Owner', industry: 'general_contractor',
      defaultPassword: KNOWN_PASSWORD,
    },
    branding: { primaryColor: '#B45309', secondaryColor: '#78350F', logo: null, logoFilename: null, favicon: null, faviconFilename: null, heroPhoto: null, heroPhotoFilename: null },
    // features.website MUST stay [] (stripWebsiteFeatures wipes site content otherwise)
    features: { crm: crmFeatures, website: [], paid_ads: false },
    integrations: { twilio: { accountSid: '', authToken: '', phoneNumber: '' }, sendgrid: { apiKey: '' }, stripe: { secretKey: '', publishableKey: '', webhookSecret: '' }, googleMaps: { apiKey: '' }, sentry: { dsn: '' }, nearmap: { apiKey: '' }, replicate: { apiToken: '' } },
    content: { services: [], customServices: [], heroTagline: '', aboutText: '', ctaText: '', description: '' },
  }

  await supabase.from('tenants').insert({
    id: tenantId, name: NAME, slug, email: ADMIN_EMAIL, admin_email: ADMIN_EMAIL,
    industry: 'general_contractor', city: 'Madison', state: 'WI', status: 'pending', products,
    plan: 'starter', is_test_tenant: true, domain: null,
  })

  console.log('[provision] Generating crm zip…')
  const zip = await generate({ id: tenantId, ...config } as any)

  console.log('[provision] Deploying to Render (~5-8 min)…')
  const deploy = await deployCustomer(
    { id: tenantId, slug, name: NAME, industry: 'general_contractor', products, config },
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
    admin_password: KNOWN_PASSWORD,
  }).eq('id', tenantId)

  console.log('')
  console.log('GCTEST_RESULT ' + JSON.stringify({ tenantId, crmUrl, repoUrl: deploy.repoUrl, email: ADMIN_EMAIL, password: KNOWN_PASSWORD }))
}

main().catch(e => { console.error('[provision] FAILED:', e?.message || e); process.exit(1) })
