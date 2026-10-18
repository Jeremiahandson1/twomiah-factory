// The company-wide modules every tenant has, website-only or not: the company and its people, billing, the
// account (offboarding), branded email addresses, the lead inbox and the audit log. Each is a shared plug-in
// (packages/tenant-backend), wired here once with the app's database, tables, sign-in and permissions — the same
// wiring every CRM template carried in its own routes/*.ts.
import { Hono } from 'hono'
import {
  createCompanyRoutes, createBillingRoutes, createSubscriptionSyncRoute, createAccountRoutes, createFactoryApiClient,
  createEmailAliasesRoutes, createEmailAliasesInternalRoute, createLeadsRoutes, TRADES_LEAD_PLATFORMS,
} from '@twomiah/tenant-backend'
import { asc, eq } from 'drizzle-orm'
import { company, user, emailAlias, lead, leadSource, contact } from '../db/schema/index.ts'
import type { VerticalSettings } from '../core/vertical.ts'
import type { Audit } from '../core/audit.ts'
import type { EmailService } from '../core/email.ts'
import { queryAudit, auditFilterOptions } from '../data/audit.ts'
import { list, one, fail, done } from '../http/reply.ts'
import type { AppEnv } from '../http/env.ts'

export interface CompanyModuleDeps {
  db: any
  vertical: VerticalSettings
  audit: Audit
  email: EmailService
  authenticate: any
  permissions: any
  features: { forgetFeatures: (companyId?: string) => void }
  /** The public enquiry endpoint, answered before the lead inbox's own sign-in (site/enquiryHandler.ts). */
  enquiryHandler: (c: any) => Promise<Response>
}

export function createCompanyModules(deps: CompanyModuleDeps) {
  const { db, vertical, audit, email, authenticate, permissions } = deps
  const factoryApiClient = createFactoryApiClient() as any
  const canSee = async (role: string, permission: string, userId?: string) =>
    permissions.hasPermission(role, permission, await permissions.getExtraPermissions(userId))
  const isAdmin = (c: any, next: any) => {
    const u = c.get('user')
    if (!u || !['owner', 'admin'].includes(u.role)) return fail(c, 403, 'Insufficient permissions')
    return next()
  }

  const companyRoutes = createCompanyRoutes({
    db, tables: { company, user }, authenticate, requireAdmin: isAdmin,
    requirePermission: permissions.requirePermission, requireAnyPermission: permissions.requireAnyPermission,
    canSee, invalidateExtraPermissions: permissions.invalidateExtraPermissions, roleLabel: permissions.roleLabel,
    audit, template: vertical.featureSet,
    sendInvite: (to: string, data: any) => email.sendTeamInvite(to, { ...data, inviteLink: `${process.env.FRONTEND_URL || ''}/reset-password?token=${data.resetToken}` }),
  } as any)

  const billingDeps = { db, companyTable: company, userTable: user, factoryApiClient, seatLimitEnv: process.env.SEAT_LIMIT }
  const billing = new Hono().use('*', isAdmin).route('/', createBillingRoutes({
    ...billingDeps,
    canManage: async (c: any) => { const u = c.get('user'); return !!u && permissions.hasPermission(u.role, 'billing:manage', await permissions.getExtraPermissions(u.userId)) },
  } as any))

  const account = new Hono().use('*', isAdmin).route('/', createAccountRoutes({ factoryApiClient }))
  const emailAliases = new Hono().use('*', isAdmin).route('/', createEmailAliasesRoutes({ db, emailAliasesTable: emailAlias, factoryApiClient } as any))

  // POST / is the public enquiry; the rest is the lead inbox, which signs people in itself (after its two inbound
  // routes, which carry their own secrets).
  const leads = new Hono()
    .post('/', (c) => deps.enquiryHandler(c))
    .route('/', createLeadsRoutes({
      db, tables: { lead, leadSource, contact }, authenticate, requirePermission: permissions.requirePermission, canSee,
      // No live updates yet (the CRM's socket server arrives with step 3); a new lead shows on the next load.
      emitToCompany: () => {}, EVENTS: { LEAD_CREATED: 'lead:created', LEAD_UPDATED: 'lead:updated', CONTACT_CREATED: 'contact:created' },
      audit, options: { platforms: TRADES_LEAD_PLATFORMS, contactType: 'lead' },
    } as any))

  const auditLogRoutes = new Hono<AppEnv>()
    .get('/', permissions.requirePermission('audit:read'), async (c) => {
      const u = c.get('user')
      const q = c.req.query()
      const page = Math.max(1, parseInt(q.page || '1', 10) || 1)
      const limit = Math.min(500, Math.max(1, parseInt(q.limit || '50', 10) || 50))
      const { rows, total } = await queryAudit(db, { companyId: u.companyId, entity: q.entity, entityId: q.entityId, action: q.action, userId: q.userId, startDate: q.startDate, endDate: q.endDate, page, limit })
      return list(c, rows, { page, limit, total })
    })
    .get('/filters', permissions.requirePermission('audit:read'), async (c) => {
      const u = c.get('user')
      return one(c, await auditFilterOptions(db, u.companyId))
    })

  // The Factory sets which features this tenant has (it replaces the list; the Factory reconciles first).
  const syncFeatures = new Hono().post('/', async (c) => {
    const body = await c.req.json().catch(() => ({})) as { features?: unknown }
    if (!Array.isArray(body.features) || !body.features.every((f) => typeof f === 'string')) return fail(c, 400, 'features must be an array of feature ids')
    const [co] = await db.select({ id: company.id }).from(company).orderBy(asc(company.createdAt)).limit(1)
    if (!co) return fail(c, 404, 'No company found')
    await db.update(company).set({ enabledFeatures: body.features, updatedAt: new Date() }).where(eq(company.id, co.id))
    deps.features.forgetFeatures(co.id)
    return done(c)
  })

  return {
    mounts: [
      { path: '/api/company', access: 'user' as const, router: companyRoutes },
      { path: '/api/billing', access: 'user' as const, router: billing },
      { path: '/api/account', access: 'user' as const, router: account },
      { path: '/api/email-aliases', access: 'user' as const, router: emailAliases },
      { path: '/api/audit', access: 'user' as const, router: auditLogRoutes },
      { path: '/api/leads', access: 'public' as const, router: leads },
      { path: '/api/internal/email-aliases', access: 'factory' as const, router: createEmailAliasesInternalRoute({ db, emailAliasesTable: emailAlias } as any) },
      { path: '/api/internal/sync-subscription', access: 'factory' as const, router: createSubscriptionSyncRoute(billingDeps as any) },
      { path: '/api/internal/sync-features', access: 'factory' as const, router: syncFeatures },
    ],
  }
}
