import { supabase, requireRole } from '../../middleware/auth'
import { generate, type GenerateConfig } from '../../services/generator'
import factoryStripe from '../../services/factoryStripe'
import { uploadZip, getZipDownloadUrl, uploadIntakeAsset } from '../../services/factoryStorage'
import { notifyWelcome, notifyNewIntake, notifyPreviewReady, notifyIntakeFeedback, notifyTrialWarning, notifyTrialExpired } from '../../services/email'
import path from 'path'
import { getRegistrar, isRegistrarConfigured } from '../../services/registrar'
import { buildBrief, type Intake } from '../../services/briefBuilder'
import { renderHomepagePreview } from '../../services/previewRenderer'
import { composeSite } from '../../services/sectionComposer'
import { renderPremiumPage, pickPremiumTemplateDir } from '../../services/premiumSiteRenderer'
import { searchStockPhotosForBusiness, trackDownload as trackUnsplashDownload } from '../../services/unsplashPlus'
import { type FactoryApp, rateLimit, checkCronSecret, checkFactoryKey, UUID_RE, DOMAIN_RE, parseJsonBody } from './shared'
import { runDeploy, triggerAutoDeploy } from './deploy'

export function registerIntakeRoutes(factory: FactoryApp) {
// ─── Inbound Email Router (SendGrid Inbound Parse → tenant CRM) ──────────────
// SendGrid posts ALL inbound emails to this single endpoint. We extract the
// company ID prefix + platform from the To address and forward to the tenant.
factory.post('/public/inbound-email', async (c) => {
  try {
    // SendGrid Inbound Parse sends form-encoded or JSON
    let body: any
    const ct = c.req.header('content-type') || ''
    if (ct.includes('multipart/form-data') || ct.includes('application/x-www-form-urlencoded')) {
      const formData = await c.req.parseBody()
      body = {
        to: formData.to as string,
        from: formData.from as string,
        subject: formData.subject as string,
        text: formData.text as string,
        html: formData.html as string,
      }
    } else {
      body = await c.req.json()
    }

    const to = body.to || body.envelope?.to?.[0] || ''
    const toMatch = to.match(/leads\+([a-z0-9]+)-([a-z_]+)@/)
    if (!toMatch) {
      console.log('[InboundEmail] No matching To address pattern:', to)
      return c.json({ error: 'Invalid inbound address' }, 400)
    }

    const companyIdPrefix = toMatch[1]

    // Look up tenant by searching for company_id prefix in tenants table
    // The tenant's CRM database has the company record, but the factory stores
    // render_backend_url which we need to forward to
    const { data: tenants } = await supabase
      .from('tenants')
      .select('id, render_backend_url, slug')
      .not('render_backend_url', 'is', null)

    if (!tenants?.length) {
      console.log('[InboundEmail] No tenants with backend URLs found')
      return c.json({ error: 'No active tenants' }, 404)
    }

    // Find tenant whose ID starts with the prefix
    const tenant = tenants.find((t: any) => t.id.startsWith(companyIdPrefix))
    if (!tenant?.render_backend_url) {
      console.log('[InboundEmail] No tenant found for prefix:', companyIdPrefix)
      return c.json({ error: 'Tenant not found' }, 404)
    }

    // Forward the email payload to the tenant's CRM backend
    const targetUrl = `${tenant.render_backend_url}/api/leads/inbound/email`
    console.log('[InboundEmail] Forwarding to:', targetUrl, 'tenant:', tenant.slug)

    const resp = await fetch(targetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    const result = await resp.json()
    return c.json(result, resp.status as any)
  } catch (err: any) {
    console.error('[InboundEmail] Error:', err.message)
    return c.json({ error: 'Failed to process inbound email' }, 500)
  }
})


// ─── Public Signup (no auth required — path contains /public/) ──────────────
// Rate limit: 5 signups per IP per hour
// ─── Trial lifecycle cron ────────────────────────────────────────────────────
// Runs daily (via Render cron or external scheduler). Authenticated by a
// shared secret (CRON_SECRET) so it can be called without a user JWT.
//
// Logic:
//   - tenants with trial_ends_at between NOW+6d and NOW+8d → send 7-day warning
//   - tenants with trial_ends_at between NOW+2d and NOW+4d → send 3-day warning
//   - tenants with trial_ends_at in the last 24h             → send day-of warning
//   - tenants with trial_ends_at < NOW and no subscription    → set trial_expired_at,
//     status='trial_expired' (triggers the paywall lock in each template)
//
// Uses trial_warning_{7d,3d,0d}_sent_at sentinels so each email is sent once.
// Safe to run multiple times per day — idempotent.
factory.post('/internal/trial-check', async (c) => {
  if (!checkCronSecret(c)) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  const now = new Date()
  const results = { warn7d: 0, warn3d: 0, warn0d: 0, expired: 0, errors: [] as string[] }

  // Helper to query a trial window and send a warning email
  const processWindow = async (
    windowStart: Date,
    windowEnd: Date,
    sentCol: 'trial_warning_7d_sent_at' | 'trial_warning_3d_sent_at' | 'trial_warning_0d_sent_at',
    daysRemaining: number,
    counter: 'warn7d' | 'warn3d' | 'warn0d'
  ) => {
    const { data: tenants, error } = await supabase
      .from('tenants')
      .select('id, name, email, slug, industry, products, plan, render_frontend_url, trial_ends_at')
      .is('trial_expired_at', null)
      .is('stripe_subscription_id', null)
      .gte('trial_ends_at', windowStart.toISOString())
      .lt('trial_ends_at', windowEnd.toISOString())
      .is(sentCol, null)
    if (error) {
      results.errors.push(`${counter}: ${error.message}`)
      return
    }
    for (const t of tenants || []) {
      try {
        const ok = await notifyTrialWarning(t as any, daysRemaining)
        if (ok) {
          await supabase.from('tenants').update({ [sentCol]: now.toISOString() }).eq('id', t.id)
          results[counter]++
        }
      } catch (e: any) {
        results.errors.push(`${counter} ${t.slug}: ${e.message}`)
      }
    }
  }

  // 7-day warning window: trial ends between NOW+6d and NOW+8d
  await processWindow(
    new Date(now.getTime() + 6 * 24 * 60 * 60 * 1000),
    new Date(now.getTime() + 8 * 24 * 60 * 60 * 1000),
    'trial_warning_7d_sent_at',
    7,
    'warn7d'
  )

  // 3-day warning window: trial ends between NOW+2d and NOW+4d
  await processWindow(
    new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000),
    new Date(now.getTime() + 4 * 24 * 60 * 60 * 1000),
    'trial_warning_3d_sent_at',
    3,
    'warn3d'
  )

  // Day-of warning window: trial ends between NOW and NOW+1d
  await processWindow(
    now,
    new Date(now.getTime() + 1 * 24 * 60 * 60 * 1000),
    'trial_warning_0d_sent_at',
    1,
    'warn0d'
  )

  // Expire tenants whose trial ended >= now, haven't been expired yet, no sub
  const { data: expiredTenants, error: expireErr } = await supabase
    .from('tenants')
    .select('id, name, email, slug, industry, products, plan, render_frontend_url')
    .is('trial_expired_at', null)
    .is('stripe_subscription_id', null)
    .lt('trial_ends_at', now.toISOString())

  if (expireErr) {
    results.errors.push('expire: ' + expireErr.message)
  } else {
    for (const t of expiredTenants || []) {
      try {
        await supabase.from('tenants').update({
          trial_expired_at: now.toISOString(),
          status: 'trial_expired',
        }).eq('id', t.id)
        await notifyTrialExpired(t as any).catch(() => {})
        results.expired++
      } catch (e: any) {
        results.errors.push(`expire ${t.slug}: ${e.message}`)
      }
    }
  }

  console.log('[TrialCheck]', JSON.stringify(results))
  return c.json({ ok: true, timestamp: now.toISOString(), ...results })
})

// ─── Public domain availability check + suggestions ────────────────────────
// Rate limited: 20 requests per 10 minutes per IP. Namecheap charges per call
// and enforces its own rate caps — this protects both us and our quota.
// When the requested name is unavailable, generates 10 nearby variants and
// returns the available ones so the customer never hits a dead end.
factory.post('/public/domain/check', rateLimit(10 * 60 * 1000, 20), async (c) => {
  try {
    const parsed = await parseJsonBody(c)
    if (parsed.error) return parsed.error
    const body = parsed.data
    const domain = typeof body.domain === 'string' ? body.domain.trim().toLowerCase() : ''
    if (!domain || !DOMAIN_RE.test(domain)) {
      return c.json({ error: 'Invalid domain format' }, 400)
    }
    if (!isRegistrarConfigured()) {
      return c.json({ error: 'Domain purchase is not configured on this environment' }, 503)
    }
    const registrar = await getRegistrar()
    const primary = await registrar.checkAvailability(domain)
    // If the customer's first pick is available, ship that and skip the
    // expensive batch call. Keeps Namecheap quota low for the happy path.
    if (primary.available) return c.json({ ...primary, suggestions: [] })

    const variants = generateDomainVariants(domain)
    const batched = variants.length > 0 ? await registrar.checkBatch(variants) : []
    const suggestions = batched.filter(x => x.available && !x.premium).slice(0, 8)
    return c.json({ ...primary, suggestions })
  } catch (err: any) {
    console.error('[Domain] Availability check failed:', err)
    return c.json({ error: err.message || 'Availability check failed' }, 500)
  }
})

/**
 * Build a list of "close-enough" domain variants to check when the
 * customer's first pick is taken. Mixes TLD swaps + common business
 * suffixes + a couple of word reorderings. Caller dedupes against the
 * original and against itself.
 */
function generateDomainVariants(input: string): string[] {
  const m = input.match(/^([^.]+)\.(.+)$/)
  if (!m) return []
  const [, base, tld] = m
  const baseClean = base.replace(/-+/g, '-')
  const tldCandidates = [tld, 'com', 'co', 'net', 'us', 'io']
  const suffixes = ['', 'co', 'inc', 'hq', 'group', 'team', 'pro', 'now', 'app', 'shop', 'go']
  const out = new Set<string>()
  for (const t of tldCandidates) {
    for (const s of suffixes) {
      if (!s && t === tld) continue  // identical to input
      const stem = s ? baseClean + s : baseClean
      if (stem.length > 30) continue  // avoid silly-long URLs
      out.add(stem + '.' + t)
    }
  }
  // Hyphenated split (handles "thekitchentechnique" → "the-kitchen-technique")
  // ONLY if base has no hyphens already AND is long enough to plausibly split.
  if (!baseClean.includes('-') && baseClean.length >= 10) {
    const halves = Math.floor(baseClean.length / 2)
    out.add(baseClean.slice(0, halves) + '-' + baseClean.slice(halves) + '.' + tld)
  }
  out.delete(input)
  return Array.from(out).slice(0, 18)
}

factory.post('/public/signup', rateLimit(60 * 60 * 1000, 5), async (c) => {
  try {
    const parsed = await parseJsonBody(c)
    if (parsed.error) return parsed.error
    const body = parsed.data

    if (!body.name || typeof body.name !== 'string' || body.name.trim().length < 2) {
      return c.json({ error: 'Company name is required (min 2 characters)' }, 400)
    }
    if (!body.email || typeof body.email !== 'string' || !body.email.includes('@')) {
      return c.json({ error: 'Valid email is required' }, 400)
    }

    const slug = body.slug || body.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')

    // Check for duplicate slug
    const { data: existing } = await supabase.from('tenants').select('id').eq('slug', slug).maybeSingle()
    if (existing) {
      return c.json({ error: 'A company with a similar name already exists. Please contact support or use a different name.' }, 409)
    }

    // ─── Domain mode handling ─────────────────────────────────────────────────
    // domainMode: 'skip' (default, no domain) | 'byod' (customer owns domain) |
    // 'buy' (we register via Namecheap synchronously before creating tenant —
    // fail-fast so the customer isn't charged for a domain attached to a
    // half-created account).
    const domainMode: 'skip' | 'byod' | 'buy' = body.domainMode === 'byod' || body.domainMode === 'buy' ? body.domainMode : 'skip'
    let resolvedDomain: string | null = null
    let resolvedRegistrar: string | null = null
    let resolvedExpiresAt: Date | null = null

    if (domainMode === 'byod') {
      const d = typeof body.domain === 'string' ? body.domain.trim().toLowerCase() : ''
      if (!d || !DOMAIN_RE.test(d)) return c.json({ error: 'Invalid domain format for BYOD' }, 400)
      resolvedDomain = d
      resolvedRegistrar = 'byod'
    } else if (domainMode === 'buy') {
      if (!isRegistrarConfigured()) {
        return c.json({ error: 'Domain purchase is not configured on this environment' }, 503)
      }
      const d = typeof body.domain === 'string' ? body.domain.trim().toLowerCase() : ''
      if (!d || !DOMAIN_RE.test(d)) return c.json({ error: 'Invalid domain format for purchase' }, 400)
      const years = Math.max(1, Math.min(10, parseInt(body.purchaseYears, 10) || 1))
      // Namecheap requires full registrant contact info. Fall back to company-level fields
      // where reasonable; require the bits there's no sensible fallback for.
      const ownerName = (body.owner_name || body.ownerName || body.name || '').trim()
      const firstName = body.owner_first_name || body.ownerFirstName || ownerName.split(/\s+/)[0] || 'Admin'
      const lastName = body.owner_last_name || body.ownerLastName || ownerName.split(/\s+/).slice(1).join(' ') || 'User'
      const phone = body.phone || ''
      if (!phone) return c.json({ error: 'Phone is required for domain registration' }, 400)
      const country = (body.country || 'US').toUpperCase()
      const registrar = await getRegistrar()
      const reg = await registrar.register(d, {
        years,
        whoisPrivacy: true,
        autoRenew: true,
        registrantContact: {
          firstName, lastName,
          email: body.email,
          phone,
          address1: body.address || '',
          city: body.city || '',
          stateProvince: body.state || '',
          postalCode: body.zip || '',
          country,
          organization: body.name,
        },
      })
      if (!reg.success) {
        return c.json({ error: 'Domain registration failed: ' + (reg.error || 'unknown') }, 400)
      }
      resolvedDomain = d
      resolvedRegistrar = 'namecheap'
      resolvedExpiresAt = reg.expiresAt || null
    }

    // Start the 30-day free trial clock at signup. No credit card required — the
    // tenant's CRM is provisioned immediately and they get 30 days to try it.
    // Warning emails fire at day 23 (7 left), day 27 (3 left), and day 30.
    // At day 30 the CRM locks to a paywall until they upgrade.
    const trialEndsAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)

    const tenantRecord: Record<string, any> = {
      name: body.name.trim(),
      slug,
      email: body.email.trim(),
      admin_email: body.admin_email || body.email.trim(),
      phone: body.phone || null,
      industry: body.industry || null,
      address: body.address || null,
      city: body.city || null,
      state: body.state || null,
      zip: body.zip || null,
      domain: resolvedDomain,
      domain_registrar: resolvedRegistrar,
      domain_expires_at: resolvedExpiresAt ? resolvedExpiresAt.toISOString() : null,
      primary_color: body.primary_color || '#FF3D00',
      plan: body.plan || 'starter',
      deployment_model: body.deployment_model || 'saas',
      billing_type: body.billing_type || 'trial',
      monthly_amount: body.monthly_amount || null,
      status: 'pending',
      products: body.products || ['crm', 'website'],
      features: body.features || [],
      notes: body.notes || null,
      admin_password: body.admin_password || null,
      website_theme: body.website_theme || null,
      trial_ends_at: trialEndsAt.toISOString(),
    }

    let { data: tenant, error: insertErr } = await supabase.from('tenants').insert(tenantRecord).select().single()
    // If trial_ends_at column hasn't been added to the live DB yet, retry without it.
    // This lets the code ship before the schema migration is applied.
    if (insertErr && insertErr.code === '42703') {
      console.warn('[Signup] trial_ends_at column missing, retrying without it. Run apps/api/schema.sql migration.')
      const { trial_ends_at: _, ...fallback } = tenantRecord
      const retry = await supabase.from('tenants').insert(fallback).select().single()
      tenant = retry.data
      insertErr = retry.error
    }
    if (insertErr || !tenant) {
      console.error('[Signup] Insert error:', insertErr?.message)
      return c.json({ error: 'Failed to create account. Please try again.' }, 500)
    }

    console.log('[Signup] New tenant created:', tenant.id, tenant.name, tenant.plan, '(trial ends ' + trialEndsAt.toISOString() + ')')

    // Send welcome email immediately (non-blocking)
    notifyWelcome(tenant).catch(e => console.warn('[Email] Welcome email failed:', e.message))

    // Auto-generate code build so triggerAutoDeploy has a factory_jobs record to deploy
    const genConfig: GenerateConfig = {
      tenant_id: tenant.id,
      products: body.products || ['crm', 'website'],
      websiteTheme: body.website_theme || undefined,
      company: {
        name: body.name.trim(),
        email: body.email.trim(),
        adminEmail: body.admin_email || body.email.trim(),
        phone: body.phone || undefined,
        address: body.address || undefined,
        city: body.city || undefined,
        state: body.state || undefined,
        zip: body.zip || undefined,
        domain: body.domain || undefined,
        industry: body.industry || undefined,
        plan: body.plan || 'starter',
        defaultPassword: body.admin_password || undefined,
      },
      branding: {
        primaryColor: body.primary_color || '#FF3D00',
        websiteTheme: body.website_theme || undefined,
      },
      features: {
        crm: body.features || [],
      },
    }

    // Run generation + auto-deploy in background — don't block the signup response.
    // "No credit card required" flow: deploy fires immediately on signup, customer
    // gets a live CRM within ~5 min, trial starts at tenant.trial_ends_at.
    // Stripe is touched only later when they upgrade from inside the CRM.
    ;(async () => {
      try {
        console.log('[Signup] Auto-generating build for tenant:', tenant.id, tenant.slug)
        const genResult = await generate(genConfig)
        const storage = await uploadZip(genResult.zipPath, genResult.zipName)

        const jobRecord: Record<string, any> = {
          tenant_id: tenant.id,
          template: genConfig.products.join('+'),
          deployment_model: body.deployment_model || 'saas',
          status: 'pending',
          features: body.features || [],
          branding: genConfig.branding,
          build_id: genResult.buildId,
          zip_name: genResult.zipName,
          storage_key: storage.storageKey,
          storage_type: storage.storageType,
        }

        const { error: jobErr } = await supabase.from('factory_jobs').insert({ ...jobRecord, config: genConfig })
        if (jobErr) {
          if (jobErr.code === '42703') {
            await supabase.from('factory_jobs').insert(jobRecord)
          } else {
            console.error('[Signup] Job insert error:', jobErr.message)
          }
        }
        console.log('[Signup] Build generated successfully for', tenant.slug, '— firing immediate auto-deploy')

        // Immediate auto-deploy — no Stripe checkout gating. triggerAutoDeploy
        // looks up the latest factory_jobs row for this tenant and kicks off
        // runDeploy in the background. Idempotent — safe to call even if a
        // deploy is already in progress.
        if (tenantRecord.deployment_model === 'saas') {
          await triggerAutoDeploy(tenant.id).catch(err =>
            console.error('[Signup] triggerAutoDeploy error:', err?.message || err)
          )
        }
      } catch (genErr: any) {
        console.error('[Signup] Auto-generate failed for', tenant.slug, ':', genErr.message)
      }
    })()

    return c.json({
      success: true,
      tenantId: tenant.id,
      slug: tenant.slug,
      trialEndsAt: trialEndsAt.toISOString(),
      message: 'Account created successfully — your CRM is being provisioned. You will receive an email when it is ready.',
    })
  } catch (err: any) {
    console.error('[Signup] Error:', err.message)
    return c.json({ error: 'Something went wrong. Please try again.' }, 500)
  }
})


