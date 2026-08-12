import { supabase, requireRole } from '../../middleware/auth'
import { findRenderServicesBySlug, wireDomainInfrastructure } from '../../services/deploy'
import factoryStripe from '../../services/factoryStripe'
import { deleteZip } from '../../services/factoryStorage'
import { notifyPreviewFollowup, notifyPostLaunchTips, notifyDomainRenewal, notifySubscriptionRenewal, notifyOffboardStarted, notifyEppCode, notifyDataExportReady, notifyReactivated, notifyOffboardComplete } from '../../services/email'
import fs from 'fs'
import path from 'path'
import { getRegistrar, isRegistrarConfigured } from '../../services/registrar'
import { type FactoryApp, secureEquals, checkFactoryKey, checkCronSecret, factoryKeyOrRole, UUID_RE, DOMAIN_RE, logTenantAudit, parseJsonBody } from './shared'

export function registerLifecycleRoutes(factory: FactoryApp) {

// ─── SendGrid Inbound Parse webhook ─────────────────────────────────────────
// Registered once per factory-owned parse hostname with SendGrid. When an
// email arrives at <tenant-id-no-dashes>-<localPart>@<parseHost>, SendGrid
// POSTs a multipart/form-data payload here. We identify the tenant from the
// local part and forward the parsed message to the tenant backend's
// /api/internal/inbound-email with X-Factory-Key auth.
//
// Auth for this endpoint: a shared secret in the URL path segment. SendGrid
// doesn't send auth headers, so we use path-based obscurity backed by a
// fixed env var (SENDGRID_INBOUND_PARSE_WEBHOOK_SECRET). Only registered
// once with SendGrid, only SendGrid knows it.
factory.post('/inbound-parse/:secret', async (c) => {
  try {
    if (!secureEquals(c.req.param('secret') || '', process.env.SENDGRID_INBOUND_PARSE_WEBHOOK_SECRET || '')) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    // SendGrid sends multipart/form-data. Hono's c.req.parseBody handles it.
    const body = await c.req.parseBody() as any
    const toRaw = String(body.to || body.envelope_to || '')
    const fromRaw = String(body.from || '')
    const subject = body.subject ? String(body.subject) : undefined
    const text = body.text ? String(body.text) : undefined
    const html = body.html ? String(body.html) : undefined
    const headers = body.headers ? String(body.headers) : undefined
    const spf = body.SPF ? String(body.SPF) : undefined
    const dkim = body.dkim ? String(body.dkim) : undefined

    // Extract the primary recipient address. SendGrid may send multiple
    // comma-separated addresses when a message is delivered to several
    // aliases; pick the first one that's on our parse host.
    const parseHost = (process.env.SENDGRID_INBOUND_PARSE_HOSTNAME || '').toLowerCase()
    const toEmails = toRaw.split(/[,;\s]+/).map(e => e.trim().toLowerCase()).filter(Boolean)
    const target = parseHost ? toEmails.find(e => e.endsWith('@' + parseHost)) || toEmails[0] : toEmails[0]
    if (!target) return c.json({ error: 'No usable recipient address' }, 400)

    // Local part is <tenantId-no-dashes>-<localPart>.
    // We stripped dashes from the UUID when generating the destination, so
    // 32 hex chars = tenantId compacted. The rest is the alias.
    const localPartFull = target.split('@')[0]
    const m = localPartFull.match(/^([a-f0-9]{32})-(.+)$/i)
    if (!m) {
      console.warn('[InboundParse] Unrecognized local-part format:', localPartFull)
      return c.json({ error: 'Unrecognized recipient format' }, 400)
    }
    const tenantIdNoDashes = m[1].toLowerCase()
    const localPart = m[2].toLowerCase()
    const tenantId = tenantIdNoDashes.slice(0,8) + '-' + tenantIdNoDashes.slice(8,12) + '-' + tenantIdNoDashes.slice(12,16) + '-' + tenantIdNoDashes.slice(16,20) + '-' + tenantIdNoDashes.slice(20,32)

    const { data: tenant } = await supabase.from('tenants').select('id, factory_sync_key, render_backend_url, status').eq('id', tenantId).single()
    if (!tenant) return c.json({ error: 'Tenant not found' }, 404)
    if (!tenant.render_backend_url || !tenant.factory_sync_key) return c.json({ error: 'Tenant not fully provisioned' }, 400)
    if (tenant.status === 'offboarded') return c.json({ error: 'Tenant is offboarded — dropping' }, 410)

    // Extract sender email + display name. "From" is typically formatted
    // like: `Display Name <user@example.com>` or just `user@example.com`.
    let fromEmail = fromRaw.trim()
    let fromName: string | undefined
    const fromMatch = fromRaw.match(/^\s*(.*)<([^>]+)>\s*$/)
    if (fromMatch) {
      fromName = fromMatch[1].trim().replace(/^"|"$/g, '') || undefined
      fromEmail = fromMatch[2].trim()
    }

    // Forward to tenant backend. Fire-and-forget with timeout so a slow
    // tenant doesn't stall SendGrid retries (SendGrid retries on non-200
    // for ~3 days — we want a clean ack immediately).
    const ingestUrl = tenant.render_backend_url.replace(/\/$/, '') + '/api/internal/inbound-email'
    const ingestRes = await fetch(ingestUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Factory-Key': tenant.factory_sync_key,
      },
      body: JSON.stringify({
        toLocalPart: localPart,
        fromEmail,
        fromName,
        subject,
        textBody: text,
        htmlBody: html,
        spfVerdict: spf,
        dkimVerdict: dkim,
        rawHeaders: headers,
      }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!ingestRes.ok) {
      console.warn('[InboundParse] Tenant ingestion failed:', ingestRes.status, 'for', tenantId)
      // Still return 200 to SendGrid — the message is in their logs; retrying won't help if the tenant is down.
    }
    return c.json({ success: true, tenantId, localPart })
  } catch (err: any) {
    console.error('[InboundParse] webhook failed:', err)
    // Return 200 so SendGrid doesn't retry for 3 days on parsing errors.
    return c.json({ error: err.message, ack: true }, 200)
  }
})


// ─── Offboard status (tenant → factory, X-Factory-Key auth) ────────────────
factory.get('/customers/:id/offboard/status', async (c) => {
  try {
    const tenantId = c.req.param('id')
    if (!UUID_RE.test(tenantId)) return c.json({ error: 'Invalid tenant ID' }, 400)
    const { data: tenant } = await supabase.from('tenants').select('id, factory_sync_key, status, offboard_started_at, offboard_grace_ends_at, domain, domain_registrar').eq('id', tenantId).single()
    if (!tenant || !checkFactoryKey(c, tenant)) return c.json({ error: 'Unauthorized' }, 401)
    return c.json({
      status: tenant.status,
      offboardStartedAt: tenant.offboard_started_at,
      offboardGraceEndsAt: tenant.offboard_grace_ends_at,
      domain: tenant.domain,
      domainRegistrar: tenant.domain_registrar,
    })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})


// ─── Email domain status + verify (tenant → factory) ───────────────────────
// The tenant backend proxies UI requests here so tenant frontends don't need
// SendGrid credentials. X-Factory-Key auth matches the email-alias-sync pattern.

factory.get('/customers/:id/email-domain/status', async (c) => {
  try {
    const tenantId = c.req.param('id')
    if (!UUID_RE.test(tenantId)) return c.json({ error: 'Invalid tenant ID' }, 400)
    const { data: tenant } = await supabase.from('tenants').select('id, factory_sync_key, domain, sendgrid_domain_auth_id').eq('id', tenantId).single()
    if (!tenant || !checkFactoryKey(c, tenant)) return c.json({ error: 'Unauthorized' }, 401)
    if (!tenant.domain) return c.json({ status: 'unconfigured', records: [] })
    if (!tenant.sendgrid_domain_auth_id) return c.json({ status: 'pending', records: [], detail: 'SendGrid domain authentication not yet initiated. Deploy logs may have more info.' })

    const sg = await import('../../services/sendgrid')
    if (!sg.isSendGridConfigured()) return c.json({ error: 'SendGrid not configured' }, 503)

    const auth = await sg.pollDomainAuth(tenant.sendgrid_domain_auth_id)
    return c.json({
      status: auth.valid ? 'verified' : 'pending',
      domain: auth.domain,
      records: auth.records,
    })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

factory.post('/customers/:id/email-domain/verify', async (c) => {
  try {
    const tenantId = c.req.param('id')
    if (!UUID_RE.test(tenantId)) return c.json({ error: 'Invalid tenant ID' }, 400)
    const { data: tenant } = await supabase.from('tenants').select('id, factory_sync_key, sendgrid_domain_auth_id').eq('id', tenantId).single()
    if (!tenant || !checkFactoryKey(c, tenant)) return c.json({ error: 'Unauthorized' }, 401)
    if (!tenant.sendgrid_domain_auth_id) return c.json({ error: 'No SendGrid domain auth to verify' }, 400)

    const sg = await import('../../services/sendgrid')
    const auth = await sg.validateDomainAuth(tenant.sendgrid_domain_auth_id)
    return c.json({
      status: auth.valid ? 'verified' : 'pending',
      domain: auth.domain,
      records: auth.records,
    })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})


// Domain buy flow — creates a Stripe Checkout session for the customer
// to pay for a new domain registration. The actual Namecheap call
// happens on the webhook (checkout.session.completed) so a customer
// can't get charged without us also kicking off the registration.
// Where does the registrar say this domain points? Read-only — it cannot change
// a domain. Exists because the registrar is the only source of truth for a
// repoint: our own tables record what we intended, not what took.
factory.get('/internal/registrar/nameservers', async (c) => {
  if (!checkCronSecret(c)) return c.json({ error: 'Unauthorized' }, 401)

  const domain = (c.req.query('domain') || '').trim().toLowerCase()
  if (!domain || !DOMAIN_RE.test(domain)) return c.json({ error: 'Invalid domain format' }, 400)
  if (!isRegistrarConfigured()) return c.json({ error: 'Registrar is not configured on this environment' }, 503)

  const registrar = await getRegistrar()
  const result = await registrar.getNameservers(domain)
  if (!result.success) return c.json({ domain, error: result.error }, 502)
  return c.json({
    domain,
    nameservers: result.nameservers || [],
    // true = still on the registrar's own DNS, so any zone we built is unused
    usingRegistrarDns: result.usingRegistrarDns ?? null,
  })
})

factory.post('/internal/domain/buy/:tenantId', async (c) => {
  try {
    const tenantId = c.req.param('tenantId')
    if (!UUID_RE.test(tenantId)) return c.json({ error: 'Invalid tenant id' }, 400)
    const body = await c.req.json().catch(() => ({})) as { domain?: string; years?: number }
    const domain = (body.domain || '').trim().toLowerCase()
    const years = Math.max(1, Math.min(10, Math.floor(body.years || 1) || 1))
    if (!domain || !DOMAIN_RE.test(domain)) return c.json({ error: 'Invalid domain format' }, 400)

    const { data: tenant } = await supabase.from('tenants')
      .select('id, slug, factory_sync_key, stripe_customer_id, domain, website_url, render_frontend_url')
      .eq('id', tenantId).single()
    if (!tenant) return c.json({ error: 'Tenant not found' }, 404)
    if (!tenant || !checkFactoryKey(c, tenant)) return c.json({ error: 'Unauthorized' }, 401)
    if (!tenant.stripe_customer_id) return c.json({ error: 'No Stripe customer on this tenant — finish initial billing first.' }, 409)
    if (tenant.domain) return c.json({ error: 'This tenant already has a domain attached.' }, 409)

    if (!isRegistrarConfigured()) return c.json({ error: 'Domain purchase is not configured on this environment' }, 503)

    // Confirm availability one more time before charging — the catalog
    // can change between the customer's click and our Checkout creation.
    const registrar = await getRegistrar()
    const avail = await registrar.checkAvailability(domain)
    if (!avail.available) return c.json({ error: 'That domain is no longer available. Try a different one.' }, 409)
    if (avail.premium) return c.json({ error: 'That is a Premium domain — pricing is non-standard and we do not auto-register Premium domains in this flow yet. Please contact support.' }, 422)

    const { lookupDomainPrice } = await import('../../config/domainPricing')
    const price = lookupDomainPrice(domain, years)
    if (!price.ok) {
      if (price.reason === 'unsupported_tld') {
        return c.json({
          error: 'We do not support .' + price.tld + ' yet. Supported TLDs: ' + price.supportedTlds.join(', '),
        }, 422)
      }
      return c.json({ error: 'Malformed domain' }, 400)
    }

    const returnBase = (tenant.website_url || tenant.render_frontend_url || '').replace(/\/+$/, '')
    if (!returnBase) return c.json({ error: 'Tenant has no site URL recorded.' }, 409)
    const session = await factoryStripe.createOneTimeCheckoutSession({
      customerId: tenant.stripe_customer_id,
      amountCents: price.retailCents,
      productName: 'Domain registration — ' + domain,
      description: price.description,
      successUrl: returnBase + '/admin/domain?domain=registered&session={CHECKOUT_SESSION_ID}',
      cancelUrl: returnBase + '/admin/domain?domain=cancelled',
      metadata: {
        purpose: 'domain_registration',
        tenant_id: tenantId,
        domain,
        years: String(years),
      },
    })
    return c.json({ url: session.url, sessionId: session.sessionId, priceCents: price.retailCents })
  } catch (e: any) {
    console.error('[Domain] buy failed:', e)
    return c.json({ error: e.message || 'Buy flow failed' }, 500)
  }
})

// ─── Customer custom domain attach + verify (post-deploy) ─────────────────
// Called by the premium admin's Custom Domain page when the customer
// pastes their domain. Updates the tenant row, kicks off full domain
// infrastructure wiring (Cloudflare zone, DNS records, SendGrid/Resend
// DKIM, Render custom-domain attachment), and returns the nameservers
// the customer needs to set at their registrar.
//
// Idempotent on retry — if the tenant already has a domain and we're
// being asked to attach the same one, returns the current state instead
// of re-wiring.
factory.post('/internal/domain/attach/:tenantId', async (c) => {
  try {
    const tenantId = c.req.param('tenantId')
    if (!UUID_RE.test(tenantId)) return c.json({ error: 'Invalid tenant ID' }, 400)
    const body = await c.req.json().catch(() => ({})) as { domain?: string; mode?: 'byod' | 'buy' }
    const domain = (body.domain || '').trim().toLowerCase()
    const mode = body.mode === 'buy' ? 'buy' : 'byod'  // 'buy' path TBD until Namecheap prod keys
    if (!domain || !DOMAIN_RE.test(domain)) return c.json({ error: 'Invalid domain format' }, 400)

    const { data: tenant, error: tErr } = await supabase.from('tenants')
      .select('id, slug, factory_sync_key, domain, domain_registrar, cloudflare_zone_id, sendgrid_domain_auth_id')
      .eq('id', tenantId).single()
    if (tErr || !tenant) return c.json({ error: 'Tenant not found' }, 404)
    if (!tenant || !checkFactoryKey(c, tenant)) return c.json({ error: 'Unauthorized' }, 401)

    if (mode === 'buy') {
      return c.json({ error: 'Domain purchase is not wired in this build yet. Use BYOD for now.' }, 501)
    }

    // BYOD path — already attached? Return current state.
    if (tenant.domain && tenant.domain.toLowerCase() === domain && tenant.cloudflare_zone_id) {
      const { getCloudflareZoneStatus } = await import('../../services/cloudflare')
      const status = await getCloudflareZoneStatus(tenant.cloudflare_zone_id).catch(() => null)
      return c.json({
        domain,
        status: status?.status === 'active' ? 'active' : 'pending_nameservers',
        nameservers: status?.nameServers || [],
        records: [],
      })
    }

    // Find the tenant's Render service IDs so we can attach Render custom
    // domains too. Reuses the wireDomainInfrastructure path that signup uses.
    const { findRenderServicesBySlug, wireDomainInfrastructure } = await import('../../services/deploy')
    const services = await findRenderServicesBySlug(tenant.slug)
    const siteServiceId = services.site || services['website-premium'] || services.website
    const backendServiceId = services.backend || services.api

    // Persist the domain on the tenant row before wiring so retries are idempotent.
    await supabase.from('tenants').update({
      domain, domain_registrar: 'byod',
    }).eq('id', tenant.id)

    const result = await wireDomainInfrastructure({
      domain,
      siteServiceId, backendServiceId,
      existingCloudflareZoneId: tenant.cloudflare_zone_id || undefined,
      existingSendgridDomainAuthId: tenant.sendgrid_domain_auth_id || undefined,
    })
    if (result.cloudflareZoneId) {
      await supabase.from('tenants').update({ cloudflare_zone_id: result.cloudflareZoneId }).eq('id', tenant.id)
    }
    if (result.sendgridDomainAuthId) {
      await supabase.from('tenants').update({ sendgrid_domain_auth_id: result.sendgridDomainAuthId }).eq('id', tenant.id)
    }
    return c.json({
      domain,
      status: result.success ? 'pending_nameservers' : 'partial',
      nameservers: result.cloudflareNameServers || [],
      steps: result.steps,
      errors: result.errors,
    })
  } catch (e: any) {
    console.error('[Domain] attach failed:', e)
    return c.json({ error: e.message || 'Attach failed' }, 500)
  }
})

// Returns current attach + verification state. Cheap call — pulls the
// Cloudflare zone status (which reflects whether the customer pointed
// their nameservers at us yet) and the Render custom-domain status.
factory.get('/internal/domain/status/:tenantId', async (c) => {
  try {
    const tenantId = c.req.param('tenantId')
    if (!UUID_RE.test(tenantId)) return c.json({ error: 'Invalid tenant ID' }, 400)
    const { data: tenant } = await supabase.from('tenants')
      .select('id, slug, factory_sync_key, domain, cloudflare_zone_id')
      .eq('id', tenantId).single()
    if (!tenant || !checkFactoryKey(c, tenant)) return c.json({ error: 'Unauthorized' }, 401)
    if (!tenant.domain) return c.json({ status: 'unconfigured', domain: null, nameservers: [] })

    const { getCloudflareZoneStatus } = await import('../../services/cloudflare')
    const zoneStatus = tenant.cloudflare_zone_id ? await getCloudflareZoneStatus(tenant.cloudflare_zone_id).catch(() => null) : null
    return c.json({
      status: zoneStatus?.status === 'active' ? 'active' : 'pending_nameservers',
      domain: tenant.domain,
      nameservers: zoneStatus?.nameServers || [],
    })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// ─── Twomiah Bookings Google Calendar OAuth orchestration ─────────────────
// One Google OAuth app for the whole platform. Tenants don't approve
// their own — the admin redirects to this Factory endpoint, we send them
// through Google's consent screen, exchange the code for tokens, then
// forward those tokens to the right tenant's internal endpoint. Admin
// browser lands back on the tenant's booking-settings page.

const googleOauthState = new Map<string, { tenantId: string; userId: string; returnUrl: string; expiresAt: number }>()

function newOauthState(payload: { tenantId: string; userId: string; returnUrl: string }): string {
  const state = (globalThis.crypto || require('crypto')).randomUUID()
  googleOauthState.set(state, { ...payload, expiresAt: Date.now() + 10 * 60_000 })
  // Light GC
  if (googleOauthState.size > 1000) {
    const now = Date.now()
    for (const [k, v] of googleOauthState) if (v.expiresAt < now) googleOauthState.delete(k)
  }
  return state
}

function consumeOauthState(state: string): { tenantId: string; userId: string; returnUrl: string } | null {
  const entry = googleOauthState.get(state)
  if (!entry || entry.expiresAt < Date.now()) { googleOauthState.delete(state); return null }
  googleOauthState.delete(state)
  return entry
}

// Step 1: tenant admin SPA hits this. We persist state, send the
// browser to Google's consent screen with our credentials.
factory.get('/calendar/google/auth', async (c) => {
  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID
  if (!clientId) return c.json({ error: 'Google Calendar OAuth not configured' }, 503)
  const tenantId = c.req.query('tenant')
  const userId = c.req.query('user')
  const returnUrl = c.req.query('return') || ''
  if (!tenantId || !userId || !returnUrl) return c.json({ error: 'tenant, user, return are required' }, 400)
  // Verify tenant exists and the return URL points to it (anti-redirect-abuse)
  const { data: tenant } = await supabase.from('tenants').select('id, website_url').eq('id', tenantId).single()
  if (!tenant) return c.json({ error: 'tenant not found' }, 404)
  if (!returnUrl.startsWith(tenant.website_url || '') && !returnUrl.startsWith('http://localhost')) {
    return c.json({ error: 'return URL must point to your tenant site' }, 400)
  }
  const state = newOauthState({ tenantId, userId, returnUrl })
  const factoryUrl = process.env.FACTORY_PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || ''
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/calendar.events',
    redirect_uri: factoryUrl.replace(/\/$/, '') + '/calendar/google/callback',
    access_type: 'offline',
    prompt: 'consent',  // forces refresh_token issuance
    state,
  })
  return c.redirect('https://accounts.google.com/o/oauth2/v2/auth?' + params.toString())
})

// Step 2: Google redirects here after consent. Exchange code for
// tokens, POST to the tenant, redirect admin back.
factory.get('/calendar/google/callback', async (c) => {
  const code = c.req.query('code')
  const state = c.req.query('state') || ''
  const error = c.req.query('error')
  const entry = consumeOauthState(state)
  if (!entry) return c.html('<p>Sign-in session expired. Please try again from your admin.</p>', 400)
  if (error || !code) return c.redirect(entry.returnUrl + (entry.returnUrl.includes('?') ? '&' : '?') + 'google=denied')

  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET
  const factoryUrl = process.env.FACTORY_PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || ''
  if (!clientId || !clientSecret) return c.html('<p>Server misconfiguration.</p>', 503)

  // Exchange code for tokens
  let tokens: any
  try {
    const body = new URLSearchParams({
      code, client_id: clientId, client_secret: clientSecret,
      redirect_uri: factoryUrl.replace(/\/$/, '') + '/calendar/google/callback',
      grant_type: 'authorization_code',
    })
    const res = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body })
    if (!res.ok) return c.html('<p>Token exchange failed: ' + (await res.text().catch(() => '')) + '</p>', 502)
    tokens = await res.json()
  } catch (e: any) {
    return c.html('<p>Token exchange error: ' + e?.message + '</p>', 502)
  }

  // Look up the user's email from Google so we display it nicely
  let externalEmail = ''
  try {
    const ures = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { 'Authorization': 'Bearer ' + tokens.access_token } })
    if (ures.ok) { const ud: any = await ures.json(); externalEmail = ud.email || '' }
  } catch { /* non-fatal */ }

  // Forward tokens to the tenant
  const { data: tenant } = await supabase.from('tenants').select('website_url, factory_sync_key').eq('id', entry.tenantId).single()
  if (!tenant?.website_url || !tenant?.factory_sync_key) {
    return c.html('<p>Tenant routing not configured.</p>', 502)
  }
  try {
    const r = await fetch(tenant.website_url.replace(/\/$/, '') + '/api/internal/calendar/store-tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Factory-Key': tenant.factory_sync_key },
      body: JSON.stringify({
        userId: entry.userId,
        provider: 'google',
        externalAccountEmail: externalEmail,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || null,
        expiresInSec: tokens.expires_in || 3600,
        calendarId: 'primary',
      }),
    })
    if (!r.ok) {
      const text = await r.text().catch(() => '')
      return c.html('<p>Tenant accept failed: ' + text + '</p>', 502)
    }
  } catch (e: any) {
    return c.html('<p>Tenant call error: ' + e?.message + '</p>', 502)
  }

  return c.redirect(entry.returnUrl + (entry.returnUrl.includes('?') ? '&' : '?') + 'google=connected')
})

// ─── Google Business Profile OAuth broker ────────────────────────────────────
// Same pattern as the calendar flow above: one approved Google app, consent
// lands back on the factory, tokens forward to the tenant's CRM backend.
// Scope is business.manage (reviews read/reply, location info). NOTE: Google
// gates the Business Profile APIs behind an access application — until that's
// approved on the Cloud project, API calls return quota errors even though
// the OAuth consent itself succeeds.
factory.get('/gbp/google/auth', async (c) => {
  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID
  if (!clientId) return c.json({ error: 'Google OAuth not configured' }, 503)
  const tenantId = c.req.query('tenant')
  const userId = c.req.query('user')
  const returnUrl = c.req.query('return') || ''
  if (!tenantId || !userId || !returnUrl) return c.json({ error: 'tenant, user, return are required' }, 400)
  const { data: tenant } = await supabase.from('tenants').select('id, website_url, render_backend_url').eq('id', tenantId).single()
  if (!tenant) return c.json({ error: 'tenant not found' }, 404)
  const allowed = [tenant.render_backend_url, tenant.website_url].filter(Boolean) as string[]
  if (!allowed.some(u => returnUrl.startsWith(u)) && !returnUrl.startsWith('http://localhost')) {
    return c.json({ error: 'return URL must point to your tenant app' }, 400)
  }
  const state = newOauthState({ tenantId, userId, returnUrl })
  const factoryUrl = process.env.FACTORY_PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || ''
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/business.manage',
    redirect_uri: factoryUrl.replace(/\/$/, '') + '/gbp/google/callback',
    access_type: 'offline',
    prompt: 'consent',
    state,
  })
  return c.redirect('https://accounts.google.com/o/oauth2/v2/auth?' + params.toString())
})

