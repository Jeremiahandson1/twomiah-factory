/**
 * Provisions a PREMIUM-website tenant with REAL composed content.
 *
 * The bare provision-test-premium.ts leaves tenants.preview_premium_pages NULL,
 * so the site's first-boot bootstrap (initDb.ts → GET /internal/site-bootstrap)
 * pulls empty pages and the site renders the "Coming Soon" placeholder. This
 * script runs composeSite() and stores the result in preview_premium_pages (+
 * marks it approved) BEFORE deploy, so the site hydrates full sections on boot.
 *
 * Run: cd apps/api && ANTHROPIC_MODEL=claude-sonnet-4-6 bun run scripts/provision-premium-full.ts
 * Teardown: bun run scripts/cleanup-test-premium.ts <tenantId>
 */
import crypto from 'crypto'
import { generate } from '../src/services/generator.ts'
import { deployCustomer } from '../src/services/deploy.ts'
import { composeSite } from '../src/services/sectionComposer.ts'
import { createClient } from '@supabase/supabase-js'

const KNOWN_PASSWORD = 'Premium-test-pw-' + crypto.randomBytes(3).toString('hex') + '!'
const ADMIN_EMAIL = 'twomiah14@gmail.com'
const NAME = 'Summit Premium Roofing'

async function main() {
  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const slug = 'premiumfull-' + Date.now().toString(36) + '-' + crypto.randomBytes(2).toString('hex')
  const tenantId = crypto.randomUUID()
  const products = ['website', 'website-premium']
  const config: any = {
    tenant_id: tenantId, tenant_name: NAME, tenant_slug: slug, products,
    company: {
      name: NAME, email: ADMIN_EMAIL, phone: '+1-608-555-0142',
      address: '500 Summit Ave', city: 'Madison', state: 'WI', stateFull: 'Wisconsin', zip: '53703',
      domain: '', domainMode: 'skip', purchaseYears: 1, ownerName: 'Owner', industry: 'roofing',
      serviceRegion: 'Madison', nearbyCities: ['Sun Prairie', 'Fitchburg', 'Middleton', 'Verona'],
      defaultPassword: KNOWN_PASSWORD,
    },
    branding: { primaryColor: '#C8102E', secondaryColor: '#1A1A1A', logo: null, logoFilename: null, favicon: null, faviconFilename: null, heroPhoto: null, heroPhotoFilename: null },
    features: { website: ['contact_form'], crm: [], paid_ads: false },
    integrations: { twilio: { accountSid: '', authToken: '', phoneNumber: '' }, sendgrid: { apiKey: '' }, stripe: { secretKey: '', publishableKey: '', webhookSecret: '' }, googleMaps: { apiKey: '' }, sentry: { dsn: '' }, nearmap: { apiKey: '' }, replicate: { apiToken: '' } },
    content: { services: [], customServices: [], heroTagline: '', aboutText: '', ctaText: '', description: '' },
  }
  await supabase.from('tenants').insert({
    id: tenantId, name: NAME, slug, email: ADMIN_EMAIL, admin_email: ADMIN_EMAIL,
    industry: 'roofing', city: 'Madison', state: 'WI', status: 'pending', products,
    is_test_tenant: true, domain: null, domain_registrar: null,
  })

  // ── Compose the premium sections + store them so first-boot bootstrap hydrates ──
  console.log('[premium] Composing sections via composeSite (AI, ~2-5 min)…')
  const composed = await composeSite({
    businessName: NAME, businessType: 'roofing', city: 'Madison', state: 'WI',
    description: "Madison's premium roofing contractor — full roof replacements, storm restoration, repairs, gutters and siding. Insured, warrantied, and locally trusted.",
    services: ['Roof Replacement', 'Storm Damage Restoration', 'Roof Repair', 'Gutters', 'Siding', 'Free Inspections'],
    goals: ['leads', 'estimates'], ownerName: 'Owner', phone: '+1-608-555-0142', email: ADMIN_EMAIL,
    nearbyCities: ['Sun Prairie', 'Fitchburg', 'Middleton', 'Verona'], primaryColor: '#C8102E',
  } as any)
  const pageKeys = Object.keys((composed as any)?.pages || {})
  console.log('[premium] Composed pages: ' + (pageKeys.join(', ') || '(NONE)'))
  if (!pageKeys.length) { console.error('[premium] composeSite returned no pages — aborting'); process.exit(1) }
  const { error: pErr } = await supabase.from('tenants').update({
    preview_premium_pages: composed,
    preview_premium_approved_at: new Date().toISOString(),
    preview_premium_generated_at: new Date().toISOString(),
  }).eq('id', tenantId)
  if (pErr) { console.error('[premium] storing preview_premium_pages failed:', pErr.message); process.exit(1) }

  console.log('[premium] Generating + deploying (site bootstraps pages on first boot)…')
  const zip = await generate({ id: tenantId, ...config } as any)
  const deploy: any = await deployCustomer(
    { id: tenantId, slug, name: NAME, industry: 'roofing', products, config } as any,
    zip.zipPath, { products } as any,
  )
  if (!deploy.siteUrl) { console.error('[premium] Deploy failed:', deploy.status, JSON.stringify(deploy.errors)); console.error('tenantId:', tenantId); process.exit(1) }
  await supabase.from('tenants').update({
    factory_sync_key: deploy.factorySyncKey || null, status: 'active',
    website_url: deploy.siteUrl, render_frontend_url: deploy.siteUrl,
  }).eq('id', tenantId)

  console.log('\n' + '━'.repeat(64))
  console.log('PREMIUM (full content) deployed. Allow ~3-4 min for first boot + bootstrap.')
  console.log('━'.repeat(64))
  console.log('Tenant ID:    ' + tenantId)
  console.log('Public site:  ' + deploy.siteUrl)
  console.log('Admin URL:    ' + deploy.siteUrl + '/admin   (' + ADMIN_EMAIL + ' / ' + KNOWN_PASSWORD + ')')
  console.log('Teardown:     cd apps/api && bun run scripts/cleanup-test-premium.ts ' + tenantId)
  console.log('PREMIUM_RESULT ' + JSON.stringify({ tenantId, siteUrl: deploy.siteUrl }))
}

main().catch((e) => { console.error('[premium] FAILED:', e?.message || e); process.exit(1) })
