/**
 * Provisions a DEMO tenant branded as "Zacho Sports Center" (Eau Claire, WI) —
 * website-rv + crm-rv — loaded with their real (publicly-listed) inventory that
 * was baked into templates/website-rv/data/inventory.json. For a side-by-side
 * vs their Dealer Spike site. Throwaway / is_test_tenant.
 *
 * Run:      cd apps/api && bun run scripts/provision-zacho-demo.ts
 * Teardown: cd apps/api && bun run scripts/cleanup-rv-website-test.ts <tenantId>
 */
import crypto from 'crypto'
import fs from 'fs'
import { generate } from '../src/services/generator.ts'
import { deployCustomer } from '../src/services/deploy.ts'
import { generateWebsiteContent } from '../src/services/contentGenerator.ts'
import { createClient } from '@supabase/supabase-js'

const KNOWN_PASSWORD = 'Zacho-demo-' + crypto.randomBytes(3).toString('hex') + '!'
const ADMIN_EMAIL = 'twomiah14@gmail.com'
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const readB64 = (p: string) => { try { const s = fs.readFileSync(p, 'utf8').trim(); return s.startsWith('data:') ? s : null } catch { return null } }
const ZLOGO = readB64('C:/tmp/zacho-logo.b64')
const ZHERO = readB64('C:/tmp/zacho-hero.b64')

