/**
 * Provisions ONE throwaway FULL RV dealer tenant — website-rv AND crm-rv together —
 * and deploys both live so we can navigate the public site + CMS + the CRM.
 * Seeds the CRM inventory from the website's DMS-importer output.
 *
 * Run:      cd apps/api && bun run scripts/provision-rv-full-test.ts
 * Teardown: cd apps/api && bun run scripts/cleanup-rv-website-test.ts <tenantId>
 */
import crypto from 'crypto'
import { generate } from '../src/services/generator.ts'
import { deployCustomer } from '../src/services/deploy.ts'
import { createClient } from '@supabase/supabase-js'

const KNOWN_PASSWORD = 'Rvfull-test-pw-' + crypto.randomBytes(3).toString('hex') + '!'
const ADMIN_EMAIL = 'twomiah14@gmail.com'
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const slug = 'rvfull-' + Date.now().toString(36) + '-' + crypto.randomBytes(2).toString('hex')
  const tenantId = crypto.randomUUID()
  const products = ['website', 'crm']
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
    features: { website: [], crm: [], paid_ads: false },
    integrations: { twilio: { accountSid: '', authToken: '', phoneNumber: '' }, sendgrid: { apiKey: '' }, stripe: { secretKey: '', publishableKey: '', webhookSecret: '' }, googleMaps: { apiKey: '' }, sentry: { dsn: '' }, nearmap: { apiKey: '' }, replicate: { apiToken: '' } },
    content: { services: [], customServices: [], heroTagline: '', aboutText: '', ctaText: '', description: '' },
  }

  await supabase.from('tenants').insert({
    id: tenantId, name: NAME, slug, email: ADMIN_EMAIL, admin_email: ADMIN_EMAIL,
    industry: 'rv', city: 'Madison', state: 'WI', status: 'pending', products,
    is_test_tenant: true, domain: null, domain_registrar: null,
  })

  console.log('[provision] Generating website-rv + crm-rv zip…')
  const zip = await generate({ id: tenantId, ...config } as any)

  console.log('[provision] Deploying both to Render (~10-12 min: website + CRM + DB)…')
  const deploy: any = await deployCustomer(
    { id: tenantId, slug, name: NAME, industry: 'rv', products, config } as any,
    zip.zipPath,
    { products } as any,
  )

  const siteUrl = deploy.siteUrl || deploy.deployedUrl
  const crmUrl = deploy.apiUrl
  if (!siteUrl) {
    console.error('[provision] Deploy FAILED: status=' + deploy.status + ' errors=' + JSON.stringify(deploy.errors))
    console.error('[provision] tenantId (for cleanup): ' + tenantId)
    process.exit(1)
  }

  await supabase.from('tenants').update({
    factory_sync_key: deploy.factorySyncKey || null, status: 'active',
    website_url: siteUrl, render_frontend_url: siteUrl,
    render_backend_url: crmUrl || null, database_url: deploy.dbConnectionString || null,
  }).eq('id', tenantId)

  // Seed the CRM inventory from the website's importer output so both are populated.
  let seeded = 0
  if (crmUrl && deploy.factorySyncKey) {
    console.log('[provision] Waiting for website inventory to import…')
    let units: any[] = []
    for (let i = 0; i < 24; i++) {
      try { const r = await fetch(siteUrl + '/api/inventory'); const j: any = await r.json(); if (j.units?.length) { units = j.units; break } } catch {}
      await sleep(15000)
    }
    console.log('[provision] Website inventory units:', units.length, '— waiting for CRM /health…')
    for (let i = 0; i < 48; i++) {
      try { const h = await fetch(crmUrl + '/health', { signal: AbortSignal.timeout(5000) }); if (h.ok) break } catch {}
      await sleep(5000)
    }
    if (units.length) {
      try {
        const r = await fetch(crmUrl + '/api/internal/seed-units', {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Factory-Key': deploy.factorySyncKey },
          body: JSON.stringify({ units }), signal: AbortSignal.timeout(60000),
        })
        const j: any = await r.json().catch(() => ({}))
        seeded = j.inserted || 0
      } catch (e: any) { console.warn('[provision] CRM seed failed:', e?.message) }
    }
  }

  console.log('')
  console.log('━'.repeat(64))
  console.log('FULL RV tenant deployed (website + CRM). Allow ~3 min for first boot.')
  console.log('━'.repeat(64))
  console.log('Tenant ID:     ' + tenantId)
  console.log('Public site:   ' + siteUrl)
  console.log('Website CMS:   ' + siteUrl + '/admin   (' + ADMIN_EMAIL + ' / ' + KNOWN_PASSWORD + ')')
  console.log('CRM:           ' + (crmUrl || 'n/a') + '   (' + ADMIN_EMAIL + ' / ' + KNOWN_PASSWORD + ')')
  console.log('CRM units seeded: ' + seeded)
  console.log('Repo:          ' + (deploy.repoUrl || 'n/a'))
  console.log('Teardown:      cd apps/api && bun run scripts/cleanup-rv-website-test.ts ' + tenantId)
  console.log('RVFULL_RESULT ' + JSON.stringify({ tenantId, siteUrl, crmUrl, seeded }))
}

main().catch((e) => { console.error('[provision] FAILED:', e?.message || e); process.exit(1) })
