/**
 * The live Factory's unified path (cutover, owner's "go" 2026-10-20): which engine a new signup gets, and the unified
 * equivalents of routes/factory/deploy.ts runDeploy (deployUnifiedTenant) and Update Code (updateUnifiedTenantCode).
 *
 * The switch is UNIFIED_SIGNUPS: off (the default — the Factory behaves exactly as before), test (only test signups:
 * the owner's test inbox and its aliases, or a row already flagged is_test_tenant) or all. It decides tenants.engine
 * ONCE, at signup; nothing here or anywhere else flips an existing tenant. A signup whose industry has no unified
 * vertical yet (dispensary) stays on the templates whatever the switch says.
 *
 * deployUnifiedTenant does every step runDeploy does for a template tenant (docs/CUTOVER_FACTORY_MAP.md): the 15-minute
 * "still working" email, the build (unified/build.ts: the tenant's own database server, repo and service, then the
 * business through POST /api/internal/provision), the factory_jobs record that services/resourceOwnership.ts reads as
 * ownership next time, the tenants row (addresses, database_url, sync key, admin email, features, website), Active only
 * once the new code answers and the business is in, the audit entries, the feature and subscription sync, the domain,
 * the ready or failure email, and the scrub of the plaintext password. Its integration settings are the template path's,
 * from the same functions (services/deploy.ts tenantIntegrationEnv, crmPlanEnv, calendarOAuthEnv, crmServiceEnv,
 * platformIntegrationEnv; services/quickbooksEnv.ts).
 *
 * Every outside call goes through `deps`, so the whole path runs against fakes (tests/unified/factory/factory.test.ts).
 */
import crypto from 'node:crypto'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { raiseAlert, clearAlert } from '../services/alerts'
import { buildUnifiedTenant, type BuildIo, type Owned, type Step } from './build'
import { updateUnifiedTenant, type UpdateResult } from './update'
import { createHosts, hostConfigFromEnv, type EnvVar } from './hosts'
import { unifiedNames } from './names'
import { engineVersion } from './tree'
import { verticalFor, crmTemplateFor, startingFeaturesFor } from '../config/industryRouting'
import { stateTimezone } from '../config/stateTimezone'
import { resolveCrmFeatures } from '../services/generator'
import { premiumSitePages, premiumServiceAreas, buildPremiumNav, type PremiumComposition } from '../services/premiumSitePages'
import { composeInstant, toComposition, tradeLabelFor } from '../services/instantComposer'
import { websiteTradeFor } from '../config/websiteTrades'
import { wantsBookings } from '../services/composerFacts'
import { signupQuestionsFor } from '../config/signupQuestions'
import { collectImageUrls, heroCreditsForUrls } from '../config/heroLibrary'
import { repoKey, type OwnedResources } from '../services/resourceOwnership'
import { requestedLook } from '../config/siteLooks'

// ─── Which engine a signup gets ────────────────────────────────────────────────

export type UnifiedSignups = 'off' | 'test' | 'all'
export type Engine = 'templates' | 'unified'

/** The switch. Anything but 'test' or 'all' (unset, a typo) is off. */
export function unifiedSignupsMode(env: Record<string, string | undefined> = process.env): UnifiedSignups {
  const v = String(env.UNIFIED_SIGNUPS || '').trim().toLowerCase()
  return v === 'test' || v === 'all' ? v : 'off'
}

/** The owner's test inbox (every E2E signs up with it). Gmail ignores dots and anything after a '+'. */
const TEST_INBOX_LOCAL = 'twomiah14'

export function isOwnerTestEmail(email: unknown): boolean {
  const m = String(email || '').trim().toLowerCase().match(/^([^@\s]+)@(gmail\.com|googlemail\.com)$/)
  return !!m && m[1].split('+')[0].replace(/\./g, '') === TEST_INBOX_LOCAL
}

/** A test signup: flagged is_test_tenant (the comp promo, the test matrix), or signed up with the owner's test inbox. */
export function isTestSignup(s: { email?: string | null; admin_email?: string | null; is_test_tenant?: boolean | null }): boolean {
  return s.is_test_tenant === true || isOwnerTestEmail(s.email) || isOwnerTestEmail(s.admin_email)
}

/**
 * The unified vertical (apps/unified/server/core/vertical.ts loadVertical) a Factory industry runs as, or null when the
 * unified app has none yet. Mirrors the templates' routing: showcase runs the basic CRM there too (services/deploy.ts
 * isBasic), and food trucks the restaurant's (its food side; config/industryRouting.ts unifiedFeaturePreset).
 */
const UNIFIED_VERTICAL_OF: Partial<Record<ReturnType<typeof verticalFor>, string>> = {
  basic: 'basic', showcase: 'basic', foodtruck: 'restaurant', contractor: 'contractor', fieldservice: 'fieldservice',
  homecare: 'homecare', roofing: 'roofing', landscaping: 'landscaping', bar: 'bar', rv: 'rv', veterinary: 'vet',
  salon: 'salon', events: 'restaurant', store: 'store',
}

export function unifiedVerticalFor(industry: string | null | undefined): string | null {
  return UNIFIED_VERTICAL_OF[verticalFor(industry)] ?? null
}

/** Every unified vertical id a Factory industry can run as. */
export const UNIFIED_VERTICAL_IDS: readonly string[] = [...new Set(Object.values(UNIFIED_VERTICAL_OF) as string[])]

/**
 * The unified verticals open to REAL customers (owner's decision, 2026-10-25: go live per industry, as each is tested):
 * UNIFIED_LIVE_VERTICALS, a comma- or space-separated list of unified vertical ids (UNIFIED_VERTICAL_IDS —
 * contractor, fieldservice, landscaping, roofing, homecare, restaurant, bar, salon, …). A food truck, a caterer or a
 * venue is 'restaurant' here, as it runs as one (unifiedVerticalFor).
 *
 * Unset, empty, or naming no known id: null — no list, and signups behave exactly as UNIFIED_SIGNUPS alone says, so
 * a typo can neither open an untested industry nor close the signup to everyone. An unknown id beside known ones is
 * ignored (and logged once), never guessed at.
 */
