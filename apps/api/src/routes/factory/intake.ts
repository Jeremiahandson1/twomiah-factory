import { supabase } from '../../middleware/auth'
import { generate, type GenerateConfig } from '../../services/generator'
import factoryStripe from '../../services/factoryStripe'
import { pushSubscriptionToTenant } from '../../services/tenantSubscription'
import { uploadZip, uploadIntakeAsset } from '../../services/factoryStorage'
import { raiseAlert, clearAlert } from '../../services/alerts'
import { notifyWelcome, notifyTrialWarning, notifyTrialExpired, notifyProvisionFailure } from '../../services/email'
import path from 'path'
import { getRegistrar, isRegistrarConfigured } from '../../services/registrar'
import { buildBrief, type Intake } from '../../services/briefBuilder'
import { renderHomepagePreview } from '../../services/previewRenderer'
import { cacheGet, cacheSet, acquireInflight, releaseInflight } from '../../lib/previewGuard'
import { type ContentGap } from '../../services/composerFacts'
import { renderPremiumPage, pickPremiumTemplateDir } from '../../services/premiumSiteRenderer'
import { collectImageUrls, heroCreditsForUrls, mergeCredits } from '../../config/heroLibrary'
import { buildPremiumNav, premiumSitePages, premiumServiceAreas } from '../../services/premiumSitePages'
import { composeInstant } from '../../services/instantComposer'
import { type FactoryApp, rateLimit, checkCronSecret, checkFactoryKey, UUID_RE, DOMAIN_RE, parseJsonBody } from './shared'
import { runDeploy, triggerAutoDeploy } from './deploy'
import { engineForSignup, isUnifiedTenant, isOwnerTestEmail, signupRefusal } from '../../unified/factory'
import { renderUnifiedPreview, unifiedPreviewVertical } from '../../unified/preview'
import { requestedLook } from '../../config/siteLooks'
import { signupComposerInput, signupComposition, composeSignupSite, liveSignupSiteDeps, resumeSignupComposes, storeSignupPhoto, SIGNUP_PHOTO_FILE } from '../../services/signupSite'
import { intakeAssetLink } from '../../services/factoryStorage'
import { crmTemplateFor, deployProductsForVertical, startingFeaturesFor, verticalFor } from '../../config/industryRouting'
import { signupEmail, signupProductList, signupFeatureList, signupSlug, SIGNUP_HEX_RE, SIGNUP_PLAN_RE, NOT_PASTED_AS_TYPED } from '../../services/signupBody'
import { MESSAGING_ENABLE_MONTHLY_CENTS } from '../../config/messagingCosts'
import { stateTimezone, notesWithTimezone } from '../../config/stateTimezone'
import { allocateSlug, signupSlugCandidates, liveSlugLookups } from '../../services/resourceOwnership'
// What a signup asked for beyond the plan — known values only, and only the questions this industry's system is asked
// (bookings where online_booking exists, online payments where online_payments does).
import { signupChoices } from '../../config/signupQuestions'
import { WEB_PRESENCE_PLAN_ID } from '../../webPresence/switch'
import { liveWebPresenceSignup } from '../../webPresence/signupLive'

export function registerIntakeRoutes(factory: FactoryApp) {

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
        pushSubscriptionToTenant(t.id).catch(() => {})  // the CRM's trial gate mirrors this
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
    // What it costs — the first year and every year after — before anyone pays (services/domainQuote.ts, 10/15).
    // null: a TLD we do not sell, or Namecheap could not say; the buy route refuses those with its own message.
    const { quoteDomain, pricedSuggestions } = await import('../../services/domainQuote')
    // If the customer's first pick is available, ship that and skip the
    // expensive batch call. Keeps Namecheap quota low for the happy path.
    if (primary.available) return c.json({ ...primary, quote: primary.premium ? null : await quoteDomain(registrar, domain), suggestions: [] })

    const variants = generateDomainVariants(domain)
    const batched = variants.length > 0 ? await registrar.checkBatch(variants) : []
    // Endings that renew close to their first-year price come first; one we cannot price is not offered.
    const suggestions = await pricedSuggestions(registrar, batched.filter(x => x.available && !x.premium), 8)
    return c.json({ ...primary, quote: null, suggestions })
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

// Images a public signup may send in body.branding, as data URLs (the generator writes them into
// the site and CRM). Raster only — an SVG served from the tenant's own domain can run script —
// and size-capped; the signup pages downscale before sending. Anything else is dropped, not
// rejected, so a bad file never costs the customer their signup.
const SIGNUP_IMAGE_RE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/
function signupImages(b: any): { logo?: string; favicon?: string; heroPhoto?: string } {
  const ok = (v: any, maxChars: number) => typeof v === 'string' && v.length <= maxChars && SIGNUP_IMAGE_RE.test(v) ? v : undefined
  if (!b || typeof b !== 'object') return {}
  const out: { logo?: string; favicon?: string; heroPhoto?: string } = {}
  const logo = ok(b.logo, 1_500_000), favicon = ok(b.favicon, 300_000), heroPhoto = ok(b.heroPhoto, 4_000_000)
  if (logo) out.logo = logo
  if (favicon) out.favicon = favicon
  if (heroPhoto) out.heroPhoto = heroPhoto
  return out
}

// The services the owner says they offer (signup's checklist + "add your own"). The site's
// services section is built from exactly these (generator injectWizardContent); with none
// it shows one card for the owner's trade. Names only: trimmed, markup/token characters
// stripped, de-duplicated, capped. Anything else is dropped, not rejected.
// The website a signup builds — and the twomiah.com instant preview shows, so the two can never
// differ. SIGNUP_WEBSITE_ENGINE=premium (a factory env var, flipped on Render): the premium site,
// composed instantly from the signup's answers (instantComposer) and deployed on its own disk.
// Unset: the standard template, as before. Flipping it back is the rollback.
/** A short free-text signup answer, trimmed and capped; anything that is not a string is no answer. */
function signupText(v: unknown, max = 80): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined
}