factory.get('/gbp/google/callback', async (c) => {
  const code = c.req.query('code')
  const state = c.req.query('state') || ''
  const error = c.req.query('error')
  const entry = consumeOauthState(state)
  if (!entry) return c.html('<p>Sign-in session expired. Please try again from your admin.</p>', 400)
  if (error || !code) return c.redirect(entry.returnUrl + (entry.returnUrl.includes('?') ? '&' : '?') + 'gbp=denied')

  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET
  const factoryUrl = process.env.FACTORY_PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || ''
  if (!clientId || !clientSecret) return c.html('<p>Server misconfiguration.</p>', 503)

  let tokens: any
  try {
    const body = new URLSearchParams({
      code, client_id: clientId, client_secret: clientSecret,
      redirect_uri: factoryUrl.replace(/\/$/, '') + '/gbp/google/callback',
      grant_type: 'authorization_code',
    })
    const res = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body })
    if (!res.ok) return c.html('<p>Token exchange failed: ' + (await res.text().catch(() => '')) + '</p>', 502)
    tokens = await res.json()
  } catch (e: any) {
    return c.html('<p>Token exchange error: ' + e?.message + '</p>', 502)
  }

  let externalEmail = ''
  try {
    const ures = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { 'Authorization': 'Bearer ' + tokens.access_token } })
    if (ures.ok) { const ud: any = await ures.json(); externalEmail = ud.email || '' }
  } catch { /* non-fatal */ }

  const { data: tenant } = await supabase.from('tenants').select('render_backend_url, factory_sync_key').eq('id', entry.tenantId).single()
  if (!tenant?.render_backend_url || !tenant?.factory_sync_key) {
    return c.html('<p>Tenant routing not configured.</p>', 502)
  }
  try {
    const r = await fetch(tenant.render_backend_url.replace(/\/$/, '') + '/api/internal/gbp/store-tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Factory-Key': tenant.factory_sync_key },
      body: JSON.stringify({
        userId: entry.userId,
        externalAccountEmail: externalEmail,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || null,
        expiresInSec: tokens.expires_in || 3600,
      }),
    })
    if (!r.ok) {
      const text = await r.text().catch(() => '')
      return c.html('<p>Tenant accept failed: ' + text + '</p>', 502)
    }
  } catch (e: any) {
    return c.html('<p>Tenant call error: ' + e?.message + '</p>', 502)
  }

  return c.redirect(entry.returnUrl + (entry.returnUrl.includes('?') ? '&' : '?') + 'gbp=connected')
})