export function unifiedLiveVerticals(env: Record<string, string | undefined> = process.env): Set<string> | null {
  const raw = String(env.UNIFIED_LIVE_VERTICALS || '').toLowerCase().split(/[\s,]+/).filter(Boolean)
  const known = raw.filter((id) => UNIFIED_VERTICAL_IDS.includes(id))
  const unknown = raw.filter((id) => !UNIFIED_VERTICAL_IDS.includes(id))
  if (unknown.length && !warnedUnknown.has(unknown.join(','))) {
    warnedUnknown.add(unknown.join(','))
    console.warn('[Unified] UNIFIED_LIVE_VERTICALS names unknown vertical(s), ignored:', unknown.join(', '), '— known:', UNIFIED_VERTICAL_IDS.join(', '))
  }
  return known.length ? new Set(known) : null
}
const warnedUnknown = new Set<string>()

type SignupWho = { industry?: string | null; email?: string | null; admin_email?: string | null; is_test_tenant?: boolean | null }

/**
 * The engine a NEW signup gets.
 *   off   always the templates (the list is not read: off means the Factory behaves exactly as before).
 *   test  a test signup: the unified app, for every vertical it has. A real signup: the unified app when its vertical
 *         is on the live list (UNIFIED_LIVE_VERTICALS), else the templates — the behaviour before the list existed.
 *   all   every signup whose industry has a unified vertical.
 * An industry with no unified vertical (dispensary) stays on the templates whatever the switch says.
 */
export function engineForSignup(s: SignupWho, mode: UnifiedSignups = unifiedSignupsMode(), live: Set<string> | null = unifiedLiveVerticals()): Engine {
  if (mode === 'off') return 'templates'
  const vertical = unifiedVerticalFor(s.industry)
  if (!vertical) return 'templates'
  if (mode === 'all') return 'unified'
  return isTestSignup(s) || !!live?.has(vertical) ? 'unified' : 'templates'
}

/**
 * Whether a REAL signup is refused because its industry is not open yet: only while a live list is set (the Factory
 * is going live per industry). Then an industry that is not on it — not tested on the unified app (vet, RV, store, the
 * basic/"other" CRM), or with no unified vertical at all (dispensary) — is refused with a clear message, rather than
 * built on the templates: the owner's rule (2026-10-25) is that no new customer starts on the templates who would have
 * to be moved later. A test signup is never refused (every vertical is tested through it), and with no list the
 * signup behaves exactly as before. Null: not refused.
 */
export function signupRefusal(s: SignupWho, mode: UnifiedSignups = unifiedSignupsMode(), live: Set<string> | null = unifiedLiveVerticals()): string | null {
  if (mode === 'off' || !live || isTestSignup(s)) return null
  if (engineForSignup(s, mode, live) === 'unified') return null
  const trade = tradeLabelFor(String(s.industry || ''))
  return (trade ? `Sign-ups for ${trade} businesses` : 'Sign-ups for this kind of business') +
    ' are not open yet. We are getting Twomiah ready for you — please check back soon.'
}

export const isUnifiedTenant = (t: { engine?: string | null } | null | undefined) => t?.engine === 'unified'

// ─── The provision body ────────────────────────────────────────────────────────