function signupWebsiteEngine(): 'premium' | 'standard' {
  return String(process.env.SIGNUP_WEBSITE_ENGINE || '').trim().toLowerCase() === 'premium' ? 'premium' : 'standard'
}

function signupServices(v: any): string[] {
  if (!Array.isArray(v)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const s of v) {
    if (typeof s !== 'string') continue
    const name = s.replace(/[<>{}\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60)
    const key = name.toLowerCase()
    if (name.length < 2 || seen.has(key)) continue
    seen.add(key)
    out.push(name)
    if (out.length >= 12) break
  }
  return out
}

// Is an industry open for sign-ups? The signup form asks when the owner picks one, so an industry not yet open is
// said so up front instead of only at submit (unified/factory.ts signupRefusal, the same rule /public/signup applies).
factory.get('/public/signup/industry-open', rateLimit(10 * 60 * 1000, 60), (c) => {
  const refusal = signupRefusal({ industry: String(c.req.query('industry') || '').slice(0, 80) })
  return c.json(refusal ? { open: false, message: refusal } : { open: true })
})

// The owner's signup photo, by the lasting address the site's pages carry (services/signupSite.ts storeSignupPhoto):
// a fresh signed link to the stored file each time, so the picture never outlives its link. Only the signup photo's
// own name shape is served — nothing else in intake storage is reachable through it.
factory.get('/public/signup-photo/:slug/:file', async (c) => {
  const slug = c.req.param('slug') || '', file = c.req.param('file') || ''
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) || slug.length > 100 || !SIGNUP_PHOTO_FILE.test(file)) return c.json({ error: 'Not found' }, 404)
  const link = await intakeAssetLink(slug, file, 60 * 60).catch(() => null)
  if (!link) return c.json({ error: 'Not found' }, 404)
  if ('url' in link) {
    c.header('Cache-Control', 'public, max-age=1800')
    return c.redirect(link.url, 302)
  }
  const type = file.endsWith('.png') ? 'image/png' : file.endsWith('.webp') ? 'image/webp' : 'image/jpeg'
  return new Response(Bun.file(link.path), { headers: { 'Content-Type': type, 'Cache-Control': 'public, max-age=1800' } })
})