// ─── Public local-business website intake ───────────────────────────────────
//
// Fired by the form on twomiah.com/businesses. Distinct flow from /public/signup:
//   * No Stripe customer, no trial clock, no CRM provisioning.
//   * Lead lands in tenants with status='intake' so the platform dashboard
//     can manage everything (intakes + active tenants + churned) in one place.
//   * Uploaded logo + reference photos go to S3/R2 under intake/<slug>/.
//   * Internal team gets an email with signed URLs (7-day) for the files.
//
// Schema dependency: tenants.intake_data jsonb column. Applied via
// migrations/2026-05-27_tenants_intake_data.sql. If the column is missing
// the endpoint falls back to writing only to the notes column.
factory.post('/public/intake', rateLimit(60 * 60 * 1000, 3), async (c) => {
  try {
    // Multipart parse — { all: true } gives arrays for repeated fields like photos[].
    const body = await c.req.parseBody({ all: true }) as Record<string, any>

    const getStr = (key: string): string => {
      const v = body[key]
      return typeof v === 'string' ? v.trim() : ''
    }

    // Array fields arrive either as repeated multipart keys (services[]) or as a
    // single comma/newline-separated string (a textarea). Accept both.
    const getArr = (key: string, max = 30): string[] => {
      const raw = body[key] ?? body[key + '[]']
      const items = Array.isArray(raw) ? raw : raw != null ? [raw] : []
      const out: string[] = []
      for (const v of items) {
        if (typeof v !== 'string') continue
        for (const part of v.split(/[\n,]/)) {
          const t = part.trim()
          if (t) out.push(t)
        }
      }
      return out.slice(0, max)
    }

    const getBool = (key: string): boolean | undefined => {
      const v = getStr(key).toLowerCase()
      if (!v) return undefined
      return ['true', 'yes', '1', 'on'].includes(v)
    }

    const businessName = getStr('businessName')
    const businessType = getStr('businessType')
    const contactEmail = getStr('contactEmail')

    if (!businessName || businessName.length < 2) {
      return c.json({ error: 'Business name is required (min 2 characters).' }, 400)
    }
    if (!businessType) {
      return c.json({ error: 'Business type is required.' }, 400)
    }
    if (!contactEmail || !contactEmail.includes('@')) {
      return c.json({ error: 'A valid contact email is required.' }, 400)
    }

    const contactPhone = getStr('contactPhone') || null
    const currentSite = getStr('currentSite') || null
    const brandColors = getStr('brandColors') || null
    const intakeNotes = getStr('notes') || null

    // ─── Rich intake fields ────────────────────────────────────────────────
    // Optional. These map 1:1 onto briefBuilder's Intake interface so a captured
    // lead can be handed straight to buildBrief() with no transformation.
    const city = getStr('city') || null
    const state = getStr('state') || null
    const serviceRegion = getStr('serviceRegion') || null
    const ownerName = getStr('ownerName') || null
    const description = getStr('description') || null
    const domain = getStr('domain') || null
    // The /start intake's optional domain-step field. Distinct from
    // `domain` (which is the customer's existing site, if any) — this
    // is what they want for their NEW site. May fail availability at
    // commit time; captured here only to surface in the review queue.
    const requestedDomain = getStr('requestedDomain') || null
    const primaryColor = getStr('primaryColor') || null
    const secondaryColor = getStr('secondaryColor') || null
    const accentColor = getStr('accentColor') || null
    const services = getArr('services')
    const competitors = getArr('competitors', 10)  // "sites you like" — inspiration
    const goals = getArr('goals', 10)               // e.g. orders, leads, bookings, info
    const serviceAreas = getArr('serviceAreas', 12)
    const nearbyCities = serviceAreas.length ? serviceAreas : getArr('nearbyCities', 12)  // manual "areas you serve"
    const wantsCrm = getBool('wantsCrm')

    // ─── Slug — collision-resistant ────────────────────────────────────────
    // Intake slugs are suffixed with '-intake' so they're visually distinct
    // from real tenants and won't collide with a future tenant of the same
    // business name (when an intake converts, the team renames cleanly).
    const baseSlug = businessName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'lead'
    let slug = baseSlug + '-intake'
    const { data: collide } = await supabase.from('tenants').select('id').eq('slug', slug).maybeSingle()
    if (collide) {
      slug = baseSlug + '-intake-' + Math.floor(Date.now() / 1000)
    }

    // ─── File validation ──────────────────────────────────────────────────
    const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml', 'image/gif']
    const MAX_FILE_SIZE = 8 * 1024 * 1024  // 8 MB per file; full request still capped at 15 MB by index.ts

    const isFile = (x: any): x is File => x && typeof x === 'object' && typeof x.arrayBuffer === 'function' && typeof x.size === 'number'

    const validateFile = (file: File, label: string): string | null => {
      if (file.size > MAX_FILE_SIZE) return `${label} is too large (max 8 MB).`
      if (file.type && !ALLOWED_IMAGE_TYPES.includes(file.type)) return `${label} must be a PNG, JPG, WEBP, SVG, or GIF.`
      return null
    }

    // ─── Upload logo (single) ─────────────────────────────────────────────
    let logoStorageKey: string | null = null
    let logoStorageType: 's3' | 'local' | null = null
    let logoUrl: string | null = null
    if (isFile(body.logo)) {
      const err = validateFile(body.logo, 'Logo')
      if (err) return c.json({ error: err }, 400)
      const buf = Buffer.from(await body.logo.arrayBuffer())
      const result = await uploadIntakeAsset(buf, body.logo.name || 'logo', body.logo.type || 'application/octet-stream', slug)
      logoStorageKey = result.storageKey
      logoStorageType = result.storageType
      logoUrl = await getZipDownloadUrl(result.storageKey, result.storageType, 7 * 24 * 60 * 60)
    }

    // ─── Upload photos (up to 5) ──────────────────────────────────────────
    const rawPhotos = body.photos || body['photos[]']
    const photoCandidates: any[] = Array.isArray(rawPhotos) ? rawPhotos : rawPhotos ? [rawPhotos] : []
    const photoStorageKeys: { storageKey: string; storageType: 's3' | 'local' }[] = []
    const photoUrls: string[] = []
    for (const candidate of photoCandidates.slice(0, 5)) {
      if (!isFile(candidate)) continue
      const err = validateFile(candidate, 'Reference photo')
      if (err) return c.json({ error: err }, 400)
      const buf = Buffer.from(await candidate.arrayBuffer())
      const result = await uploadIntakeAsset(buf, candidate.name || 'photo', candidate.type || 'application/octet-stream', slug)
      photoStorageKeys.push({ storageKey: result.storageKey, storageType: result.storageType })
      const url = await getZipDownloadUrl(result.storageKey, result.storageType, 7 * 24 * 60 * 60)
      if (url) photoUrls.push(url)
    }

    // ─── Persist ──────────────────────────────────────────────────────────
    const intakeData = {
      source: 'businesses-intake-form',
      submittedAt: new Date().toISOString(),
      brandColors: brandColors || null,
      logo: logoStorageKey ? { storageKey: logoStorageKey, storageType: logoStorageType } : null,
      photos: photoStorageKeys,
      freeFormNotes: intakeNotes || null,
      // Brief-ready intake — mirrors briefBuilder's Intake interface exactly so
      // buildBrief(intakeData.intake) works with no glue. Keys with no value are
      // dropped on serialization, leaving a clean partial.
      intake: {
        businessName,
        businessType,
        city: city || undefined,
        state: state || undefined,
        phone: contactPhone || undefined,
        email: contactEmail,
        domain: domain || undefined,
        ownerName: ownerName || undefined,
        serviceRegion: serviceRegion || undefined,
        nearbyCities: nearbyCities.length ? nearbyCities : undefined,
        description: description || undefined,
        siteUrl: currentSite || undefined,
        goals: goals.length ? goals : undefined,
        competitors: competitors.length ? competitors : undefined,
        branding: {
          primaryColor: primaryColor || undefined,
          secondaryColor: secondaryColor || undefined,
          accentColor: accentColor || undefined,
          logo: logoUrl || undefined,
        },
        services: services.length ? services : undefined,
        wantsCrm,
        requestedDomain: requestedDomain || undefined,
      },
    }

    const tenantRecord: Record<string, any> = {
      name: businessName,
      slug,
      email: contactEmail,
      admin_email: contactEmail,
      phone: contactPhone,
      industry: businessType,
      website_url: currentSite,
      city,
      state,
      status: 'intake',
      notes: intakeNotes,  // free-form notes stay as plain text
      intake_data: intakeData,
    }

    let { data: tenant, error: insertErr } = await supabase.from('tenants').insert(tenantRecord).select().single()
    // Fallback for environments where the intake_data column migration hasn't
    // been applied yet OR PostgREST's schema cache is stale — stash the JSON
    // in notes so we don't lose the lead. 42703 = Postgres native undefined_column,
    // PGRST204 = PostgREST schema cache miss, message-substring catches the rest.
    const isMissingColumn = insertErr && (
      insertErr.code === '42703' ||
      insertErr.code === 'PGRST204' ||
      (typeof insertErr.message === 'string' && insertErr.message.toLowerCase().includes('intake_data'))
    )
    if (isMissingColumn) {
      console.warn('[Intake] intake_data column missing or stale in schema cache — falling back to notes-only storage. Error:', insertErr?.code, insertErr?.message)
      const fallback = { ...tenantRecord }
      delete fallback.intake_data
      fallback.notes = (intakeNotes ? intakeNotes + '\n\n' : '') + '---\nintake_data: ' + JSON.stringify(intakeData)
      const retry = await supabase.from('tenants').insert(fallback).select().single()
      tenant = retry.data
      insertErr = retry.error
    }
    if (insertErr || !tenant) {
      console.error('[Intake] Insert failed:', { code: insertErr?.code, message: insertErr?.message, details: (insertErr as any)?.details, hint: (insertErr as any)?.hint })
      return c.json({ error: 'Failed to save your submission. Please try again or email support@twomiah.com directly.' }, 500)
    }

    console.log('[Intake] New intake captured:', tenant.id, businessName, '(' + businessType + ')')

    // Fire-and-forget email to the internal team
    notifyNewIntake({
      businessName,
      businessType,
      contactEmail,
      contactPhone,
      currentSite,
      brandColors,
      notes: intakeNotes,
      logoUrl,
      photoUrls,
      intakeId: tenant.id,
    }).catch((e: any) => console.warn('[Email] Intake notification failed:', e.message))

    // Auto-fire composer so the customer gets a preview without staff
    // having to click 'Compose' in the staff queue. Delayed slightly so
    // the HTTP response returns first. Rate-limiting already happens
    // upstream on the intake POST (3/hr/IP) so spam doesn't flood the
    // composer. Idempotent: if preview_premium_pages is already set
    // (re-submission), we skip and don't waste tokens.
    setTimeout(() => {
      autoComposeForNewIntake(tenant.id).catch((e: any) =>
        console.warn('[AutoCompose] Failed for ' + tenant.id + ':', e.message))
    }, 200)

    return c.json({
      success: true,
      intakeId: tenant.id,
      message: "Thanks! We're composing your preview now — you'll get an email within 15 minutes.",
    })
  } catch (err: any) {
    console.error('[Intake] Error:', err.message || err)
    return c.json({ error: 'Submission failed. Please try again.' }, 500)
  }
})