// ─── Twomiah Bookings Outlook Calendar OAuth orchestration ─────────────────
// Mirror of the Google flow against Microsoft identity platform.
// One approved Azure AD app for the platform; tokens forwarded to the
// tenant by the same /api/internal/calendar/store-tokens endpoint.

factory.get('/calendar/outlook/auth', async (c) => {
  const clientId = process.env.OUTLOOK_CALENDAR_CLIENT_ID
  if (!clientId) return c.json({ error: 'Outlook OAuth not configured' }, 503)
  const tenantId = c.req.query('tenant')
  const userId = c.req.query('user')
  const returnUrl = c.req.query('return') || ''
  if (!tenantId || !userId || !returnUrl) return c.json({ error: 'tenant, user, return are required' }, 400)
  const { data: tenant } = await supabase.from('tenants').select('id, website_url').eq('id', tenantId).single()
  if (!tenant) return c.json({ error: 'tenant not found' }, 404)
  if (!returnUrl.startsWith(tenant.website_url || '') && !returnUrl.startsWith('http://localhost')) {
    return c.json({ error: 'return URL must point to your tenant site' }, 400)
  }
  const state = newOauthState({ tenantId, userId, returnUrl })
  const factoryUrl = process.env.FACTORY_PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || ''
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: factoryUrl.replace(/\/$/, '') + '/calendar/outlook/callback',
    scope: 'offline_access Calendars.ReadWrite User.Read',
    response_mode: 'query',
    state,
  })
  return c.redirect('https://login.microsoftonline.com/common/oauth2/v2.0/authorize?' + params.toString())
})