factory.post('/public/signup', rateLimit(60 * 60 * 1000, 5), async (c) => {
  let signupName: string | null = null
  try {
    const parsed = await parseJsonBody(c)
    if (parsed.error) return parsed.error
    const body = parsed.data
    signupName = typeof body.name === 'string' ? body.name.trim().slice(0, 80) || null : null

    if (!body.name || typeof body.name !== 'string' || body.name.trim().length < 2) {
      return c.json({ error: 'Company name is required (min 2 characters)' }, 400)
    }
    const signupAddress = signupEmail(body.email)
    if (!signupAddress) {
      return c.json({ error: 'Valid email is required' }, 400)
    }
    body.email = signupAddress
    // The look they chose in the preview (foundry, heritage or studio); anything else is refused, nothing sent is the trade's own.
    const look = requestedLook(body.design)
    if (!look.ok) return c.json({ error: 'Unknown design.' }, 400)

    // The $19 Web presence plan: its own, much smaller signup (no CRM, no Render build). Off (the default) it answers 404, as if it did not exist.
    if (body.plan === WEB_PRESENCE_PLAN_ID) {
      const r = await liveWebPresenceSignup(body, look.design, signupServices(body.services))
      return c.json(r.body as any, r.status as any)
    }

    // Every other answer, to its own shape (S5-7, above). From here on `body` holds only checked values.
    body.name = body.name.trim().slice(0, 120)
    if (body.admin_email != null && body.admin_email !== '') {
      const adminAddress = signupEmail(body.admin_email)
      if (!adminAddress) return c.json({ error: 'Valid email is required' }, 400)
      body.admin_email = adminAddress
    } else body.admin_email = undefined
    if (body.plan != null && body.plan !== '' && !(typeof body.plan === 'string' && SIGNUP_PLAN_RE.test(body.plan))) return c.json({ error: 'Unknown plan.' }, 400)
    if (body.admin_password != null && !(typeof body.admin_password === 'string' && body.admin_password.length <= 200)) return c.json({ error: 'That password is too long.' }, 400)
    for (const [key, max] of [['slug', 60], ['phone', 40], ['industry', 80], ['address', 300], ['city', 120], ['state', 80], ['zip', 20], ['website_theme', 60], ['notes', 2000]] as const) body[key] = signupText(body[key], max)
    body.primary_color = typeof body.primary_color === 'string' && SIGNUP_HEX_RE.test(body.primary_color.trim()) ? body.primary_color.trim() : undefined
    body.deployment_model = body.deployment_model === 'owned' ? 'owned' : 'saas'
    // Stripe's price for the plan is what is charged (factoryStripe.createSubscriptionCheckout) and what the paid webhook records;
    // the form's own figure is only what the dashboard shows until then.
    body.monthly_amount = typeof body.monthly_amount === 'number' && Number.isFinite(body.monthly_amount) && body.monthly_amount >= 0 && body.monthly_amount <= 100_000 ? body.monthly_amount : null
    body.products = signupProductList(body.products)
    body.features = signupFeatureList(body.features, body.industry)
    // Only a domain the owner says they have, checked below; any other text sent as "domain" is nothing.
    if (body.domainMode !== 'byod') body.domain = undefined

    // Going live per industry (unified/factory.ts signupRefusal): while UNIFIED_LIVE_VERTICALS is set, a real signup
    // for an industry not yet open is refused here, before anything is made, rather than started on the templates and
    // moved later. Unset (the default), nothing is refused.
    const refusal = signupRefusal({ industry: body.industry, email: body.email, admin_email: body.admin_email })
    if (refusal) return c.json({ error: refusal, code: 'INDUSTRY_NOT_OPEN' }, 422)

    // The slug names the repo, the services and the database: letters, digits and dashes only, whoever typed it (S5-7).
    const baseSlug = signupSlug(body.slug) || signupSlug(body.name)
    if (!baseSlug) return c.json({ error: 'Company name is required (min 2 characters)' }, 400)

    // Check for duplicate slug
    const { data: existing } = await supabase.from('tenants').select('id').eq('slug', baseSlug).maybeSingle()
    if (existing) {
      return c.json({ error: 'A company with a similar name already exists. Please contact support or use a different name.' }, 409)
    }

    // The slug names the tenant's GitHub repo, Render services and database, so it is free only when none of THOSE
    // exist either — Amber Inn (10/17) was handed "amber-inn" while a hand-built repo, site and database held the
    // name, and the deploy deleted them. Taken → the next suffix (-2, -3 …). A lookup that fails counts as taken.
    const allocated = await allocateSlug(signupSlugCandidates(baseSlug), liveSlugLookups(supabase))
    if (allocated.skipped.length) console.log('[Signup] Slug candidates skipped:', JSON.stringify(allocated.skipped))
    if (!allocated.slug) {
      return c.json({ error: 'We could not reserve a name for your account just now. Please try again in a few minutes.' }, 503)
    }
    const slug = allocated.slug

    // ─── Domain mode handling ─────────────────────────────────────────────────
    // domainMode: 'skip' (default, no domain) | 'byod' (customer owns domain).
    //
    // 'buy' used to register a domain at Namecheap right here — on OUR account, before any payment, from a public,
    // unauthenticated endpoint. Nothing legitimate sent it (the signup forms only offer "a domain you have"), but anyone
    // could, five times an hour per address. Refused now: a domain is bought after sign-up, from the website's custom
    // domain page, where Stripe takes the money first and the paid webhook registers it. (10/14)
    if (body.domainMode === 'buy') {
      return c.json({ error: 'Domains are bought after sign-up, from your website settings. Leave the domain blank, or enter one you already own.' }, 400)
    }
    const domainMode: 'skip' | 'byod' = body.domainMode === 'byod' ? 'byod' : 'skip'
    let resolvedDomain: string | null = null
    let resolvedRegistrar: string | null = null

    if (domainMode === 'byod') {
      const d = typeof body.domain === 'string' ? body.domain.trim().toLowerCase() : ''
      if (!d || !DOMAIN_RE.test(d)) return c.json({ error: 'Invalid domain format for BYOD' }, 400)
      resolvedDomain = d
      resolvedRegistrar = 'byod'
      body.domain = d
    }

    // Pay-then-deploy: the tenant is created 'pending' / awaiting-payment.
    // NOTHING is deployed until Stripe checkout completes — the webhook
    // (checkout.session.completed → triggerAutoDeploy) provisions the real
    // site + CRM only after the card is charged. No free trial: the free
    // homepage preview is the "try before you buy," and the CRM carries a
    // 30-day money-back guarantee (a refund policy, not a deployed trial).
    // Premium website (the switch is on): the products the premium deploy builds, and the site,
    // composed now from these answers — stored where the premium path keeps a composition
    // (preview_premium_pages), so site-bootstrap seeds the deployed site with exactly it. A retail
    // store keeps its storefront; a signup with no website (none today) keeps what it asked for.
    const requestedProducts: string[] = Array.isArray(body.products) && body.products.length ? body.products : ['crm', 'website']
    const premiumSite = signupWebsiteEngine() === 'premium' && verticalFor(body.industry) !== 'store'
      && requestedProducts.some((x) => String(x).startsWith('website'))
    const signupProducts = premiumSite ? deployProductsForVertical(body.industry, requestedProducts) : requestedProducts
    // Which engine builds this business — decided once, here, from UNIFIED_SIGNUPS and UNIFIED_LIVE_VERTICALS
    // (unified/factory.ts). Off (the default): 'templates', and this signup runs exactly as it always has.
    const engine = engineForSignup({ industry: body.industry, email: body.email, admin_email: body.admin_email })
    // The templates generator writes the owner's password into the site's first-run settings as typed (below), so there it
    // may not hold a character that is code syntax. A unified signup's is hashed and may be anything. (S5-7)
    if (engine !== 'unified' && typeof body.admin_password === 'string' && NOT_PASTED_AS_TYPED.test(body.admin_password)) {
      return c.json({ error: 'Please choose a password without quotes, backslashes, brackets or a $ sign.' }, 400)
    }
    const ownerPasswordHash = engine === 'unified' && typeof body.admin_password === 'string' && body.admin_password
      ? await (await import('bcryptjs')).default.hash(body.admin_password, 10) : null
    // A store on the unified app gets a site too: its home is its products (the built-in shop), with a contact page —
    // skipping it left a store's front door a "coming soon" with no way to the shop (store live test, 2026-10-26).
    const unifiedSite = engine === 'unified'
      && requestedProducts.some((x) => String(x).startsWith('website'))
    // The site (services/signupSite.ts): the trade's template composition stored now — no model call, so neither the
    // signup nor the checkout waits — and the AI builder's composition of the same answers started after the insert;
    // the build uses the AI's when it is ready and the template one otherwise.
    // The owner's photo ("It becomes the big picture at the top of your website") is stored with the intake's assets
    // and reaches both composers by its lasting address — never as the data URL it arrived as.
    let premiumPages: Record<string, any> | null = null
    let ownPhoto: Awaited<ReturnType<typeof storeSignupPhoto>> = null
    if (premiumSite || unifiedSite) {
      const heroPhoto = signupImages(body.branding).heroPhoto
      if (heroPhoto) {
        const factoryUrl = (process.env.TWOMIAH_FACTORY_URL || process.env.FACTORY_PUBLIC_URL || new URL(c.req.url).origin).replace(/\/+$/, '')
        ownPhoto = await storeSignupPhoto(heroPhoto, slug, { upload: uploadIntakeAsset, factoryUrl })
          .catch((e: any) => { console.warn('[Signup] Photo could not be stored (the site uses a library photo):', e?.message); return null })
      }
      premiumPages = signupComposition(
        signupComposerInput(body, {
          services: signupServices(body.services), goals: signupChoices(body).goals,
          photos: ownPhoto ? [{ url: ownPhoto.url, tag: 'hero', alt: body.name.trim() }] : [],
        }),
        { ai: true },
      )
    }

    const signupZone = stateTimezone(body.state)
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
      // set when a domain we registered is attached (paid webhook / register-at-cost), never at signup
      domain_expires_at: null,
      primary_color: body.primary_color || '#FF3D00',
      plan: body.plan || 'starter10',
      deployment_model: body.deployment_model || 'saas',
      billing_type: 'subscription',
      billing_status: 'pending',
      monthly_amount: body.monthly_amount || null,
      status: 'pending',
      products: [...signupProducts],
      ...(premiumPages ? { preview_premium_pages: premiumPages } : {}),
      // The signup pages send no list, so the business starts with its industry's whole ready CRM
      // (getDefaultFeaturesForTemplate: everything the template offers except paid add-ons and not-ready features).
      // A unified signup starts with the unified app's preset for its industry (a restaurant's or a food truck's food
      // side; industryRouting.ts startingFeaturesFor).
      features: (Array.isArray(body.features) && body.features.length)
        ? body.features
        : startingFeaturesFor(body.industry, { unified: engine === 'unified' }),
      // The zone the CRM will run on — its state's (config/stateTimezone.ts), not the form's Timezone select, which
      // starts on Eastern and reached us only as text in these notes (Run 4: a Wisconsin agency recorded as Eastern).
      notes: notesWithTimezone(body.notes, signupZone),
      // THE OWNER'S PASSWORD IS NEVER STORED AS TYPED (security review S5-1, 2026-11-13). It sat in this row in plain
      // text from signup until the build finished — for ever on a signup that never built — and the row was readable
      // with the dashboard's public key. A unified signup's is hashed here, now (bcrypt, what its app checks); the
      // build hands the hash on as it is (unified/factory.ts). A templates signup still carries it as typed, because
      // that generator writes it into the site's own first-run settings; it is scrubbed when the build ends.
      admin_password: engine === 'unified' ? ownerPasswordHash : (body.admin_password || null),
      website_theme: body.website_theme || null,
      // Only a unified signup names its engine; every other row takes the column's default ('templates').
      ...(engine === 'unified' ? { engine } : {}),
      // A signup with the owner's test inbox is a test site, flagged as one, so it can be deleted cleanly (testCleanup.ts refuses
      // any row without the flag). It was routed as a test (unified/factory.ts isTestSignup) but left unflagged: the contractor
      // final pass (11/14) had to be flagged by hand.
      ...(isOwnerTestEmail(body.email) || isOwnerTestEmail(body.admin_email) ? { is_test_tenant: true } : {}),
    }

    let builtUnified = engine === 'unified'
    let { data: tenant, error: insertErr } = await supabase.from('tenants').insert(tenantRecord).select().single()
    // If a newer column (e.g. billing_status) hasn't been added to the live DB
    // yet, retry without it so the code can ship ahead of the migration.
    if (insertErr && insertErr.code === '42703') {
      console.warn('[Signup] Unknown column on insert, retrying without billing_status:', insertErr.message)
      // engine too: a Factory DB without migrations/2026-10-20_tenants_engine.sql builds this business on the templates.
      if (tenantRecord.engine) console.error('[Signup] tenants.engine is missing (run migrations/2026-10-20_tenants_engine.sql) — this signup takes the templates')
      const { billing_status: _, engine: _engine, ...fallback } = tenantRecord
      // …and the templates generator needs the password as typed (above).
      builtUnified = false
      fallback.admin_password = body.admin_password || null
      const retry = await supabase.from('tenants').insert(fallback).select().single()
      tenant = retry.data
      insertErr = retry.error
    }
    if (insertErr || !tenant) {
      console.error('[Signup] Insert error:', insertErr?.message)
      void raiseAlert({ key: 'route:signup', what: 'New signups are failing (500) — the account could not be created', business: signupName, detail: insertErr?.message })
      return c.json({ error: 'Failed to create account. Please try again.' }, 500)
    }

    console.log('[Signup] New tenant created (pending payment):', tenant.id, tenant.name, tenant.plan)

    // The AI builder's site, in the background: never awaited, so it cannot hold up the signup or the checkout. A
    // compose lost to a restart is run again by the preview sweep, or by the build (services/signupSite.ts).
    if (premiumPages) {
      liveSignupSiteDeps().then((d) => composeSignupSite(tenant.id, d))
        .catch((e: any) => console.warn('[Signup] AI site compose could not start for', tenant.slug, ':', e?.message))
    }

    // The owner's answers, kept on the tenant (intake_data.signup — everything else reads
    // intake_data.intake, so a signup row is never mistaken for an intake). Non-fatal.
    const choices = signupChoices(body)
    if (choices.goals.length || choices.addons.length || signupZone || ownPhoto || look.design) {
      const { error: choiceErr } = await supabase.from('tenants')
        .update({ intake_data: {
          signup: { ...choices, ...(signupZone ? { timezone: signupZone } : {}), ...(look.design ? { design: look.design } : {}), at: new Date().toISOString() },
          // The stored photo, where the build's seed-photos step reads intake photos: it lands in the business's own library.
          ...(ownPhoto ? { photos: [{ storageKey: ownPhoto.storageKey, storageType: ownPhoto.storageType }] } : {}),
        } }).eq('id', tenant.id)
      if (choiceErr) console.warn('[Signup] Could not save add-on choices:', choiceErr.message)
    }

    // Send welcome email immediately (non-blocking)
    // The owner by first name: the signup has it now; the build that tenantOwner reads it from does not exist yet.
    notifyWelcome(tenant, signupText(body.owner_first_name) ?? null).catch(e => console.warn('[Email] Welcome email failed:', e.message))

    // Auto-generate code build so triggerAutoDeploy has a factory_jobs record to deploy
    const ownerServices = signupServices(body.services)
    const genConfig: GenerateConfig = {
      tenant_id: tenant.id,
      tenant_slug: tenant.slug,
      // Its own copy: generate() adds to the list it's given.
      products: [...signupProducts],
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
        plan: body.plan || 'starter10',
        // A unified build takes the hash from the tenant row; only the templates generator is handed the password.
        defaultPassword: builtUnified ? undefined : (body.admin_password || undefined),
        // The owner's own name for their CRM login. Signup asked for it and only ever wrote it into `notes`
        // ("Admin: John Test"), so every owner was seeded as "Admin User". (E2E run 1, 10/14)
        ownerFirstName: signupText(body.owner_first_name),
        ownerLastName: signupText(body.owner_last_name),
      },
      branding: {
        primaryColor: body.primary_color || '#FF3D00',
        websiteTheme: body.website_theme || undefined,
        ...signupImages(body.branding),
      },
      features: {
        // The list the tenant row was given above (the signup's choice, or the template's starting default) — the CRM's
        // seed starts the company on exactly this, so the build and the Factory never disagree.
        crm: (Array.isArray(tenant.features) && tenant.features.length ? tenant.features : body.features) || [],
      },
      ...(ownerServices.length ? { content: { ownerServiceNames: ownerServices } } : {}),
    }

    // Generate the build in the background — don't block the signup response.
    // Generation is cheap (local file-gen, no Render/DB), so it's safe to run
    // before payment; it just produces the factory_jobs record the deploy needs.
    // The EXPENSIVE step (Render service + Postgres) is the deploy, which only
    // fires after checkout completes (webhook, or the race-resolution below).
    ;(async () => {
      try {
       if (isUnifiedTenant(tenant)) {
        // A unified tenant has no package to generate: its build is the unified app at the Factory's version
        // (unified/factory.ts). The job is recorded all the same — the deploy's record, and the owner's name and
        // chosen password (scrubbed once the business holds its hash), as for a template signup.
        const { error: jobErr } = await supabase.from('factory_jobs').insert({
          tenant_id: tenant.id, template: 'unified', deployment_model: body.deployment_model || 'saas', status: 'pending',
          features: body.features || [], branding: genConfig.branding, config: genConfig,
        })
        if (jobErr) console.error('[Signup] Unified job insert error:', jobErr.message)
        else console.log('[Signup] Unified tenant recorded for', tenant.slug, '— awaiting payment before deploy')
       } else {
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
        console.log('[Signup] Build generated for', tenant.slug, '— awaiting payment before deploy')
       }

        // Pay-then-deploy race resolution: the build must exist before we can
        // deploy, and payment can land on either side of generation. If the
        // customer already paid while we were generating (webhook flipped
        // billing_status → active but found no build to deploy yet), fire the
        // deploy now. Otherwise the checkout.session.completed webhook triggers
        // it. triggerAutoDeploy is idempotent, so at most one deploy ever runs.
        if (tenantRecord.deployment_model === 'saas') {
          const { data: fresh } = await supabase
            .from('tenants').select('billing_status, status, render_frontend_url')
            .eq('id', tenant.id).maybeSingle()
          const alreadyPaid = fresh?.billing_status === 'active' || fresh?.status === 'active'
          if (alreadyPaid && !fresh?.render_frontend_url) {
            console.log('[Signup] Payment already completed for', tenant.slug, '— deploying now')
            await triggerAutoDeploy(tenant.id).catch(err =>
              console.error('[Signup] post-generate triggerAutoDeploy error:', err?.message || err)
            )
          }
        }
      } catch (genErr: any) {
        console.error('[Signup] Auto-generate failed for', tenant.slug, ':', genErr.message)
        // The customer may already be mid-checkout (or paid) — never let this
        // die in logs only. Staff gets an actionable alert with tenant + error.
        notifyProvisionFailure(tenant, 'Build generation', genErr?.message || String(genErr))
          .catch((e: any) => console.error('[Signup] failure-alert email failed:', e?.message))
      }
    })()

    // Create the Stripe Checkout session the customer must complete to launch.
    // Payment (webhook) — not this request — triggers the deploy. Success/cancel
    // land on the public marketing site, never the staff console.
    const siteUrl = (process.env.PUBLIC_SITE_URL || 'https://twomiah.com').replace(/\/$/, '')
    let checkoutUrl: string | null = null
    try {
      const checkout = await factoryStripe.createSubscriptionCheckout(
        { id: tenant.id, email: tenant.email, name: tenant.name, phone: tenant.phone, stripeCustomerId: tenant.stripe_customer_id },
        {
          planId: tenant.plan || 'starter10',
          billingCycle: 'monthly',
          // Asked for texting → after paying for the plan, go straight to the $10/mo texting checkout.
          successUrl: choices.addons.includes('texting')
            ? (process.env.TWOMIAH_FACTORY_URL || new URL(c.req.url).origin).replace(/\/+$/, '') + '/api/v1/factory/public/signup/' + tenant.id + '/next'
            : siteUrl + '/welcome?tenant=' + tenant.id,
          cancelUrl: siteUrl + '/signup?canceled=1',
        }
      )
      checkoutUrl = checkout.url || null
      if (checkout.stripeCustomerId && !tenant.stripe_customer_id) {
        await supabase.from('tenants').update({ stripe_customer_id: checkout.stripeCustomerId }).eq('id', tenant.id)
      }
      // A session with no URL means the customer has no way to pay — treat it as
      // a checkout failure rather than returning "success" with a dead link (the
      // signup form would otherwise show a misleading "being built" message).
      if (!checkoutUrl) throw new Error('Stripe returned no checkout URL')
    } catch (payErr: any) {
      console.error('[Signup] Checkout creation failed for', tenant.slug, ':', payErr?.message || payErr)
      void raiseAlert({ key: 'route:signup-checkout', what: 'New signups cannot get to payment (checkout failed, 502)', business: tenant.name, detail: payErr?.message || String(payErr), tenantId: tenant.id })
      return c.json({ error: 'Account created, but we could not start checkout. Please try again or contact support.', tenantId: tenant.id }, 502)
    }

    clearAlert('route:signup'); clearAlert('route:signup-checkout')
    return c.json({
      success: true,
      tenantId: tenant.id,
      slug: tenant.slug,
      checkoutUrl,
      message: 'Account created — complete checkout to launch your site.',
    })
  } catch (err: any) {
    console.error('[Signup] Error:', err.message)
    void raiseAlert({ key: 'route:signup', what: 'New signups are failing (500)', business: signupName, detail: err?.message || String(err) })
    return c.json({ error: 'Something went wrong. Please try again.' }, 500)
  }
})