// ─── Show-first preview (staff-triggered draft render) ─────────────────────────
// Renders a website-only DRAFT of an intake lead to a self-contained HTML page
// and stores it so it can be shared via a public link. This NEVER touches the
// deploy pipeline (no GitHub/Render/DB) — the real factory build only runs when
// the customer buys. Re-running overwrites the same preview, so nothing piles up.
factory.post('/intake/:id/preview', requireRole('owner', 'admin', 'editor'), async (c) => {
  try {
    const id = c.req.param('id')
    if (!UUID_RE.test(id)) return c.json({ error: 'Invalid intake id' }, 400)

    const { data: tenant, error } = await supabase
      .from('tenants')
      .select('id, name, industry, city, state, intake_data')
      .eq('id', id)
      .maybeSingle()
    if (error || !tenant) return c.json({ error: 'Intake not found' }, 404)

    // Prefer the structured intake captured by /public/intake; fall back to the
    // tenant's own columns for leads created before structured capture existed.
    const stored = (tenant.intake_data && tenant.intake_data.intake) || null
    const intake: Intake = stored || {
      businessName: tenant.name,
      businessType: tenant.industry || 'other',
      city: tenant.city || undefined,
      state: tenant.state || undefined,
    }
    if (!intake.businessName || !intake.businessType) {
      return c.json({ error: 'Lead is missing a business name or type — cannot build a preview.' }, 422)
    }

    const brief = buildBrief(intake)
    if (!brief.ok) {
      return c.json({ error: 'Could not build a safe config for this lead', validation: brief.validation }, 422)
    }

    const preview = await renderHomepagePreview(brief.config)
    const generatedAt = new Date().toISOString()

    const { error: saveErr } = await supabase
      .from('tenants')
      .update({ preview_html: preview.html, preview_generated_at: generatedAt })
      .eq('id', id)
    if (saveErr) {
      console.error('[Preview] Save failed:', saveErr.code, saveErr.message)
      return c.json({ error: 'Preview rendered but could not be saved. If this mentions a missing column, apply the preview_html migration.', detail: saveErr.message }, 500)
    }

    const origin = new URL(c.req.url).origin
    return c.json({
      ok: true,
      previewUrl: `${origin}/api/v1/factory/public/intake/${id}/preview`,
      template: brief.decision.websiteTemplate,
      generatedAt,
    })
  } catch (err: any) {
    console.error('[Preview] Render failed:', err?.message || err)
    return c.json({ error: 'Failed to render preview', detail: err?.message }, 500)
  }
})