const HEX = /^#[0-9a-fA-F]{6}$/
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/
const clip = (v: unknown, max: number) => { const s = typeof v === 'string' ? v.trim() : ''; return s ? s.slice(0, max) : null }
const httpUrl = (v: unknown) => (typeof v === 'string' && /^https?:\/\//i.test(v) && v.length <= 2000 ? v : null)

/** The tenant bought a website (any website product). */
export function wantsWebsite(tenant: { products?: string[] | null }): boolean {
  return (tenant.products || []).some((p) => String(p).startsWith('website'))
}

/** The owner's name as the CRM templates' seed takes it (services/generator.ts: 'Admin User' when none was given). */
export function ownerName(company: { ownerFirstName?: string; ownerLastName?: string; ownerName?: string } = {}) {
  const parts = (company.ownerName || 'Admin User').split(' ')
  return {
    firstName: company.ownerFirstName?.trim() || parts[0] || 'Admin',
    lastName: company.ownerLastName?.trim() || parts.slice(1).join(' ') || 'User',
  }
}

/** The features the business starts with: exactly what the template path seeds (generator.ts resolveCrmFeatures). */
export function unifiedFeatures(tenant: any, config: any): string[] {
  const template = crmTemplateFor(tenant.industry)
  let requested: string[] = tenant.features?.length ? tenant.features : (config?.features?.crm || [])
  // Nothing picked: the industry's starting set as the unified app has it (a restaurant's and a food truck's food side —
  // industryRouting.ts startingFeaturesFor). What the signup picked is kept as it was picked.
  if (!requested.length) requested = startingFeaturesFor(tenant.industry, { unified: true })
  return resolveCrmFeatures(template, config?.company?.plan || 'starter', requested).seed
}

/**
 * The owner said the business takes bookings: the signup's "We take bookings" (intake_data.signup.goals) or the intake's
 * goals, read by the same rule that gives the site its booking sections (composerFacts.ts wantsBookings). The app then
 * starts with something bookable (apps/unified/server/modules/provision.ts startingBookings). Live test 2026-10-22: the
 * answer reached only the site's words, so /book said "Bookings opening soon" on a business that had asked for it.
 */
export function takesBookings(tenant: any): boolean {
  const data = tenant?.intake_data || {}
  const goals = [...(Array.isArray(data.signup?.goals) ? data.signup.goals : []), ...(Array.isArray(data.intake?.goals) ? data.intake.goals : [])]
  // Only where the business's system has online booking (config/signupQuestions.ts) — an intake's "bookings" goal on a
  // roofer or an RV dealer starts nothing bookable.
  return signupQuestionsFor(tenant?.industry).bookings && wantsBookings({ goals } as any)
}

/** The site's composition: the one the signup or the intake stored, else one composed now from the tenant's facts. */
export function compositionFor(tenant: any): PremiumComposition | null {
  if (tenant.preview_premium_pages?.pages) return tenant.preview_premium_pages
  const intake = tenant.intake_data?.intake || {}
  // The template composer (services/instantComposer.ts): the trade's whole page plan from the tenant's own facts.
  return toComposition(composeInstant({
    businessName: tenant.name, businessType: tenant.industry || 'other',
    city: tenant.city || undefined, state: tenant.state || undefined, phone: tenant.phone || undefined,
    email: tenant.email || undefined, services: Array.isArray(intake.services) ? intake.services : [],
    description: intake.description || undefined,
  } as any))
}

/**
 * The composer's one card for the trade when the owner listed no services (instantComposer: websiteTradeFor(…).service,
 * else the trade's label) is marked standIn: the site shows the business's own services there, or nothing, never the
 * trade as a service (apps/unified/server/site/menu.ts). A card the owner typed is never marked.
 */
export function markStandInServices(sections: any[], industry: string | null | undefined): any[] {
  const type = String(industry || '').toLowerCase().replace(/\s+/g, '_')
  const standIn = websiteTradeFor(type)?.service || tradeLabelFor(industry || '')
  return sections.map((s) => {
    const items = s?.type === 'services' && Array.isArray(s.data?.items) ? s.data.items : null
    const only = items && items.length === 1 ? items[0] : null
    const bare = only && Object.keys(only).every((k) => k === 'title')
    return standIn && bare && only.title === standIn ? { ...s, data: { ...s.data, items: [{ ...only, standIn: true }] } } : s
  })
}

/** The look a signup chose (intake_data.signup.design), as the site row's `design`; nothing chosen, or a value no longer choosable: none. */
function chosenLook(tenant: any): { design?: string } {
  const look = requestedLook(tenant?.intake_data?.signup?.design)
  return look.ok && look.design ? { design: look.design } : {}
}

/** The website part of the provision body: premium-site-bootstrap's pages, nav and settings for the same tenant. */
export function provisionSite(tenant: any): Record<string, unknown> {
  const composed = compositionFor(tenant)
  const pages = premiumSitePages(composed).filter((p) => SLUG.test(p.slug))
  const serviceAreas = premiumServiceAreas(tenant)
  return {
    // No site-wide title: each page's tab reads "Page — Business, City" (apps/unified/server/site/menu.ts pageTitle);
    // the name alone here was stamped on every page's tab.
    nav: buildPremiumNav([...pages.filter((p) => p.isPublished).map((p) => p.slug), ...(serviceAreas.length ? ['service-areas'] : [])]),
    serviceAreas,
    photoCredits: heroCreditsForUrls(collectImageUrls(pages)),
    contentGaps: Array.isArray(composed?.contentGaps) ? composed!.contentGaps : [],
    contactCtaLabel: 'Get in touch',
    // The look the visitor chose in the preview, kept with the signup (intake_data.signup.design); none: the vertical's own.
    ...chosenLook(tenant),
    ...(tenant.primary_color && HEX.test(tenant.primary_color) ? { accentColor: tenant.primary_color } : {}),
    pages: pages.map((p) => ({
      slug: p.slug, title: p.title, navOrder: p.navOrder, isPublished: p.isPublished,
      sections: markStandInServices((p.sections || []).filter((s: any) => s && typeof s.type === 'string').map((s: any) => ({
        ...s, data: s.data && typeof s.data === 'object' && !Array.isArray(s.data) ? s.data : {},
      })), tenant.industry),
    })),
  }
}

/**
 * The body of the tenant's POST /api/internal/provision (apps/unified/server/modules/provision.ts provisionSchema).
 * The owner's password goes only as a bcrypt hash; the plaintext is never part of it.
 */
export function provisionBody(tenant: any, config: any, passwordHash: string): Record<string, unknown> {
  const company = config?.company || {}
  const name = ownerName(company)
  const zone = stateTimezone(tenant.state) || clip(tenant.intake_data?.signup?.timezone, 64)
  return {
    company: {
      name: clip(tenant.name, 200), slug: tenant.slug,
      email: tenant.email || null, phone: clip(tenant.phone, 40), address: clip(tenant.address, 300),
      city: clip(tenant.city, 120), state: clip(tenant.state, 80), zip: clip(tenant.zip, 20),
      logo: httpUrl(config?.branding?.logo), website: null,
      ...(HEX.test(String(tenant.primary_color || '')) ? { primaryColor: tenant.primary_color } : {}),
      secondaryColor: HEX.test(String(tenant.secondary_color || '')) ? tenant.secondary_color : null,
      // The zone the CRM templates run on: the state's (config/stateTimezone.ts), else what the signup recorded.
      timezone: zone,
    },
    owner: {
      email: String(tenant.admin_email || tenant.email || company.adminEmail || company.email || '').trim().toLowerCase(),
      passwordHash, firstName: name.firstName.slice(0, 100), lastName: name.lastName.slice(0, 100), phone: clip(tenant.phone, 40),
    },
    features: unifiedFeatures(tenant, config),
    industry: clip(tenant.industry, 120),
    takesBookings: takesBookings(tenant),
    // A store's too (store live test, 2026-10-26): its composed home is its live products (shop/grid), with a contact page.
    ...(wantsWebsite(tenant) ? { site: provisionSite(tenant) } : {}),
  }
}

// ─── The integration settings ──────────────────────────────────────────────────

/**
 * The Factory's settings for a unified tenant's service — the same values the template path gives a CRM backend
 * (services/deploy.ts deployCustomer + refreshPlatformIntegrationEnv), from the same functions. (The roof
 * reports reach the Factory's review queue through FACTORY_URL, which the build sets — gap 22.) Returned as a function of the
 * service's address: QuickBooks' return address and API_URL carry it. The build owns the service's own settings
 * (secrets, DATABASE_URL, the addresses) — unified/build.ts tenantEnv.
 */
export async function unifiedIntegrationEnv(tenant: any, config: any, opts: { factoryUrl: string; guessUrl: string }): Promise<(serviceUrl: string) => EnvVar[]> {
  const d = await import('../services/deploy')
  const { quickbooksTenantEnv } = await import('../services/quickbooksEnv')
  const integrations = config?.integrations
  const isStore = verticalFor(tenant.industry) === 'store'
  const products: string[] = tenant.products || config?.products || []
  const crmRequested: string[] = tenant.features?.length ? tenant.features : (config?.features?.crm || [])
  const hasVisualizer = !isStore && (products.includes('vision') || (config?.features?.website || []).includes('visualizer') || crmRequested.includes('visualizer'))
  const plan = tenant.plan || config?.company?.plan || config?.plan || 'starter'
  const fixed: EnvVar[] = [
    ...d.crmPlanEnv(plan),
    // The CRM's Google app (Business Profile) and the site's calendar apps: this one service is both.
    ...d.calendarOAuthEnv(),
    // Texting: the platform's Twilio ACCOUNT (to send through the business's own Messaging Service and to check
    // Twilio's signature on replies), never the platform's shared NUMBER — a business texts from its own registered
    // number (services/a2p.ts, written into its CRM once approved), or not at all. (2026-10-21)
    ...(await d.tenantIntegrationEnv(tenant.id, integrations)).filter((e) => e.key !== 'TWILIO_PHONE_NUMBER' && e.key !== 'TWILIO_MESSAGING_SERVICE_SID'),
    ...d.crmServiceEnv({ hasVisualizer, name: tenant.name, ownerEmail: config?.company?.email || tenant.email || '', domain: config?.company?.domain || '' }),
    ...(isStore && process.env.FACTORY_FROM_EMAIL ? [{ key: 'FACTORY_FROM_EMAIL', value: process.env.FACTORY_FROM_EMAIL }] : []),
  ]
  // The tenant's own Stripe key: its webhook endpoint registered before the service exists, so the signing secret rides
  // in the first deploy (as deployCustomer does it).
  if (integrations?.stripe?.secretKey && !integrations.stripe.webhookSecret) {
    const wh = await d.ensureStripeWebhookEndpoint(integrations.stripe.secretKey, opts.guessUrl + '/api/stripe/webhook')
    if (wh.secret) fixed.push({ key: 'STRIPE_WEBHOOK_SECRET', value: wh.secret })
    else console.warn('[Unified] Stripe webhook auto-registration skipped:', wh.error)
  }
  const customerHasStripeKey = !!integrations?.stripe?.secretKey
  return (serviceUrl: string) => {
    const out = new Map<string, string>()
    for (const v of [...fixed, ...quickbooksTenantEnv(serviceUrl), ...d.platformIntegrationEnv(serviceUrl, { customerHasStripeKey })]) {
      if (!out.has(v.key)) out.set(v.key, v.value)
    }
    return [...out].map(([key, value]) => ({ key, value }))
  }
}

// ─── What the deploy talks to ──────────────────────────────────────────────────

export interface UnifiedDeps {
  /** The Factory database (Supabase client, or a stand-in with the same from().select/insert/update/eq chain). */
  db: any
  io: BuildIo
  /** The monorepo the tenant's tree is built from, and the engine commit it is stamped with. */
  root: string
  version: string
  factoryUrl: string
  fetch: (url: string, init?: RequestInit) => Promise<Response>
  owned: (tenantId: string) => Promise<OwnedResources>
  integrationEnv: (tenant: any, config: any, opts: { factoryUrl: string; guessUrl: string }) => Promise<(serviceUrl: string) => EnvVar[]>
  hashPassword: (plain: string) => Promise<string>
  audit: (tenantId: string, action: string, changes: Record<string, { old: any; new: any }>, by?: string, note?: string) => Promise<void>
  notify: {
    complete: (tenant: any, urls: { apiUrl?: string; deployedUrl?: string; siteUrl?: string; repoUrl?: string }) => Promise<unknown>
    failed: (tenant: any, reason: string) => Promise<unknown>
    stillWorking: (tenant: any) => Promise<unknown>
  }
  pushSubscription: (tenantId: string) => Promise<unknown>
  /** The tenant's R2 media bucket, made and named as the template path does (services/deploy.ts createR2BucketReport). */
  r2: {
    configured: () => boolean
    ensureBucket: (slug: string) => Promise<{ bucketName: string; created: boolean }>
    envVars: (bucketName: string) => EnvVar[]
  }
  /** POST /api/internal/seed-photos with the intake's photos (routes/factory/deploy.ts seedIntakePhotos). Non-fatal. */
  seedPhotos: (tenantId: string) => Promise<unknown>
  domains: {
    /** services/deploy.ts unifiedDomainTargets: where the domain points (the one service, all three names). */
    targets: (tenant: { slug: string; engine: string; render_backend_url: string }) => Promise<Record<string, string> | null>
    wire: (opts: any) => Promise<{ success: boolean; cloudflareZoneId?: string; sendgridDomainAuthId?: number; steps: any[]; errors: string[] }>
    reconcileAliases: (tenant: any) => void
  }
  stillWorkingMs?: number
  /** How long the build waits for the database and the new code (unified/build.ts waitMs). */
  waitMs?: number
  /**
   * services/signupSite.ts settleSignupSite: the signup's AI website finished, run again after a restart, or given up
   * on for the template one stored at signup. Absent: the stored composition is used as it is.
   */
  settleSite?: (tenantId: string) => Promise<unknown>
}

/** Pushes a built tree to the repo's main branch (replacing it, as the template deploy does) and returns the commit. */
export function pushTree(repoFullName: string, dir: string, version: string, env: Record<string, string | undefined> = process.env): string {
  const header = 'Authorization: Basic ' + Buffer.from('x-access-token:' + (env.GITHUB_TOKEN || '')).toString('base64')
  const git = (args: string[]) => {
    const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } as any })
    // The header is never echoed: only the command's first word and git's own error.
    if (r.status !== 0) throw new Error('git ' + args.filter((a) => !a.startsWith('http.extraHeader')).slice(-3).join(' ') + ' failed: ' + (r.stderr || '').trim().slice(0, 300))
    return r.stdout.trim()
  }
  git(['init'])
  git(['checkout', '-b', 'main'])
  git(['config', 'user.email', 'factory@twomiah.app'])
  git(['config', 'user.name', 'Twomiah Factory'])
  git(['config', 'credential.helper', ''])
  git(['remote', 'add', 'origin', 'https://github.com/' + repoFullName + '.git'])
  git(['add', '-A'])
  git(['commit', '-m', 'Twomiah unified ' + version.slice(0, 9)])
  git(['-c', 'http.extraHeader=' + header, 'push', 'origin', 'main', '--force'])
  return git(['rev-parse', 'HEAD'])
}

