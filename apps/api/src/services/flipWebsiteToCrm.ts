/**
 * "Flip to CRM" — convert a website-only dealer (keeping their own DMS, with
 * inventory in the site's data/inventory.json) into a full CRM tenant, copying
 * their inventory across so it's a one-step conversion, not a migration.
 *
 * Unlike crmAddonProvision (premium-only: owner-credential handoff + SSO key
 * alignment), this targets STANDARD website tenants. A fresh CRM deploy creates
 * its own company + owner (the onboarding emails the credentials), so the only
 * extra step over a normal CRM provision is seeding the inventory.
 *
 * Flow:
 *  1. Validate: tenant has a website, no CRM yet, has an industry.
 *  2. Fetch the site's inventory via GET {site}/api/inventory.
 *  3. generate({products:['crm']}) → deployCustomer → CRM URL + DB + sync key.
 *  4. Wait for the CRM /health, then POST the units to the CRM's
 *     /api/internal/seed-units (X-Factory-Key).
 *  5. Record products += 'crm' and the CRM/DB URLs on the tenant.
 *
 *  ⚠️ KNOWN LIMITATION (verified live 2026-06-20 — deploy + seed + tenant update
 *  all worked end-to-end): deployCustomer recreates the tenant's slug-named
 *  GitHub repo for the CRM, which CLOBBERS the website code in that SAME repo.
 *  The website keeps serving on its running container but would fail a future
 *  redeploy. Before this is safe for a live customer, the CRM must deploy to a
 *  separate repo (e.g. slug + '-crm'), or the repo must be regenerated with
 *  BOTH website/ + crm-rv/. Until then, treat flip-to-crm as deploy-once and do
 *  not redeploy the website afterward. (Same deployCustomer behavior underlies
 *  crmAddonProvision, so the premium addon path likely shares this caveat.)
 */
const inFlight = new Set<string>()

export async function flipWebsiteToCrm(tenantId: string): Promise<{ success: boolean; crmUrl?: string; seeded?: number; error?: string }> {
  if (inFlight.has(tenantId)) return { success: false, error: 'flip already in flight' }
  inFlight.add(tenantId)
  try {
    return await doFlip(tenantId)
  } catch (err: any) {
    console.error('[Flip] Failed for', tenantId, ':', err?.message || err)
    return { success: false, error: err?.message || String(err) }
  } finally {
    inFlight.delete(tenantId)
  }
}