// Public: serve the rendered preview so a prospect can just open the link.
factory.get('/public/intake/:id/preview', async (c) => {
  const id = c.req.param('id')
  if (!UUID_RE.test(id)) return c.text('Invalid preview link', 400)
  const { data: tenant } = await supabase
    .from('tenants')
    .select('preview_html')
    .eq('id', id)
    .maybeSingle()
  if (!tenant || !tenant.preview_html) {
    return c.html('<!doctype html><meta charset="utf-8"><title>Preview not ready</title><body style="font:16px system-ui;padding:40px">This preview hasn\'t been generated yet.</body>', 404)
  }
  return c.html(tenant.preview_html)
})

// ─── Premium preview: multi-page section-composition ──────────────────────
// The premium tier produces a 4-page site (home/about/services/contact),
// composed by Claude. Stored as the raw SiteResult JSON in
// tenants.preview_premium_pages; rendered on-demand below so staff can
// edit the JSON before publishing without invalidating the URL.

factory.post('/intake/:id/preview-premium', requireRole('owner', 'admin', 'editor'), async (c) => {
  try {
    const id = c.req.param('id')
    if (!UUID_RE.test(id)) return c.json({ error: 'Invalid intake id' }, 400)

    const { data: tenant, error } = await supabase
      .from('tenants')
      .select('id, name, industry, city, state, intake_data')
      .eq('id', id)
      .maybeSingle()
    if (error || !tenant) return c.json({ error: 'Intake not found' }, 404)

    const stored = (tenant.intake_data && tenant.intake_data.intake) || null
    const intake = stored || {
      businessName: tenant.name,
      businessType: tenant.industry || 'general contractor',
      city: tenant.city || undefined,
      state: tenant.state || undefined,
    }
    if (!intake.businessName || !intake.businessType) {
      return c.json({ error: 'Lead is missing business name or type — cannot compose preview.' }, 422)
    }

    // Customer photos from the intake — flow into the composer so the AI
    // can place them in real section slots instead of Unsplash defaults.
    // The intake stores:
    //   intake_data.logo:   { storageKey, storageType }  — for the logo
    //   intake_data.photos: [{ storageKey, storageType }] — reference photos
    //   intake_data.intake.branding.logo: signed URL (7-day TTL at intake time)
    // The signed URL at intake time has likely expired by composer-trigger
    // time, so we regenerate from storageKeys with a 30-day TTL. After deploy,
    // the seed-photos endpoint copies these into the tenant's permanent R2.
    const intakeData = tenant.intake_data || {}
    const SIGNED_TTL_SECONDS = 30 * 24 * 60 * 60
    const customerPhotos: Array<{ url: string; tag?: string; alt?: string }> = []
    if (intakeData.logo && intakeData.logo.storageKey) {
      const url = await getZipDownloadUrl(
        intakeData.logo.storageKey,
        intakeData.logo.storageType,
        SIGNED_TTL_SECONDS
      ).catch(() => null)
      if (url) customerPhotos.push({ url, tag: 'misc', alt: intake.businessName + ' logo' })
    }
    if (Array.isArray(intakeData.photos)) {
      for (const ref of intakeData.photos) {
        if (!ref || !ref.storageKey) continue
        const url = await getZipDownloadUrl(ref.storageKey, ref.storageType, SIGNED_TTL_SECONDS).catch(() => null)
        if (url) customerPhotos.push({ url })
      }
    }

    // Licensed stock photos from Unsplash+ if configured. Returns []
    // silently when UNSPLASH_PLUS_ACCESS_KEY isn't set, so behavior is
    // unchanged until you subscribe.
    const stockPhotos = await searchStockPhotosForBusiness(
      intake.businessType,
      Array.isArray(intake.services) && intake.services.length > 0 ? intake.services[0] : undefined,
      intake.city
    )

    const composed = await composeSite({
      businessName: intake.businessName,
      businessType: intake.businessType,
      city: intake.city,
      state: intake.state,
      description: intake.description,
      services: intake.services,
      goals: intake.goals,
      competitors: intake.competitors,
      ownerName: intake.ownerName,
      phone: intake.phone,
      email: intake.email,
      nearbyCities: intake.nearbyCities,
      primaryColor: intake.branding?.primaryColor,
      customerPhotos,
      stockPhotos: stockPhotos.map(p => ({ url: p.url, tag: p.tag, alt: p.alt })),
    })

    // Unsplash terms: ping /photos/:id/download for every photo we
    // could conceivably use. Fire-and-forget — we don't block the
    // response on Unsplash's ping endpoint.
    for (const p of stockPhotos) {
      trackUnsplashDownload(p.unsplashId).catch(() => {})
    }

    const generatedAt = new Date().toISOString()
    const { error: saveErr } = await supabase
      .from('tenants')
      .update({
        preview_premium_pages: composed,
        preview_premium_generated_at: generatedAt,
      })
      .eq('id', id)
    if (saveErr) {
      console.error('[PremiumPreview] Save failed:', saveErr.code, saveErr.message)
      return c.json({ error: 'Composition rendered but could not be saved. If this mentions a missing column, apply the preview_premium_pages migration.', detail: saveErr.message }, 500)
    }

    const origin = new URL(c.req.url).origin
    return c.json({
      ok: true,
      previewUrl: `${origin}/api/v1/factory/public/intake/${id}/preview-premium`,
      generatedAt,
      rationale: composed.rationale,
      sections: Object.fromEntries(
        Object.entries(composed.pages).map(([page, p]) => [
          page,
          (p as { sections: { type: string; variant: string }[] }).sections.map(s => s.type + '/' + s.variant),
        ])
      ),
    })
  } catch (err: any) {
    console.error('[PremiumPreview] Compose failed:', err?.message || err)
    return c.json({ error: 'Failed to compose preview', detail: err?.message }, 500)
  }
})

const PREMIUM_PAGE_TITLES: Record<string, string> = {
  home: 'Home', about: 'About', services: 'Services', contact: 'Contact',
  menu: 'Menu', schedule: 'Schedule', catering: 'Catering',
  strains: 'Strains', deals: 'Deals', visit: 'Visit',
  quote: 'Estimator', storm: 'Storm damage', projects: 'Projects',
  packages: 'Packages',
  'find-care': 'Find care', caregivers: 'Caregivers', coverage: 'Coverage',
  emergency: 'Emergency', pricing: 'Pricing',
  reservations: 'Reservations', 'private-dining': 'Private dining',
  // Salon / spa
  stylists: 'Our team', gallery: 'Gallery',
  // Fitness
  classes: 'Classes', trainers: 'Trainers',
  // Hotel
  rooms: 'Rooms', amenities: 'Amenities', local: 'The area',
  // Events / venue
  venue: 'The venue', vendors: 'Vendors',
}

// Nav labels per page slug. 'home' is omitted (it's the brand logo).
// 'contact' is omitted because the header CTA points to /contact already
// — including it in nav doubles up. Vertical-specific slugs get the
// human-readable label for the food truck / dispensary / etc.
const PREMIUM_PAGE_NAV_LABEL: Record<string, string> = {
  menu: 'Menu',
  services: 'Services',
  schedule: 'Find us',
  catering: 'Catering',
  strains: 'Strains',
  deals: 'Deals',
  visit: 'Visit',
  quote: 'Estimator',
  storm: 'Storm damage',
  projects: 'Projects',
  packages: 'Packages',
  'find-care': 'Find care',
  caregivers: 'Caregivers',
  coverage: 'Coverage',
  emergency: 'Emergency',
  pricing: 'Pricing',
  reservations: 'Reservations',
  'private-dining': 'Private dining',
  // Salon / spa
  stylists: 'Our team',
  gallery: 'Gallery',
  // Fitness
  classes: 'Classes',
  trainers: 'Trainers',
  // Hotel
  rooms: 'Rooms',
  amenities: 'Amenities',
  local: 'The area',
  // Events / venue
  venue: 'The venue',
  vendors: 'Vendors',
  about: 'About',
}

function buildPremiumNav(
  pageSlugs: string[],
  layoutMode: 'single-page' | 'multi-page' = 'multi-page',
): Array<{ label: string; href: string }> {
  // Stable per-vertical order: the thing they sell first (menu/services/
  // strains), then secondary funnels (find us/catering/deals/visit), then
  // about.
  const order = ['emergency', 'menu', 'services', 'rooms', 'venue', 'find-care', 'classes', 'packages', 'quote', 'pricing', 'reservations', 'private-dining', 'strains', 'caregivers', 'coverage', 'projects', 'storm', 'schedule', 'amenities', 'local', 'vendors', 'stylists', 'trainers', 'catering', 'deals', 'gallery', 'visit', 'about']
  const present = new Set(pageSlugs)
  const out: Array<{ label: string; href: string }> = []
  for (const slug of order) {
    if (present.has(slug) && PREMIUM_PAGE_NAV_LABEL[slug]) {
      // Single-page verticals use anchor hrefs (#menu) so the renderer's
      // path-prefix logic emits them as in-page links. Multi-page stays
      // with route hrefs which get prefixed with the preview base path.
      const href = layoutMode === 'single-page' ? '#' + slug : slug
      out.push({ label: PREMIUM_PAGE_NAV_LABEL[slug], href })
    }
  }
  // Single-page sites benefit from a "Contact" anchor link in nav since
  // there's no separate /contact page to navigate to via the header CTA.
  if (layoutMode === 'single-page' && present.has('contact')) {
    out.push({ label: 'Contact', href: '#contact' })
  }
  return out
}