/** The engine commit this Factory runs: Render's RENDER_GIT_COMMIT, else the checkout's HEAD. */
export function factoryVersion(root: string, env: Record<string, string | undefined> = process.env): string {
  const c = String(env.RENDER_GIT_COMMIT || '').trim()
  return /^[0-9a-f]{7,40}$/.test(c) ? c : engineVersion(root)
}

/** The Factory's own deps: Supabase, GitHub, Render, the email and audit services. */
export async function liveUnifiedDeps(): Promise<UnifiedDeps> {
  const [{ supabase }, ownership, email, shared, sub, deploySvc, aliases, bcrypt, deployRoutes, signupSite] = await Promise.all([
    import('../middleware/auth'), import('../services/resourceOwnership'), import('../services/email'),
    import('../routes/factory/shared'), import('../services/tenantSubscription'), import('../services/deploy'),
    import('../services/emailAliasSync'), import('bcryptjs'), import('../routes/factory/deploy'), import('../services/signupSite'),
  ])
  const siteDeps = await signupSite.liveSignupSiteDeps()
  const env = { ...process.env, GITHUB_ORG: process.env.GITHUB_ORG || process.env.GITHUB_USER }
  const hosts = createHosts(hostConfigFromEnv(env), (url, init) => fetch(url, init))
  const root = path.resolve(import.meta.dir, '..', '..', '..', '..')
  const version = factoryVersion(root)
  return {
    db: supabase,
    io: { hosts, push: async (repo, dir) => pushTree(repo, dir, version), sleep: (ms) => new Promise((r) => setTimeout(r, ms)) },
    root, version,
    factoryUrl: (process.env.TWOMIAH_FACTORY_URL || process.env.FACTORY_PUBLIC_URL || 'https://twomiah-factory.onrender.com').replace(/\/+$/, ''),
    fetch: (url, init) => fetch(url, init),
    owned: (id) => ownership.loadOwnedResources(id),
    integrationEnv: unifiedIntegrationEnv,
    hashPassword: (plain) => bcrypt.default.hash(plain, 10),
    audit: shared.logTenantAudit,
    notify: {
      complete: (t, urls) => email.notifyDeployComplete(t, urls),
      failed: (t, reason) => email.notifyDeployFailed(t, reason),
      stillWorking: (t) => email.notifyStillWorking(t),
    },
    pushSubscription: (id) => sub.pushSubscriptionToTenant(id),
    r2: { configured: deploySvc.isR2Configured, ensureBucket: deploySvc.createR2BucketReport, envVars: deploySvc.getR2EnvVars },
    seedPhotos: (id) => deployRoutes.seedIntakePhotosIfPremium(id),
    domains: {
      targets: (t) => deploySvc.unifiedDomainTargets(t) as any,
      wire: (o) => deploySvc.wireDomainInfrastructure(o),
      reconcileAliases: (t) => aliases.reconcileAliasesInBackground(t),
    },
    settleSite: (id) => signupSite.settleSignupSite(id, siteDeps),
  }
}