factory.get('/calendar/outlook/callback', async (c) => {
  const code = c.req.query('code')
  const state = c.req.query('state') || ''
  const error = c.req.query('error')
  const entry = consumeOauthState(state)
  if (!entry) return c.html('<p>Sign-in session expired. Please try again from your admin.</p>', 400)
  if (error || !code) return c.redirect(entry.returnUrl + (entry.returnUrl.includes('?') ? '&' : '?') + 'outlook=denied')

  const clientId = process.env.OUTLOOK_CALENDAR_CLIENT_ID
  const clientSecret = process.env.OUTLOOK_CALENDAR_CLIENT_SECRET
  const factoryUrl = process.env.FACTORY_PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || ''
  if (!clientId || !clientSecret) return c.html('<p>Server misconfiguration.</p>', 503)

  let tokens: any
  try {
    const body = new URLSearchParams({
      code, client_id: clientId, client_secret: clientSecret,
      redirect_uri: factoryUrl.replace(/\/$/, '') + '/calendar/outlook/callback',
      grant_type: 'authorization_code',
      scope: 'offline_access Calendars.ReadWrite User.Read',
    })
    const res = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
    })
    if (!res.ok) return c.html('<p>Token exchange failed: ' + (await res.text().catch(() => '')) + '</p>', 502)
    tokens = await res.json()
  } catch (e: any) {
    return c.html('<p>Token exchange error: ' + e?.message + '</p>', 502)
  }

  let externalEmail = ''
  try {
    const ures = await fetch('https://graph.microsoft.com/v1.0/me', { headers: { 'Authorization': 'Bearer ' + tokens.access_token } })
    if (ures.ok) { const ud: any = await ures.json(); externalEmail = ud.mail || ud.userPrincipalName || '' }
  } catch { /* non-fatal */ }

  const { data: tenant } = await supabase.from('tenants').select('website_url, factory_sync_key').eq('id', entry.tenantId).single()
  if (!tenant?.website_url || !tenant?.factory_sync_key) {
    return c.html('<p>Tenant routing not configured.</p>', 502)
  }
  try {
    const r = await fetch(tenant.website_url.replace(/\/$/, '') + '/api/internal/calendar/store-tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Factory-Key': tenant.factory_sync_key },
      body: JSON.stringify({
        userId: entry.userId,
        provider: 'outlook',
        externalAccountEmail: externalEmail,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || null,
        expiresInSec: tokens.expires_in || 3600,
      }),
    })
    if (!r.ok) {
      const text = await r.text().catch(() => '')
      return c.html('<p>Tenant accept failed: ' + text + '</p>', 502)
    }
  } catch (e: any) {
    return c.html('<p>Tenant call error: ' + e?.message + '</p>', 502)
  }

  return c.redirect(entry.returnUrl + (entry.returnUrl.includes('?') ? '&' : '?') + 'outlook=connected')
})