async function renderPremiumPreviewPage(id: string, slug: string, c: any) {
  const { data: tenant } = await supabase
    .from('tenants')
    .select('name, email, phone, industry, preview_premium_pages, preview_premium_approved_at, intake_data')
    .eq('id', id)
    .maybeSingle()
  if (!tenant || !tenant.preview_premium_pages) {
    return c.html('<!doctype html><meta charset="utf-8"><title>Preview not ready</title><body style="font:16px system-ui;padding:40px">This preview hasn\'t been composed yet.</body>', 404)
  }
  // Staff approval gate. Public callers see a "pending review" page until
  // staff approves. Staff can bypass with the X-Staff-Bypass header so
  // the platform's review UI can preview pre-approval.
  const expectedBypass = process.env.STAFF_BYPASS_TOKEN || ''
  const bypassed = !!expectedBypass && c.req.header('X-Staff-Bypass') === expectedBypass
  if (!tenant.preview_premium_approved_at && !bypassed) {
    return c.html(
      '<!doctype html><meta charset="utf-8"><title>Preview pending review</title>' +
      '<body style="font:16px/1.6 system-ui;padding:60px 40px;max-width:560px;margin:auto;color:#334155">' +
      '<h1 style="font:600 28px Georgia,serif;color:#0f172a;margin-bottom:12px">Your preview is being reviewed</h1>' +
      '<p>We have your draft and someone is looking it over now. We\'ll email you within one business day once it\'s ready to share.</p>' +
      '<p style="color:#64748b;font-size:14px;margin-top:24px">If you don\'t hear from us, please email <a href="mailto:support@twomiah.com" style="color:#1e40af">support@twomiah.com</a>.</p>' +
      '</body>',
      404
    )
  }
  const composed = tenant.preview_premium_pages as { pages: Record<string, { sections: any[] }> }
  const composedPageSlugs = Object.keys(composed.pages || {})

  const { layoutModeFor } = await import('../../config/industryRouting')
  const layoutMode = layoutModeFor(tenant.industry)
  const isSinglePage = layoutMode === 'single-page'

  // Single-page verticals (food truck etc.) — every "page" the composer
  // produced becomes an anchor section on /. Sub-page URLs redirect to
  // /#slug so deep links still work, and the LLM doesn't have to know
  // anything about layout mode.
  if (isSinglePage && slug !== 'home') {
    const fragment = composedPageSlugs.includes(slug) ? '#' + slug : ''
    return c.redirect('/api/v1/factory/public/intake/' + id + '/preview-premium' + fragment, 302)
  }

  const intake = (tenant.intake_data && tenant.intake_data.intake) || {}

  // For single-page, sections are the concatenation of every composed
  // page wrapped with a section-anchor (id="<slug>") so the nav can
  // scroll to them. The hero of the home page stays first; subsequent
  // page heroes are demoted to section-eyebrow style by the renderer.
  let sectionsToRender: any[]
  if (isSinglePage) {
    sectionsToRender = []
    const order = ['home', 'menu', 'services', 'strains', 'schedule', 'catering', 'deals', 'about', 'visit', 'contact']
    const seen = new Set<string>()
    const walk = (key: string) => {
      const p = composed.pages?.[key]
      if (!p || seen.has(key)) return
      seen.add(key)
      const pageSections = (p.sections || []).map((s: any, i: number) => ({
        ...s,
        _onepageAnchor: i === 0 ? key : undefined,  // first section of each page gets the anchor id
      }))
      sectionsToRender.push(...pageSections)
    }
    for (const k of order) walk(k)
    // Catch-all: include any composed pages not in the canonical order.
    for (const k of composedPageSlugs) walk(k)
  } else {
    const page = composed.pages?.[slug]
    if (!page) return c.text('Page not found', 404)
    sectionsToRender = page.sections
  }

  const settings = {
    companyName: tenant.name || 'Your Company',
    tagline: intake.description ? String(intake.description).slice(0, 120) : undefined,
    phone: tenant.phone || intake.phone,
    email: tenant.email || intake.email,
    seoTitle: tenant.name,
    seoDescription: intake.description,
    nav: buildPremiumNav(composedPageSlugs, layoutMode),
    layoutMode,
  }

  const previewBasePath = `/api/v1/factory/public/intake/${id}/preview-premium`
  const templateDir = pickPremiumTemplateDir(tenant.industry)
  const rendered = await renderPremiumPage(
    { slug: isSinglePage ? 'home' : slug, title: PREMIUM_PAGE_TITLES[slug] || slug, sections: sectionsToRender },
    settings,
    previewBasePath,
    templateDir,
  )
  return c.html(rendered.html)
}

factory.get('/public/intake/:id/preview-premium', async (c) => {
  const id = c.req.param('id')
  if (!UUID_RE.test(id)) return c.text('Invalid preview link', 400)
  return renderPremiumPreviewPage(id, 'home', c)
})

factory.get('/public/intake/:id/preview-premium/:slug', async (c) => {
  const id = c.req.param('id')
  const slug = c.req.param('slug')
  if (!UUID_RE.test(id)) return c.text('Invalid preview link', 400)
  if (!/^[a-z0-9-]+$/.test(slug)) return c.text('Invalid page', 400)
  return renderPremiumPreviewPage(id, slug, c)
})

// Staff approval — flips the gate so the public preview link renders.
// Optionally PATCHes the composition first (staff can fix wording, swap
// section variants, etc. before approving). Sends the prospect the
// "preview is ready" email with the link.
factory.post('/intake/:id/approve-premium', requireRole('owner', 'admin', 'editor'), async (c) => {
  try {
    const id = c.req.param('id')
    if (!UUID_RE.test(id)) return c.json({ error: 'Invalid intake id' }, 400)

    const body = await c.req.json().catch(() => ({})) as { pages?: unknown }
    const userId = c.get('userId')

    const updates: Record<string, any> = {
      preview_premium_approved_at: new Date().toISOString(),
      preview_premium_approved_by: userId || null,
    }
    if (body.pages && typeof body.pages === 'object') {
      const { data: existing } = await supabase
        .from('tenants')
        .select('preview_premium_pages')
        .eq('id', id)
        .maybeSingle()
      if (!existing) return c.json({ error: 'Tenant not found' }, 404)
      const composed = (existing.preview_premium_pages || {}) as any
      composed.pages = body.pages
      updates.preview_premium_pages = composed
    }

    const { data: tenant, error: saveErr } = await supabase
      .from('tenants')
      .update(updates)
      .eq('id', id)
      .select('id, name, email')
      .single()
    if (saveErr || !tenant) {
      return c.json({ error: saveErr?.message || 'Tenant not found' }, saveErr ? 500 : 404)
    }

    const origin = new URL(c.req.url).origin
    const previewUrl = `${origin}/api/v1/factory/public/intake/${id}/preview-premium`
    if (tenant.email) {
      notifyPreviewReady({ to: tenant.email, businessName: tenant.name || 'your', previewUrl })
        .catch((e: any) => console.warn('[Email] Preview-ready notification failed:', e.message))
    }

    return c.json({ ok: true, previewUrl, emailedTo: tenant.email || null })
  } catch (err: any) {
    console.error('[ApprovePremium] Failed:', err?.message || err)
    return c.json({ error: err?.message || 'Could not approve preview' }, 500)
  }
})

// Staff: list pending premium compositions for the triage queue. A
// composition is "pending" when preview_premium_pages is set but
// preview_premium_approved_at is null.
factory.get('/intake/premium-queue', requireRole('owner', 'admin', 'editor'), async (c) => {
  const status = c.req.query('status') || 'pending'
  let query = supabase
    .from('tenants')
    .select('id, name, email, phone, city, state, industry, intake_data, preview_premium_pages, preview_premium_generated_at, preview_premium_approved_at, preview_premium_approved_by, created_at')
    .not('preview_premium_pages', 'is', null)
    .order('preview_premium_generated_at', { ascending: false })
    .limit(200)
  if (status === 'pending') {
    query = query.is('preview_premium_approved_at', null)
  } else if (status === 'approved') {
    query = query.not('preview_premium_approved_at', 'is', null)
  }
  const { data, error } = await query
  if (error) return c.json({ error: error.message }, 500)

  // Annotate each queue row with feedback counts so staff can see at-a-glance
  // which intakes are mid-revision-cycle. Best-effort — table may not be
  // migrated yet on some environments.
  const tenantIds = (data || []).map((r: any) => r.id)
  const feedbackByTenant: Record<string, { total: number; unprocessed: number }> = {}
  if (tenantIds.length > 0) {
    try {
      const { data: fb } = await supabase.from('intake_feedback')
        .select('tenant_id, status')
        .in('tenant_id', tenantIds)
      for (const row of (fb || []) as any[]) {
        const e = feedbackByTenant[row.tenant_id] || { total: 0, unprocessed: 0 }
        e.total++
        if (row.status === 'new' || row.status === 'reviewed') e.unprocessed++
        feedbackByTenant[row.tenant_id] = e
      }
    } catch { /* table may not exist yet */ }
  }

  const items = (data || []).map((row: any) => {
    const intake = (row.intake_data && row.intake_data.intake) || {}
    const pages = (row.preview_premium_pages?.pages || {}) as Record<string, { sections?: any[] }>
    const sectionCounts: Record<string, number> = {}
    for (const [name, page] of Object.entries(pages)) {
      sectionCounts[name] = Array.isArray(page?.sections) ? page.sections.length : 0
    }
    const fb = feedbackByTenant[row.id] || { total: 0, unprocessed: 0 }
    return {
      id: row.id,
      businessName: row.name || intake.businessName,
      businessType: row.industry || intake.businessType,
      city: row.city || intake.city,
      state: row.state || intake.state,
      email: row.email,
      composedAt: row.preview_premium_generated_at,
      approvedAt: row.preview_premium_approved_at,
      approvedBy: row.preview_premium_approved_by,
      sectionCounts,
      rationale: row.preview_premium_pages?.rationale || null,
      feedbackCount: fb.total,
      feedbackUnprocessed: fb.unprocessed,
    }
  })
  return c.json({ items })
})

