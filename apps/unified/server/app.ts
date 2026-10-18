// The unified server (SPEC §3, §7): every service wired once, every API mounted through the registry. Takes its
// database and vertical as arguments, so a test can boot the real thing against a throwaway database.
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { secureHeaders } from 'hono/secure-headers'
import { asc } from 'drizzle-orm'
import {
  createAuthMiddleware, createPermissions, createEnabledFeatureGate, createWriteAuditFloor, createAuthRoutes, createMfaRoutes,
} from '@twomiah/tenant-backend'
import * as schema from './db/schema/index.ts'
import { company, user } from './db/schema/index.ts'
import logger from './core/logger.ts'
import { createAudit, requestScope } from './core/audit.ts'
import { createEmailService } from './core/email.ts'
import type { VerticalSettings } from './core/vertical.ts'
import { mountAll, type Mount } from './http/registry.ts'
import { contentSecurityPolicy, pagingGuard, createRateLimiter, isWrite } from './http/guards.ts'
import { errorHandler } from './http/errors.ts'
import { fail, one } from './http/reply.ts'

export function createApp(deps: { db: any; vertical: VerticalSettings }) {
  const { db, vertical } = deps

  const audit = createAudit({ db })
  const email = createEmailService({ db, logger })
  const { authenticate } = createAuthMiddleware({ db, tables: { user, company } })
  const permissions = createPermissions({
    db, tables: { user },
    roleLabels: vertical.roleLabels,
    extraRolePermissions: vertical.extraRolePermissions,
  })
  const features = createEnabledFeatureGate({ db, tables: { company } })

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

  app.get('/health', (c) => one(c, { status: 'ok', timestamp: new Date().toISOString(), uptime: process.uptime() }))

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
  ]
  mountAll(app, mounts, {
    authenticate,
    requireEnabledFeature: features.requireEnabledFeature,
    isFeatureEnabled: features.isFeatureEnabled,
    companyId,
  })

  app.onError(errorHandler)
  // An unknown API path is a JSON 404, never the screen's HTML with a 200.
  app.notFound((c) => fail(c, 404, `Route not found: ${c.req.method} ${c.req.path}`))

  return { app, services: { audit, email, permissions, features, authenticate, companyId } }
}