// ─── Twomiah Bookings post-job review request SMS (daily) ──────────────────
factory.post('/internal/booking-review-requests', async (c) => {
  if (!checkCronSecret(c)) return c.json({ error: 'Unauthorized' }, 401)
  const { data: tenants, error } = await supabase
    .from('tenants').select('id, slug, website_url, factory_sync_key, status')
    .eq('status', 'live').contains('products', ['website-premium'])
  if (error) return c.json({ error: error.message }, 500)
  const results: any[] = []
  for (const t of tenants || []) {
    if (!t.website_url || !t.factory_sync_key) continue
    try {
      const res = await fetch(t.website_url.replace(/\/$/, '') + '/api/internal/booking-review-requests', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Factory-Key': t.factory_sync_key },
        signal: AbortSignal.timeout(30_000),
      })
      const body = await res.json().catch(() => ({}))
      results.push({ slug: t.slug, ok: res.ok, ...body })
    } catch (e: any) { results.push({ slug: t.slug, ok: false, error: e?.message }) }
  }
  return c.json({ ok: true, tenants: results.length, results })
})

// ─── Twomiah Bookings rebook nudge daily cron ──────────────────────────────
// Daily cron. Fans out to every live premium-website tenant; each
// tenant decides per-service whether to send (rebookIntervalDays).
factory.post('/internal/booking-rebook-reminders', async (c) => {
  if (!checkCronSecret(c)) return c.json({ error: 'Unauthorized' }, 401)

  const { data: tenants, error } = await supabase
    .from('tenants')
    .select('id, slug, website_url, factory_sync_key, status')
    .eq('status', 'live')
    .contains('products', ['website-premium'])
  if (error) return c.json({ error: error.message }, 500)

  const results: any[] = []
  for (const t of tenants || []) {
    if (!t.website_url || !t.factory_sync_key) continue
    try {
      const res = await fetch(t.website_url.replace(/\/$/, '') + '/api/internal/booking-rebook-reminders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Factory-Key': t.factory_sync_key },
        signal: AbortSignal.timeout(30_000),
      })
      const body = await res.json().catch(() => ({}))
      results.push({ slug: t.slug, ok: res.ok, ...body })
    } catch (e: any) {
      results.push({ slug: t.slug, ok: false, error: e?.message })
    }
  }
  return c.json({ ok: true, tenants: results.length, results })
})

// ─── Twomiah Bookings 24h reminder cron ────────────────────────────────────
// External scheduler hits this hourly. We fan out to every live tenant
// that has the website-premium product and POST their internal
// /api/internal/booking-reminders endpoint, which sends emails for any
// bookings starting in the next 23-25 hours.
factory.post('/internal/booking-reminders', async (c) => {
  if (!checkCronSecret(c)) return c.json({ error: 'Unauthorized' }, 401)

  const { data: tenants, error } = await supabase
    .from('tenants')
    .select('id, slug, website_url, factory_sync_key, products, status')
    .eq('status', 'live')
    .contains('products', ['website-premium'])
  if (error) return c.json({ error: error.message }, 500)

  const results: any[] = []
  for (const t of tenants || []) {
    if (!t.website_url || !t.factory_sync_key) {
      results.push({ slug: t.slug, ok: false, reason: 'missing url or sync key' })
      continue
    }
    try {
      const res = await fetch(t.website_url.replace(/\/$/, '') + '/api/internal/booking-reminders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Factory-Key': t.factory_sync_key },
        signal: AbortSignal.timeout(30_000),
      })
      const body = await res.json().catch(() => ({}))
      results.push({ slug: t.slug, ok: res.ok, ...body })
    } catch (e: any) {
      results.push({ slug: t.slug, ok: false, error: e?.message })
    }
  }
  const totalSent = results.reduce((acc, r) => acc + (r.sent || 0), 0)
  return c.json({ ok: true, tenants: results.length, totalSent, results })
})

// ─── Tenant health sweep ──────────────────────────────────────────────────
// Daily via the lifecycle cron. Checks the things that actually take a tenant
// off the air (site reachable, CRM API reachable, TLS cert expiry, DNS
// delegation) and alerts staff on the transition into unhealthy.
factory.post('/internal/health-sweep', async (c) => {
  if (!checkCronSecret(c)) return c.json({ error: 'Unauthorized' }, 401)
  const { sweepTenantHealth } = await import('../../services/healthMonitor')
  const result = await sweepTenantHealth()
  return c.json({ ok: true, timestamp: new Date().toISOString(), ...result })
})