// Staff: fetch all feedback rows for a single intake (chronological). Powers
// the feedback log in the premium-review detail view.
factory.get('/intake/:id/feedback', requireRole('owner', 'admin', 'editor'), async (c) => {
  const id = c.req.param('id')
  if (!UUID_RE.test(id)) return c.json({ error: 'Invalid intake id' }, 400)
  const { data, error } = await supabase.from('intake_feedback')
    .select('id, message, status, recomposed_at, created_at')
    .eq('tenant_id', id)
    .order('created_at', { ascending: true })
  if (error) {
    if (error.code === '42P01' || (error.message || '').toLowerCase().includes('intake_feedback')) {
      return c.json({ feedback: [], warning: 'intake_feedback table not migrated yet' })
    }
    return c.json({ error: error.message }, 500)
  }
  return c.json({ feedback: data || [] })
})

// Staff: full intake + composition for the detail view.
factory.get('/intake/:id/premium-detail', requireRole('owner', 'admin', 'editor'), async (c) => {
  const id = c.req.param('id')
  if (!UUID_RE.test(id)) return c.json({ error: 'Invalid intake id' }, 400)
  const { data, error } = await supabase
    .from('tenants')
    .select('id, name, email, phone, city, state, industry, intake_data, preview_premium_pages, preview_premium_generated_at, preview_premium_approved_at, preview_premium_approved_by')
    .eq('id', id)
    .maybeSingle()
  if (error) return c.json({ error: error.message }, 500)
  if (!data) return c.json({ error: 'Not found' }, 404)
  return c.json({ intake: data })
})

// Staff preview routes — same renderer as the public preview but
// bypasses the approval gate. Accepts the auth token via Authorization
// header OR ?token=<jwt> query param. Iframes can't add custom headers
// so the query-param path is necessary for the platform's review UI.
async function authStaffFromQueryOrHeader(c: any): Promise<{ ok: boolean; role?: string }> {
  const queryToken = c.req.query('token')
  const headerAuth = c.req.header('Authorization') || ''
  const headerToken = headerAuth.startsWith('Bearer ') ? headerAuth.slice(7) : ''
  const token = queryToken || headerToken
  if (!token) return { ok: false }
  try {
    const { data, error } = await supabase.auth.getUser(token)
    if (error || !data?.user) return { ok: false }
    const { data: factoryUser } = await supabase
      .from('factory_users').select('role').eq('auth_id', data.user.id).maybeSingle()
    const role = factoryUser?.role
    if (!role || !['owner', 'admin', 'editor'].includes(role)) return { ok: false }
    return { ok: true, role }
  } catch {
    return { ok: false }
  }
}

async function renderPremiumPreviewPageStaff(id: string, slug: string, c: any) {
  const { data: tenant } = await supabase
    .from('tenants')
    .select('name, email, phone, industry, preview_premium_pages, intake_data')
    .eq('id', id)
    .maybeSingle()
  if (!tenant || !tenant.preview_premium_pages) {
    return c.html('<!doctype html><meta charset="utf-8"><title>Preview not ready</title><body style="font:16px system-ui;padding:40px">This preview hasn\'t been composed yet.</body>', 404)
  }
  const composed = tenant.preview_premium_pages as { pages: Record<string, { sections: any[] }> }
  const page = composed.pages?.[slug]
  if (!page) return c.text('Page not found', 404)

  const intake = (tenant.intake_data && tenant.intake_data.intake) || {}
  const composedPageSlugs = Object.keys(composed.pages || {})
  const settings = {
    companyName: tenant.name || 'Your Company',
    tagline: intake.description ? String(intake.description).slice(0, 120) : undefined,
    phone: tenant.phone || intake.phone,
    email: tenant.email || intake.email,
    seoTitle: tenant.name,
    seoDescription: intake.description,
    nav: buildPremiumNav(composedPageSlugs),
  }

  // basePath is the STAFF route stem with the token preserved, so nav
  // links inside the rendered preview stay on the staff-bypass path
  // while reviewing.
  const token = c.req.query('token')
  const previewBasePath = `/api/v1/factory/intake/${id}/preview-premium-staff`
  const templateDir = pickPremiumTemplateDir(tenant.industry)
  let renderedHtml = (await renderPremiumPage(
    { slug, title: PREMIUM_PAGE_TITLES[slug] || slug, sections: page.sections },
    settings,
    previewBasePath,
    templateDir,
  )).html
  if (token) {
    // Append ?token=… to every same-origin nav href so the iframe can
    // navigate without losing auth. Only matches hrefs that start with
    // the previewBasePath we just emitted.
    renderedHtml = renderedHtml.replace(
      new RegExp('href="(' + previewBasePath.replace(/[/]/g, '\\/') + '[^"?#]*)"', 'g'),
      (_m, href) => 'href="' + href + '?token=' + encodeURIComponent(token) + '"'
    )
  }
  return c.html(renderedHtml)
}

factory.get('/intake/:id/preview-premium-staff', async (c) => {
  const id = c.req.param('id')
  if (!UUID_RE.test(id)) return c.text('Invalid preview link', 400)
  const auth = await authStaffFromQueryOrHeader(c)
  if (!auth.ok) return c.text('Unauthorized', 401)
  return renderPremiumPreviewPageStaff(id, 'home', c)
})

factory.get('/intake/:id/preview-premium-staff/:slug', async (c) => {
  const id = c.req.param('id')
  const slug = c.req.param('slug')
  if (!UUID_RE.test(id)) return c.text('Invalid preview link', 400)
  if (!/^[a-z0-9-]+$/.test(slug)) return c.text('Invalid page', 400)
  const auth = await authStaffFromQueryOrHeader(c)
  if (!auth.ok) return c.text('Unauthorized', 401)
  return renderPremiumPreviewPageStaff(id, slug, c)
})

// Staff: unapprove (reverts the gate). Useful if a composition was approved
// in error and staff needs to take it offline while fixing.
factory.post('/intake/:id/unapprove-premium', requireRole('owner', 'admin'), async (c) => {
  const id = c.req.param('id')
  if (!UUID_RE.test(id)) return c.json({ error: 'Invalid intake id' }, 400)
  const { error } = await supabase
    .from('tenants')
    .update({ preview_premium_approved_at: null, preview_premium_approved_by: null })
    .eq('id', id)
  if (error) return c.json({ error: error.message }, 500)
  return c.json({ ok: true })
})

// Internal: generate a Stripe Customer Portal session URL for the
// tenant's admin to manage their subscription, payment method, and
// invoices. The tenant's site server calls this from /api/internal/
// billing-portal authenticated by FACTORY_SYNC_KEY, then forwards the
// URL to the admin's Billing nav click.
factory.get('/internal/billing-portal/:tenantId', async (c) => {
  const tenantId = c.req.param('tenantId')
  if (!UUID_RE.test(tenantId)) return c.json({ error: 'Invalid tenant id' }, 400)
  const { data: tenant, error } = await supabase.from('tenants')
    .select('id, factory_sync_key, stripe_customer_id, website_url, render_frontend_url')
    .eq('id', tenantId)
    .single()
  if (error || !tenant) return c.json({ error: 'Tenant not found' }, 404)
  if (!checkFactoryKey(c, tenant)) return c.json({ error: 'Bad sync key' }, 401)
  if (!tenant.stripe_customer_id) return c.json({ error: 'No Stripe customer on this tenant yet — billing portal unavailable until first payment.' }, 409)
  const returnUrl = (tenant.website_url || tenant.render_frontend_url || 'https://twomiah.com').replace(/\/+$/, '') + '/admin/account'
  try {
    const session = await factoryStripe.createBillingPortalSession(tenant.stripe_customer_id, returnUrl)
    return c.json({ url: session.url })
  } catch (e: any) {
    console.error('[BillingPortal]', e.message)
    return c.json({ error: 'Could not create billing portal session: ' + e.message }, 500)
  }
})

// Path A++ — mint a single-use, 60s-TTL handoff JWT for SSO from the
// premium admin into the CRM admin. Signed with the tenant's
// factory_sync_key — same key the CRM has, so the CRM can verify
// without knowing about the factory. Audience claim scopes the token
// to the CRM specifically (token stolen + used against any other
// endpoint fails the aud check).
factory.get('/internal/crm-handoff/:tenantId', async (c) => {
  const tenantId = c.req.param('tenantId')
  if (!UUID_RE.test(tenantId)) return c.json({ error: 'Invalid tenant id' }, 400)
  const email = (c.req.query('email') || '').toLowerCase().trim()
  if (!email) return c.json({ error: 'email required' }, 400)
  const { data: tenant, error } = await supabase.from('tenants')
    .select('id, slug, industry, factory_sync_key, products')
    .eq('id', tenantId)
    .single()
  if (error || !tenant) return c.json({ error: 'Tenant not found' }, 404)
  if (!checkFactoryKey(c, tenant)) return c.json({ error: 'Bad sync key' }, 401)
  if (!(tenant.products || []).includes('crm')) return c.json({ error: 'No CRM on this tenant' }, 409)
  const { buildCrmApiHost } = await import('../../config/industryRouting')
  const crmHost = buildCrmApiHost(tenant.slug, tenant.industry || '')
  const jwtLib = (await import('jsonwebtoken')).default
  const token = jwtLib.sign(
    { sub: email, tenant_id: tenantId, aud: 'twomiah-crm', iss: 'twomiah-factory' },
    tenant.factory_sync_key,
    { expiresIn: '60s' }
  )
  return c.json({ url: 'https://' + crmHost + '/auth/handoff?token=' + encodeURIComponent(token) })
})

// Path A++ — create a Stripe Checkout session for the CRM add-on
// against the tenant's existing Stripe customer. The tenant's premium
// site calls this when the customer clicks "Add CRM — $49/mo" in
// their /billing page. We return a Checkout URL; the tenant redirects.
// On payment success, the customer lands back on the premium /billing
// page with ?crm=ordered, and the Stripe webhook auto-provisions the
// CRM via services/crmAddonProvision.ts. If auto-provision fails, staff
// get an alert email and run scripts/provision-crm-for-tenant.ts
// manually (24h SLA fallback).
factory.get('/internal/checkout/crm-addon/:tenantId', async (c) => {
  const tenantId = c.req.param('tenantId')
  if (!UUID_RE.test(tenantId)) return c.json({ error: 'Invalid tenant id' }, 400)
  const { data: tenant, error } = await supabase.from('tenants')
    .select('id, factory_sync_key, stripe_customer_id, products, website_url, render_frontend_url')
    .eq('id', tenantId)
    .single()
  if (error || !tenant) return c.json({ error: 'Tenant not found' }, 404)
  if (!checkFactoryKey(c, tenant)) return c.json({ error: 'Bad sync key' }, 401)
  if (!tenant.stripe_customer_id) return c.json({ error: 'No Stripe customer on this tenant yet — finish initial billing first.' }, 409)
  if ((tenant.products || []).includes('crm')) return c.json({ error: 'CRM is already active on this tenant.' }, 409)
  const priceId = process.env.STRIPE_PRICE_PREMIUM_CRM_ADDON
  if (!priceId) return c.json({ error: 'CRM add-on price not minted in Stripe yet — run create-stripe-products.ts.' }, 503)
  const returnBase = (tenant.website_url || tenant.render_frontend_url || '').replace(/\/+$/, '')
  if (!returnBase) return c.json({ error: 'Tenant has no site URL recorded.' }, 409)
  try {
    const session = await factoryStripe.createCheckoutSessionForExistingCustomer({
      customerId: tenant.stripe_customer_id,
      priceId,
      mode: 'subscription',
      successUrl: returnBase + '/admin/billing?crm=ordered',
      cancelUrl: returnBase + '/admin/billing?crm=cancelled',
      metadata: { tenant_id: tenantId, addon: 'crm' },
    })
    return c.json({ url: session.url })
  } catch (e: any) {
    console.error('[CrmAddonCheckout]', e.message)
    return c.json({ error: 'Could not create checkout: ' + e.message }, 500)
  }
})