// After the plan checkout of a signup that asked for texting: start the $10/mo texting checkout
// (its own subscription, the same one Settings → Texting starts, so the existing webhook switches
// it on and cancelling it touches nothing else). Anything else — no texting asked, already on,
// Stripe unavailable — goes to the welcome page. A link that can only open a payment page for
// that tenant, so it needs no login.
factory.get('/public/signup/:id/next', rateLimit(10 * 60 * 1000, 10), async (c) => {
  const siteUrl = (process.env.PUBLIC_SITE_URL || 'https://twomiah.com').replace(/\/$/, '')
  const id = c.req.param('id')
  const welcome = siteUrl + '/welcome' + (UUID_RE.test(id) ? '?tenant=' + id : '')
  if (!UUID_RE.test(id)) return c.redirect(welcome, 302)
  try {
    const { data: t } = await supabase.from('tenants')
      .select('id, email, name, phone, stripe_customer_id, messaging_enabled, intake_data').eq('id', id).maybeSingle()
    const asked = Array.isArray(t?.intake_data?.signup?.addons) && t!.intake_data.signup.addons.includes('texting')
    if (!t || !asked || t.messaging_enabled || !factoryStripe.isConfigured()) return c.redirect(welcome, 302)
    const checkout = await factoryStripe.createMessagingEnableCheckout(
      { id: t.id, email: t.email, name: t.name, phone: t.phone, stripeCustomerId: t.stripe_customer_id },
      MESSAGING_ENABLE_MONTHLY_CENTS,
      { successUrl: welcome + '&texting=on', cancelUrl: welcome + '&texting=later' },
    )
    if (!t.stripe_customer_id && checkout.stripeCustomerId) {
      await supabase.from('tenants').update({ stripe_customer_id: checkout.stripeCustomerId }).eq('id', id)
    }
    return c.redirect(checkout.url || welcome, 302)
  } catch (e: any) {
    console.error('[Signup] Texting checkout failed for', id, ':', e?.message || e)
    return c.redirect(welcome, 302)
  }
})