// One tenant, checked on demand — for when an operator is looking at a
// specific customer and wants the answer now rather than tomorrow.
factory.get('/admin/tenants/:id/health', requireRole('owner', 'admin'), async (c) => {
  const { data: tenant, error } = await supabase
    .from('tenants')
    .select('id, slug, name, domain, website_url, render_frontend_url, render_backend_url, cloudflare_zone_id')
    .eq('id', c.req.param('id'))
    .single()
  if (error || !tenant) return c.json({ error: 'Tenant not found' }, 404)
  const { checkTenant } = await import('../../services/healthMonitor')
  return c.json(await checkTenant(tenant as any))
})

// ─── Renewal check cron (domain + sub renewals + teardown pickup) ──────────
// Runs daily via external scheduler (same x-cron-secret pattern as /internal/trial-check).
// Idempotent — sentinel columns prevent duplicate warnings.
factory.post('/internal/renewal-check', async (c) => {
  if (!checkCronSecret(c)) return c.json({ error: 'Unauthorized' }, 401)

  const now = new Date()
  const results = { domain60: 0, domain30: 0, domain7: 0, sub60: 0, sub30: 0, sub7: 0, teardowns: 0, errors: [] as string[] }

  async function processDomainWindow(daysLower: number, daysUpper: number, sentinelCol: string, daysRemainingForEmail: number) {
    const lowerBound = new Date(now.getTime() + daysLower * 24 * 60 * 60 * 1000)
    const upperBound = new Date(now.getTime() + daysUpper * 24 * 60 * 60 * 1000)
    const { data, error } = await supabase
      .from('tenants')
      .select('id, name, email, admin_email, domain, render_frontend_url')
      .is(sentinelCol, null)
      .not('domain_expires_at', 'is', null)
      .gte('domain_expires_at', lowerBound.toISOString())
      .lt('domain_expires_at', upperBound.toISOString())
    if (error) { results.errors.push(sentinelCol + ': ' + error.message); return 0 }
    let count = 0
    for (const t of data || []) {
      try {
        const billingUrl = t.render_frontend_url ? t.render_frontend_url.replace(/\/$/, '') + '/settings/billing' : undefined
        await notifyDomainRenewal(t as any, daysRemainingForEmail, billingUrl).catch(() => {})
        await supabase.from('tenants').update({ [sentinelCol]: now.toISOString() }).eq('id', t.id)
        count++
      } catch (e: any) {
        results.errors.push(`${sentinelCol} ${t.id}: ${e.message}`)
      }
    }
    return count
  }

  results.domain60 = await processDomainWindow(55, 65, 'domain_renewal_warned_60d_at', 60)
  results.domain30 = await processDomainWindow(27, 33, 'domain_renewal_warned_30d_at', 30)
  results.domain7  = await processDomainWindow(5, 9, 'domain_renewal_warned_7d_at', 7)

  // Sub renewals: derive from tenants with active stripe_subscription_id + next_billing_date
  async function processSubWindow(daysLower: number, daysUpper: number, sentinelCol: string, daysRemainingForEmail: number) {
    const lowerBound = new Date(now.getTime() + daysLower * 24 * 60 * 60 * 1000)
    const upperBound = new Date(now.getTime() + daysUpper * 24 * 60 * 60 * 1000)
    const { data, error } = await supabase
      .from('tenants')
      .select('id, name, email, admin_email, plan')
      .is(sentinelCol, null)
      .not('stripe_subscription_id', 'is', null)
      .not('next_billing_date', 'is', null)
      .gte('next_billing_date', lowerBound.toISOString())
      .lt('next_billing_date', upperBound.toISOString())
    if (error) { results.errors.push(sentinelCol + ': ' + error.message); return 0 }
    let count = 0
    for (const t of data || []) {
      try {
        await notifySubscriptionRenewal(t as any, daysRemainingForEmail).catch(() => {})
        await supabase.from('tenants').update({ [sentinelCol]: now.toISOString() }).eq('id', t.id)
        count++
      } catch (e: any) {
        results.errors.push(`${sentinelCol} ${t.id}: ${e.message}`)
      }
    }
    return count
  }

  results.sub60 = await processSubWindow(55, 65, 'sub_renewal_warned_60d_at', 60)
  results.sub30 = await processSubWindow(27, 33, 'sub_renewal_warned_30d_at', 30)
  results.sub7  = await processSubWindow(5, 9, 'sub_renewal_warned_7d_at', 7)

  // Teardown pickup: tenants whose grace period has ended.
  // Soft-teardown only: delete Cloudflare zone + SendGrid domain auth, mark
  // status='offboarded'. Render services stay — destructive service deletion
  // is left to a human admin (see /customers/:id/teardown below).
  const { data: overdue, error: teardownErr } = await supabase
    .from('tenants')
    .select('id, name, email, admin_email, cloudflare_zone_id, sendgrid_domain_auth_id')
    .not('offboard_grace_ends_at', 'is', null)
    .lt('offboard_grace_ends_at', now.toISOString())
    .neq('status', 'offboarded')
  if (teardownErr) results.errors.push('teardown query: ' + teardownErr.message)
  else for (const t of overdue || []) {
    try {
      if (t.cloudflare_zone_id) {
        const cf = await import('../../services/cloudflare')
        if (cf.isCloudflareConfigured()) await cf.deleteZone(t.cloudflare_zone_id).catch(e => console.warn('[Teardown] CF zone delete:', e.message))
      }
      if (t.sendgrid_domain_auth_id) {
        const sg = await import('../../services/sendgrid')
        if (sg.isSendGridConfigured()) await sg.deleteDomainAuth(t.sendgrid_domain_auth_id).catch(e => console.warn('[Teardown] SG auth delete:', e.message))
      }
      await supabase.from('tenants').update({ status: 'offboarded', cloudflare_zone_id: null, sendgrid_domain_auth_id: null }).eq('id', t.id)
      await notifyOffboardComplete(t as any).catch(() => {})
      results.teardowns++
    } catch (e: any) {
      results.errors.push(`teardown ${t.id}: ${e.message}`)
    }
  }

  // ── Premium preview 24h follow-up nudge ─────────────────────────────
  // Customers who got a preview but never approved get one polite check-
  // in email 24-72h after the preview generated. preview_followup_sent_at
  // is the idempotency sentinel. We exclude tenants who already paid
  // (stripe_subscription_id set) and offboarded ones.
  try {
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000)
    const threeDaysAgo = new Date(now.getTime() - 72 * 60 * 60 * 1000)
    const { data: stale, error: staleErr } = await supabase
      .from('tenants')
      .select('id, name, email, preview_premium_generated_at')
      .is('preview_followup_sent_at', null)
      .is('stripe_subscription_id', null)
      .neq('status', 'offboarded')
      .not('preview_premium_pages', 'is', null)
      .gte('preview_premium_generated_at', threeDaysAgo.toISOString())
      .lte('preview_premium_generated_at', oneDayAgo.toISOString())
      .limit(50)
    let nudged = 0
    if (!staleErr && stale) {
      const factoryUrl = process.env.TWOMIAH_FACTORY_URL || ''
      for (const t of stale as any[]) {
        if (!t.email || !factoryUrl) continue
        try {
          await notifyPreviewFollowup({
            to: t.email,
            businessName: t.name,
            previewUrl: `${factoryUrl}/api/v1/factory/public/intake/${t.id}/preview-premium`,
          }).catch(() => {})
          await supabase.from('tenants').update({ preview_followup_sent_at: now.toISOString() }).eq('id', t.id)
          nudged++
        } catch (e: any) {
          results.errors.push(`preview_followup ${t.id}: ${e.message}`)
        }
      }
    } else if (staleErr) {
      results.errors.push('preview_followup: ' + staleErr.message)
    }
    ;(results as any).preview_followups_sent = nudged
  } catch (e: any) {
    results.errors.push('preview_followup outer: ' + e.message)
  }

  // ── Day-1 post-launch tips ──────────────────────────────────────────
  // ~24-72h after they paid, send the "your site is live — now what?"
  // tips email. Limits to premium-website tenants (products contains
  // 'website-premium') so CRM-only tenants don't get the website-tips
  // copy. Caps at 50/run.
  try {
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000)
    const threeDaysAgo = new Date(now.getTime() - 72 * 60 * 60 * 1000)
    const { data: launched } = await supabase
      .from('tenants')
      .select('id, name, email, products, paid_at, render_frontend_url, website_url')
      .is('launch_followup_sent_at', null)
      .not('stripe_subscription_id', 'is', null)
      .neq('status', 'offboarded')
      .gte('paid_at', threeDaysAgo.toISOString())
      .lte('paid_at', oneDayAgo.toISOString())
      .limit(50)
    let nudged = 0
    if (launched) {
      for (const t of launched as any[]) {
        const products: string[] = Array.isArray(t.products) ? t.products : []
        if (!products.includes('website-premium')) continue
        if (!t.email) continue
        const siteUrl = t.website_url || t.render_frontend_url
        if (!siteUrl) continue
        const adminUrl = siteUrl.replace(/\/+$/, '') + '/admin'
        try {
          await notifyPostLaunchTips({
            to: t.email,
            businessName: t.name,
            siteUrl,
            adminUrl,
          }).catch(() => {})
          await supabase.from('tenants').update({ launch_followup_sent_at: now.toISOString() }).eq('id', t.id)
          nudged++
        } catch (e: any) {
          results.errors.push(`launch_followup ${t.id}: ${e.message}`)
        }
      }
    }
    ;(results as any).launch_tips_sent = nudged
  } catch (e: any) {
    results.errors.push('launch_followup outer: ' + e.message)
  }

  console.log('[RenewalCheck]', JSON.stringify(results))
  return c.json({ ok: true, timestamp: now.toISOString(), ...results })
})


