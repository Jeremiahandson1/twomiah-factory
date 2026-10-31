// The unified server (SPEC §3, §7): every service wired once, every API mounted through the registry. Takes its
// database and vertical as arguments, so a test can boot the real thing against a throwaway database.
import { Hono, type MiddlewareHandler } from 'hono'
import { cors } from 'hono/cors'
import { secureHeaders } from 'hono/secure-headers'
import { asc } from 'drizzle-orm'
import {
  createAuthMiddleware, createPermissions, createEnabledFeatureGate, createWriteAuditFloor, createAuthRoutes, createMfaRoutes,
} from '@twomiah/tenant-backend'
import * as schema from './db/schema/index.ts'
import { company, user } from './db/schema/index.ts'
import logger from './core/logger.ts'
import { APP_VERSION } from './core/version.ts'
import { createAudit, requestScope } from './core/audit.ts'
import { createEmailService } from './core/email.ts'
import { createEnquiries, enquiryTemplates } from './core/enquiry.ts'
import { createEnquiryHandler } from './site/enquiryHandler.ts'
import { createCompanyModules } from './modules/company.ts'
import { createBookingModule, bookingMounts } from './modules/booking.ts'
import { createStripeDeposits } from './booking/deposits.ts'
import { createBookingTexts } from './booking/texts.ts'
import { createCrmModules, createCrmAdsConnector } from './modules/crm.ts'
import { createCrmServices } from './crm/services.ts'
import { createRealtime } from './core/realtime.ts'
import { createSiteAdmin, createSeedPhotosRoute, sharedPhotoStore, type PhotoStore } from './site/admin.ts'
import { createSiteRoutes, siteStylesheet } from './site/routes.ts'
import { createStorefront } from './crm/store/index.ts'
import { createBarSite, createMenuSite } from './crm/bar/barSite.ts'
import { createBarLive } from './crm/bar/barLive.ts'
import { loadSiteContext } from './site/context.ts'
import { createBookingPages } from './booking/pages.ts'
import { BASE_CRM, type VerticalSettings } from './core/vertical.ts'
import { mountAll, type Mount } from './http/registry.ts'
import { savedOnce } from './http/savedOnce.ts'
import { createAdminScreens, HOMECARE_PAGES } from './http/adminScreens.ts'
import { contentSecurityPolicy, sitePolicy, frameOptions, pagingGuard, createRateLimiter, isWrite } from './http/guards.ts'
import { errorHandler } from './http/errors.ts'
import { adminHostHandover } from './http/adminHost.ts'
import { fail, one } from './http/reply.ts'
import { createLive, LIVE_SOCKET_PATH } from './http/live.ts'
import { createDownloadLinks, DOWNLOAD_PATH } from './http/downloads.ts'
import { createPhonePush } from './core/phonePush.ts'
import { createPhoneRules } from './crm/notify/phoneRules.ts'
import { withHomecareSessions, viewAsCareTrail } from './crm/homecare/office/signIn.ts'
import { createViewAs } from './core/viewAs.ts'
import { hasConsent } from './site/smsConsent.ts'

const NOT_FOUND_PAGE = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Page not found</title>' +
  '<style>body{margin:0;min-height:100vh;display:grid;place-items:center;font:17px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;background:#f7f7f5;color:#1a1a1a}main{max-width:30rem;padding:2rem 1rem;text-align:center}h1{font-size:1.6rem;margin:0 0 .5rem}a{color:inherit;font-weight:600}</style></head>' +
  '<body><main><h1>That page isn’t here.</h1><p>It may have moved, or the link may be wrong.</p><p><a href="/">Go to the home page</a></p></main></body></html>'


/**
 * Test seams, used only by the behaviour-suite harness (tests/unified/harness/runUnifiedSuite.ts), which runs the CRM
 * templates' own tests against this app: they sign in with an x-test-user header, and, like those templates' route
 * files, reach a module without the feature gate the template's index.ts put in front of it.
 */
export interface TestSeams {
  /** Wraps the real sign-in check (the suites' header bridge falls back to it). */
  authenticate?: (real: MiddlewareHandler) => MiddlewareHandler
  /** false: the registry mounts every module without its feature gate. */
  featureGates?: boolean
  /** A fake Stripe client for the card-payment code, so no test calls Stripe (tests/booking-deposits.test.ts). */
  stripe?: any
}