// ─── Public instant preview (self-serve, no auth, no deploy, ~$0) ──────────────
// The homepage "preview your site" widget posts { businessName, businessType }
// and gets back a fully rendered, self-contained standard-template homepage —
// the SAME token-filled template a paying customer receives, NOT the premium AI
// composer. It never writes to the DB and never touches the deploy pipeline, so
// it costs nothing but the render itself. That render is defended on three axes
// so it can't be spammed into a cost/DoS vector: per-IP rate limit (rateLimit
// middleware) + global in-flight cap + identical-input cache (previewGuard).
// Returns raw HTML for iframe srcdoc.
// The free preview on twomiah.com shows the site a signup builds. When the homepage sends one
// of the signup's own trade values ("electrical", "salon"…), build the same config the signup
// does (POST /public/signup above): that industry, no services, the signup's default theme
// and colour. Free text keeps going through buildBrief, whose buckets differ from signup's
// (it reads "electrician" as HVAC/plumbing). Not 'retail': its storefront has no preview.
const SIGNUP_PREVIEW_TRADES = new Set([
  'roofing', 'general_contractor', 'remodeler', 'painter', 'concrete', 'flooring',
  'hvac', 'plumbing', 'electrical', 'landscaping', 'home_care', 'veterinary', 'rv',
  'dispensary', 'restaurant', 'salon', 'fitness', 'food_truck', 'other',
])
function signupPreviewConfig(name: string, industry: string, city: string, state: string): GenerateConfig {
  // twomiah.com signup.html: home care → 'clean-professional', other → 'clean-minimal',
  // every trade → 'modern-minimal' (a template without that theme keeps its own look).
  const theme = industry === 'home_care' ? 'clean-professional' : industry === 'other' ? 'clean-minimal' : 'modern-minimal'
  return {
    products: ['website'],
    websiteTheme: theme,
    company: { name, city: city || undefined, state: state || undefined, industry, plan: 'starter10' },
    branding: { primaryColor: '#FF3D00', websiteTheme: theme },
    features: { crm: [] },
  } as GenerateConfig
}