const toOwned = (o: OwnedResources): Owned => ({ repos: o.repos, serviceIds: o.serviceIds, databaseIds: o.databaseIds })

async function latestJob(db: any, tenantId: string): Promise<any | null> {
  const { data } = await db.from('factory_jobs').select('*').eq('tenant_id', tenantId).order('created_at', { ascending: false }).limit(1).maybeSingle()
  return data || null
}

// ─── The deploy ────────────────────────────────────────────────────────────────

export interface UnifiedDeployResult { success: boolean; steps: Step[]; errors: string[]; serviceUrl?: string }

/**
 * Builds (or builds again) a unified tenant and records it — runDeploy's equivalent. The caller has already applied
 * runDeploy's guards (triggerAutoDeploy: not already deployed, no deploy running) and marked the job deploying.
 */
export async function deployUnifiedTenant(tenantId: string, depsIn?: UnifiedDeps): Promise<UnifiedDeployResult> {
  const deps = depsIn || await liveUnifiedDeps()
  const { db } = deps
  const { data: tenant, error: tErr } = await db.from('tenants').select('*').eq('id', tenantId).single()
  if (tErr || !tenant) return { success: false, steps: [], errors: ['tenant not found: ' + (tErr?.message || tenantId)] }
  // A template tenant is never built here, and never marked anything by it.
  if (!isUnifiedTenant(tenant)) return { success: false, steps: [], errors: ['tenant ' + tenant.slug + ' runs the templates, not the unified app'] }

  const stillWorking = setTimeout(() => {
    deps.notify.stillWorking(tenant).catch((e: any) => console.warn('[Unified] Still-working email failed:', e?.message))
    // The owner is told the build is stuck while the customer is still waiting, not after they write in.
    void raiseAlert({ key: 'deploy-stalled:' + tenant.id, what: 'A new customer\'s build is taking over 15 minutes', business: tenant.name || tenant.slug, detail: 'still building; the customer was sent a "still working" email', tenantId: tenant.id })
  }, deps.stillWorkingMs ?? 15 * 60_000)
  ;(stillWorking as any).unref?.()

  let job: any = null
  const fail = async (reason: string, result?: { steps: Step[]; errors: string[] }): Promise<UnifiedDeployResult> => {
    clearTimeout(stillWorking)
    if (job?.id) {
      const { error } = await db.from('factory_jobs').update({ status: 'failed' }).eq('id', job.id)
      if (error) console.error('[Unified] Failed to mark job failed:', error.message)
    }
    const { error: sErr } = await db.from('tenants').update({ status: 'deploy_failed' }).eq('id', tenant.id)
    if (sErr) console.error('[Unified] Failed to mark tenant deploy_failed:', sErr.message)
    else await deps.audit(tenant.id, 'deploy', { status: { old: tenant.status, new: 'deploy_failed' } }, 'system', 'Deploy failed: ' + reason)
    deps.notify.failed(tenant, reason).catch((e: any) => console.warn('[Unified] Deploy-failed email failed:', e?.message))
    return { success: false, steps: result?.steps || [], errors: result?.errors?.length ? result.errors : [reason] }
  }

  try {
    const vertical = unifiedVerticalFor(tenant.industry)
    if (!vertical) return await fail(`industry '${tenant.industry}' has no unified vertical`)

    job = await latestJob(db, tenant.id)
    if (!job) {
      const { data, error } = await db.from('factory_jobs').insert({
        tenant_id: tenant.id, template: 'unified', deployment_model: tenant.deployment_model || 'saas', status: 'deploying', features: tenant.features || [],
      }).select().single()
      if (error || !data) return await fail('could not record the deploy job: ' + (error?.message || 'no row'))
      job = data
    }
    const config = job.config || {}

    // Ownership, as deployCustomer reads it: records unreadable → own nothing, so anything holding a name stops the build.
    let owned: Owned
    try { owned = toOwned(await deps.owned(tenant.id)) } catch (e: any) {
      console.warn('[Unified] Tenant records unreadable — treating nothing as this tenant\'s:', e?.message)
      owned = { repos: new Set(), serviceIds: new Set(), databaseIds: new Set() }
    }

    const names = unifiedNames(tenant.slug)
    const guessUrl = `https://${names.service}.onrender.com`
    // The temporary password: the one the owner chose at signup (or the build config's), else one nobody knows — the
    // owner then sets theirs through Forgot password, as the ready email says. Only its hash leaves this function.
    const plain = tenant.admin_password || config?.company?.defaultPassword || crypto.randomBytes(24).toString('base64url')
    const passwordHash = await deps.hashPassword(plain)
    const provision = provisionBody(tenant, config, passwordHash)
    // The website: a signup's AI composition is settled (finished, redone after a restart, or given up on for the
    // template one stored at signup — services/signupSite.ts) while the database and service are made, and the provision
    // body is made from what stands once the new code answers. Only a site still waiting on the AI is settled; any
    // other composition is used as stored.
    const settling = wantsWebsite(tenant) && tenant.preview_premium_pages?.aiCompose && deps.settleSite
      ? deps.settleSite(tenant.id).catch((e: any) => { console.warn('[Unified] Site settle failed for', tenant.slug, '— the stored site is used:', e?.message) })
      : null
    const provisionNow = settling
      ? async () => {
          await settling
          const { data } = await db.from('tenants').select('preview_premium_pages').eq('id', tenant.id).maybeSingle()
          return provisionBody({ ...tenant, preview_premium_pages: data?.preview_premium_pages ?? tenant.preview_premium_pages }, config, passwordHash)
        }
      : provision
    const baseEnv = await deps.integrationEnv(tenant, config, { factoryUrl: deps.factoryUrl, guessUrl })

    // The media bucket every upload goes to (packages/tenant-backend files/storage.ts reads R2_*), made the template
    // path's way: '<name>-media', an existing one of that name reused. Non-blocking, as there: no bucket, no uploads.
    let r2Env: EnvVar[] = []
    let r2Bucket: string | null = null
    if (!deps.r2.configured()) console.log('[Unified] R2 not configured — no media bucket for', tenant.slug)
    else {
      try {
        const b = await deps.r2.ensureBucket(names.service)
        r2Bucket = b.bucketName
        r2Env = deps.r2.envVars(b.bucketName)
      } catch (e: any) { console.warn('[Unified] R2 bucket creation failed (non-blocking):', e?.message) }
    }
    const integrationEnv = (serviceUrl: string) => {
      const out = baseEnv(serviceUrl)
      return [...out, ...r2Env.filter((v) => !out.some((o) => o.key === v.key))]
    }

    console.log('[Unified] Building', tenant.slug, 'as', vertical, 'at', deps.version.slice(0, 9))
    const result = await buildUnifiedTenant({
      tenant: { id: tenant.id, slug: tenant.slug }, vertical, provision: provisionNow, integrationEnv, factoryUrl: deps.factoryUrl, domain: tenant.domain || null,
      owned, root: deps.root, version: deps.version, waitMs: deps.waitMs,
    }, deps.io)
    console.log('[Unified] Build steps for', tenant.slug + ':', JSON.stringify(result.steps))

    const rec = result.record
    // The record — written whenever something was made, success or not, so the next build and the teardown know it as
    // this tenant's (services/resourceOwnership.ts reads exactly these columns).
    if (rec) {
      const jobUpdate = {
        status: result.success ? 'complete' : 'failed',
        github_repo: 'https://github.com/' + rec.repo,
        render_url: rec.serviceUrl,
        render_service_ids: { backend: rec.serviceId, database: rec.databaseId },
      }
      const { error: jErr } = await db.from('factory_jobs').update(jobUpdate).eq('id', job.id)
      if (jErr) console.error('[Unified] Job update failed:', jErr.message)

      const critical: Record<string, any> = {
        render_frontend_url: rec.serviceUrl, render_backend_url: rec.serviceUrl,
        database_url: rec.databaseUrl, factory_sync_key: rec.factorySyncKey,
      }
      if (!tenant.admin_email && tenant.email) critical.admin_email = tenant.email
      const { error: cErr } = await db.from('tenants').update(critical).eq('id', tenant.id)
      if (cErr) {
        console.error('[Unified] CRITICAL tenant update failed:', cErr.message, Object.keys(critical).join(', '))
        void raiseAlert({ key: 'deploy-record:' + tenant.id, what: 'A build finished but its address could not be saved — the platform will not know where it lives', business: tenant.name || tenant.slug, detail: cErr.message, tenantId: tenant.id })
      }
      else await deps.audit(tenant.id, 'deploy', {
        render_frontend_url: { old: tenant.render_frontend_url || null, new: rec.serviceUrl },
        render_backend_url: { old: tenant.render_backend_url || null, new: rec.serviceUrl },
        database_url: { old: tenant.database_url ? '***masked***' : null, new: '***masked***' },
      }, 'system', `Deploy completed for ${tenant.slug} (unified ${deps.version.slice(0, 9)})`)

      const features = (provision as any).features as string[]
      if (features.length) {
        const { error } = await db.from('tenants').update({ features }).eq('id', tenant.id)
        if (error) console.warn('[Unified] Features record failed (non-blocking):', error.message)
      }
      // One write per optional field, as runDeploy does (a column missing from the live schema fails only its own).
      const optional: Record<string, any> = {}
      if (wantsWebsite(tenant)) optional.website_url = rec.serviceUrl
      if (r2Bucket) optional.r2_bucket_name = r2Bucket
      for (const [field, value] of Object.entries(optional)) {
        const { error } = await db.from('tenants').update({ [field]: value }).eq('id', tenant.id)
        if (error) console.warn('[Unified] Optional tenant field ' + field + ' failed (non-blocking):', error.message)
      }
    }

    if (!result.success || !rec) return await fail(result.errors.join('; ') || 'the build did not finish', result)

    // Serving: the build waited for the new commit to answer and the business to be provisioned.
    clearTimeout(stillWorking)
    const { error: aErr } = await db.from('tenants').update({ status: 'active' }).eq('id', tenant.id)
    if (aErr) console.error('[Unified] Failed to mark tenant active:', aErr.message)
    else await deps.audit(tenant.id, 'deploy', { status: { old: tenant.status, new: 'active' } }, 'system', 'Serving: ' + rec.serviceUrl + ' runs ' + rec.commit.slice(0, 9))

    // The running app's features and subscription, as runDeploy syncs them.
    const features = (provision as any).features as string[]
    if (features.length) {
      try {
        const res = await deps.fetch(rec.serviceUrl.replace(/\/$/, '') + '/api/internal/sync-features', {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Factory-Key': rec.factorySyncKey },
          body: JSON.stringify({ features }), signal: AbortSignal.timeout(15_000),
        })
        if (res.ok) deps.pushSubscription(tenant.id).catch(() => {})
        else {
          console.warn('[Unified] Feature sync HTTP', res.status, 'for', tenant.slug)
          void raiseAlert({ key: 'feature-sync:' + tenant.id, what: 'A new build is live but its features could not be switched on', business: tenant.name || tenant.slug, detail: 'HTTP ' + res.status, tenantId: tenant.id })
        }
      } catch (e: any) { console.warn('[Unified] Feature sync failed:', e?.message); void raiseAlert({ key: 'feature-sync:' + tenant.id, what: 'A new build is live but its features could not be switched on', business: tenant.name || tenant.slug, detail: e?.message, tenantId: tenant.id }) }
    }

    // The tenant's own domain: @, www and app.<domain> at its one service (services/deploy.ts unifiedDomainTargets).
    if (tenant.domain) {
      try {
        const targets = await deps.domains.targets({ slug: tenant.slug, engine: 'unified', render_backend_url: rec.serviceUrl })
        if (targets) {
          const d = await deps.domains.wire({
            domain: tenant.domain, ...targets, adminEmailForDmarc: tenant.admin_email || tenant.email,
            existingCloudflareZoneId: tenant.cloudflare_zone_id || undefined, existingSendgridDomainAuthId: tenant.sendgrid_domain_auth_id || undefined,
          })
          const domainUpdate: Record<string, any> = {}
          if (d.cloudflareZoneId) domainUpdate.cloudflare_zone_id = d.cloudflareZoneId
          if (d.sendgridDomainAuthId) domainUpdate.sendgrid_domain_auth_id = d.sendgridDomainAuthId
          if (Object.keys(domainUpdate).length) {
            const { error } = await db.from('tenants').update(domainUpdate).eq('id', tenant.id)
            if (error && error.code !== '42703') console.warn('[Unified] Domain ids persist failed:', error.message)
          }
          if (d.errors.length) {
            console.warn('[Unified] Domain errors:', d.errors.join('; '))
            void raiseAlert({ key: 'domain-wiring:' + tenant.id, what: 'A customer\'s own domain was not fully connected to their new site', business: tenant.name || tenant.slug, detail: d.errors.join('; '), tenantId: tenant.id })
          }
          deps.domains.reconcileAliases({
            id: tenant.id, slug: tenant.slug, domain: tenant.domain, engine: 'unified',
            cloudflare_zone_id: d.cloudflareZoneId || tenant.cloudflare_zone_id, render_backend_url: rec.serviceUrl,
            factory_sync_key: rec.factorySyncKey, products: tenant.products, website_url: wantsWebsite(tenant) ? rec.serviceUrl : tenant.website_url,
          })
        }
      } catch (e: any) {
        console.error('[Unified] Domain wiring threw:', e?.message)
        void raiseAlert({ key: 'domain-wiring:' + tenant.id, what: 'A customer\'s own domain was not connected to their new site', business: tenant.name || tenant.slug, detail: e?.message, tenantId: tenant.id })
      }
    }

    // The intake's photos into the tenant's own library (its one service answers POST /api/internal/seed-photos), for a
    // tenant that bought a website. Non-fatal, as for a premium site.
    if (wantsWebsite(tenant)) {
      await Promise.resolve().then(() => deps.seedPhotos(tenant.id)).catch((e: any) => console.warn('[Unified] Seed photos failed for', tenant.slug, ':', e?.message))
    }

    const base = rec.serviceUrl.replace(/\/$/, '')
    deps.notify.complete({ ...tenant, admin_password: undefined }, {
      deployedUrl: base + '/login', siteUrl: wantsWebsite(tenant) ? base : undefined, repoUrl: 'https://github.com/' + rec.repo,
    }).catch((e: any) => console.warn('[Unified] Ready email failed:', e?.message))

    // The plaintext password is scrubbed now the business holds its hash: not on the tenant row, not in the job config.
    const { error: scrubErr } = await db.from('tenants').update({ admin_password: null }).eq('id', tenant.id)
    if (scrubErr) console.warn('[Unified] admin_password scrub failed:', scrubErr.message)
    if (config?.company?.defaultPassword) {
      const { error } = await db.from('factory_jobs').update({ config: { ...config, company: { ...config.company, defaultPassword: undefined } } }).eq('id', job.id)
      if (error) console.warn('[Unified] job config password scrub failed:', error.message)
    }
    return { success: true, steps: result.steps, errors: [], serviceUrl: rec.serviceUrl }
  } catch (e: any) {
    console.error('[Unified] Deploy threw for', tenant.slug + ':', e?.message)
    return await fail(e?.message || String(e))
  } finally {
    clearTimeout(stillWorking)
    clearAlert('deploy-stalled:' + tenant.id)
  }
}

