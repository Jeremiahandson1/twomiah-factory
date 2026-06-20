/**
 * Provisions ONE throwaway VETERINARY WEBSITE (website-vet — a standard
 * server-rendered EJS site, NOT the premium/AI-composed track) and deploys it
 * live so we can see what the generated vet marketing site looks like.
 *
 * products: ['website'] (legacy/standard) + industry veterinary → generator
 * picks website-vet. Flagged is_test_tenant=true.
 *
 * Run from apps/api:  cd apps/api && bun run scripts/provision-vet-website-test.ts
 * Teardown:           cd apps/api && bun run scripts/cleanup-vet-website-test.ts <tenantId>
 */
import crypto from 'crypto'
import { generate } from '../src/services/generator.ts'
import { deployCustomer } from '../src/services/deploy.ts'
import { createClient } from '@supabase/supabase-js'

const KNOWN_PASSWORD = 'Vetsite-test-pw-' + crypto.randomBytes(3).toString('hex') + '!'
const ADMIN_EMAIL = 'twomiah14@gmail.com'

async function main() {
  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const slug = 'vetsite-' + Date.now().toString(36) + '-' + crypto.randomBytes(2).toString('hex')
  const tenantId = crypto.randomUUID()
  const products = ['website']
  const NAME = 'Lakeside Animal Hospital'

  const config: any = {
    tenant_id: tenantId, tenant_name: NAME, tenant_slug: slug, products,
    company: {
      name: NAME, email: ADMIN_EMAIL, phone: '+1-608-555-0199',
      address: '210 Lakeside Dr', city: 'Madison', state: 'WI', stateFull: 'Wisconsin', zip: '53703',
      domain: '', domainMode: 'skip', purchaseYears: 1, ownerName: 'Owner', industry: 'veterinary',
      serviceRegion: 'Greater Madison', nearbyCities: ['Sun Prairie', 'Fitchburg', 'Middleton', 'Verona'],
      defaultPassword: KNOWN_PASSWORD,
    },
    branding: { primaryColor: '#0D9488', secondaryColor: '#0F766E', accentColor: '#F59E0B', offWhiteColor: '#F8FAFB', logo: null, logoFilename: null, favicon: null, faviconFilename: null, heroPhoto: null, heroPhotoFilename: null },
    features: { website: ['contact_form'], crm: [], paid_ads: false },
    integrations: { twilio: { accountSid: '', authToken: '', phoneNumber: '' }, sendgrid: { apiKey: '' }, stripe: { secretKey: '', publishableKey: '', webhookSecret: '' }, googleMaps: { apiKey: '' }, sentry: { dsn: '' }, nearmap: { apiKey: '' }, replicate: { apiToken: '' } },
    content: { services: [], customServices: [], heroTagline: '', aboutText: '', ctaText: '', description: '' },
  }

  await supabase.from('tenants').insert({
    id: tenantId, name: NAME, slug, email: ADMIN_EMAIL, admin_email: ADMIN_EMAIL,
    industry: 'veterinary', city: 'Madison', state: 'WI', status: 'pending', products,
    is_test_tenant: true, domain: null, domain_registrar: null,
  })

  console.log('[provision] Generating website-vet zip…')
  const zip = await generate({ id: tenantId, ...config } as any)

  console.log('[provision] Deploying to Render (~2 min build, ~3-5 min until live)…')
  const deploy = await deployCustomer(
    { id: tenantId, slug, name: NAME, industry: 'veterinary', products, config },
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
  console.log('Vet website deployed. Wait ~2-3 min for first boot.')
  console.log('━'.repeat(64))
  console.log('Tenant ID:    ' + tenantId)
  console.log('Public site:  ' + siteUrl)
  console.log('Admin (CMS):  ' + siteUrl + '/admin   (' + ADMIN_EMAIL + ' / ' + KNOWN_PASSWORD + ')')
  console.log('Repo:         ' + (deploy.repoUrl || 'n/a'))
  console.log('Steps:        ' + JSON.stringify(deploy.steps))
  console.log('')
  console.log('Teardown:     cd apps/api && bun run scripts/cleanup-vet-website-test.ts ' + tenantId)
  console.log('VETSITE_RESULT ' + JSON.stringify({ tenantId, siteUrl, repoUrl: deploy.repoUrl }))
}

main().catch(e => { console.error('[provision] FAILED:', e?.message || e); process.exit(1) })
