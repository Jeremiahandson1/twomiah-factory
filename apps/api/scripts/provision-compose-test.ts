/**
 * Composer E2E for a chosen vertical: composeSite() → preview_premium_pages →
 * generate → deploy, so the LIVE site renders real AI-composed sections.
 * Modeled on provision-premium-full.ts; exists because the salon/restaurant
 * verticals shipped with their composed site never proven.
 *
 * Run:      cd apps/api && bun run scripts/provision-compose-test.ts salon
 *           cd apps/api && bun run scripts/provision-compose-test.ts restaurant
 * Teardown: bun run scripts/cleanup-test-premium.ts <tenantId>
 */
import crypto from 'crypto'
import { generate } from '../src/services/generator.ts'
import { deployCustomer } from '../src/services/deploy.ts'
import { composeSite } from '../src/services/sectionComposer.ts'
import { createClient } from '@supabase/supabase-js'

const VERTICALS: Record<string, any> = {
  salon: {
    name: 'Gilded Shears Studio',
    industry: 'salon',
    businessType: 'hair salon',
    description: 'An Eau Claire hair studio for cuts, color, balayage and bridal styling — warm chairs, honest pricing, easy online booking.',
    services: ['Haircuts', 'Color & Balayage', 'Blowouts & Styling', 'Bridal & Event Hair', 'Treatments', 'Kids Cuts'],
    primaryColor: '#8A5A44',
    // words that would betray a contractor-pack leak on a salon site
    mustNotContain: ['roof', 'contractor', 'hvac', 'plumbing', 'lien', 'remodel', 'shingle'],
    mustContain: ['salon', 'hair'],
  },
  restaurant: {
    name: 'The Copper Birch',
    industry: 'restaurant',
    businessType: 'restaurant',
    description: 'A Eau Claire supper-club-inspired restaurant — wood-fired plates, craft cocktails, private dining and full-service event hosting.',
    services: ['Dinner Service', 'Private Events', 'Catering', 'Craft Cocktails', 'Sunday Brunch', 'Chef Tastings'],
    primaryColor: '#5B3A29',
    mustNotContain: ['roof', 'contractor', 'hvac', 'plumbing', 'lien', 'remodel', 'shingle'],
    mustContain: ['menu', 'dining'],
  },
}

const which = process.argv[2]
const V = VERTICALS[which]
if (!V) { console.error('Usage: bun run scripts/provision-compose-test.ts <salon|restaurant>'); process.exit(1) }

const KNOWN_PASSWORD = 'Compose-test-pw-' + crypto.randomBytes(3).toString('hex') + '!'
const ADMIN_EMAIL = 'twomiah14@gmail.com'

