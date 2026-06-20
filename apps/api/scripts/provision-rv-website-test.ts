/**
 * Provisions ONE throwaway RV/POWERSPORTS DEALER WEBSITE (website-rv — a standard
 * server-rendered EJS site) and deploys it live so we can see the generated site.
 *
 * products: ['website'] + industry rv → generator picks website-rv.
 * Flagged is_test_tenant=true.
 *
 * Run from apps/api:  cd apps/api && bun run scripts/provision-rv-website-test.ts
 * Teardown:           cd apps/api && bun run scripts/cleanup-rv-website-test.ts <tenantId>
 */
import crypto from 'crypto'
import { generate } from '../src/services/generator.ts'
import { deployCustomer } from '../src/services/deploy.ts'
import { createClient } from '@supabase/supabase-js'

const KNOWN_PASSWORD = 'Rvsite-test-pw-' + crypto.randomBytes(3).toString('hex') + '!'
const ADMIN_EMAIL = 'twomiah14@gmail.com'

async function main() {
  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const slug = 'rvsite-' + Date.now().toString(36) + '-' + crypto.randomBytes(2).toString('hex')
  const tenantId = crypto.randomUUID()
  const products = ['website']
  const NAME = 'Northwoods RV & Powersports'

  const config: any = {
    tenant_id: tenantId, tenant_name: NAME, tenant_slug: slug, products,
    company: {
      name: NAME, email: ADMIN_EMAIL, phone: '+1-608-555-0177',
      address: '500 Dealer Way', city: 'Madison', state: 'WI', stateFull: 'Wisconsin', zip: '53703',
      domain: '', domainMode: 'skip', purchaseYears: 1, ownerName: 'Owner', industry: 'rv',
      serviceRegion: 'Greater Madison', nearbyCities: ['Sun Prairie', 'Fitchburg', 'Middleton', 'Verona'],
      defaultPassword: KNOWN_PASSWORD,
    },
    branding: { primaryColor: '#166534', secondaryColor: '#14532D', accentColor: '#EA580C', offWhiteColor: '#F8FAFB', logo: null, logoFilename: null, favicon: null, faviconFilename: null, heroPhoto: null, heroPhotoFilename: null },
    // IMPORTANT: an empty website array → generator uses ALL_WEBSITE_FEATURES
    // (nothing stripped). Passing a non-empty subset makes stripWebsiteFeatures
    // DELETE the other features' pages + empty their data files (e.g. a partial
    // list would wipe services.json and 404 the /services/:slug pages). Mirror
    // production (intake/deploy pass no website features → all enabled).
    features: { website: [], crm: [], paid_ads: false },
    integrations: { twilio: { accountSid: '', authToken: '', phoneNumber: '' }, sendgrid: { apiKey: '' }, stripe: { secretKey: '', publishableKey: '', webhookSecret: '' }, googleMaps: { apiKey: '' }, sentry: { dsn: '' }, nearmap: { apiKey: '' }, replicate: { apiToken: '' } },
    content: { services: [], customServices: [], heroTagline: '', aboutText: '', ctaText: '', description: '' },
  }

  await supabase.from('tenants').insert({
    id: tenantId, name: NAME, slug, email: ADMIN_EMAIL, admin_email: ADMIN_EMAIL,
    industry: 'rv', city: 'Madison', state: 'WI', status: 'pending', products,
    is_test_tenant: true, domain: null, domain_registrar: null,
  })

  console.log('[provision] Generating website-rv zip…')
  const zip = await generate({ id: tenantId, ...config } as any)

  console.log('[provision] Deploying to Render (~2 min build, ~3-5 min until live)…')
  const deploy = await deployCustomer(
    { id: tenantId, slug, name: NAME, industry: 'rv', products, config },
    zip.zipPath,
    { products },
  )

  const siteUrl = deploy.siteUrl || deploy.deployedUrl
  if (!siteUrl) {
    console.error('[provision] Deploy FAILED: status=' + deploy.status + ' errors=' + JSON.stringify(deploy.errors))
    console.error('[provision] tenantId (for cleanup): ' + tenantId)
    process.exit(1)
  }

  await supabase.from('tenants').update({
    factory_sync_key: deploy.factorySyncKey || null, status: 'active',
    website_url: siteUrl, render_frontend_url: siteUrl,
  }).eq('id', tenantId)

  console.log('')
  console.log('━'.repeat(64))
  console.log('RV website deployed. Wait ~2-3 min for first boot.')
  console.log('━'.repeat(64))
  console.log('Tenant ID:    ' + tenantId)
  console.log('Public site:  ' + siteUrl)
  console.log('Admin (CMS):  ' + siteUrl + '/admin   (' + ADMIN_EMAIL + ' / ' + KNOWN_PASSWORD + ')')
  console.log('Repo:         ' + (deploy.repoUrl || 'n/a'))
  console.log('')
  console.log('Teardown:     cd apps/api && bun run scripts/cleanup-rv-website-test.ts ' + tenantId)
  console.log('RVSITE_RESULT ' + JSON.stringify({ tenantId, siteUrl, repoUrl: deploy.repoUrl }))
}

main().catch(e => { console.error('[provision] FAILED:', e?.message || e); process.exit(1) })