// ─── Offboard + reactivate ──────────────────────────────────────────────────
factory.post('/customers/:id/offboard', factoryKeyOrRole('owner', 'admin'), async (c) => {
  try {
    const tenantId = c.req.param('id')
    if (!UUID_RE.test(tenantId)) return c.json({ error: 'Invalid tenant ID' }, 400)
    const parsed = await parseJsonBody(c)
    if (parsed.error) return parsed.error
    // Require explicit confirm flag so this can't be triggered by accident
    if (parsed.data.confirm !== true) return c.json({ error: 'Set body.confirm=true to offboard this tenant' }, 400)

    const { data: tenant, error: tenantErr } = await supabase.from('tenants').select('*').eq('id', tenantId).single()
    if (tenantErr || !tenant) return c.json({ error: 'Tenant not found' }, 404)
    if (tenant.offboard_started_at) return c.json({ error: 'Offboard already started at ' + tenant.offboard_started_at }, 409)

    const now = new Date()
    const graceEndsAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)  // 30-day grace per plan
    const steps: Array<{ step: string; status: string; detail?: string }> = []

    // 1. Cancel Stripe subscription at period end
    if (tenant.stripe_subscription_id) {
      try {
        await factoryStripe.cancelSubscription(tenant.stripe_subscription_id, { atPeriodEnd: true })
        steps.push({ step: 'stripe_cancel', status: 'ok' })
      } catch (e: any) {
        steps.push({ step: 'stripe_cancel', status: 'warning', detail: e.message })
      }
    } else {
      steps.push({ step: 'stripe_cancel', status: 'skipped', detail: 'no subscription' })
    }

    // 2. Unlock domain at Namecheap + fetch EPP code (only if we registered it)
    let eppCode: string | null = null
    if (tenant.domain_registrar === 'namecheap' && tenant.domain) {
      try {
        if (isRegistrarConfigured()) {
          const registrar = await getRegistrar()
          const unlock = await registrar.unlock(tenant.domain)
          if (!unlock.success) steps.push({ step: 'registrar_unlock', status: 'warning', detail: unlock.error })
          else steps.push({ step: 'registrar_unlock', status: 'ok' })
          const epp = await registrar.getEppCode(tenant.domain)
          if (epp.success && epp.eppCode) {
            eppCode = epp.eppCode
            steps.push({ step: 'registrar_epp', status: 'ok' })
          } else {
            steps.push({ step: 'registrar_epp', status: 'warning', detail: epp.error })
          }
        } else {
          steps.push({ step: 'registrar_unlock', status: 'skipped', detail: 'registrar not configured' })
        }
      } catch (e: any) {
        steps.push({ step: 'registrar_unlock', status: 'warning', detail: e.message })
      }
    } else {
      steps.push({ step: 'registrar_unlock', status: 'skipped', detail: tenant.domain_registrar === 'byod' ? 'BYOD domain — customer already owns it' : 'no domain' })
    }

    // 3. Set offboard sentinels
    await supabase.from('tenants').update({
      offboard_started_at: now.toISOString(),
      offboard_grace_ends_at: graceEndsAt.toISOString(),
      epp_code_sent_at: eppCode ? now.toISOString() : null,
    }).eq('id', tenantId)

    // 4. Data export — dumps every public-schema table from the tenant DB to
    // a JSON bundle on R2, emails a 7-day signed download link. Non-blocking
    // so an R2 outage doesn't stop the offboard.
    if (tenant.database_url) {
      (async () => {
        try {
          const { exportTenantData } = await import('../../services/dataExport')
          const result = await exportTenantData({ tenantId: tenant.id, tenantSlug: tenant.slug, tenantDatabaseUrl: tenant.database_url })
          if (result.success && result.signedUrl && result.expiresAt) {
            await notifyDataExportReady(tenant, result.signedUrl, result.expiresAt).catch(e => console.warn('[Offboard] Data export email failed:', e.message))
            steps.push({ step: 'data_export', status: 'ok', detail: result.rowCount + ' rows across ' + result.tableCount + ' tables' })
          } else {
            steps.push({ step: 'data_export', status: 'warning', detail: result.error })
          }
        } catch (e: any) {
          steps.push({ step: 'data_export', status: 'warning', detail: e.message })
        }
      })()
    } else {
      steps.push({ step: 'data_export', status: 'skipped', detail: 'no tenant database_url stored' })
    }

    // 5. Audit log + emails (non-blocking)
    const user = c.get('user')
    await logTenantAudit(tenantId, 'offboard_start', {
      offboard_grace_ends_at: { old: null, new: graceEndsAt.toISOString() },
      stripe_subscription_id: { old: tenant.stripe_subscription_id, new: null },
    }, user?.email || 'system')

    const reactivationUrl = tenant.render_frontend_url ? (tenant.render_frontend_url.replace(/\/$/, '') + '/settings/account') : undefined
    notifyOffboardStarted(tenant, graceEndsAt, reactivationUrl).catch(e => console.warn('[Offboard] email failed:', e.message))
    if (eppCode) notifyEppCode(tenant, eppCode).catch(e => console.warn('[Offboard] EPP email failed:', e.message))

    return c.json({
      success: true,
      offboardGraceEndsAt: graceEndsAt.toISOString(),
      steps,
      nextStep: 'Grace period active. Reactivate via /customers/:id/reactivate before ' + graceEndsAt.toISOString() + ' to restore.',
    })
  } catch (err: any) {
    console.error('[Offboard] failed:', err)
    return c.json({ error: err.message }, 500)
  }
})