factory.post('/public/preview', rateLimit(10 * 60_000, 6), async (c) => {
  let body: any
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid request.' }, 400)
  }

  // Strip angle brackets so a name can never inject markup into the rendered
  // HTML (token substitution is raw), and bound every field so a payload can't
  // bloat the render.
  const clean = (s: unknown, max: number): string =>
    typeof s === 'string' ? s.replace(/[<>]/g, '').trim().slice(0, max) : ''
  const businessName = clean(body.businessName, 80)
  const businessType = clean(body.businessType ?? body.industry, 60)
  const city = clean(body.city, 60)
  const state = clean(body.state, 40)
  if (businessName.length < 2 || businessType.length < 2) {
    return c.json({ error: 'Enter a business name and what you do (e.g. "Joe\'s Roofing" and "roofing").' }, 422)
  }

  // The look the visitor chose (foundry, heritage or studio): refused when it is anything else. Nothing sent: the trade's own.
  const look = requestedLook(body.design)
  if (!look.ok) return c.json({ error: 'Unknown design.' }, 422)

  // A trade the unified app is open to is drawn by the unified renderer — the page a signup of it really gets, in the
  // chosen look (unified/preview.ts). Every other trade keeps the preview it has, below.
  const unifiedVertical = unifiedPreviewVertical(businessType)

  // engine: 'premium' — the premium site, composed instantly from what they typed (no model call,
  // ~$0, milliseconds): the site the premium engine builds, not the standard template. The default
  // stays the standard preview until signups build premium too, so the preview never shows a
  // different site from the one a signup gets.
  const premium = body.engine ? body.engine === 'premium' : signupWebsiteEngine() === 'premium'
  const cacheKey = [unifiedVertical ? 'unified:' + (look.design ?? 'default') : premium ? 'premium' : 'standard', businessName, businessType, city, state].join('|').toLowerCase()
  const cached = cacheGet(cacheKey)
  if (cached) return c.html(cached)

  if (unifiedVertical) {
    if (!acquireInflight()) return c.json({ error: 'Busy rendering previews right now — try again in a few seconds.' }, 503)
    try {
      const html = await renderUnifiedPreview({ businessName, businessType, city: city || undefined, state: state || undefined, vertical: unifiedVertical, design: look.design })
      cacheSet(cacheKey, html)
      clearAlert('route:preview')
      return c.html(html)
    } catch (err: any) {
      console.error('[PublicPreview] Unified render failed:', err?.message || err)
      // The preview every open trade gets (the unified renderer): the same alert as the other preview paths.
      void raiseAlert({ key: 'route:preview', what: 'The homepage preview is failing (500) — visitors see "Preview failed to render"', business: businessName, detail: err?.message || String(err) })
      return c.json({ error: 'Preview failed to render — please try again.' }, 500)
    } finally {
      releaseInflight()
    }
  }

  if (premium) {
    if (!acquireInflight()) return c.json({ error: 'Busy rendering previews right now — try again in a few seconds.' }, 503)
    try {
      // A thin trade's hero may be a live stock shot (one cached search per trade, never more than a few seconds' wait).
      const { liveStockFor } = await import('../../config/heroLibrary')
      const stockPhotos = liveStockFor(businessType) ? (await (await import('../../services/pexelsStock')).pexelsHeroPhotos(businessType).catch(() => [])).map((p) => ({ url: p.url, tag: 'hero', alt: p.alt })) : []
      const site = composeInstant({ businessName, businessType, city: city || undefined, state: state || undefined, ...(stockPhotos.length ? { stockPhotos } : {}) })
      const published = Object.keys(site.pages).filter((slug) => !site.heldPages.includes(slug))
      const settings = {
        companyName: businessName,
        nav: buildPremiumNav(published),
        // Credits for the library photo, as the deployed site shows them.
        photoCredits: heroCreditsForUrls(collectImageUrls(site.pages.home)),
      }
      // Links inside the preview go nowhere ('#'): it's one page in an iframe on twomiah.com.
      const { html } = await renderPremiumPage({ slug: 'home', title: businessName, sections: site.pages.home }, settings as any, '#', pickPremiumTemplateDir(businessType))
      cacheSet(cacheKey, html)
      clearAlert('route:preview')
      return c.html(html)
    } catch (err: any) {
      console.error('[PublicPreview] Premium render failed:', err?.message || err)
      void raiseAlert({ key: 'route:preview', what: 'The homepage preview is failing (500) — visitors see "Preview failed to render"', business: businessName, detail: err?.message || String(err) })
      return c.json({ error: 'Preview failed to render — please try again.' }, 500)
    } finally {
      releaseInflight()
    }
  }

  let config: GenerateConfig
  const signupTrade = businessType.toLowerCase()
  if (SIGNUP_PREVIEW_TRADES.has(signupTrade)) {
    config = signupPreviewConfig(businessName, signupTrade, city, state)
  } else {
    const intake: Intake = {
      businessName,
      businessType,
      city: city || undefined,
      state: state || undefined,
    }
    const brief = buildBrief(intake)
    if (!brief.ok) {
      return c.json({ error: 'Could not build a preview for that — try a more common business type.' }, 422)
    }
    config = brief.config
  }

  if (!acquireInflight()) {
    return c.json({ error: 'Busy rendering previews right now — try again in a few seconds.' }, 503)
  }
  try {
    const preview = await renderHomepagePreview(config)
    cacheSet(cacheKey, preview.html)
    clearAlert('route:preview')
    return c.html(preview.html)
  } catch (err: any) {
    console.error('[PublicPreview] Render failed:', err?.message || err)
    void raiseAlert({ key: 'route:preview', what: 'The homepage preview is failing (500) — visitors see "Preview failed to render"', business: businessName, detail: err?.message || String(err) })
    return c.json({ error: 'Preview failed to render — please try again.' }, 500)
  } finally {
    releaseInflight()
  }
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
    .select('id, name, slug, email, admin_email, phone, city, state, address, industry, domain, primary_color, secondary_color, website_theme, factory_sync_key, admin_password, preview_premium_pages, intake_data')
    .eq('id', tenantId)
    .single()
  if (error || !tenant) return c.json({ error: 'Tenant not found' }, 404)
  if (!checkFactoryKey(c, tenant)) return c.json({ error: 'Bad sync key' }, 401)

  const composed = (tenant.preview_premium_pages || {}) as {
    pages?: Record<string, { sections: any[] }>
    heldPages?: string[]
    contentGaps?: ContentGap[]
  }

  // Uploaded brand assets. The generator writes an uploaded logo to
  // build/images/brand-logo.<ext> and an uploaded favicon to build/favicon.png;
  // with no upload it synthesizes /images/logo.svg + /favicon.svg. The build
  // this site was deployed from is the tenant's latest factory job.
  const { data: latestJob } = await supabase.from('factory_jobs')
    .select('config, branding').eq('tenant_id', tenantId)
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  const jobBranding = (latestJob?.config?.branding || latestJob?.branding || {}) as { logo?: string; favicon?: string }
  const uploadedLogoExt = typeof jobBranding.logo === 'string' && jobBranding.logo.startsWith('data:')
    ? ((jobBranding.logo.match(/^data:image\/([a-z0-9.+-]+)/i)?.[1] || 'png').toLowerCase().replace('svg+xml', 'svg').replace('jpeg', 'jpg'))
    : null
  const uploadedFavicon = typeof jobBranding.favicon === 'string' && jobBranding.favicon.startsWith('data:')

  // The composer's page set, held pages unpublished (services/premiumSitePages.ts — the unified build seeds the same list).
  const pages = premiumSitePages(composed)

  const serviceAreas = premiumServiceAreas(tenant)

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
    // Favicon + logo for the premium head's <link rel="icon"> and og:image.
    // The settings row is seeded ONCE at first boot, so we point at the local
    // assets the generator ALWAYS writes into the site's build/ dir:
    // build/favicon.svg and build/images/logo.svg. We deliberately do NOT sign
    // a remote R2 URL here — the intake flow never captures a favicon, uploaded
    // logos are copied into the tenant's own R2 as section photos (not a stable
    // settings URL), and any signed URL would expire while this row lives
    // forever. Local paths never 404 and never expire, so they're the robust
    // default. (Templates serve /favicon.svg from build/ via server-static.)
    faviconUrl: uploadedFavicon ? '/favicon.png' : '/favicon.svg',
    logoUrl: uploadedLogoExt ? '/images/brand-logo.' + uploadedLogoExt : '/images/logo.svg',
    // Nav derived from the page set the composer actually produced —
    // food trucks get Menu/Find us/Catering, generic verticals get
    // Services/About. Same buildPremiumNav helper used by the preview
    // endpoints above. Held (unpublished) pages stay out until the owner
    // publishes them and adds them under Settings → Navigation.
    nav: buildPremiumNav([...pages.filter(p => p.isPublished).map(p => p.slug), ...(serviceAreas.length ? ['service-areas'] : [])]),
    serviceAreas,
    // The admin's "Finish your site" checklist — what the owner can add and
    // what it unlocks. Seeded once with the rest of the settings row.
    contentGaps: Array.isArray(composed.contentGaps) ? composed.contentGaps : [],
    // Credits for every curated-library photo across the composed pages. The
    // settings row is seeded once at first boot, so this covers the whole
    // site rather than a single page — a photo used on /services still gets
    // credited in the footer that renders on every page. With the credits saved at compose time, when the live stock
    // registry was warm (a live photo is otherwise uncredited once this runs on another instance).
    photoCredits: mergeCredits((composed as any)._photoCredits, heroCreditsForUrls(collectImageUrls(pages))),
  }

  // Note: admin credentials are NOT returned here. The seed reads them
  // from ADMIN_EMAIL + ADMIN_INITIAL_PASSWORD env vars (set by the
  // deploy). Writing the password to the tenant row would require an
  // extra UPDATE during deploy and adds nothing — the env-var path is
  // already populated by every deploy that runs initDb.ts.
  return c.json({ settings, pages })
})

// Every 10 minutes (services/scheduler.ts): signups not yet built whose AI site is pending or was lost with a restart
// (services/signupSite.ts). It also retried the previews of the "see a preview first" website offer; that went with the
// offer (routes/factory/closedIntake.ts).
factory.post('/internal/preview-sweep', async (c) => {
  if (!checkCronSecret(c)) return c.json({ error: 'Unauthorized' }, 401)
  let signupSites: string[] = []
  try { signupSites = await resumeSignupComposes(await liveSignupSiteDeps()) }
  catch (e: any) { console.warn('[PreviewSweep] signup sites:', e?.message) }
  return c.json({ ok: true, signupSites })
})

}