async function main() {
  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const slug = 'zacho-' + Date.now().toString(36) + '-' + crypto.randomBytes(2).toString('hex')
  const tenantId = crypto.randomUUID()
  const products = ['website', 'crm']
  const NAME = 'Zacho Sports Center'

  const config: any = {
    tenant_id: tenantId, tenant_name: NAME, tenant_slug: slug, products,
    company: {
      name: NAME, email: ADMIN_EMAIL, phone: '+1-715-723-0264',
      address: '2891 Mall Dr', city: 'Eau Claire', state: 'WI', stateFull: 'Wisconsin', zip: '54701',
      domain: '', domainMode: 'skip', purchaseYears: 1, ownerName: 'Owner', industry: 'rv',
      serviceRegion: 'Eau Claire & Chippewa Falls', nearbyCities: ['Chippewa Falls', 'Altoona', 'Menomonie', 'Hallie'],
      defaultPassword: KNOWN_PASSWORD,
    },
    branding: { primaryColor: '#E60000', secondaryColor: '#1A1A1A', accentColor: '#F4B41A', offWhiteColor: '#F8FAFB', logo: ZLOGO, logoFilename: ZLOGO ? 'zacho-logo.png' : null, favicon: null, faviconFilename: null, heroPhoto: ZHERO, heroPhotoFilename: ZHERO ? 'zacho-hero.jpg' : null },
    features: { website: [], crm: [], paid_ads: false },
    integrations: { twilio: { accountSid: '', authToken: '', phoneNumber: '' }, sendgrid: { apiKey: '' }, stripe: { secretKey: '', publishableKey: '', webhookSecret: '' }, googleMaps: { apiKey: '' }, sentry: { dsn: '' }, nearmap: { apiKey: '' }, replicate: { apiToken: '' } },
    content: { services: [], customServices: [], heroTagline: '', aboutText: '', ctaText: '', description: '' },
  }

  await supabase.from('tenants').insert({
    id: tenantId, name: NAME, slug, email: ADMIN_EMAIL, admin_email: ADMIN_EMAIL,
    industry: 'rv', city: 'Eau Claire', state: 'WI', status: 'pending', products,
    is_test_tenant: true, domain: null, domain_registrar: null,
  })

  console.log('[zacho] Composing tailored RV/powersports content (AI composer, ~1-3 min)…')
  try {
    const ai = await generateWebsiteContent({
      businessName: NAME, businessType: 'rv',
      location: { city: 'Eau Claire', state: 'WI', stateFull: 'Wisconsin' },
      services: ['New & Used Boats', 'Motorcycles', 'ATVs & Side-by-Sides', 'Service & Repair', 'Parts & Accessories', 'Financing'],
      description: "Eau Claire's family-owned powersports and marine dealer — Bennington and Crestliner pontoons and fishing boats, Indian, Honda and Yamaha motorcycles, ATVs and side-by-sides. Full-service sales, certified on-site service, and financing for every credit situation.",
      colorPalette: { primary: '#E67A22', secondary: '#1A1A1A' },
      serviceRegion: 'Eau Claire & Chippewa Falls', nearbyCities: ['Chippewa Falls', 'Altoona', 'Menomonie'],
      phone: '+1-715-723-0264', email: ADMIN_EMAIL,
    })
    // The composer leaves hero.image empty and its homepage merge replaces the
    // hero wholesale — so pin the marine hero (written by branding.heroPhoto).
    if (ai?.homepage?.hero) ai.homepage.hero.image = '/images/hero.jpg'
    // The composer leaves service.image empty → the template renders big empty
    // gray boxes. Fill them with real inventory photos so the cards show product.
    try {
      const inv = JSON.parse(fs.readFileSync('C:/ALL TWOMIAH PRODUCTS/TwomiahFactory/templates/website-rv/data/inventory.json', 'utf8'))
      const need = Math.max(6, (ai.services || []).length)
      const seen = new Set<string>()
      const pics: string[] = []
      const cats = [...new Set(inv.map((x: any) => x.category).filter(Boolean))]
      // round-robin across categories so the cards are varied AND distinct (no repeats)
      let added = true
      while (added && pics.length < need) {
        added = false
        for (const c of cats) {
          const m = inv.find((x: any) => x.category === c && x.photos?.[0] && !seen.has(x.photos[0]))
          if (m) { seen.add(m.photos[0]); pics.push(m.photos[0]); added = true; if (pics.length >= need) break }
        }
      }
      for (const x of inv) { if (pics.length >= need) break; if (x.photos?.[0] && !seen.has(x.photos[0])) { seen.add(x.photos[0]); pics.push(x.photos[0]) } }
      ;(ai.services || []).forEach((s: any, i: number) => { if (pics[i]) s.image = pics[i] }) // distinct photo per card
      console.log('[zacho] Assigned ' + pics.length + ' inventory photos to ' + (ai.services?.length || 0) + ' service cards')
    } catch (e: any) { console.warn('[zacho] service image assign failed:', e?.message) }
    config.content.aiGenerated = ai
    console.log('[zacho] Composed: ' + (ai?.services?.length || 0) + ' services, ' + (ai?.posts?.length || 0) + ' posts. Hero tagline: ' + JSON.stringify(ai?.homepage?.hero?.tagline || '(none)'))
  } catch (e: any) { console.error('[zacho] COMPOSE FAILED:', e?.message); process.exit(1) }

  console.log('[zacho] Generating website-rv + crm-rv (composed content + real inventory)…')
  const zip = await generate({ id: tenantId, ...config } as any)

  console.log('[zacho] Deploying website + CRM + DB (~10-12 min)…')
  const deploy: any = await deployCustomer(
    { id: tenantId, slug, name: NAME, industry: 'rv', products, config } as any,
    zip.zipPath, { products } as any,
  )

  const siteUrl = deploy.siteUrl || deploy.deployedUrl
  const crmUrl = deploy.apiUrl
  if (!siteUrl) { console.error('[zacho] Deploy FAILED:', deploy.status, JSON.stringify(deploy.errors)); console.error('tenantId:', tenantId); process.exit(1) }

  await supabase.from('tenants').update({
    factory_sync_key: deploy.factorySyncKey || null, status: 'active',
    website_url: siteUrl, render_frontend_url: siteUrl,
    render_backend_url: crmUrl || null, database_url: deploy.dbConnectionString || null,
  }).eq('id', tenantId)

  // Seed the CRM from the website's (baked) inventory so both are populated.
  let seeded = 0
  if (crmUrl && deploy.factorySyncKey) {
    let units: any[] = []
    for (let i = 0; i < 24; i++) { try { const r = await fetch(siteUrl + '/api/inventory'); const j: any = await r.json(); if (j.units?.length) { units = j.units; break } } catch {} await sleep(15000) }
    for (let i = 0; i < 48; i++) { try { const h = await fetch(crmUrl + '/health', { signal: AbortSignal.timeout(5000) }); if (h.ok) break } catch {} await sleep(5000) }
    if (units.length) { try { const r = await fetch(crmUrl + '/api/internal/seed-units', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Factory-Key': deploy.factorySyncKey }, body: JSON.stringify({ units }), signal: AbortSignal.timeout(60000) }); const j: any = await r.json().catch(() => ({})); seeded = j.inserted || 0 } catch {} }
  }

  console.log('\n' + '━'.repeat(64))
  console.log('ZACHO DEMO deployed (website + CRM). Allow ~3 min for first boot.')
  console.log('━'.repeat(64))
  console.log('Tenant ID:     ' + tenantId)
  console.log('Public site:   ' + siteUrl)
  console.log('Website CMS:   ' + siteUrl + '/admin   (' + ADMIN_EMAIL + ' / ' + KNOWN_PASSWORD + ')')
  console.log('CRM:           ' + (crmUrl || 'n/a') + '   (' + ADMIN_EMAIL + ' / ' + KNOWN_PASSWORD + ')')
  console.log('CRM units seeded: ' + seeded)
  console.log('Teardown:      cd apps/api && bun run scripts/cleanup-rv-website-test.ts ' + tenantId)
  console.log('ZACHO_RESULT ' + JSON.stringify({ tenantId, siteUrl, crmUrl, seeded }))
}

main().catch((e) => { console.error('[zacho] FAILED:', e?.message || e); process.exit(1) })