factory.post('/customers/:id/reactivate', factoryKeyOrRole('owner', 'admin'), async (c) => {
  try {
    const tenantId = c.req.param('id')
    if (!UUID_RE.test(tenantId)) return c.json({ error: 'Invalid tenant ID' }, 400)
    const { data: tenant, error: tenantErr } = await supabase.from('tenants').select('*').eq('id', tenantId).single()
    if (tenantErr || !tenant) return c.json({ error: 'Tenant not found' }, 404)
    if (!tenant.offboard_started_at) return c.json({ error: 'Tenant is not in an offboarding state' }, 400)
    const graceEnd = tenant.offboard_grace_ends_at ? new Date(tenant.offboard_grace_ends_at) : null
    if (graceEnd && graceEnd < new Date()) return c.json({ error: 'Grace period has ended — reactivation not available' }, 410)

    // Reverse Stripe cancellation (remove cancel_at_period_end)
    if (tenant.stripe_subscription_id) {
      try {
        await factoryStripe.reactivateSubscription(tenant.stripe_subscription_id)
      } catch (e: any) {
        console.warn('[Reactivate] Stripe reactivation failed:', e.message)
      }
    }

    await supabase.from('tenants').update({
      offboard_started_at: null,
      offboard_grace_ends_at: null,
      epp_code_sent_at: null,
    }).eq('id', tenantId)

    const user = c.get('user')
    await logTenantAudit(tenantId, 'offboard_reactivate', {
      offboard_started_at: { old: tenant.offboard_started_at, new: null },
    }, user?.email || 'system')

    notifyReactivated(tenant).catch(e => console.warn('[Reactivate] email failed:', e.message))
    return c.json({ success: true })
  } catch (err: any) {
    console.error('[Reactivate] failed:', err)
    return c.json({ error: err.message }, 500)
  }
})


// ─── Email alias sync (tenant → factory) ────────────────────────────────────
// Called by the tenant's CRM backend whenever an email_alias is created,
// updated, or deleted. The factory reflects the change in Cloudflare Email
// Routing on the tenant's zone. Auth: tenant's factory_sync_key in X-Factory-Key.
factory.post('/customers/:id/email-alias-sync', async (c) => {
  try {
    const tenantId = c.req.param('id')
    if (!UUID_RE.test(tenantId)) return c.json({ error: 'Invalid tenant ID' }, 400)
    const { data: tenant } = await supabase.from('tenants').select('id, domain, factory_sync_key, cloudflare_zone_id').eq('id', tenantId).single()
    if (!tenant || !checkFactoryKey(c, tenant)) return c.json({ error: 'Unauthorized' }, 401)
    if (!tenant.domain || !tenant.cloudflare_zone_id) return c.json({ error: 'Tenant has no domain or Cloudflare zone configured' }, 400)

    const body = await c.req.json().catch(() => ({}))
    const { localPart, routingMode, forwardTo, enabled } = body
    if (!localPart || !/^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$/.test(localPart)) return c.json({ error: 'Invalid localPart' }, 400)

    // Load cloudflare module lazily so this file's import graph doesn't fail for
    // environments where CF isn't configured.
    const cf = await import('../../services/cloudflare')
    if (!cf.isCloudflareConfigured()) return c.json({ error: 'Cloudflare not configured' }, 503)

    const matcherValue = localPart + '@' + tenant.domain
    const existingRules = await cf.listEmailRoutingRules(tenant.cloudflare_zone_id)
    const existing = existingRules.find(r => r.matcherValue.toLowerCase() === matcherValue.toLowerCase())

    // Disabled or deleted alias → remove rule if present
    if (enabled === false) {
      if (existing) await cf.deleteEmailRoutingRule(tenant.cloudflare_zone_id, existing.tag)
      return c.json({ success: true, action: existing ? 'removed' : 'noop' })
    }

    // Determine destination — forward mode sends to external email; crm mode
    // sends to the factory-wide SendGrid Inbound Parse hostname (if configured).
    let destination = ''
    if (routingMode === 'crm') {
      const parseHost = process.env.SENDGRID_INBOUND_PARSE_HOSTNAME || ''
      if (!parseHost) return c.json({ error: 'Inbound Parse hostname not configured on factory (SENDGRID_INBOUND_PARSE_HOSTNAME)' }, 503)
      // Prefix with tenant slug + local part so the webhook can route by recipient.
      destination = tenantId.replace(/-/g, '') + '-' + localPart + '@' + parseHost
    } else {
      if (!forwardTo || !String(forwardTo).includes('@')) return c.json({ error: 'forwardTo required for forward mode' }, 400)
      destination = String(forwardTo)
      // Cloudflare requires destination addresses to be verified before use.
      // Try to add it — noop if already exists. The verification email fires once per destination.
      try { await cf.addEmailDestinationAddress(destination) } catch (e: any) {
        if (!String(e.message).toLowerCase().includes('already')) {
          console.warn('[EmailAliasSync] add destination failed (non-blocking):', e.message)
        }
      }
    }

    const rule = { matcherValue, forwardTo: destination, enabled: true, name: 'alias_' + localPart }
    if (existing) {
      await cf.updateEmailRoutingRule(tenant.cloudflare_zone_id, existing.tag, rule)
      return c.json({ success: true, action: 'updated', ruleTag: existing.tag })
    } else {
      const created = await cf.addEmailRoutingRule(tenant.cloudflare_zone_id, rule)
      return c.json({ success: true, action: 'created', ruleTag: created.tag })
    }
  } catch (err: any) {
    console.error('[EmailAliasSync] failed:', err)
    return c.json({ error: err.message }, 500)
  }
})


// ─── Delete Job ──────────────────────────────────────────────────────────────
factory.delete('/jobs/:id', requireRole('owner', 'admin'), async (c) => {
  try {
    const jobId = c.req.param('id')
    if (!UUID_RE.test(jobId)) return c.json({ error: 'Invalid job ID format' }, 400)
    const { data: job, error: jobErr } = await supabase.from('factory_jobs').select('*').eq('id', jobId).single()
    if (jobErr || !job) return c.json({ error: jobErr?.message || 'Job not found' }, jobErr && jobErr.code !== 'PGRST116' ? 500 : 404)

    if (job.storage_key) {
      await deleteZip(job.storage_key, job.storage_type || 'local')
    } else if (job.zip_name) {
      const OUTPUT_DIR = process.env.FACTORY_OUTPUT_DIR || path.resolve(process.cwd(), '..', '..', 'generated')
      const zipPath = path.join(OUTPUT_DIR, job.zip_name)
      if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath)
    }

    await supabase.from('factory_jobs').delete().eq('id', jobId)
    return c.json({ success: true })
  } catch (err: any) {
    console.error('[Factory] Delete job error:', err)
    return c.json({ error: 'Failed to delete build' }, 500)
  }
})

}