async function main() {
  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const slug = 'composetest-' + which + '-' + Date.now().toString(36).slice(-4) + crypto.randomBytes(2).toString('hex')
  const tenantId = crypto.randomUUID()
  const products = ['website', 'website-premium']
  const config: any = {
    tenant_id: tenantId, tenant_name: V.name, tenant_slug: slug, products,
    company: {
      name: V.name, email: ADMIN_EMAIL, phone: '+1-715-555-0142',
      address: '214 Water St', city: 'Eau Claire', state: 'WI', stateFull: 'Wisconsin', zip: '54703',
      domain: '', domainMode: 'skip', purchaseYears: 1, ownerName: 'Owner', industry: V.industry,
      serviceRegion: 'Eau Claire', nearbyCities: ['Altoona', 'Chippewa Falls', 'Menomonie'],
      defaultPassword: KNOWN_PASSWORD,
    },
    branding: { primaryColor: V.primaryColor, secondaryColor: '#1A1A1A', logo: null, logoFilename: null, favicon: null, faviconFilename: null, heroPhoto: null, heroPhotoFilename: null },
    // features.website MUST stay [] — a non-empty list makes stripWebsiteFeatures
    // wipe services/blog/gallery on the site side (the "star icon" bug).
    features: { website: [], crm: [], paid_ads: false },
    integrations: { twilio: { accountSid: '', authToken: '', phoneNumber: '' }, sendgrid: { apiKey: '' }, stripe: { secretKey: '', publishableKey: '', webhookSecret: '' }, googleMaps: { apiKey: '' }, sentry: { dsn: '' }, nearmap: { apiKey: '' }, replicate: { apiToken: '' } },
    content: { services: [], customServices: [], heroTagline: '', aboutText: '', ctaText: '', description: '' },
  }
  await supabase.from('tenants').insert({
    id: tenantId, name: V.name, slug, email: ADMIN_EMAIL, admin_email: ADMIN_EMAIL,
    industry: V.industry, city: 'Eau Claire', state: 'WI', status: 'pending', products,
    is_test_tenant: true, domain: null, domain_registrar: null,
  })

  console.log(`[compose] Composing ${which} sections via composeSite (AI, ~2-5 min)…`)
  const composed = await composeSite({
    businessName: V.name, businessType: V.businessType, city: 'Eau Claire', state: 'WI',
    description: V.description, services: V.services,
    goals: ['bookings', 'walk-ins'], ownerName: 'Owner', phone: '+1-715-555-0142', email: ADMIN_EMAIL,
    nearbyCities: ['Altoona', 'Chippewa Falls', 'Menomonie'], primaryColor: V.primaryColor,
  } as any)
  const pageKeys = Object.keys((composed as any)?.pages || {})
  console.log('[compose] Composed pages: ' + (pageKeys.join(', ') || '(NONE)'))
  if (!pageKeys.length) { console.error('[compose] composeSite returned no pages — aborting'); process.exit(1) }

  // leak check on the composed JSON before spending a deploy on it
  const blob = JSON.stringify(composed).toLowerCase()
  const leaks = V.mustNotContain.filter((w: string) => blob.includes(w))
  const present = V.mustContain.filter((w: string) => blob.includes(w))
  console.log(`[compose] vocabulary — expected present: ${present.join(',') || 'NONE'} | leaks: ${leaks.join(',') || 'none'}`)
  if (leaks.length) console.warn('[compose] WARNING: cross-vertical vocabulary leaked into the composed content')

  const { error: pErr } = await supabase.from('tenants').update({
    preview_premium_pages: composed,
    preview_premium_approved_at: new Date().toISOString(),
    preview_premium_generated_at: new Date().toISOString(),
  }).eq('id', tenantId)
  if (pErr) { console.error('[compose] storing preview_premium_pages failed:', pErr.message); process.exit(1) }

  console.log('[compose] Generating + deploying…')
  const zip = await generate({ id: tenantId, ...config } as any)
  const deploy: any = await deployCustomer(
    { id: tenantId, slug, name: V.name, industry: V.industry, products, config } as any,
    zip.zipPath, { products } as any,
  )
  if (!deploy.siteUrl) { console.error('[compose] Deploy failed:', deploy.status, JSON.stringify(deploy.errors)); console.error('tenantId:', tenantId); process.exit(1) }
  await supabase.from('tenants').update({
    factory_sync_key: deploy.factorySyncKey || null, status: 'active',
    website_url: deploy.siteUrl, render_frontend_url: deploy.siteUrl,
  }).eq('id', tenantId)

  console.log('\n' + '━'.repeat(64))
  console.log(`COMPOSE E2E (${which}) deployed. Allow ~3-4 min for first boot + bootstrap.`)
  console.log('Teardown: cd apps/api && bun run scripts/cleanup-test-premium.ts ' + tenantId)
  console.log('COMPOSE_RESULT ' + JSON.stringify({ which, tenantId, siteUrl: deploy.siteUrl, pages: pageKeys, leaks }))
}

main().catch((e) => { console.error('[compose] FAILED:', e?.message || e); process.exit(1) })