// ─── Update Code ───────────────────────────────────────────────────────────────

/**
 * Update Code for a unified tenant: the Factory's integration settings it lacks are added first (a key the Factory
 * gained since the build reaches it, as refreshPlatformIntegrationEnv does for a template CRM — never overwriting one
 * the tenant has), then the unified app at this Factory's version is pushed and waited for (unified/update.ts).
 */
export async function updateUnifiedTenantCode(tenantId: string, depsIn?: UnifiedDeps): Promise<UpdateResult> {
  const deps = depsIn || await liveUnifiedDeps()
  const { db } = deps
  const { data: tenant } = await db.from('tenants').select('*').eq('id', tenantId).single()
  if (!tenant) return { tenantId, success: false, steps: [], errors: ['tenant not found'] }
  if (!isUnifiedTenant(tenant)) return { tenantId, success: false, steps: [], errors: ['tenant ' + tenant.slug + ' runs the templates'] }
  const { data: jobs } = await db.from('factory_jobs').select('*').eq('tenant_id', tenantId).order('created_at', { ascending: false })
  const built = (jobs || []).find((j: any) => j.github_repo && j.render_service_ids?.backend)
  if (!built || !tenant.render_backend_url) return { tenantId, success: false, steps: [], errors: ['no unified build recorded for ' + tenant.slug + ' — deploy it first'] }

  let owned: Owned
  try { owned = toOwned(await deps.owned(tenantId)) } catch (e: any) {
    return { tenantId, success: false, steps: [], errors: ['tenant records unreadable (' + e?.message + ') — nothing was changed'] }
  }
  const record = { tenantId, slug: tenant.slug, repo: repoKey(built.github_repo), serviceId: built.render_service_ids.backend, serviceUrl: tenant.render_backend_url }

  const steps: Step[] = []
  // The settings first, so the deploy the push starts carries them — only on the service recorded as this tenant's.
  if (owned.serviceIds.has(record.serviceId)) {
    try {
      const envFor = await deps.integrationEnv(tenant, built.config || {}, { factoryUrl: deps.factoryUrl, guessUrl: record.serviceUrl })
      const current = await deps.io.hosts.getEnv(record.serviceId)
      const missing = envFor(record.serviceUrl).filter((v) => !(v.key in current))
      if (missing.length) await deps.io.hosts.setEnv(record.serviceId, missing)
      steps.push({ step: 'settings', status: 'ok', detail: missing.length ? 'added ' + missing.map((v) => v.key).join(', ') : 'nothing missing' })
    } catch (e: any) {
      steps.push({ step: 'settings', status: 'error', detail: e?.message })
    }
  }
  const r = await updateUnifiedTenant(record, owned, { root: deps.root, version: deps.version, waitMs: deps.waitMs }, deps.io)
  return { ...r, steps: [...steps, ...r.steps] }
}
