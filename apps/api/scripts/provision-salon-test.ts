/**
 * Provisions ONE throwaway Salon CRM (crm-salon, "Twomiah Salon") test tenant,
 * deploys it live through the real Factory pipeline (GitHub repo + Render service
 * + Render Postgres + migrations + seed), and prints URLs / creds to verify it.
 *
 * Flagged is_test_tenant=true. Tear down with:
 *     cd apps/api && bun run scripts/cleanup-salon-test.ts <tenantId>
 *
 * Run from apps/api so bun auto-loads .env:
 *     cd apps/api && bun run scripts/provision-salon-test.ts
 */
import crypto from 'crypto'
import { generate } from '../src/services/generator.ts'
import { deployCustomer } from '../src/services/deploy.ts'
import { getFeaturesForTemplate } from '../src/config/featureRegistry.ts'
import { createClient } from '@supabase/supabase-js'

const KNOWN_PASSWORD = 'Salon-test-pw-' + crypto.randomBytes(3).toString('hex') + '!'
const ADMIN_EMAIL = 'twomiah14@gmail.com'

async function main() {
  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const slug = 'salontest-' + Date.now().toString(36) + '-' + crypto.randomBytes(2).toString('hex')
  const tenantId = crypto.randomUUID()
  const products = ['crm']
  const NAME = 'Copper & Cane Salon (test)'
  const salonFeatures = getFeaturesForTemplate('crm-salon').map(f => f.id)
  console.log('[provision] Salon features →', salonFeatures.join(', '))

  const config: any = {
    tenant_id: tenantId, tenant_name: NAME, tenant_slug: slug, products,
    company: {
      name: NAME, email: ADMIN_EMAIL, phone: '+1-608-555-0177',
      address: '18 W Mifflin St', city: 'Madison', state: 'WI', stateFull: 'Wisconsin', zip: '53703',
      domain: '', domainMode: 'skip', ownerName: 'Owner', industry: 'hair_salon',
      defaultPassword: KNOWN_PASSWORD,
    },
    branding: { primaryColor: '#0D9488', secondaryColor: '#0F766E', logo: null, logoFilename: null, favicon: null, faviconFilename: null, heroPhoto: null, heroPhotoFilename: null },
    // features.website MUST stay [] — a non-empty list makes stripWebsiteFeatures
    // wipe services/blog/gallery on the site side (see project_website_content_pipeline).
    features: { crm: salonFeatures, website: [], paid_ads: false },
    integrations: { twilio: { accountSid: '', authToken: '', phoneNumber: '' }, sendgrid: { apiKey: '' }, stripe: { secretKey: process.env.STRIPE_SECRET_KEY || '', publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || '', webhookSecret: '' }, googleMaps: { apiKey: '' }, sentry: { dsn: '' }, nearmap: { apiKey: '' }, replicate: { apiToken: '' } },
    content: { services: [], customServices: [], heroTagline: '', aboutText: '', ctaText: '', description: '' },
  }

  await supabase.from('tenants').insert({
    id: tenantId, name: NAME, slug, email: ADMIN_EMAIL, admin_email: ADMIN_EMAIL,
    industry: 'hair_salon', city: 'Madison', state: 'WI', status: 'pending', products,
    plan: 'starter', is_test_tenant: true, domain: null,
  })

  console.log('[provision] Generating crm-salon zip…')
  const zip = await generate({ id: tenantId, ...config } as any)

  console.log('[provision] Deploying to Render (GitHub push + build + DB migrate + seed, ~3-7 min)…')
  const deploy = await deployCustomer(
    { id: tenantId, slug, name: NAME, industry: 'hair_salon', products, config },
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
  console.log('━'.repeat(64))
  console.log('Salon CRM test tenant deployed. Wait ~2-3 min for first boot.')
  console.log('━'.repeat(64))
  console.log('Tenant ID:   ' + tenantId)
  console.log('CRM URL:     ' + crmUrl)
  console.log('Repo:        ' + (deploy.repoUrl || 'n/a'))
  console.log('Owner email: ' + ADMIN_EMAIL)
  console.log('Owner pw:    ' + KNOWN_PASSWORD)
  console.log('Steps:       ' + JSON.stringify(deploy.steps))
  console.log('')
  console.log('Verify:      /crm/service-menu (6 seeded services), /crm/reminders (Sarah Mitchell shows OVERDUE),')
  console.log('             /crm/clients → Sarah → Formula History (Wella 6/0 + 7/1, 20 vol)')
  console.log('Teardown:    cd apps/api && bun run scripts/cleanup-salon-test.ts ' + tenantId)
  console.log('SALONTEST_RESULT ' + JSON.stringify({ tenantId, crmUrl, repoUrl: deploy.repoUrl, email: ADMIN_EMAIL, password: KNOWN_PASSWORD }))
}

main().catch(e => { console.error('[provision] FAILED:', e?.message || e); process.exit(1) })
