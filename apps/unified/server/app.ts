// The unified server (SPEC §3, §7): every service wired once, every API mounted through the registry. Takes its
// database and vertical as arguments, so a test can boot the real thing against a throwaway database.
import { Hono, type MiddlewareHandler } from 'hono'
import { cors } from 'hono/cors'
import { secureHeaders } from 'hono/secure-headers'
import { asc } from 'drizzle-orm'
import {
  createAuthMiddleware, createPermissions, createEnabledFeatureGate, createWriteAuditFloor, createAuthRoutes, createMfaRoutes, createFileStorage,
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
import { createCrmModules, createCrmAdsConnector } from './modules/crm.ts'
import { createCrmServices } from './crm/services.ts'
import { createRealtime } from './core/realtime.ts'
import { createSiteAdmin, type PhotoStore } from './site/admin.ts'
import { createSiteRoutes } from './site/routes.ts'
import { loadSiteContext } from './site/context.ts'
import { createBookingPages } from './booking/pages.ts'
import { BASE_CRM, type VerticalSettings } from './core/vertical.ts'
import { mountAll, type Mount } from './http/registry.ts'
import { createAdminScreens } from './http/adminScreens.ts'
import { contentSecurityPolicy, sitePolicy, pagingGuard, createRateLimiter, isWrite } from './http/guards.ts'
import { errorHandler } from './http/errors.ts'
import { fail, one } from './http/reply.ts'

const NOT_FOUND_PAGE = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Page not found</title>' +
  '<style>body{margin:0;min-height:100vh;display:grid;place-items:center;font:17px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;background:#f7f7f5;color:#1a1a1a}main{max-width:30rem;padding:2rem 1rem;text-align:center}h1{font-size:1.6rem;margin:0 0 .5rem}a{color:inherit;font-weight:600}</style></head>' +
  '<body><main><h1>That page isn’t here.</h1><p>It may have moved, or the link may be wrong.</p><p><a href="/">Go to the home page</a></p></main></body></html>'

/** The shared R2 file storage, as the photo store the website uses. */
function sharedPhotoStore(): PhotoStore {
  const s = createFileStorage()
  return { put: (k, b, t) => s.put(k, b, t), getObject: (k) => s.getObject(k), remove: async (k) => { s.deleteFile(k) } }
}

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
}

export function createApp(deps: { db: any; vertical: VerticalSettings; store?: PhotoStore; adminDist?: string; testing?: TestSeams }) {
  const { db, vertical } = deps
  const store = deps.store ?? sharedPhotoStore()

  const audit = createAudit({ db })
  const email = createEmailService({ db, logger })
  const realAuth = createAuthMiddleware({ db, tables: { user, company } }).authenticate as MiddlewareHandler
  const authenticate = deps.testing?.authenticate ? deps.testing.authenticate(realAuth) : realAuth
  const permissions = createPermissions({
    db, tables: { user },
    roleLabels: vertical.roleLabels,
    extraRolePermissions: vertical.extraRolePermissions,
    roleMapping: vertical.roleMapping,
  })
  const features = createEnabledFeatureGate({ db, tables: { company } })
  email.register(enquiryTemplates)
  const enquiries = createEnquiries({ db, email, logger, isFeatureEnabled: features.isFeatureEnabled, to: vertical.crm?.websiteEnquiries, forms: vertical.crm?.websiteForms })
  const enquiryHandler = createEnquiryHandler({ db, vertical, enquiries })
  const realtime = createRealtime()
  const adsConnector = createCrmAdsConnector()
  const crm = createCrmServices({ db, email, audit, logger, isFeatureEnabled: features.isFeatureEnabled, settings: vertical.crm ?? BASE_CRM })
  const companyModules = createCompanyModules({ db, vertical, audit, email, authenticate, permissions, features, enquiryHandler, realtime, adsConnector })
  // Card deposits and people's own calendars join with the CRM's payments and calendar sync (CUTOVER_LEDGER).
  const bookings = createBookingModule({ db, vertical, email, logger, permissions })

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
  app.use('*', secureHeaders({ crossOriginResourcePolicy: 'cross-origin' }))
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
    { path: '/api/auth/mfa-devices', access: 'user', router: createMfaRoutes({ db, authenticate, audit, issuer: vertical.mfaIssuer }) },
    // The company, its people, billing, email addresses, the lead inbox (and the public enquiry), the audit log.
    ...companyModules.mounts,
    // Bookings: the owner's book, the public booking API, the scheduled messages.
    ...bookingMounts(bookings, companyId),
    // The CRM: contacts, jobs, quotes, invoices and every module the shared code carries.
    ...createCrmModules({ db, audit, logger, authenticate, permissions, features, realtime, services: crm, adsConnector, settings: vertical.crm ?? BASE_CRM }),
    // The website's admin: pages, settings, photos, blog, portfolio, visits.
    { path: '/api/site', access: 'user', router: createSiteAdmin({ db, permissions, store, vertical }) },
    // The admin screens: their page at /login and /crm/*, their files at /crm-assets/*. Before the website.
    {
      path: '/', admin: true, access: 'public',
      router: createAdminScreens({
        distDir: deps.adminDist,
        screens: () => vertical.screens,
        companyName: async () => (await db.select({ name: company.name }).from(company).orderBy(asc(company.createdAt)).limit(1))[0]?.name ?? null,
      }),
    },
    // The public website. Last: its /:slug catch-all must come after every other path.
    // The booking pages (/book, /booking/<token>) are part of it, ahead of its pages by slug.
    {
      path: '/', site: true, access: 'public',
      router: new Hono()
        .use('*', sitePolicy)
        .route('/', createBookingPages({ engine: bookings.engine, ctxOf: () => loadSiteContext(db, vertical), isFeatureEnabled: features.isFeatureEnabled }))
        .route('/', createSiteRoutes({ db, vertical, enquiries: enquiryHandler, store })),
    },
  ]
  mountAll(app, mounts, {
    authenticate,
    requireEnabledFeature: deps.testing?.featureGates === false ? () => (async (_c, next) => { await next() }) as MiddlewareHandler : features.requireEnabledFeature,
    // The public mounts' gate (a feature off answers 404) follows the same testing seam as the signed-in one.
    isFeatureEnabled: deps.testing?.featureGates === false ? async () => true : features.isFeatureEnabled,
    companyId,
  })

  app.onError(errorHandler)
  // An unknown API path is a JSON 404, never a page with a 200; an unknown web page is a page saying so.
  app.notFound((c) => c.req.path.startsWith('/api/')
    ? fail(c, 404, `Route not found: ${c.req.method} ${c.req.path}`)
    : c.html(NOT_FOUND_PAGE, 404))

  return { app, services: { audit, email, permissions, features, authenticate, companyId, enquiries, bookings, crm, realtime, mounts, refreshSubscription: companyModules.refreshSubscription } }
}
