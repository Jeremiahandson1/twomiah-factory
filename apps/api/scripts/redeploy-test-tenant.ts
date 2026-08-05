/**
 * Regenerate a test tenant's code from the current templates and push it to the
 * existing repo (Render rebuilds from the push). Test tenants only.
 *
 *   cd apps/api && bun run scripts/redeploy-test-tenant.ts <tenantId>
 */
import { generate } from '../src/services/generator.ts'
import { updateCustomerCode } from '../src/services/deploy.ts'
import { getFeaturesForTemplate } from '../src/config/featureRegistry.ts'
import { crmTemplateFor } from '../src/config/industryRouting.ts'
import { createClient } from '@supabase/supabase-js'

const tenantId = process.argv[2]
if (!tenantId) { console.error('usage: redeploy-test-tenant.ts <tenantId>'); process.exit(1) }

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const { data: tenant } = await supabase.from('tenants').select('*').eq('id', tenantId).single()
if (!tenant) { console.error('tenant not found'); process.exit(1) }
if (!tenant.is_test_tenant) { console.error('refusing: not a test tenant'); process.exit(1) }

const template = crmTemplateFor(tenant.industry)
const features = getFeaturesForTemplate(template).map((f: any) => f.id)
console.log('[redeploy]', tenant.slug, '-> template', template)

const config: any = {
  tenant_id: tenant.id, tenant_name: tenant.name, tenant_slug: tenant.slug, products: tenant.products || ['crm'],
  company: {
    name: tenant.name, email: tenant.admin_email || tenant.email, phone: tenant.phone || '',
    address: tenant.address || '', city: tenant.city || '', state: tenant.state || '', zip: tenant.zip || '',
    domain: '', domainMode: 'skip', ownerName: 'Owner', industry: tenant.industry,
    defaultPassword: tenant.admin_password || 'ChangeMe-1!',
  },
  branding: { primaryColor: tenant.primary_color, secondaryColor: tenant.secondary_color, logo: null, logoFilename: null, favicon: null, faviconFilename: null, heroPhoto: null, heroPhotoFilename: null },
  features: { crm: features, website: [], paid_ads: false },
  integrations: { twilio: { accountSid: '', authToken: '', phoneNumber: '' }, sendgrid: { apiKey: '' }, stripe: { secretKey: '', publishableKey: '', webhookSecret: '' }, googleMaps: { apiKey: '' }, sentry: { dsn: '' }, nearmap: { apiKey: '' }, replicate: { apiToken: '' } },
  content: { services: [], customServices: [], heroTagline: '', aboutText: '', ctaText: '', description: '' },
}

const zip = await generate({ id: tenant.id, ...config } as any)
const res = await updateCustomerCode({ id: tenant.id, slug: tenant.slug, name: tenant.name }, zip.zipPath)
console.log('[redeploy] steps:', JSON.stringify(res.steps))
if (!res.success) { console.error('[redeploy] FAILED:', res.errors); process.exit(1) }
console.log('[redeploy] pushed — Render is rebuilding')
