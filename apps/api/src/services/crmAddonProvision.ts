/**
 * Auto-provision a CRM for an existing premium-website tenant.
 *
 * Runs when the Stripe webhook sees a paid checkout for the
 * STRIPE_PRICE_PREMIUM_CRM_ADDON SKU (metadata: { tenant_id, addon: 'crm' }).
 * Extracted from scripts/provision-crm-for-tenant.ts — that script remains
 * the manual fallback / re-run path (and supports --force re-deploys).
 *
 * Flow:
 *  1. Validate tenant (premium, no CRM yet, has sync key + Stripe customer)
 *  2. Fetch the premium owner's email + bcrypt hash from the premium site
 *  3. deployCustomer with products=['crm'] only
 *  4. Align the CRM's FACTORY_SYNC_KEY env to the tenant's existing key
 *     (SSO handoff tokens are signed with it) and redeploy if needed
 *  5. Seed the CRM admin with the premium credentials (same login)
 *  6. Update tenants.products, tell the premium site its CRM URL
 *  7. Email the customer; on any failure email staff so the manual
 *     script can be run within the 24h SLA
 */
import { sendEmail } from './email'

const RENDER_API = 'https://api.render.com/v1'

// Stripe retries webhooks aggressively — don't double-provision a tenant
// whose first run is still mid-deploy.
const inFlight = new Set<string>()

function renderHeaders() {
  return { Authorization: 'Bearer ' + process.env.RENDER_API_KEY, accept: 'application/json' }
}

async function alertStaff(subject: string, detail: string, tenantId: string) {
  const to = process.env.STAFF_NOTIFY_EMAIL || process.env.INTAKE_NOTIFY_EMAIL || 'support@twomiah.com'
  await sendEmail(to, subject,
    '<p>' + detail + '</p>' +
    '<p>Tenant: <code>' + tenantId + '</code></p>' +
    '<p>Manual fallback: <code>bun run scripts/provision-crm-for-tenant.ts ' + tenantId + '</code></p>'
  ).catch(() => {})
}

export async function provisionCrmAddonForTenant(tenantId: string): Promise<{ success: boolean; crmUrl?: string; error?: string }> {
  if (inFlight.has(tenantId)) {
    console.log('[CrmAddon] Provision already in flight for', tenantId, '— skipping duplicate trigger')
    return { success: false, error: 'already in flight' }
  }
  inFlight.add(tenantId)
  try {
    return await doProvision(tenantId)
  } catch (err: any) {
    console.error('[CrmAddon] Provision failed for', tenantId, ':', err?.message || err)
    await alertStaff('CRM add-on auto-provision FAILED', 'Auto-provision threw: ' + (err?.message || String(err)), tenantId)
    return { success: false, error: err?.message || String(err) }
  } finally {
    inFlight.delete(tenantId)
  }
}