// Internal: bootstrap payload for a freshly-deployed premium site.
// Called by the premium template's bin/seed.ts on first boot (after
// drizzle-kit push creates the schema). Returns the data needed to
// hydrate settings + pages + the initial admin user so the customer
// lands on their composed home page instead of the placeholder.
//
// Auth: X-Factory-Key header must match tenants.factory_sync_key. We
// generate that key during deploy and inject it as FACTORY_SYNC_KEY
// in the site service's env vars — same pattern as the CRM /api/
// internal/sync-features path.
factory.get('/internal/site-bootstrap/:tenantId', async (c) => {
  const tenantId = c.req.param('tenantId')
  if (!UUID_RE.test(tenantId)) return c.json({ error: 'Invalid tenant id' }, 400)
  const { data: tenant, error } = await supabase.from('tenants')
    .select('id, name, slug, email, admin_email, phone, city, state, address, industry, domain, primary_color, secondary_color, website_theme, factory_sync_key, admin_password, preview_premium_pages')
    .eq('id', tenantId)
    .single()
  if (error || !tenant) return c.json({ error: 'Tenant not found' }, 404)
  if (!checkFactoryKey(c, tenant)) return c.json({ error: 'Bad sync key' }, 401)

  const composed = (tenant.preview_premium_pages || {}) as { pages?: Record<string, { sections: any[] }> }
  const composedPages = composed.pages || {}

  // Page set is whatever the composer actually produced. Generic verticals
  // get home/about/services/contact; food trucks get home/menu/about/
  // schedule/catering/contact; future verticals will define their own.
  // Falls back to the generic 4-page set when no composition exists yet
  // (e.g. first boot before AI compose completes).
  const PAGE_TITLE_BY_SLUG: Record<string, string> = {
    home: 'Home', about: 'About', services: 'Services', contact: 'Contact',
    menu: 'Menu', schedule: 'Find us', catering: 'Catering',
  }
  const FALLBACK_SLUGS = ['home', 'about', 'services', 'contact']
  const composedSlugs = Object.keys(composedPages)
  const slugs = composedSlugs.length > 0 ? composedSlugs : FALLBACK_SLUGS
  const pages = slugs.map((slug, i) => ({
    slug,
    title: PAGE_TITLE_BY_SLUG[slug] || slug.charAt(0).toUpperCase() + slug.slice(1),
    sections: composedPages[slug]?.sections || [],
    navOrder: i,
    isPublished: true,
  }))

  // Standard CMS-defaults for a fresh tenant. The composer doesn't
  // currently emit settings — we synthesize them from the tenant row.
  const settings = {
    companyName: tenant.name,
    tagline: '',
    phone: tenant.phone || '',
    email: tenant.email || tenant.admin_email || '',
    address: [tenant.address, tenant.city, tenant.state].filter(Boolean).join(', '),
    primaryColor: tenant.primary_color || '#1a1a1a',
    secondaryColor: tenant.secondary_color || '#666666',
    accentColor: tenant.primary_color || '#1a1a1a',
    seoTitle: tenant.name,
    seoDescription: tenant.name + ' — Premium website',
    contactCtaLabel: 'Get in touch',
    // Nav derived from the page set the composer actually produced —
    // food trucks get Menu/Find us/Catering, generic verticals get
    // Services/About. Same buildPremiumNav helper used by the preview
    // endpoints above.
    nav: buildPremiumNav(pages.map(p => p.slug)),
  }

  // Note: admin credentials are NOT returned here. The seed reads them
  // from ADMIN_EMAIL + ADMIN_INITIAL_PASSWORD env vars (set by the
  // deploy). Writing the password to the tenant row would require an
  // extra UPDATE during deploy and adds nothing — the env-var path is
  // already populated by every deploy that runs initDb.ts.
  return c.json({ settings, pages })
})

// Public: status check used by the intake "we're composing" screen to
// poll until the preview is ready. Returns { ready, previewUrl } without
// leaking the full intake payload.
factory.get('/public/intake/:id/status', async (c) => {
  const id = c.req.param('id')
  if (!UUID_RE.test(id)) return c.json({ error: 'Invalid intake id' }, 400)
  const { data, error } = await supabase.from('tenants')
    .select('name, preview_premium_pages, preview_premium_generated_at, preview_premium_approved_at')
    .eq('id', id)
    .maybeSingle()
  if (error || !data) return c.json({ ready: false, error: 'Not found' }, 404)
  const ready = !!data.preview_premium_pages && !!data.preview_premium_approved_at
  const factoryUrl = process.env.TWOMIAH_FACTORY_URL || ''
  const previewUrl = ready && factoryUrl ? `${factoryUrl}/api/v1/factory/public/intake/${id}/preview-premium` : null
  return c.json({
    ready,
    businessName: data.name,
    generatedAt: data.preview_premium_generated_at,
    previewUrl,
  })
})

// Auto-compose path. Called from /public/intake right after the row
// lands. Mirrors the staff-triggered /intake/:id/preview-premium logic
// — pulls intake_data, signs customer photo URLs, fetches stock photos
// if configured, calls composeSite, saves preview_premium_pages, fires
// the preview-ready email. Idempotent: skips when the tenant already
// has preview_premium_pages set.
async function autoComposeForNewIntake(tenantId: string): Promise<void> {
  const { data: tenant, error } = await supabase.from('tenants')
    .select('id, name, email, industry, intake_data, preview_premium_pages')
    .eq('id', tenantId)
    .single()
  if (error || !tenant) {
    console.warn('[AutoCompose] tenant not found:', tenantId, error?.message)
    return
  }
  if (tenant.preview_premium_pages) {
    console.log('[AutoCompose] tenant ' + tenantId + ' already has a preview — skipping.')
    return
  }
  if (!tenant.intake_data) {
    console.warn('[AutoCompose] tenant ' + tenantId + ' has no intake_data — cannot compose.')
    return
  }

  const intake = (tenant.intake_data as any).intake || (tenant.intake_data as any)
  if (!intake?.businessName) {
    console.warn('[AutoCompose] no businessName on intake_data for ' + tenantId)
    return
  }

  // Customer-supplied photos: sign R2 keys so the composer (and Claude
  // via image-url-fetch eventually) can reach them.
  const SIGNED_TTL_SECONDS = 60 * 60 * 24 * 14  // 14d
  const customerPhotos: Array<{ url: string; tag?: string; alt?: string }> = []
  const intakeRoot = tenant.intake_data as any
  if (intakeRoot.logo?.storageKey) {
    const url = await getZipDownloadUrl(intakeRoot.logo.storageKey, intakeRoot.logo.storageType, SIGNED_TTL_SECONDS).catch(() => null)
    if (url) customerPhotos.push({ url, tag: 'misc', alt: intake.businessName + ' logo' })
  }
  if (Array.isArray(intakeRoot.photos)) {
    for (const ref of intakeRoot.photos) {
      if (!ref || !ref.storageKey) continue
      const url = await getZipDownloadUrl(ref.storageKey, ref.storageType, SIGNED_TTL_SECONDS).catch(() => null)
      if (url) customerPhotos.push({ url })
    }
  }

  const stockPhotos = await searchStockPhotosForBusiness(
    intake.businessType,
    Array.isArray(intake.services) && intake.services.length > 0 ? intake.services[0] : undefined,
    intake.city,
  ).catch(() => [])

  const composed = await composeSite({
    businessName: intake.businessName,
    businessType: intake.businessType,
    city: intake.city,
    state: intake.state,
    description: intake.description,
    services: intake.services,
    goals: intake.goals,
    competitors: intake.competitors,
    ownerName: intake.ownerName,
    phone: intake.phone,
    email: intake.email,
    nearbyCities: intake.nearbyCities,
    primaryColor: intake.branding?.primaryColor,
    customerPhotos,
    stockPhotos: (stockPhotos || []).map((p: any) => ({ url: p.url, tag: p.tag, alt: p.alt })),
  })

  for (const p of (stockPhotos || []) as any[]) {
    if (p.unsplashId) trackUnsplashDownload(p.unsplashId).catch(() => {})
  }

  const generatedAt = new Date().toISOString()
  await supabase.from('tenants').update({
    preview_premium_pages: composed,
    preview_premium_generated_at: generatedAt,
  }).eq('id', tenantId)

  // Email the prospect the preview link. We do NOT gate on staff approval
  // here — the self-serve flow assumes the AI output is fine to show and
  // staff steps in only when feedback comes back through the widget or
  // when a quality issue surfaces.
  const factoryUrl = process.env.TWOMIAH_FACTORY_URL || ''
  if (factoryUrl && tenant.email) {
    const previewUrl = `${factoryUrl}/api/v1/factory/public/intake/${tenantId}/preview-premium`
    // For auto-compose we DO need to pre-approve so the public preview
    // URL doesn't 401. Mark approved_at as the compose time.
    await supabase.from('tenants').update({
      preview_premium_approved_at: generatedAt,
    }).eq('id', tenantId)
    notifyPreviewReady({
      to: tenant.email,
      businessName: tenant.name,
      previewUrl,
    }).catch((e: any) => console.warn('[Email] auto-compose preview-ready failed:', e.message))
  }
  console.log('[AutoCompose] tenant=' + tenantId + ' composed in self-serve mode, preview at ' + generatedAt)
}

