import { supabase, requireRole } from '../../middleware/auth'
import { isConfigured, addCustomDomain, findRenderServicesBySlug } from '../../services/deploy'
import pg from 'pg'
import { FEATURE_REGISTRY, getFeaturesForTemplate } from '../../config/featureRegistry'
import { crmTemplateFor } from '../../config/industryRouting'
import { getAuthorizationUrl, exchangeCodeForTokens, refreshAccessToken, getCompanyInfo } from '../../services/quickbooksOnline'
import { type FactoryApp, parseJsonBody, UUID_RE, DOMAIN_RE, logTenantAudit, diffTenantChanges, qboOAuthStates, cleanExpiredStates } from './shared'

export function registerAdminRoutes(factory: FactoryApp) {
// ─── Preview ────────────────────────────────────────────────────────────────
function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function sanitizeCSSColor(str: string): string {
  return /^#[0-9a-fA-F]{3,8}$/.test(str.trim()) ? str.trim() : '#f97316'
}

factory.post('/preview', requireRole('owner', 'admin', 'editor'), async (c) => {
  try {
    const parsed = await parseJsonBody(c)
    if (parsed.error) return parsed.error
    const { config } = parsed.data
    if (!config) return c.json({ error: 'config required' }, 400)

    const name = escapeHtml(config.company?.name || 'Your Company')
    const primary = sanitizeCSSColor(config.branding?.primaryColor || '#f97316')
    const hero = escapeHtml(config.content?.heroTagline || 'Quality You Can Trust')
    const about = escapeHtml(config.content?.aboutText || '')
    const cta = escapeHtml(config.content?.ctaText || 'Get a free estimate today.')
    const html = '<!DOCTYPE html><html><head><title>' + name + ' Preview</title>' +
      '<style>body{font-family:system-ui,sans-serif;margin:0;} .hero{background:' + primary + ';color:white;padding:80px 40px;text-align:center;} .hero h1{font-size:2.5rem;margin:0 0 16px;} .content{max-width:800px;margin:40px auto;padding:0 20px;} .cta{background:#f5f5f5;text-align:center;padding:40px;margin-top:40px;}</style>' +
      '</head><body><div class="hero"><div style="font-size:0.9rem;text-transform:uppercase;letter-spacing:2px;margin-bottom:16px;">' + hero + '</div><h1>' + name + '</h1></div>' +
      '<div class="content"><p>' + about + '</p></div><div class="cta"><p>' + cta + '</p></div></body></html>'
    return new Response(html, { headers: { 'Content-Type': 'text/html' } })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})


// ─── Update Tenant (general fields with audit) ──────────────────────────────
factory.patch('/customers/:id', requireRole('owner', 'admin'), async (c) => {
  try {
    const id = c.req.param('id')
    if (!UUID_RE.test(id)) return c.json({ error: 'Invalid tenant ID format' }, 400)

    const parsed = await parseJsonBody(c)
    if (parsed.error) return parsed.error

    // Only allow known editable fields
    const ALLOWED_FIELDS = [
      'status', 'billing_type', 'billing_status', 'plan',
      'monthly_amount', 'one_time_amount', 'paid_at', 'next_billing_date',
      'render_frontend_url', 'render_backend_url', 'website_url',
      'notes', 'name', 'email', 'admin_email', 'phone',
      'address', 'city', 'state', 'zip', 'domain',
      'primary_color', 'secondary_color', 'industry',
    ]

    const updates: Record<string, any> = {}
    for (const key of ALLOWED_FIELDS) {
      if (key in parsed.data) updates[key] = parsed.data[key]
    }
    if (Object.keys(updates).length === 0) return c.json({ error: 'No valid fields to update' }, 400)

    // Fetch current tenant for diff
    const { data: tenant, error: fetchErr } = await supabase.from('tenants').select('*').eq('id', id).single()
    if (fetchErr || !tenant) return c.json({ error: 'Tenant not found' }, 404)

    // Apply update
    const { error: updateErr } = await supabase.from('tenants').update(updates).eq('id', id)
    if (updateErr) throw updateErr

    // Compute diff and log audit
    const changes = diffTenantChanges(tenant, updates)
    if (Object.keys(changes).length > 0) {
      const user = c.get('user')
      const adminEmail = user?.email || 'unknown'

      // Classify the action
      let action = 'update'
      if (changes.status) action = 'status_change'
      else if (changes.billing_type || changes.billing_status || changes.plan || changes.monthly_amount || changes.one_time_amount) action = 'billing_change'

      await logTenantAudit(id, action, changes, adminEmail, parsed.data.audit_note)
    }

    return c.json({ success: true, updated: Object.keys(updates) })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})


// ─── Tenant Audit Log (read) ─────────────────────────────────────────────────
factory.get('/customers/:id/audit-log', requireRole('owner', 'admin'), async (c) => {
  try {
    const id = c.req.param('id')
    if (!UUID_RE.test(id)) return c.json({ error: 'Invalid ID' }, 400)

    const limit = Math.min(Number(c.req.query('limit') || 50), 200)
    const offset = Number(c.req.query('offset') || 0)

    const { data, error } = await supabase
      .from('tenant_audit_log')
      .select('*')
      .eq('tenant_id', id)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (error) throw error
    return c.json({ auditLog: data || [], limit, offset })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})


// ─── Customer Domain ────────────────────────────────────────────────────────
factory.post('/customers/:id/domain', requireRole('owner', 'admin'), async (c) => {
  try {
    const tenantId = c.req.param('id')
    if (!UUID_RE.test(tenantId)) return c.json({ error: 'Invalid tenant ID format' }, 400)
    const parsed = await parseJsonBody(c)
    if (parsed.error) return parsed.error
    const { domain } = parsed.data
    if (!domain) return c.json({ error: 'domain is required' }, 400)
    if (!DOMAIN_RE.test(domain)) return c.json({ error: 'Invalid domain format. Expected format: example.com' }, 400)

    // Get current domain for audit diff
    const { data: curTenant } = await supabase.from('tenants').select('domain').eq('id', tenantId).single()
    const oldDomain = curTenant?.domain || null

    // Save domain to tenant record
    const { error } = await supabase.from('tenants').update({ domain }).eq('id', tenantId)
    if (error) throw error

    // Audit log
    if (oldDomain !== domain) {
      const user = c.get('user')
      await logTenantAudit(tenantId, 'update', { domain: { old: oldDomain, new: domain } }, user?.email)
    }

    // If Render services exist, add custom domain to each
    const renderErrors: string[] = []
    if (isConfigured()) {
      const { data: job } = await supabase.from('factory_jobs').select('render_service_ids')
        .eq('tenant_id', tenantId).order('created_at', { ascending: false }).limit(1).maybeSingle()
      const serviceIds = job?.render_service_ids
      if (serviceIds) {
        // Add domain to the primary user-facing service (site or frontend) at apex + www
        const primaryServiceId = serviceIds.site || serviceIds.frontend
        if (primaryServiceId) {
          const result = await addCustomDomain(primaryServiceId, domain)
          if (!result.success) renderErrors.push('Primary service (apex): ' + result.error)
          const wwwResult = await addCustomDomain(primaryServiceId, 'www.' + domain)
          if (!wwwResult.success && !wwwResult.error?.includes('already')) renderErrors.push('Primary service (www): ' + wwwResult.error)
        }
        // CRM backend gets app.<domain> — this is what the tenant's team logs into
        const backendServiceId = serviceIds.backend || serviceIds.api
        if (backendServiceId) {
          const appResult = await addCustomDomain(backendServiceId, 'app.' + domain)
          if (!appResult.success && !appResult.error?.includes('already')) renderErrors.push('CRM backend (app.): ' + appResult.error)
        }
      }
    }

    return c.json({ success: true, domain, renderErrors: renderErrors.length ? renderErrors : undefined })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})


// ─── Customer Domain DNS Verification ────────────────────────────────────────
factory.get('/customers/:id/domain/status', requireRole('owner', 'admin', 'editor'), async (c) => {
  try {
    const tenantId = c.req.param('id')
    if (!UUID_RE.test(tenantId)) return c.json({ error: 'Invalid tenant ID format' }, 400)

    const { data: tenant } = await supabase.from('tenants').select('domain, slug, website_url, render_frontend_url, render_backend_url')
      .eq('id', tenantId).single()
    if (!tenant?.domain) return c.json({ error: 'No domain configured' }, 400)

    const domain = tenant.domain
    // Find the actual .onrender.com hostname (not the custom domain)
    let renderHost = ''
    for (const url of [tenant.render_frontend_url, tenant.render_backend_url, tenant.website_url]) {
      if (url) {
        try {
          const host = new URL(url).hostname
          if (host.endsWith('.onrender.com')) { renderHost = host; break }
        } catch {}
      }
    }
    // Fallback: try to find via Render API
    if (!renderHost && tenant.slug) {
      try {
        const serviceIds = await findRenderServicesBySlug(tenant.slug)
        const primaryId = serviceIds.site || serviceIds.frontend
        if (primaryId && process.env.RENDER_API_KEY) {
          const svcRes = await fetch('https://api.render.com/v1/services/' + primaryId, {
            headers: { 'Authorization': 'Bearer ' + process.env.RENDER_API_KEY },
          })
          if (svcRes.ok) {
            const svcData = await svcRes.json() as any
            const svcUrl = svcData.serviceDetails?.url || svcData.service?.serviceDetails?.url
            if (svcUrl) renderHost = new URL(svcUrl).hostname
          }
        }
      } catch {}
    }
    if (!renderHost) {
      // Last resort: use website_url even if it's the custom domain
      const fallback = tenant.website_url || tenant.render_frontend_url || ''
      if (fallback) try { renderHost = new URL(fallback).hostname } catch {}
    }

    // Check DNS resolution via DNS-over-HTTPS (Cloudflare)
    const results: { type: string; name: string; status: 'verified' | 'pending' | 'error'; current?: string; expected?: string }[] = []

    // Check root domain A/CNAME
    try {
      const rootRes = await fetch('https://cloudflare-dns.com/dns-query?name=' + encodeURIComponent(domain) + '&type=A', {
        headers: { 'Accept': 'application/dns-json' },
      })
      const rootData = await rootRes.json() as any
      const rootAnswers = (rootData.Answer || []).map((a: any) => a.data)

      // Also check CNAME
      const cnameRes = await fetch('https://cloudflare-dns.com/dns-query?name=' + encodeURIComponent(domain) + '&type=CNAME', {
        headers: { 'Accept': 'application/dns-json' },
      })
      const cnameData = await cnameRes.json() as any
      const cnameAnswers = (cnameData.Answer || []).map((a: any) => a.data?.replace(/\.$/, ''))

      const pointsToRender = cnameAnswers.some((c: string) => c?.includes('.onrender.com')) ||
        rootAnswers.length > 0 // A records exist (Render IPs vary)

      results.push({
        type: 'A/CNAME',
        name: domain,
        status: pointsToRender ? 'verified' : 'pending',
        current: cnameAnswers.length > 0 ? 'CNAME → ' + cnameAnswers[0] : rootAnswers.length > 0 ? 'A → ' + rootAnswers[0] : 'Not configured',
        expected: 'CNAME → ' + renderHost,
      })
    } catch {
      results.push({ type: 'A/CNAME', name: domain, status: 'error', expected: 'CNAME → ' + renderHost })
    }

    // Check www subdomain
    try {
      const wwwRes = await fetch('https://cloudflare-dns.com/dns-query?name=www.' + encodeURIComponent(domain) + '&type=CNAME', {
        headers: { 'Accept': 'application/dns-json' },
      })
      const wwwData = await wwwRes.json() as any
      const wwwAnswers = (wwwData.Answer || []).map((a: any) => a.data?.replace(/\.$/, ''))
      const wwwPointsToRender = wwwAnswers.some((c: string) => c?.includes('.onrender.com'))

      results.push({
        type: 'CNAME',
        name: 'www.' + domain,
        status: wwwPointsToRender ? 'verified' : 'pending',
        current: wwwAnswers.length > 0 ? 'CNAME → ' + wwwAnswers[0] : 'Not configured',
        expected: 'CNAME → ' + renderHost,
      })
    } catch {
      results.push({ type: 'CNAME', name: 'www.' + domain, status: 'error', expected: 'CNAME → ' + renderHost })
    }

    // Check SSL (try HTTPS on the domain)
    let sslStatus: 'verified' | 'pending' | 'error' = 'pending'
    try {
      const sslRes = await fetch('https://' + domain, { method: 'HEAD', redirect: 'manual' })
      if (sslRes.status < 500) sslStatus = 'verified'
    } catch {
      sslStatus = 'pending'
    }

    const allVerified = results.every(r => r.status === 'verified')

    return c.json({
      domain,
      renderHost,
      records: results,
      ssl: sslStatus,
      allVerified,
      instructions: {
        provider: 'Your DNS provider (GoDaddy, Namecheap, Cloudflare, etc.)',
        steps: [
          { type: 'CNAME', name: 'www', value: renderHost, description: 'Points www.' + domain + ' to your site' },
          { type: 'CNAME', name: '@', value: renderHost, description: 'Points ' + domain + ' to your site (use CNAME flattening if supported, otherwise use A record)' },
        ],
        note: 'DNS changes typically take 5-30 minutes to propagate. SSL certificates are provisioned automatically by Render once DNS is verified.',
      },
    })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})


// ─── Settings: Current User Profile ──────────────────────────────────────────
factory.get('/settings/profile', async (c) => {
  try {
    const userId = c.get('userId')
    const { data, error } = await supabase
      .from('factory_users')
      .select('id, auth_id, email, name, role, created_at')
      .eq('auth_id', userId)
      .maybeSingle()
    if (error) throw error
    return c.json(data || { email: '', name: '', role: 'viewer' })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

factory.patch('/settings/profile', async (c) => {
  try {
    const userId = c.get('userId')
    const parsed = await parseJsonBody(c)
    if (parsed.error) return parsed.error
    const { name } = parsed.data
    const { data, error } = await supabase
      .from('factory_users')
      .update({ name })
      .eq('auth_id', userId)
      .select('id, auth_id, email, name, role, created_at')
      .single()
    if (error) throw error
    return c.json(data)
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})


// ─── Settings: Team Management (owner/admin only) ────────────────────────────
factory.get('/settings/users', requireRole('owner', 'admin'), async (c) => {
  try {
    const { data, error } = await supabase
      .from('factory_users')
      .select('id, auth_id, email, name, role, created_at')
      .order('created_at', { ascending: true })
    if (error) throw error
    return c.json(data || [])
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

factory.post('/settings/users', requireRole('owner', 'admin'), async (c) => {
  try {
    const parsed = await parseJsonBody(c)
    if (parsed.error) return parsed.error
    const { email, role } = parsed.data
    if (!email) return c.json({ error: 'email is required' }, 400)
    const validRoles = ['admin', 'editor', 'viewer']
    if (!role || !validRoles.includes(role)) return c.json({ error: 'role must be one of: ' + validRoles.join(', ') }, 400)

    // Check if user already exists
    const { data: existing } = await supabase
      .from('factory_users')
      .select('id')
      .eq('email', email)
      .maybeSingle()
    if (existing) return c.json({ error: 'User with this email already exists' }, 409)

    // Create a placeholder entry — auth_id will be filled when they log in
    // For now use a deterministic UUID from email or generate one
    const { data: authUser } = await (supabase.auth.admin as any).getUserByEmail(email)
    const authId = authUser?.user?.id || null

    if (authId) {
      const { data, error } = await supabase
        .from('factory_users')
        .insert({ auth_id: authId, email, role })
        .select('id, auth_id, email, name, role, created_at')
        .single()
      if (error) throw error
      return c.json(data, 201)
    } else {
      // Invite user via Supabase Auth
      const { data: invited, error: inviteErr } = await supabase.auth.admin.inviteUserByEmail(email)
      if (inviteErr) throw inviteErr
      if (!invited?.user) return c.json({ error: 'Failed to create invitation' }, 500)
      const { data, error } = await supabase
        .from('factory_users')
        .insert({ auth_id: invited.user.id, email, role })
        .select('id, auth_id, email, name, role, created_at')
        .single()
      if (error) throw error
      return c.json(data, 201)
    }
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

factory.patch('/settings/users/:id', requireRole('owner', 'admin'), async (c) => {
  try {
    const targetId = c.req.param('id')
    if (!UUID_RE.test(targetId)) return c.json({ error: 'Invalid user ID format' }, 400)
    const parsed = await parseJsonBody(c)
    if (parsed.error) return parsed.error
    const { role } = parsed.data
    const validRoles = ['owner', 'admin', 'editor', 'viewer']
    if (!role || !validRoles.includes(role)) return c.json({ error: 'role must be one of: ' + validRoles.join(', ') }, 400)

    // Prevent non-owners from assigning owner role
    const callerRole = c.get('userRole')
    if (role === 'owner' && callerRole !== 'owner') return c.json({ error: 'Only owners can assign owner role' }, 403)

    // Prevent demoting the last owner
    if (role !== 'owner') {
      const { data: target } = await supabase.from('factory_users').select('role').eq('id', targetId).single()
      if (target?.role === 'owner') {
        const { count } = await supabase.from('factory_users').select('id', { count: 'exact', head: true }).eq('role', 'owner')
        if (count && count <= 1) return c.json({ error: 'Cannot demote the last owner' }, 400)
      }
    }

    const { data, error } = await supabase
      .from('factory_users')
      .update({ role })
      .eq('id', targetId)
      .select('id, auth_id, email, name, role, created_at')
      .single()
    if (error) throw error
    return c.json(data)
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

factory.delete('/settings/users/:id', requireRole('owner', 'admin'), async (c) => {
  try {
    const targetId = c.req.param('id')
    if (!UUID_RE.test(targetId)) return c.json({ error: 'Invalid user ID format' }, 400)

    // Prevent removing the last owner
    const { data: target } = await supabase.from('factory_users').select('role').eq('id', targetId).single()
    if (target?.role === 'owner') {
      const { count } = await supabase.from('factory_users').select('id', { count: 'exact', head: true }).eq('role', 'owner')
      if (count && count <= 1) return c.json({ error: 'Cannot remove the last owner' }, 400)
    }

    // Prevent removing yourself
    const callerFactoryUserId = c.get('factoryUserId')
    if (callerFactoryUserId === targetId) return c.json({ error: 'Cannot remove yourself' }, 400)

    const { error } = await supabase.from('factory_users').delete().eq('id', targetId)
    if (error) throw error
    return c.json({ success: true })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})


// ─── Feature Management ──────────────────────────────────────────────────────

// Get features for a tenant (with registry metadata + audit log)
factory.get('/customers/:id/features', requireRole('owner', 'admin', 'editor'), async (c) => {
  try {
    const id = c.req.param('id')
    if (!UUID_RE.test(id)) return c.json({ error: 'Invalid ID' }, 400)

    const { data: tenant, error } = await supabase.from('tenants').select('id, features, plan, products, industry, database_url, status, last_feature_sync').eq('id', id).single()
    if (error || !tenant) return c.json({ error: 'Tenant not found' }, 404)

    // Determine which template this tenant uses
    const ind = tenant.industry || ''
    // automotive is parked and not in the central router; everything else
    // resolves through crmTemplateFor so industry variants (rv_dealer,
    // powersports, cleaning, etc.) map to the right template.
    const template = ind === 'automotive' ? 'crm-automotive' : crmTemplateFor(ind)

    const availableFeatures = getFeaturesForTemplate(template)

    // If tenant is active but has no features stored, or stored features are mostly from a
    // different template (e.g. industry was corrected), re-populate with all available features
    let enabledFeatures: string[] = tenant.features || []
    const availableIds = new Set(availableFeatures.map(f => f.id))
    const matchCount = enabledFeatures.filter(f => availableIds.has(f)).length
    const mismatch = enabledFeatures.length > 0 && matchCount < availableIds.size / 2
    if ((enabledFeatures.length === 0 || mismatch) && tenant.status === 'active') {
      enabledFeatures = availableFeatures.map(f => f.id)
      await supabase.from('tenants').update({ features: enabledFeatures }).eq('id', id)
    }

    // Get audit log (last 50 entries)
    const { data: auditLog } = await supabase
      .from('tenant_feature_audit')
      .select('*')
      .eq('tenant_id', id)
      .order('created_at', { ascending: false })
      .limit(50)

    return c.json({
      enabledFeatures,
      availableFeatures,
      template,
      plan: tenant.plan,
      hasDatabaseUrl: !!tenant.database_url,
      lastFeatureSync: tenant.last_feature_sync || null,
      auditLog: auditLog || [],
      registry: FEATURE_REGISTRY,
    })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

// Update features for a tenant (sync to Factory DB + deployed CRM)
factory.patch('/customers/:id/features', requireRole('owner', 'admin'), async (c) => {
  try {
    const id = c.req.param('id')
    if (!UUID_RE.test(id)) return c.json({ error: 'Invalid ID' }, 400)

    const parsed = await parseJsonBody(c)
    if (parsed.error) return parsed.error
    const { features, note } = parsed.data
    if (!Array.isArray(features)) return c.json({ error: 'features must be an array of strings' }, 400)

    // Get current tenant
    const { data: tenant, error } = await supabase.from('tenants').select('id, features, plan, industry, database_url, slug, render_backend_url, factory_sync_key').eq('id', id).single()
    if (error || !tenant) return c.json({ error: 'Tenant not found' }, 404)

    const previousFeatures: string[] = tenant.features || []
    const newFeatures: string[] = features.filter((f: any) => typeof f === 'string')

    // Determine what changed
    const added = newFeatures.filter(f => !previousFeatures.includes(f))
    const removed = previousFeatures.filter(f => !newFeatures.includes(f))
    const action = added.length > 0 && removed.length > 0 ? 'bulk_update'
      : added.length > 0 ? 'enable'
      : removed.length > 0 ? 'disable'
      : 'bulk_update'

    // Update Factory tenant record
    const { error: updateErr } = await supabase.from('tenants').update({ features: newFeatures }).eq('id', id)
    if (updateErr) throw updateErr

    // Sync to deployed CRM via HTTP API (preferred) or direct DB (fallback).
    // Verify-after-push: read what the CRM returned and confirm it matches
    // what we sent — silently dropped features would otherwise look like success.
    let syncedToCrm = false
    let syncError: string | null = null
    let syncMode: 'http' | 'db' | 'none' = 'none'
    let receivedCount: number | null = null

    if (tenant.render_backend_url && tenant.factory_sync_key) {
      syncMode = 'http'
      try {
        const syncUrl = tenant.render_backend_url.replace(/\/$/, '') + '/api/internal/sync-features'
        const syncRes = await fetch(syncUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Factory-Key': tenant.factory_sync_key },
          body: JSON.stringify({ features: newFeatures }),
        })
        const body = await syncRes.json().catch(() => ({} as any))
        if (!syncRes.ok) {
          syncError = body?.error || `HTTP ${syncRes.status}`
        } else {
          // Verify-after-push: CRM returns the persisted feature list.
          const returned: string[] = Array.isArray(body?.features) ? body.features : []
          receivedCount = returned.length
          const missing = newFeatures.filter(f => !returned.includes(f))
          if (missing.length > 0) {
            syncError = `CRM returned divergent feature list (missing: ${missing.join(', ')})`
          } else {
            syncedToCrm = true
          }
        }
      } catch (syncErr: any) {
        syncError = syncErr.message
        console.error('[Features] HTTP sync failed for', tenant.slug, ':', syncErr.message)
      }
    } else if (tenant.database_url) {
      syncMode = 'db'
      const ind = tenant.industry || ''
      const isHomeCare = ind === 'home_care'
      try {
        const client = new pg.Client({ connectionString: tenant.database_url, ssl: { rejectUnauthorized: false } })
        await client.connect()
        if (isHomeCare) {
          await client.query(
            `UPDATE agencies SET settings = jsonb_set(COALESCE(settings::jsonb, '{}'), '{enabledFeatures}', $1::jsonb)::json WHERE slug = $2`,
            [JSON.stringify(newFeatures), tenant.slug]
          )
        } else {
          await client.query(
            `UPDATE company SET enabled_features = $1::json WHERE slug = $2`,
            [JSON.stringify(newFeatures), tenant.slug]
          )
        }
        await client.end()
        receivedCount = newFeatures.length
        syncedToCrm = true
      } catch (syncErr: any) {
        syncError = syncErr.message
        console.error('[Features] DB sync failed for', tenant.slug, ':', syncErr.message)
      }
    } else {
      syncError = 'No sync method available (no backend URL or database connection)'
    }

    // Persist sync attempt on tenant row so the admin UI can show
    // current health without needing fresh history. Non-fatal on error.
    const lastFeatureSync = {
      at: new Date().toISOString(),
      ok: syncedToCrm,
      error: syncError,
      sent_count: newFeatures.length,
      received_count: receivedCount,
      mode: syncMode,
    }
    await supabase.from('tenants').update({ last_feature_sync: lastFeatureSync }).eq('id', id)

    // Get admin email from auth context
    const user = c.get('user')
    const adminEmail = user?.email || 'unknown'

    // Write audit log — always, even on resync-no-diff, so failures leave a trace.
    const changedFeatures = [...added, ...removed]
    const auditAction = changedFeatures.length === 0 ? 'resync' : action
    await supabase.from('tenant_feature_audit').insert({
      tenant_id: id,
      action: auditAction,
      features: changedFeatures,
      previous: previousFeatures,
      current: newFeatures,
      changed_by: adminEmail,
      synced_to_crm: syncedToCrm,
      sync_error: syncError,
      note: note || null,
    })

    return c.json({
      success: syncedToCrm,
      features: newFeatures,
      syncedToCrm,
      syncError,
      added,
      removed,
      lastFeatureSync,
    })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})


// ─── Tenant Database Health Check ─────────────────────────────────────────────

// Diagnostic: check all tenants for missing database_url
factory.get('/admin/db-health', requireRole('owner', 'admin'), async (c) => {
  try {
    const { data: tenants, error } = await supabase
      .from('tenants')
      .select('id, name, slug, status, database_url, supabase_project_ref, render_backend_url')
      .order('created_at', { ascending: false })

    if (error) throw error

    const results = (tenants || []).map(t => ({
      id: t.id,
      name: t.name,
      slug: t.slug,
      status: t.status,
      hasDatabase: !!t.database_url,
      hasSupabaseRef: !!t.supabase_project_ref,
      hasBackendUrl: !!t.render_backend_url,
      issue: t.status === 'active' && !t.database_url ? 'MISSING_DB_URL' : null,
    }))

    const missing = results.filter(r => r.issue === 'MISSING_DB_URL')

    return c.json({
      total: results.length,
      active: results.filter(r => r.status === 'active').length,
      missingDbUrl: missing.length,
      affected: missing,
      all: results,
    })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

// Repair: manually set database_url for a tenant
factory.patch('/customers/:id/database-url', requireRole('owner', 'admin'), async (c) => {
  try {
    const id = c.req.param('id')
    if (!UUID_RE.test(id)) return c.json({ error: 'Invalid ID' }, 400)

    const parsed = await parseJsonBody(c)
    if (parsed.error) return parsed.error
    const { database_url, skip_test } = parsed.data
    if (!database_url || typeof database_url !== 'string') {
      return c.json({ error: 'database_url is required (string)' }, 400)
    }

    // Verify the connection works before saving (skip if requested)
    if (!skip_test) {
      try {
        const client = new pg.Client({ connectionString: database_url, ssl: { rejectUnauthorized: false } })
        await client.connect()
        const result = await client.query('SELECT current_database() as db')
        await client.end()
        console.log('[Repair] Verified DB connection for tenant', id, '- db:', result.rows[0]?.db)
      } catch (connErr: any) {
        return c.json({ error: 'Connection test failed: ' + connErr.message, hint: 'For Render internal DBs, use skip_test: true' }, 400)
      }
    }

    // Get old value for audit
    const { data: curTenant } = await supabase.from('tenants').select('database_url').eq('id', id).single()

    const { error } = await supabase.from('tenants').update({ database_url }).eq('id', id)
    if (error) throw error

    // Audit log (mask connection strings for security)
    const user = c.get('user')
    await logTenantAudit(id, 'update', {
      database_url: { old: curTenant?.database_url ? '***masked***' : null, new: '***masked***' },
    }, user?.email, skip_test ? 'Connection test skipped' : 'Connection verified')

    return c.json({ success: true, message: skip_test ? 'database_url saved (untested)' : 'database_url saved and verified' })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

// Repair: attempt to recover database_url from Supabase project ref
factory.post('/customers/:id/repair-db-url', requireRole('owner', 'admin'), async (c) => {
  try {
    const id = c.req.param('id')
    if (!UUID_RE.test(id)) return c.json({ error: 'Invalid ID' }, 400)

    const { data: tenant, error } = await supabase
      .from('tenants')
      .select('id, slug, supabase_project_ref, database_url')
      .eq('id', id)
      .single()
    if (error || !tenant) return c.json({ error: 'Tenant not found' }, 404)

    if (tenant.database_url) {
      return c.json({ message: 'Tenant already has database_url', alreadySet: true })
    }

    if (!tenant.supabase_project_ref) {
      return c.json({ error: 'No supabase_project_ref — cannot recover connection string. Use PATCH /database-url to set manually.' }, 400)
    }

    // Try to get the connection string from Supabase Management API
    const sbApiKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ACCESS_TOKEN
    if (!sbApiKey) {
      return c.json({ error: 'No Supabase access token configured on Factory' }, 500)
    }

    const res = await fetch(`https://api.supabase.com/v1/projects/${tenant.supabase_project_ref}/postgrest`, {
      headers: { 'Authorization': `Bearer ${sbApiKey}` },
    })

    if (!res.ok) {
      // Try the database connection string endpoint
      const dbRes = await fetch(`https://api.supabase.com/v1/projects/${tenant.supabase_project_ref}`, {
        headers: { 'Authorization': `Bearer ${sbApiKey}` },
      })
      if (!dbRes.ok) {
        return c.json({ error: `Supabase API returned ${dbRes.status}. Set database_url manually via PATCH.` }, 400)
      }
      const project = await dbRes.json() as any
      // Build connection string from project info
      const dbHost = project.database?.host || `db.${tenant.supabase_project_ref}.supabase.co`
      return c.json({
        error: 'Could not auto-recover full connection string',
        hint: `Database host is likely: ${dbHost}. Use PATCH /database-url with the full postgres:// connection string including password.`,
        supabaseProjectRef: tenant.supabase_project_ref,
      }, 400)
    }

    return c.json({
      error: 'Auto-recovery requires the database password which is not stored. Use PATCH /database-url to set manually.',
      supabaseProjectRef: tenant.supabase_project_ref,
      hint: 'Find the connection string in the Supabase dashboard under Project Settings > Database.',
    }, 400)
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

// ─── Settings: Integration Status ────────────────────────────────────────────
factory.get('/settings/integrations', async (c) => {
  try {
    const integrations = {
      render: { configured: !!(process.env.RENDER_API_KEY), label: 'Render' },
      github: { configured: !!(process.env.GITHUB_TOKEN), label: 'GitHub' },
      stripe: { configured: !!(process.env.STRIPE_SECRET_KEY), label: 'Stripe' },
      sendgrid: { configured: !!(process.env.SENDGRID_API_KEY), label: 'SendGrid' },
      supabase_visualizer: { configured: !!(process.env.VISION_SUPABASE_URL && process.env.VISION_SUPABASE_SERVICE_KEY), label: 'Vision Supabase' },
      qb_online: { configured: !!(process.env.QBO_CLIENT_ID && process.env.QBO_CLIENT_SECRET), label: 'QuickBooks Online' },
      qb_desktop: { configured: !!(process.env.QBWC_PASSWORD), label: 'QuickBooks Desktop' },
    }
    return c.json(integrations)
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})


// ─── QBO OAuth: Initiate Connection ──────────────────────────────────────────
factory.get('/integrations/qbo/connect', requireRole('owner', 'admin'), async (c) => {
  try {
    if (!process.env.QBO_CLIENT_ID || !process.env.QBO_CLIENT_SECRET) {
      return c.json({ error: 'QuickBooks Online is not configured — set QBO_CLIENT_ID and QBO_CLIENT_SECRET' }, 400)
    }
    cleanExpiredStates()
    const state = crypto.randomUUID()
    qboOAuthStates.set(state, Date.now() + 10 * 60 * 1000) // 10 min expiry
    const authUrl = getAuthorizationUrl(state)
    return c.json({ authUrl })
  } catch (err: any) {
    console.error('[QBO] Error generating auth URL:', err.message)
    return c.json({ error: err.message }, 500)
  }
})

// ─── QBO OAuth: Callback (public — Intuit redirects here) ────────────────────
factory.get('/integrations/qbo/callback', async (c) => {
  const platformUrl = process.env.PLATFORM_URL || (process.env.NODE_ENV === 'production' ? 'https://twomiah-factory-platform.onrender.com' : 'http://localhost:5173')
  try {
    const state = c.req.query('state')
    const code = c.req.query('code')
    const realmId = c.req.query('realmId')
    const error = c.req.query('error')

    if (error) {
      console.error('[QBO] OAuth error from Intuit:', error)
      return c.redirect(`${platformUrl}/settings?qbo=error&message=${encodeURIComponent(error)}`)
    }

    if (!state || !code || !realmId) {
      return c.redirect(`${platformUrl}/settings?qbo=error&message=${encodeURIComponent('Missing required OAuth parameters')}`)
    }

    // Validate state
    cleanExpiredStates()
    const expiry = qboOAuthStates.get(state)
    if (!expiry || Date.now() > expiry) {
      qboOAuthStates.delete(state)
      return c.redirect(`${platformUrl}/settings?qbo=error&message=${encodeURIComponent('OAuth state expired or invalid — please try again')}`)
    }
    qboOAuthStates.delete(state)

    // Exchange code for tokens
    const tokens = await exchangeCodeForTokens(code, realmId)

    // Verify connection by fetching company info
    const companyInfo = await getCompanyInfo(tokens.access_token, realmId)

    // Store tokens in factory_integrations
    const config = {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      realm_id: realmId,
      expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      company_name: companyInfo.companyName,
      connected_at: new Date().toISOString(),
    }

    await supabase.from('factory_integrations').upsert({
      id: 'qbo',
      updated_at: new Date().toISOString(),
      config,
    })

    console.log(`[QBO] Connected to "${companyInfo.companyName}" (realm ${realmId})`)
    return c.redirect(`${platformUrl}/settings?qbo=connected`)
  } catch (err: any) {
    console.error('[QBO] Callback error:', err.message)
    return c.redirect(`${platformUrl}/settings?qbo=error&message=${encodeURIComponent(err.message)}`)
  }
})

// ─── QBO OAuth: Connection Status ────────────────────────────────────────────
factory.get('/integrations/qbo/status', async (c) => {
  try {
    const { data, error } = await supabase
      .from('factory_integrations')
      .select('config, updated_at')
      .eq('id', 'qbo')
      .maybeSingle()

    if (error) {
      // Table may not exist yet
      return c.json({ connected: false })
    }

    if (!data || !data.config?.access_token) {
      return c.json({ connected: false })
    }

    return c.json({
      connected: true,
      companyName: data.config.company_name || null,
      realmId: data.config.realm_id || null,
      connectedAt: data.config.connected_at || null,
      lastSync: data.updated_at || null,
    })
  } catch (err: any) {
    console.error('[QBO] Status check error:', err.message)
    return c.json({ connected: false })
  }
})

// ─── QBO OAuth: Disconnect ───────────────────────────────────────────────────
factory.post('/integrations/qbo/disconnect', requireRole('owner', 'admin'), async (c) => {
  try {
    const { error } = await supabase
      .from('factory_integrations')
      .delete()
      .eq('id', 'qbo')

    if (error) throw error
    console.log('[QBO] Disconnected')
    return c.json({ ok: true })
  } catch (err: any) {
    console.error('[QBO] Disconnect error:', err.message)
    return c.json({ error: err.message }, 500)
  }
})

// ─── QBO OAuth: Refresh Token ────────────────────────────────────────────────
factory.post('/integrations/qbo/refresh', requireRole('owner', 'admin'), async (c) => {
  try {
    const { data, error } = await supabase
      .from('factory_integrations')
      .select('config')
      .eq('id', 'qbo')
      .maybeSingle()

    if (error || !data?.config?.refresh_token) {
      return c.json({ error: 'No QBO connection found — connect first' }, 400)
    }

    const tokens = await refreshAccessToken(data.config.refresh_token)

    const updatedConfig = {
      ...data.config,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
    }

    await supabase.from('factory_integrations').update({
      config: updatedConfig,
      updated_at: new Date().toISOString(),
    }).eq('id', 'qbo')

    console.log('[QBO] Token refreshed successfully')
    return c.json({ ok: true, expiresAt: updatedConfig.expires_at })
  } catch (err: any) {
    console.error('[QBO] Token refresh error:', err.message)
    return c.json({ error: err.message }, 500)
  }
})
}