async function doProvision(tenantId: string): Promise<{ success: boolean; crmUrl?: string; error?: string }> {
  const { supabase } = await import('../middleware/auth')

  const { data: tenant, error: tErr } = await supabase.from('tenants').select('*').eq('id', tenantId).maybeSingle()
  if (tErr || !tenant) throw new Error('Tenant lookup failed: ' + (tErr?.message || 'not found'))

  if (!tenant.products?.includes('website-premium')) {
    throw new Error('Tenant does not have website-premium — CRM add-on is a premium-only upgrade path')
  }
  if (tenant.products?.includes('crm')) {
    console.log('[CrmAddon]', tenant.slug, 'already has crm in products — treating as provisioned')
    return { success: true }
  }
  if (!tenant.factory_sync_key) throw new Error('Tenant has no factory_sync_key — cannot authenticate to premium site')
  if (!process.env.RENDER_API_KEY) throw new Error('RENDER_API_KEY not configured')

  // 2. Owner credentials from the premium site (X-Factory-Key gated)
  const premiumSiteUrl = (tenant.website_url || '').replace(/\/+$/, '')
  if (!premiumSiteUrl) throw new Error('Tenant has no website_url recorded — cannot reach premium site')
  const credRes = await fetch(premiumSiteUrl + '/api/internal/owner-credentials', {
    headers: { 'X-Factory-Key': tenant.factory_sync_key },
    signal: AbortSignal.timeout(15000),
  })
  if (!credRes.ok) throw new Error('Owner credentials lookup failed: HTTP ' + credRes.status)
  const ownerRow = await credRes.json() as { email: string; passwordHash: string; name: string | null }
  console.log('[CrmAddon] Owner found:', ownerRow.email)

  // 3. Refuse to clobber an existing CRM service — that needs human eyes
  const { buildCrmApiHost } = await import('../config/industryRouting')
  const crmApiName = buildCrmApiHost(tenant.slug, tenant.industry || '').replace('.onrender.com', '')
  const checkExisting = await fetch(RENDER_API + '/services?name=' + crmApiName + '&limit=3', { headers: renderHeaders() })
  const existingList = await checkExisting.json() as any[]
  const existingCrm = existingList?.[0]?.service || existingList?.[0]
  if (existingCrm?.id) {
    throw new Error('CRM service "' + crmApiName + '" already exists on Render but tenant.products lacks crm — needs manual verification')
  }

  console.log('[CrmAddon] Generating CRM zip for', tenant.slug)
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
      primaryColor: tenant.primary_color || '#FF6B35',
      secondaryColor: tenant.secondary_color || '#1A365D',
    },
    features: {},
    integrations: { resendKey: process.env.TWOMIAH_RESEND_API_KEY || process.env.RESEND_API_KEY || '' },
    content: {},
  }
  const zip = await generate({ id: tenant.id, ...config } as any)

  console.log('[CrmAddon] Deploying CRM to Render for', tenant.slug)
  const { deployCustomer } = await import('./deploy')
  const result = await deployCustomer(
    { id: tenant.id, slug: tenant.slug, name: tenant.name, industry: tenant.industry, products: ['crm'], config } as any,
    zip.zipPath,
    { products: ['crm'], additiveCrm: true } as any
  )
  if (!result.apiUrl) throw new Error('CRM deploy failed: ' + result.status + ' ' + JSON.stringify(result.errors))
  console.log('[CrmAddon] CRM deployed:', result.apiUrl)

  // Wait for the CRM to come up before seeding
  for (let i = 0; i < 60; i++) {
    try {
      const h = await fetch(result.apiUrl + '/health', { signal: AbortSignal.timeout(5000) })
      if (h.ok) { console.log('[CrmAddon] CRM /health responded after ' + (i * 5) + 's'); break }
    } catch {}
    await new Promise(r => setTimeout(r, 5000))
    if (i === 59) console.warn('[CrmAddon] CRM /health never responded within 5min — continuing anyway')
  }

  // 4. SSO handoff requires the CRM's FACTORY_SYNC_KEY env to equal the
  // tenant's existing key. deployCustomer minted a fresh one — overwrite
  // and redeploy when they differ.
  const existingTenantKey = tenant.factory_sync_key as string
  const freshlyGeneratedKey = result.factorySyncKey
  let factorySyncKey = freshlyGeneratedKey || existingTenantKey || ''
  if (existingTenantKey && freshlyGeneratedKey && existingTenantKey !== freshlyGeneratedKey) {
    console.log('[CrmAddon] Aligning CRM FACTORY_SYNC_KEY to existing tenant key for SSO handoff')
    const crmSvcLookup = await fetch(RENDER_API + '/services?name=' + crmApiName + '&limit=3', { headers: renderHeaders() })
    const crmList = await crmSvcLookup.json() as any[]
    const crmSvcId = (crmList?.[0]?.service?.id || crmList?.[0]?.id) as string | undefined
    if (!crmSvcId) throw new Error('Could not find CRM service "' + crmApiName + '" for sync-key alignment — SSO handoff would fail')

    const putEnvRes = await fetch(RENDER_API + '/services/' + crmSvcId + '/env-vars/FACTORY_SYNC_KEY', {
      method: 'PUT',
      headers: { ...renderHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify({ value: existingTenantKey }),
    })
    if (!putEnvRes.ok) throw new Error('PUT FACTORY_SYNC_KEY failed: HTTP ' + putEnvRes.status)

    const triggerRes = await fetch(RENDER_API + '/services/' + crmSvcId + '/deploys', {
      method: 'POST', headers: { ...renderHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify({ clearCache: 'do_not_clear' }),
    })
    if (!triggerRes.ok) throw new Error('Redeploy trigger failed: HTTP ' + triggerRes.status)
    const triggerText = await triggerRes.text()
    let triggerJson: any = null
    try { triggerJson = triggerText ? JSON.parse(triggerText) : null } catch {}
    let newDeployId: string | undefined = triggerJson?.id || triggerJson?.deploy?.id || triggerJson?.deployId
    if (!newDeployId) {
      await new Promise(r => setTimeout(r, 3000))
      const lookupRes = await fetch(RENDER_API + '/services/' + crmSvcId + '/deploys?limit=1', { headers: renderHeaders() })
      const lookupJson = await lookupRes.json() as any[]
      newDeployId = lookupJson?.[0]?.deploy?.id || lookupJson?.[0]?.id
    }
    if (!newDeployId) throw new Error('Could not determine redeploy id after key alignment')

    let redeployedOk = false
    for (let i = 0; i < 72; i++) {
      try {
        const dr = await fetch(RENDER_API + '/services/' + crmSvcId + '/deploys/' + newDeployId, { headers: renderHeaders() })
        const dj = await dr.json() as any
        if (dj?.status === 'live') { redeployedOk = true; break }
        if (dj?.status && /failed|canceled|deactivated/.test(dj.status)) {
          throw new Error('CRM redeploy ended with status=' + dj.status)
        }
      } catch (e: any) {
        if (e?.message?.startsWith('CRM redeploy ended')) throw e
      }
      await new Promise(r => setTimeout(r, 5000))
    }
    if (!redeployedOk) throw new Error('CRM redeploy did not reach live within 6min — bailing to avoid key mismatch')

    // Verify the env var actually persisted — a silent PUT failure here
    // means a 401 storm for the customer later.
    const verifyRes = await fetch(RENDER_API + '/services/' + crmSvcId + '/env-vars/FACTORY_SYNC_KEY', { headers: renderHeaders() })
    const verifyJson = await verifyRes.json() as any
    const persistedVal = verifyJson?.value || verifyJson?.envVar?.value
    if (persistedVal !== existingTenantKey) throw new Error('FACTORY_SYNC_KEY PUT silently failed — Render shows a different value')

    // Give the new container's load-balancer slot a beat to take over
    await new Promise(r => setTimeout(r, 10000))
    factorySyncKey = existingTenantKey
  }

  // 5. Seed the CRM admin with the premium credentials (hash passes through —
  // the customer's existing password keeps working)
  if (factorySyncKey) {
    try {
      const seedRes = await fetch(result.apiUrl + '/api/internal/seed-from-premium', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Factory-Key': factorySyncKey },
        body: JSON.stringify({ email: ownerRow.email, passwordHash: ownerRow.passwordHash, name: ownerRow.name || tenant.name }),
      })
      if (seedRes.ok) console.log('[CrmAddon] CRM owner seeded with shared credentials')
      else console.warn('[CrmAddon] Seed call returned', seedRes.status)
    } catch (e: any) {
      console.warn('[CrmAddon] Seed call failed:', e?.message)
    }
  } else {
    console.warn('[CrmAddon] No factory_sync_key — skipping seed; customer must use forgot-password')
  }

  // 6. Record the product + tell the premium site where its CRM lives
  const newProducts = Array.from(new Set([...(tenant.products || []), 'crm']))
  await supabase.from('tenants').update({
    products: newProducts,
    factory_sync_key: factorySyncKey || tenant.factory_sync_key,
  }).eq('id', tenant.id)
  console.log('[CrmAddon] Updated tenants.products →', JSON.stringify(newProducts))

  if (factorySyncKey && premiumSiteUrl) {
    try {
      const r = await fetch(premiumSiteUrl + '/api/internal/set-crm-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Factory-Key': factorySyncKey },
        body: JSON.stringify({ crmUrl: result.apiUrl }),
      })
      if (!r.ok) console.warn('[CrmAddon] set-crm-url returned', r.status)
    } catch (e: any) {
      console.warn('[CrmAddon] Could not notify premium site:', e?.message)
    }
  }

  // 7. Tell the customer
  const to = tenant.admin_email || tenant.email
  if (to) {
    await sendEmail(to,
      'Your Twomiah CRM is ready',
      '<p>Hi ' + (tenant.name || 'there') + ',</p>' +
      '<p>Your CRM is live at <a href="' + result.apiUrl + '/crm">' + result.apiUrl + '/crm</a>.</p>' +
      '<p>Sign in with the same email and password you use for your website admin.</p>'
    ).catch(() => {})
  }

  return { success: true, crmUrl: result.apiUrl }
}