// Public: customer feedback on a premium-website preview. The "Request
// changes" widget on the preview page POSTs here. We save the message
// and email staff so they can review and trigger a recompose (or edit
// the preview JSON directly in the Premium Review page).
//
// Rate-limited per IP to make brigading the inbox harder.
factory.post('/public/intake/:id/feedback', rateLimit(60 * 60 * 1000, 20), async (c) => {
  const id = c.req.param('id')
  if (!UUID_RE.test(id)) return c.json({ error: 'Invalid intake id' }, 400)
  const body = await c.req.json().catch(() => ({})) as { message?: string }
  const message = (body.message || '').toString().trim()
  if (!message) return c.json({ error: 'Tell us what you would like changed.' }, 400)
  if (message.length > 4000) return c.json({ error: 'Please keep feedback under 4000 characters.' }, 400)

  const { data: tenant, error: tErr } = await supabase.from('tenants')
    .select('id, name, email, preview_premium_pages')
    .eq('id', id)
    .single()
  if (tErr || !tenant) return c.json({ error: 'Preview not found.' }, 404)
  if (!tenant.preview_premium_pages) {
    return c.json({ error: 'No preview composed yet — nothing to give feedback on.' }, 400)
  }

  const { error: insertErr } = await supabase.from('intake_feedback').insert({
    tenant_id: id,
    message,
    status: 'new',
  })
  if (insertErr) {
    const missingCol = insertErr.code === '42P01' || (insertErr.message || '').toLowerCase().includes('intake_feedback')
    if (missingCol) {
      return c.json({ error: 'Feedback table not migrated yet. Run apps/api/migrations/2026-06-05_intake_feedback.sql in Supabase.' }, 503)
    }
    console.error('[Feedback] insert failed:', insertErr)
    return c.json({ error: 'Could not save your feedback. Please try again or email support@twomiah.com.' }, 500)
  }

  notifyIntakeFeedback({
    businessName: tenant.name,
    intakeId: tenant.id,
    message,
    contactEmail: tenant.email || undefined,
  }).catch((e: any) => console.warn('[Email] Feedback notification failed:', e.message))

  // Staff-routed only. Auto-recompose was removed 2026-06-07 — the
  // right path for content tweaks (swap a photo, edit copy, change a
  // service title) is the post-purchase customizer where the customer
  // self-edits. The feedback widget is for situations the customizer
  // can't address: "you got my industry wrong", "the whole vibe is off",
  // "I want a different vertical". Staff reviews each one and triggers
  // a recompose via the staff queue if needed. Keeping this gated behind
  // a human prevents runaway AI cost AND prevents customers from
  // training themselves to ask the AI for things they should do
  // themselves once the site is live.
  return c.json({ success: true, message: "Got it — someone on our team will read this and follow up by email within one business day." })
})

// Re-runs the composer using the original intake_data + every piece of
// feedback that's been submitted on this intake, in chronological order.
// Treats feedback as a mandate ('act on all of it', not as suggestions),
// then saves the new pages to preview_premium_pages and emails the
// customer a refreshed preview link. Resets preview_premium_approved_at
// because the new draft hasn't been re-approved by staff.
async function recomposePreviewWithFeedback(tenantId: string): Promise<void> {
  const { data: tenant, error } = await supabase.from('tenants')
    .select('id, name, email, industry, intake_data')
    .eq('id', tenantId)
    .single()
  if (error || !tenant || !tenant.intake_data) {
    console.warn('[Recompose] No intake_data on tenant ' + tenantId + ' — cannot recompose')
    return
  }

  const { data: fbRows } = await supabase.from('intake_feedback')
    .select('message')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: true })
  const feedbackHistory = (fbRows || []).map(r => String((r as any).message || '')).filter(Boolean)
  if (feedbackHistory.length === 0) return  // nothing to act on (shouldn't happen, but safe)

  const intake = tenant.intake_data as any
  const composed = await composeSite({
    businessName: intake.businessName || tenant.name,
    businessType: intake.businessType || tenant.industry || 'business',
    city: intake.city,
    state: intake.state,
    description: intake.description,
    services: intake.services,
    goals: intake.goals,
    competitors: intake.competitors,
    ownerName: intake.ownerName,
    phone: intake.phone,
    email: intake.email,
    nearbyCities: intake.nearbyCities,
    primaryColor: intake.branding?.primaryColor,
    feedbackHistory,
  })

  const generatedAt = new Date().toISOString()
  await supabase.from('tenants').update({
    preview_premium_pages: composed,
    preview_premium_generated_at: generatedAt,
    preview_premium_approved_at: null,         // re-review required
    preview_premium_approved_by: null,
  }).eq('id', tenantId)

  await supabase.from('intake_feedback').update({ status: 'recomposed', recomposed_at: generatedAt })
    .eq('tenant_id', tenantId).in('status', ['new', 'reviewed'])

  if (tenant.email) {
    const factoryUrl = process.env.TWOMIAH_FACTORY_URL || ''
    const previewUrl = factoryUrl ? `${factoryUrl}/api/v1/factory/public/intake/${tenantId}/preview-premium` : ''
    if (previewUrl) {
      notifyPreviewReady({
        to: tenant.email,
        businessName: tenant.name,
        previewUrl,
      }).catch((e: any) => console.warn('[Email] Recompose preview-ready failed:', e.message))
    }
  }
  console.log('[Recompose] tenant=' + tenantId + ' feedback_count=' + feedbackHistory.length + ' new preview saved')
}

// Public: "Approve & buy" action on the premium preview. Creates a Stripe
// Checkout session for the standalone $1k build + $75/mo subscription
// (with optional $499 launch coupon applied automatically), marks the
// tenant's products to include 'website-premium' so the eventual deploy
// picks the right template, and returns the Stripe URL the prospect's
// browser redirects to.
//
// Rate-limited because the only thing standing between the public web and
// Stripe Checkout creation is this endpoint. Per-IP limit is intentionally
// loose — a prospect may legitimately click buy more than once.
factory.post('/public/intake/:id/checkout-premium', rateLimit(60 * 60 * 1000, 10), async (c) => {
  try {
    const id = c.req.param('id')
    if (!UUID_RE.test(id)) return c.json({ error: 'Invalid intake id' }, 400)

    const body = await c.req.json().catch(() => ({})) as { billingCycle?: 'monthly' | 'annual' }
    const billingCycle: 'monthly' | 'annual' = body.billingCycle === 'annual' ? 'annual' : 'monthly'

    const { data: tenant } = await supabase
      .from('tenants')
      .select('*')
      .eq('id', id)
      .maybeSingle()
    if (!tenant) return c.json({ error: 'Intake not found' }, 404)
    if (!tenant.preview_premium_pages) {
      return c.json({ error: 'Preview must be composed before checkout.' }, 422)
    }

    // Mark products so the eventual deploy picks the website-premium
    // template. Note: 'website' MUST stay in products — the generator's
    // premium branch is INSIDE `if (products.includes('website'))`, so
    // dropping 'website' would skip the entire website pipeline.
    const productsSet = new Set<string>(Array.isArray(tenant.products) ? tenant.products : [])
    productsSet.add('website')
    productsSet.add('website-premium')
    productsSet.add('cms')
    const products = Array.from(productsSet)
    if (JSON.stringify(products) !== JSON.stringify(tenant.products || [])) {
      await supabase.from('tenants').update({ products }).eq('id', id)
    }

    // Generate the build NOW so a factory_jobs row exists when the Stripe
    // webhook calls triggerAutoDeploy on checkout.session.completed. The
    // generate step is fast (~seconds) and idempotent — if a build already
    // exists for this tenant, we skip and reuse. Without this, payment
    // succeeds but the deploy never fires (triggerAutoDeploy bails on
    // "No build found for tenant").
    const { data: existingJob } = await supabase
      .from('factory_jobs')
      .select('id, status')
      .eq('tenant_id', id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!existingJob) {
      const intake = (tenant.intake_data && tenant.intake_data.intake) || {}
      const genConfig: GenerateConfig = {
        tenant_id: tenant.id,
        products,
        company: {
          name: intake.businessName || tenant.name || '',
          email: intake.email || tenant.email || undefined,
          phone: intake.phone || tenant.phone || undefined,
          city: intake.city || tenant.city || undefined,
          state: intake.state || tenant.state || undefined,
          stateFull: intake.stateFull || undefined,
          industry: 'general_contractor',  // routes to website-premium-contractor; #26 generalizes
          ownerName: intake.ownerName || undefined,
          serviceRegion: intake.serviceRegion || undefined,
          nearbyCities: intake.nearbyCities || undefined,
          description: intake.description || undefined,
          domain: intake.domain || tenant.domain || undefined,
          plan: 'premium',
        },
        branding: {
          primaryColor: intake.branding?.primaryColor || '#1a2e22',
          secondaryColor: intake.branding?.secondaryColor || '#0f1f17',
        },
        features: { website: [], crm: [] },
      }
      try {
        const genResult = await generate(genConfig)
        const storage = await uploadZip(genResult.zipPath, genResult.zipName)
        const jobRecord: Record<string, any> = {
          tenant_id: tenant.id,
          template: products.join('+'),
          deployment_model: 'saas',
          status: 'pending',
          features: [],
          branding: genConfig.branding,
          build_id: genResult.buildId,
          zip_name: genResult.zipName,
          storage_key: storage.storageKey,
          storage_type: storage.storageType,
        }
        const { error: jobErr } = await supabase.from('factory_jobs').insert({ ...jobRecord, config: genConfig })
        if (jobErr) {
          if (jobErr.code === '42703') {
            await supabase.from('factory_jobs').insert(jobRecord)
          } else {
            console.error('[CheckoutPremium] Build-row insert failed:', jobErr.message)
            return c.json({ error: 'Could not record the build. Try again or email support@twomiah.com.' }, 500)
          }
        }
      } catch (genErr: any) {
        console.error('[CheckoutPremium] generate() failed:', genErr.message)
        return c.json({ error: 'Could not generate the build for checkout. ' + (genErr.message || '') }, 500)
      }
    }

    const checkout = await factoryStripe.createPremiumWebsiteCheckout(
      {
        id: tenant.id,
        email: tenant.email || undefined,
        name: tenant.name || undefined,
        phone: tenant.phone || undefined,
        stripeCustomerId: tenant.stripe_customer_id || undefined,
      },
      { billingCycle, intakeId: id }
    )
    if (!checkout.url) return c.json({ error: 'Stripe did not return a checkout URL' }, 502)

    if (!tenant.stripe_customer_id && checkout.stripeCustomerId) {
      await supabase.from('tenants').update({ stripe_customer_id: checkout.stripeCustomerId }).eq('id', id)
    }

    return c.json({ ok: true, url: checkout.url, billingCycle })
  } catch (err: any) {
    console.error('[CheckoutPremium] Failed:', err?.message || err)
    return c.json({ error: err?.message || 'Could not start checkout' }, 500)
  }
})

}