async function doFlip(tenantId: string): Promise<{ success: boolean; crmUrl?: string; seeded?: number; error?: string }> {
  const { supabase } = await import('../middleware/auth')

  const { data: tenant, error: tErr } = await supabase.from('tenants').select('*').eq('id', tenantId).maybeSingle()
  if (tErr || !tenant) throw new Error('Tenant lookup failed: ' + (tErr?.message || 'not found'))

  const products: string[] = tenant.products || []
  const hasWebsite = products.some((p) => p === 'website' || p.startsWith('website'))
  if (!hasWebsite) throw new Error('Tenant has no website product — nothing to flip')
  if (products.some((p) => p === 'crm' || p.startsWith('crm-'))) {
    console.log('[Flip]', tenant.slug, 'already has a CRM — treating as done')
    return { success: true, crmUrl: tenant.render_backend_url || undefined }
  }
  if (!tenant.industry) throw new Error('Tenant has no industry — cannot pick a CRM template')
  if (!process.env.RENDER_API_KEY) throw new Error('RENDER_API_KEY not configured')

  // 1. Pull the site's current inventory (best-effort — flip still proceeds if empty).
  const siteUrl = (tenant.website_url || tenant.render_frontend_url || '').replace(/\/+$/, '')
  let units: any[] = []
  if (siteUrl) {
    try {
      const invRes = await fetch(siteUrl + '/api/inventory', { signal: AbortSignal.timeout(20000) })
      if (invRes.ok) {
        const body = await invRes.json() as { units?: any[] }
        units = Array.isArray(body.units) ? body.units : []
      }
      console.log('[Flip] Fetched', units.length, 'units from', siteUrl)
    } catch (e: any) {
      console.warn('[Flip] Inventory fetch failed (continuing with 0):', e?.message)
    }
  }

  // 2. Refuse to clobber an existing CRM service.
  const { buildCrmApiHost } = await import('../config/industryRouting')
  const RENDER_API = 'https://api.render.com/v1'
  const renderHeaders = () => ({ Authorization: 'Bearer ' + process.env.RENDER_API_KEY, accept: 'application/json' })
  const crmApiName = buildCrmApiHost(tenant.slug, tenant.industry || '').replace('.onrender.com', '')
  const checkExisting = await fetch(RENDER_API + '/services?name=' + crmApiName + '&limit=3', { headers: renderHeaders() })
  const existingList = await checkExisting.json() as any[]
  if ((existingList?.[0]?.service?.id || existingList?.[0]?.id)) {
    throw new Error('CRM service "' + crmApiName + '" already exists on Render but tenant lacks crm — needs manual verification')
  }

  // 3. Generate + deploy the CRM (industry drives crm-rv selection).
  console.log('[Flip] Generating CRM for', tenant.slug, '(industry', tenant.industry + ')')
  const { generate } = await import('./generator')
  const config = {
    tenant_id: tenant.id,
    tenant_name: tenant.name,
    tenant_slug: tenant.slug,
    products: ['crm'],
    company: {
      name: tenant.name,
      email: tenant.admin_email || tenant.email,
      industry: tenant.industry,
      city: tenant.city || '',
      state: tenant.state || '',
      zip: tenant.zip || '',
      phone: tenant.phone || '',
      domain: '', domainMode: 'skip',
    },
    branding: {
      primaryColor: tenant.primary_color || '#166534',
      secondaryColor: tenant.secondary_color || '#14532D',
    },
    features: {},
    integrations: { resendKey: process.env.TWOMIAH_RESEND_API_KEY || process.env.RESEND_API_KEY || '' },
    content: {},
  }
  const zip = await generate({ id: tenant.id, ...config } as any)

  const { deployCustomer } = await import('./deploy')
  const result = await deployCustomer(
    { id: tenant.id, slug: tenant.slug, name: tenant.name, industry: tenant.industry, products: ['crm'], config } as any,
    zip.zipPath,
    { products: ['crm'] } as any
  )
  if (!result.apiUrl) throw new Error('CRM deploy failed: ' + result.status + ' ' + JSON.stringify(result.errors))
  console.log('[Flip] CRM deployed:', result.apiUrl)

  // 4. Wait for the CRM to come up before seeding.
  for (let i = 0; i < 60; i++) {
    try {
      const h = await fetch(result.apiUrl + '/health', { signal: AbortSignal.timeout(5000) })
      if (h.ok) { console.log('[Flip] CRM /health responded after ' + (i * 5) + 's'); break }
    } catch {}
    await new Promise((r) => setTimeout(r, 5000))
  }

  // 5. Seed the inventory into the fresh CRM.
  let seeded = 0
  const syncKey = result.factorySyncKey
  if (units.length && syncKey) {
    try {
      const seedRes = await fetch(result.apiUrl + '/api/internal/seed-units', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Factory-Key': syncKey },
        body: JSON.stringify({ units }),
        signal: AbortSignal.timeout(60000),
      })
      if (seedRes.ok) {
        const j = await seedRes.json() as { inserted?: number }
        seeded = j.inserted || 0
        console.log('[Flip] Seeded', seeded, 'units into CRM')
      } else {
        console.warn('[Flip] seed-units returned HTTP', seedRes.status)
      }
    } catch (e: any) {
      console.warn('[Flip] seed-units failed:', e?.message)
    }
  }

  // 6. Record the conversion on the tenant.
  const newProducts = Array.from(new Set([...products, 'crm']))
  const update: any = { products: newProducts }
  if (result.apiUrl) update.render_backend_url = result.apiUrl
  if (result.dbConnectionString) update.database_url = result.dbConnectionString
  if (syncKey) update.factory_sync_key = syncKey
  await supabase.from('tenants').update(update).eq('id', tenant.id)
  console.log('[Flip] Updated tenants.products →', JSON.stringify(newProducts))

  return { success: true, crmUrl: result.apiUrl, seeded }
}
