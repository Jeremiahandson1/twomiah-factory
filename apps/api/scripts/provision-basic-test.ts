/**
 * Provisions ONE throwaway crm-basic ("Twomiah Basic") test tenant and deploys it live through the real
 * Factory pipeline — GitHub repo, Render service, Render Postgres, migrations, seed.
 *
 * The industry is 'gym' ON PURPOSE. It is a SHOWCASE industry, so this exercises the whole new path
 * end to end: verticalFor('gym') → 'showcase' → crmTemplateFor → 'crm-basic', suffix 'basic', rootDir
 * crm-basic/backend. Before this vertical existed, a gym was handed the construction CRM — RFIs, lien
 * waivers, submittals. Provisioning with 'other' would prove less, because 'other' is the obvious case.
 *
 * Flagged is_test_tenant=true. Tear down with the shared teardown, which now sweeps '-basic' too.
 *
 * Run from apps/api so bun auto-loads .env:
 *     cd apps/api && bun run scripts/provision-basic-test.ts
 */
import crypto from 'crypto'
import * as fs from 'fs'

// This runs from a git WORKTREE, which has no .env of its own — bun's auto-load finds nothing and the
// Supabase client dies with "supabaseUrl is required". The real file lives in the primary checkout.
// Set API_ENV_PATH to override.
{
  const envPath = process.env.API_ENV_PATH || 'C:/ALL TWOMIAH PRODUCTS/TwomiahFactory/apps/api/.env'
  if (!process.env.SUPABASE_URL && fs.existsSync(envPath)) {
    for (const raw of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const m = raw.replace(/\r$/, '').match(/^([^#=]+)=(.*)$/)
      if (m && !process.env[m[1].trim()]) process.env[m[1].trim()] = m[2].trim().replace(/^"|"$/g, '')
    }
  }
  for (const k of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'RENDER_API_KEY', 'GITHUB_TOKEN']) {
    if (!process.env[k]) { console.error(`[provision] ${k} is not set — refusing to start a deploy that will fail part-way`); process.exit(1) }
  }
}

import { generate } from '../src/services/generator.ts'
import { deployCustomer } from '../src/services/deploy.ts'
import { getFeaturesForTemplate } from '../src/config/featureRegistry.ts'
import { crmTemplateFor, crmServiceSuffixFor, verticalFor } from '../src/config/industryRouting.ts'
import { createClient } from '@supabase/supabase-js'

const KNOWN_PASSWORD = 'Basic-test-pw-' + crypto.randomBytes(3).toString('hex') + '!'
const ADMIN_EMAIL = 'twomiah14@gmail.com'
const INDUSTRY = 'gym'

async function main() {
  // Refuse to deploy if the routing does not actually lead here — otherwise this "proves" crm-basic works
  // by quietly deploying crm instead, which is the failure mode worth guarding against most.
  const tpl = crmTemplateFor(INDUSTRY)
  if (tpl !== 'crm-basic') {
    console.error(`[provision] REFUSING: crmTemplateFor('${INDUSTRY}') is '${tpl}', not 'crm-basic'. Nothing deployed.`)
    process.exit(1)
  }
  console.log(`[provision] '${INDUSTRY}' → vertical '${verticalFor(INDUSTRY)}' → ${tpl} → suffix '${crmServiceSuffixFor(INDUSTRY)}'`)

  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const slug = 'basictest-' + Date.now().toString(36) + '-' + crypto.randomBytes(2).toString('hex')
  const tenantId = crypto.randomUUID()
  const products = ['crm']
  const NAME = 'Northside Strength & Conditioning (test)'
  const features = getFeaturesForTemplate('crm-basic').map(f => f.id)
  console.log('[provision] crm-basic offers ' + features.length + ' features')

  const config: any = {
    tenant_id: tenantId, tenant_name: NAME, tenant_slug: slug, products,
    company: {
      name: NAME, email: ADMIN_EMAIL, phone: '+1-608-555-0188',
      address: '412 State St', city: 'Madison', state: 'WI', stateFull: 'Wisconsin', zip: '53703',
      domain: '', domainMode: 'skip', ownerName: 'Owner', industry: INDUSTRY,
      defaultPassword: KNOWN_PASSWORD,
    },
    branding: { primaryColor: '#7C3AED', secondaryColor: '#5B21B6', logo: null, logoFilename: null, favicon: null, faviconFilename: null },
    // features.website MUST stay [] — a non-empty list makes stripWebsiteFeatures wipe
    // services/blog/gallery on the site side (see project_website_content_pipeline).
    features: { crm: features, website: [], paid_ads: false },
    integrations: { twilio: { accountSid: '', authToken: '', phoneNumber: '' }, sendgrid: { apiKey: '' }, stripe: { secretKey: '', publishableKey: '' } },
    content: { services: [], customServices: [], heroTagline: '', aboutText: '', ctaText: '', description: '' },
  }

  await supabase.from('tenants').insert({
    id: tenantId, name: NAME, slug, email: ADMIN_EMAIL, admin_email: ADMIN_EMAIL,
    industry: INDUSTRY, city: 'Madison', state: 'WI', status: 'pending', products,
    plan: 'starter', is_test_tenant: true, domain: null,
  })

  console.log('[provision] Generating crm-basic zip…')
  const zip = await generate({ id: tenantId, ...config } as any)

  console.log('[provision] Deploying to Render (GitHub push + build + DB migrate + seed, ~3-7 min)…')
  const deploy = await deployCustomer(
    { id: tenantId, slug, name: NAME, industry: INDUSTRY, products, config },
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
  console.log('crm-basic test tenant deployed. Wait ~2-3 min for first boot.')
  console.log('━'.repeat(64))
  console.log('Tenant ID:   ' + tenantId)
  console.log('CRM URL:     ' + crmUrl)
  console.log('Repo:        ' + (deploy.repoUrl || 'n/a'))
  console.log('Owner email: ' + ADMIN_EMAIL)
  console.log('Owner pw:    ' + KNOWN_PASSWORD)
  console.log('Steps:       ' + JSON.stringify(deploy.steps))
  console.log('')
  console.log('BASICTEST_RESULT ' + JSON.stringify({ tenantId, slug, crmUrl, repoUrl: deploy.repoUrl, email: ADMIN_EMAIL, password: KNOWN_PASSWORD }))
}

main().catch(e => { console.error('[provision] FAILED:', e?.message || e); process.exit(1) })