export function createApp(deps: { db: any; vertical: VerticalSettings; store?: PhotoStore; adminDist?: string; testing?: TestSeams }) {
  const { db, vertical } = deps
  const store = deps.store ?? sharedPhotoStore()

  const audit = createAudit({ db })
  const email = createEmailService({ db, logger })
  const permissions = createPermissions({
    db, tables: { user },
    roleLabels: vertical.roleLabels,
    extraRolePermissions: vertical.extraRolePermissions,
    withheldRolePermissions: vertical.withheldRolePermissions,
    roleMapping: vertical.roleMapping,
  })
  const sharedAuth = createAuthMiddleware({ db, tables: { user, company } }).authenticate as MiddlewareHandler
  // View As, every vertical (core/viewAs.ts): the owner or an admin opens the app as one of their people. Home care
  // keeps its own on top — viewing as a caregiver is read-only, and signing out ends every session
  // (crm/homecare/office/signIn.ts) — inside, so Return from a View As is answered before it.
  const viewAs = createViewAs({ db, permissions, careTrail: vertical.crm?.homecare ? viewAsCareTrail(db) : undefined })
  const realAuth = viewAs.wrap(vertical.crm?.homecare ? withHomecareSessions(sharedAuth, { db, logger }) : sharedAuth)
  const authenticate = deps.testing?.authenticate ? deps.testing.authenticate(realAuth) : realAuth
  const features = createEnabledFeatureGate({ db, tables: { company } })
  email.register(enquiryTemplates)
  const enquiries = createEnquiries({ db, email, logger, isFeatureEnabled: features.isFeatureEnabled, to: vertical.crm?.websiteEnquiries, forms: vertical.crm?.websiteForms })
  const enquiryHandler = createEnquiryHandler({ db, vertical, enquiries })
  const realtime = createRealtime()
  const live = createLive({ realtime })
  // The app is made below; a link fetches through it (as the person who asked), so it is reached lazily.
  const downloads = createDownloadLinks({ fetchApp: (req) => app.fetch(req) })
  const adsConnector = createCrmAdsConnector()
  const crm = createCrmServices({ db, email, audit, logger, isFeatureEnabled: features.isFeatureEnabled, settings: vertical.crm ?? BASE_CRM, featureSet: vertical.featureSet, vocabulary: vertical.vocabulary, stripe: deps.testing?.stripe })
  // Phone notifications, every vertical: the sender and the phones (core/phonePush.ts), and who is told what — a job
  // assigned or rescheduled, a new lead (crm/notify/phoneRules.ts). The job scan is timed work: boot only, never tests.
  const phonePush = createPhonePush({ db, logger })
  const phoneRules = createPhoneRules({ db, phonePush, realtime, permissions, companyId: () => companyId(), logger })
  crm.addJob(() => phoneRules.start())
  const companyModules = createCompanyModules({ db, vertical, audit, email, authenticate, permissions, features, enquiryHandler, realtime, adsConnector, store })
  // Card deposits on the business's own Stripe account (booking/deposits.ts), paid deposits back to the booking engine;
  // people's own calendars are the module's (booking/calendars.ts).
  // Texts to the customer (confirmation, reminder, review request) through the CRM's own texting (booking/texts.ts).
  const bookings = createBookingModule({ db, vertical, email, logger, permissions, isFeatureEnabled: features.isFeatureEnabled, deposits: createStripeDeposits(crm.stripeService), texts: createBookingTexts(crm.sms, (co, phone) => hasConsent(db, co, phone)) })
  crm.useBookingDeposits({
    paid: (p) => bookings.engine.depositPaid(p.companyId, p.bookingId, p.paymentIntentId),
    refunded: (p) => bookings.engine.depositRefunded(p.companyId, p.bookingId, p.paymentIntentId),
  })
  // Its reminders, rebook nudges and review requests go out on its own clock (the premium sites waited for the Factory's
  // three crons, which reach only `<slug>-site` addresses). Boot only, never tests; the Factory's door stays.
  crm.addJob(() => bookings.startJobs())

  /** One company per tenant database (SPEC §2): the oldest row is the business. */
  async function companyId(): Promise<string | null> {
    const [row] = await db.select({ id: company.id }).from(company).orderBy(asc(company.createdAt)).limit(1)
    return row?.id ?? null
  }

  const app = new Hono()

  // Order matters. The request scope opens first, so every audit row written below it can see the request;
  // the write floor sits right under it, so it can see whether a handler already logged.
  app.use('*', (c, next) => requestScope.run({ c }, next))
  app.use('*', createWriteAuditFloor({ db, schema, log: audit.log, scope: requestScope }))
  // X-Frame-Options is frameOptions' (http/guards.ts): SAMEORIGIN everywhere but the booking embed.
  app.use('*', secureHeaders({ crossOriginResourcePolicy: 'cross-origin', xFrameOptions: false }))
  app.use('*', frameOptions)
  app.use('*', contentSecurityPolicy)
  app.use('/api/*', pagingGuard)
  app.use('*', cors({
    origin: process.env.FRONTEND_URL || '*',
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token', 'X-Request-ID'],
    credentials: true,
  }))
  // Reads and writes have separate budgets, so browsing can't use up saving.
  app.use('/api/*', createRateLimiter(15 * 60 * 1000, process.env.NODE_ENV === 'production' ? 6000 : 100000, (m) => !isWrite(m)))
  app.use('/api/*', createRateLimiter(15 * 60 * 1000, process.env.NODE_ENV === 'production' ? 1200 : 100000, isWrite))
  // Per address: a ceiling on a flood from one place. The per-person lock (10 failures) lives in shared auth.
  app.use('/api/auth/login', createRateLimiter(15 * 60 * 1000, 150))
  app.use('/api/auth/forgot-password', createRateLimiter(15 * 60 * 1000, 20))
  app.use('/api/auth/web-handoff/*', createRateLimiter(15 * 60 * 1000, 60))

  // `commit` is the tenant repo's commit this instance runs (Render sets it): Update Code waits for the commit it
  // pushed, because Render reports a deploy live while the old instance still answers. `version` is the unified app's.
  app.get('/health', (c) => one(c, {
    status: 'ok', timestamp: new Date().toISOString(), uptime: process.uptime(),
    commit: process.env.RENDER_GIT_COMMIT || null, version: APP_VERSION,
  }))

  const mounts: Mount[] = [
    // Sign-in, refresh and password reset are public; the routes that need a session apply it themselves.
    {
      path: '/api/auth',
      access: 'public',
      router: createAuthRoutes({
        db, tables: { user, company }, authenticate,
        permissions: {
          getPermissions: permissions.getPermissions, normalizeRole: permissions.normalizeRole,
          hasPermission: permissions.hasPermission, roleLabel: permissions.roleLabel,
          ROLE_HIERARCHY: permissions.ROLE_HIERARCHY, getExtraPermissions: permissions.getExtraPermissions,
        },
        emailService: email, logger, audit,
        options: { vertical: vertical.id, visionUrl: vertical.visionUrl },
      }),
    },
    // Live updates (http/live.ts): the one-time ticket behind sign-in; the socket takes the ticket instead.
    { path: '/api/live', access: 'user', router: live.ticketRoutes },
    { path: LIVE_SOCKET_PATH, access: 'public', router: live.socketRoutes },
    // One-time download links (http/downloads.ts): asked behind sign-in, fetched by the random token, as the asker.
    { path: '/api/downloads', access: 'user', router: downloads.linkRoutes },
    { path: DOWNLOAD_PATH, access: 'public', router: downloads.downloadRoutes },
    { path: '/api/auth/mfa-devices', access: 'user', router: createMfaRoutes({ db, authenticate, audit, issuer: vertical.mfaIssuer }) },
    // View As (core/viewAs.ts): start one, and the banner's "is this a View As?". Return is POST /api/auth/logout.
    { path: '/api/auth/impersonate', access: 'user', router: viewAs.routes },
    // The company, its people, billing, email addresses, the lead inbox (and the public enquiry), the audit log.
    ...companyModules.mounts,
    // Bookings: the owner's book, the public booking API, the scheduled messages.
    ...bookingMounts(bookings, companyId),
    // The CRM: contacts, jobs, quotes, invoices and every module the shared code carries.
    // This phone's push token, for every vertical (core/phonePush.ts) — before any module's own /api/push.
    { path: '/api/push/expo-token', access: 'user', router: phonePush.tokenRoutes },
    ...createCrmModules({ db, audit, logger, authenticate, permissions, features, realtime, phonePush, services: crm, adsConnector, settings: vertical.crm ?? BASE_CRM, customerWord: vertical.vocabulary.customer.one, store }),
    // The website's admin: pages, settings, photos, blog, portfolio, visits — and the editor's preview, which draws a draft
    // through the website's own routes (site/preview.ts).
    { path: '/api/site', access: 'user', router: createSiteAdmin({ db, permissions, store, vertical, preview: { fetchApp: (req) => app.fetch(req), stylesheet: siteStylesheet } }) },
    // The photos the business gave at signup, copied in by the Factory after the build (site/admin.ts).
    { path: '/api/internal/seed-photos', access: 'factory', router: createSeedPhotosRoute({ db, store, companyId }) },
    // The admin screens: their page at /login and /crm/*, their files at /crm-assets/*. Before the website.
    {
      path: '/', admin: true, access: 'public',
      router: createAdminScreens({
        distDir: deps.adminDist,
        // The vertical's screen settings, and the browser's Google Maps key at run time (address search, satellite tiles):
        // its OWN key, restricted to the tenant's web addresses — never the server's GOOGLE_MAPS_API_KEY, which can't be
        // restricted that way and which the templates baked into every page (CUTOVER_LEDGER, Roofing). Absent: the
        // address box is a plain box.
        // And the switch the call log rides (CrmSettings.callTrackingSwitch), for the AI Receptionist page.
        // roleLabels: what this vertical calls each rung — the one vocabulary the server's refusals and Users rows answer in
        // (VerticalSettings.roleLabels through permissions.roleLabel), handed to the screens so the Users list, the role
        // picker and the View As banner say the same word (roofing live re-test 3: "Staff" in Users, "Field" in the brief).
        screens: () => ({ ...vertical.screens, vocabulary: vertical.vocabulary, roleLabels: Object.fromEntries((permissions.ROLE_HIERARCHY as string[]).map((r) => [r, permissions.roleLabel(r)])), mapsBrowserKey: process.env.GOOGLE_MAPS_BROWSER_KEY || '', callTrackingSwitch: vertical.crm?.callTrackingSwitch ?? 'call_tracking' }),
        extraPages: vertical.crm?.homecare ? HOMECARE_PAGES : [],
        brand: async () => (await db.select({ primaryColor: company.primaryColor, secondaryColor: company.secondaryColor, email: company.email }).from(company).orderBy(asc(company.createdAt)).limit(1))[0] ?? null,
        companyName: async () => (await db.select({ name: company.name }).from(company).orderBy(asc(company.createdAt)).limit(1))[0]?.name ?? null,
      }),
    },
    // The public website. Last: its /:slug catch-all must come after every other path.
    // The booking pages (/book, /booking/<token>) are part of it, ahead of its pages by slug.
    {
      path: '/', site: true, access: 'public',
      router: new Hono()
        // On app.<domain> the website half hands over to the admin (http/adminHost.ts), as the templates' CRM service did.
        .use('*', adminHostHandover())
        .use('*', sitePolicy)
        .route('/', createBookingPages({ engine: bookings.engine, ctxOf: () => loadSiteContext(db, vertical), isFeatureEnabled: features.isFeatureEnabled }))
        // A store's website reads its shop through the store add-on (crm/store createStorefront); a bar's sections read
        // its night through the bar add-on (crm/bar/barSite.ts, SiteSettings.facts).
        .route('/', createSiteRoutes({
          db, vertical, enquiries: enquiryHandler, store, shop: vertical.crm?.store ? createStorefront({ db, logger, services: crm, audit, isFeatureEnabled: features.isFeatureEnabled }) : null,
          facts: vertical.site.facts === 'bar' ? createBarSite({ db, live: createBarLive(db) })
            : vertical.site.facts === 'menu' ? createMenuSite({ db, live: createBarLive(db) }) : null,
        })),
    },
  ]
  mountAll(app, mounts, {
    authenticate,
    requireEnabledFeature: deps.testing?.featureGates === false ? () => (async (_c, next) => { await next() }) as MiddlewareHandler : features.requireEnabledFeature,
    // The public mounts' gate (a feature off answers 404) follows the same testing seam as the signed-in one.
    isFeatureEnabled: deps.testing?.featureGates === false ? async () => true : features.isFeatureEnabled,
    companyId,
    savedOnce: savedOnce(db),
  })

  app.onError(errorHandler)
  // An unknown API path is a JSON 404, never a page with a 200; an unknown web page is a page saying so.
  app.notFound((c) => c.req.path.startsWith('/api/')
    ? fail(c, 404, `Route not found: ${c.req.method} ${c.req.path}`)
    : c.html(NOT_FOUND_PAGE, 404))

  return { app, services: { audit, email, permissions, features, authenticate, companyId, enquiries, bookings, crm, realtime, live, phonePush, phoneRules, mounts, refreshSubscription: companyModules.refreshSubscription, dropUnofferedFeatures: companyModules.dropUnofferedFeatures } }
}
