/**
 * Code-only redeploy of the existing STORE test tenant (crm-store shop back-office
 * + website-store storefront). Recomposes storefront content so the site keeps its
 * on-theme copy, regenerates from the current templates, and force-pushes to the
 * existing repo (Render autoDeploys both services). DB untouched. Test tenants only.
 *
 *   cd apps/api && bun run scripts/redeploy-store-test.ts <tenantId>
 */
import { generate } from '../src/services/generator.ts'
import { updateCustomerCode } from '../src/services/deploy.ts'
import { getFeaturesForTemplate } from '../src/config/featureRegistry.ts'
import { deployProductsForVertical } from '../src/config/industryRouting.ts'
import { generateWebsiteContent } from '../src/services/contentGenerator.ts'
import { createClient } from '@supabase/supabase-js'

const tenantId = process.argv[2]
if (!tenantId) { console.error('usage: redeploy-store-test.ts <tenantId>'); process.exit(1) }

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const { data: tenant } = await supabase.from('tenants').select('*').eq('id', tenantId).single()
if (!tenant) { console.error('tenant not found'); process.exit(1) }
if (!tenant.is_test_tenant) { console.error('refusing: not a test tenant'); process.exit(1) }

const industry = tenant.industry || 'dropshipping'
const products = deployProductsForVertical(industry, [])
const storeFeatures = getFeaturesForTemplate('crm-store').map((f: any) => f.id)
const city = tenant.city || 'Eau Claire', state = tenant.state || 'WI'

console.log('[redeploy-store]', tenant.slug, 'products →', JSON.stringify(products))
console.log('[redeploy-store] Composing storefront content (AI + Pexels)…')
const aiGenerated = await generateWebsiteContent({
  businessName: tenant.name, businessType: industry,
  location: { city, state, stateFull: 'Wisconsin' },
  services: [], description: tenant.name + ' online store', nearbyCities: [],
  phone: tenant.phone, email: tenant.admin_email || tenant.email, ownerName: 'Owner',
}).catch((e: any) => { console.warn('[redeploy-store] content compose failed (ships skeleton):', e?.message); return undefined })

const config: any = {
  tenant_id: tenant.id, tenant_name: tenant.name, tenant_slug: tenant.slug, products,
  company: {
    name: tenant.name, email: tenant.admin_email || tenant.email, phone: tenant.phone || '',
    address: '', city, state, stateFull: 'Wisconsin', zip: '',
    domain: '', domainMode: 'skip', ownerName: 'Owner', industry,
    defaultPassword: tenant.admin_password || 'ChangeMe-1!', description: tenant.name + ' online store',
  },
  branding: { primaryColor: tenant.primary_color || '#4f46e5', secondaryColor: '#1e3a5f', logo: null, logoFilename: null, favicon: null, faviconFilename: null, heroPhoto: null, heroPhotoFilename: null },
  features: { crm: storeFeatures, website: [], paid_ads: false },
  integrations: { twilio: { accountSid: '', authToken: '', phoneNumber: '' }, sendgrid: { apiKey: '' }, stripe: { secretKey: '', publishableKey: '', webhookSecret: '' }, googleMaps: { apiKey: '' }, sentry: { dsn: '' }, nearmap: { apiKey: '' }, replicate: { apiToken: '' } },
  content: { services: [], customServices: [], heroTagline: '', aboutText: '', ctaText: '', description: tenant.name + ' online store', aiGenerated },
}

console.log('[redeploy-store] Generating crm-store + website-store zip…')
const zip = await generate({ id: tenant.id, ...config } as any)
const res = await updateCustomerCode({ id: tenant.id, slug: tenant.slug, name: tenant.name }, zip.zipPath)
console.log('[redeploy-store] steps:', JSON.stringify(res.steps))
if (!res.success) { console.error('[redeploy-store] FAILED:', res.errors); process.exit(1) }
console.log('[redeploy-store] pushed — Render is rebuilding shop-api + storefront')
