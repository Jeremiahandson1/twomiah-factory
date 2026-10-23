// The company-wide modules every tenant has, website-only or not: the company and its people, billing, the
// account (offboarding), branded email addresses, the lead inbox and the audit log. Each is a shared plug-in
// (packages/tenant-backend), wired here once with the app's database, tables, sign-in and permissions — the same
// wiring every CRM template carried in its own routes/*.ts.
import { Hono } from 'hono'
import {
  createCompanyRoutes, createBillingRoutes, createSubscriptionSyncRoute, createAccountRoutes, createFactoryApiClient,
  createEmailAliasesRoutes, createEmailAliasesInternalRoute, createLeadsRoutes, TRADES_LEAD_PLATFORMS, refreshSubscriptionFromFactory,
  withoutNotReady, withinOffer,
} from '@twomiah/tenant-backend'
import { asc, eq } from 'drizzle-orm'
import { company, user, emailAlias, lead, leadSource, contact } from '../db/schema/index.ts'
import type { VerticalSettings } from '../core/vertical.ts'
import type { Audit } from '../core/audit.ts'
import type { EmailService } from '../core/email.ts'
import { queryAudit, auditFilterOptions } from '../data/audit.ts'
import { list, one, fail, done } from '../http/reply.ts'
import type { AppEnv } from '../http/env.ts'
import type { Realtime } from '../core/realtime.ts'
import { createProvisionRoute } from './provision.ts'
import { createDomainRoutes } from './domain.ts'
import { homecareCompanyFields, describeAgency } from '../crm/homecare/office/companyFields.ts'
import { createCompanyLogoRoute } from './companyLogo.ts'
import type { PhotoStore } from '../site/admin.ts'

export interface CompanyModuleDeps {
  db: any
  vertical: VerticalSettings
  audit: Audit
  email: EmailService
  authenticate: any
  permissions: any
  features: { forgetFeatures: (companyId?: string) => void; requireEnabledFeature: (feature: string | string[]) => any }
  /** The public enquiry endpoint, answered before the lead inbox's own sign-in (site/enquiryHandler.ts). */
  enquiryHandler: (c: any) => Promise<Response>
  /** Live updates (a new lead shows in an open inbox). */
  realtime: Realtime
  /** Told when the switched-on features change: registers the business with Twomiah Ads when paid_ads goes on. */
  adsConnector: { onFeaturesChanged: (features: string[]) => unknown }
  /** Where an uploaded logo is kept (the website's photo store, served at /media). */
  store: PhotoStore
}

/** The Factory subscription's doors (packages/tenant-backend billing.ts createBillingRoutes). */
export const SUBSCRIPTION_DOORS = ['/subscription', '/portal-link', '/restart-checkout'] as const

/**
 * The agency's own Twomiah subscription at /api/billing: the office's (owner or admin), and changing what is paid for
 * is billing:manage. Each door is gated on its own path, not '*', so a vertical whose /api/billing also holds its own
 * records composes this at its router's root without the gate falling over them: home care's visit invoicing
 * (server/crm/homecare/billing/index.ts), which checks its own permissions.
 */
export function createSubscriptionRoutes(deps: { db: any; permissions: any; factoryApiClient?: any }): Hono {
  const { db, permissions } = deps
  const officeOnly = (c: any, next: any) => {
    const u = c.get('user')
    if (!u || !['owner', 'admin'].includes(u.role)) return fail(c, 403, 'Insufficient permissions')
    return next()
  }
  const app = new Hono()
  for (const door of SUBSCRIPTION_DOORS) app.use(door, officeOnly)
  return app.route('/', createBillingRoutes({
    db, companyTable: company, userTable: user, factoryApiClient: deps.factoryApiClient ?? createFactoryApiClient(), seatLimitEnv: process.env.SEAT_LIMIT,
    canManage: async (c: any) => { const u = c.get('user'); return !!u && permissions.hasPermission(u.role, 'billing:manage', await permissions.getExtraPermissions(u.userId)) },
  } as any))
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
    // The owner's switch takes effect on the next request, not after the gate's 15-second cache.
    onFeaturesChanged: (features: string[]) => { deps.features.forgetFeatures(); void deps.adsConnector.onFeaturesChanged(features) },
    sendInvite: (to: string, data: any) => email.sendTeamInvite(to, { ...data, inviteLink: `${process.env.FRONTEND_URL || ''}/reset-password?token=${data.resetToken}` }),
    // Home care's own company columns (time zone, mileage rate, legal name, NPI, Medicaid id) and the zone its reports
    // count days on (server/crm/homecare/office/companyFields.ts; templates/crm-homecare routes/company.ts).
    ...(vertical.crm?.homecare ? { fields: homecareCompanyFields, describe: describeAgency } : {}),
    // The roles a login may hold here (CrmSettings.team.roles; the store's manager and staff). 'user' is the old
    // spelling of field — the shared POST /users defaults to it and stores it as field — so it rides along with field.
    ...(vertical.crm?.team?.roles?.length
      ? { options: { roles: vertical.crm.team.roles.includes('field') ? [...vertical.crm.team.roles, 'user'] : vertical.crm.team.roles } }
      : {}),
  } as any)

  const billingDeps = { db, companyTable: company, userTable: user, factoryApiClient, seatLimitEnv: process.env.SEAT_LIMIT }
  // Everywhere but home care, /api/billing is only the subscription: the office's, all of it (staff get a 403 on any
  // path, as before). Home care composes the doors into its visit invoicing instead (no mount here; see below).
  const billing = new Hono().use('*', isAdmin).route('/', createSubscriptionRoutes({ db, permissions, factoryApiClient }))

  const account = new Hono().use('*', isAdmin).route('/', createAccountRoutes({ factoryApiClient }))
  const emailAliases = new Hono().use('*', isAdmin).route('/', createEmailAliasesRoutes({ db, emailAliasesTable: emailAlias, factoryApiClient } as any))

  // POST / is the public enquiry; the rest is the lead inbox, which signs people in itself (after its two inbound
  // routes, which carry their own secrets).
  const leads = new Hono()
    .post('/', (c) => deps.enquiryHandler(c))
    .route('/', createLeadsRoutes({
      db, tables: { lead, leadSource, contact }, authenticate, requirePermission: permissions.requirePermission, canSee,
      // The inbox is the lead_inbox feature's, on the server as in the menu; the enquiry form above is everyone's.
      requireFeature: deps.features.requireEnabledFeature('lead_inbox'),
      emitToCompany: deps.realtime.emitToCompany, EVENTS: deps.realtime.EVENTS,
      // The vertical's platforms (CrmSettings.leads, templates/crm-basic routes/leads.ts T42); absent, the trades set.
      // What a converted lead becomes: a salon's is a client, in the book (templates/crm-salon routes/leads.ts, Salon T27 N13).
      audit, options: { platforms: vertical.crm?.leads?.platforms ?? TRADES_LEAD_PLATFORMS, contactType: vertical.crm?.leads?.contactType ?? 'lead' },
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

  // The Factory sets which features this tenant has (it replaces the list; the Factory reconciles first). A not-ready
  // feature in it is dropped: no path switches one on (withoutNotReady); so is one this industry is not offered
  // (withinOffer) — a list sent from an older Factory row cannot switch back on what the industry no longer has.
  const syncFeatures = new Hono().post('/', async (c) => {
    const body = await c.req.json().catch(() => ({})) as { features?: unknown }
    if (!Array.isArray(body.features) || !body.features.every((f) => typeof f === 'string')) return fail(c, 400, 'features must be an array of feature ids')
    const [co] = await db.select({ id: company.id }).from(company).orderBy(asc(company.createdAt)).limit(1)
    if (!co) return fail(c, 404, 'No company found')
    const features = withinOffer(vertical.featureSet, withoutNotReady(body.features as string[]))
    await db.update(company).set({ enabledFeatures: features, updatedAt: new Date() }).where(eq(company.id, co.id))
    deps.features.forgetFeatures(co.id)
    void deps.adsConnector.onFeaturesChanged(features)
    // The reply is what the Factory's admin save verifies (apps/api services/featureSyncVerdict.ts): the list as stored,
    // read back, so a feature sent and not kept — withheld as not ready or not offered — reads as missing, never as
    // in sync. It answered { success } alone, so every admin save to a unified tenant read "divergent (missing: all)".
    const [stored] = await db.select({ enabledFeatures: company.enabledFeatures }).from(company).where(eq(company.id, co.id)).limit(1)
    const kept: string[] = Array.isArray(stored?.enabledFeatures) ? (stored.enabledFeatures as string[]) : []
    return one(c, { success: true, features: kept, withheld: (body.features as string[]).filter((f) => !kept.includes(f)) })
  })

  /**
   * At boot: the business's switched-on features, less any this industry no longer offers (withinOffer — the one rule
   * every writer of the list applies). A feature withdrawn from an industry stayed on for every business that already
   * had it: a home-care agency made before 2026-10-22 kept the shared Invoices — a second billing book whose payments
   * neither its dashboard nor its Billing counted, reachable only by a typed address — and Time Tracking, whose Time page
   * an agency's menu doesn't have (live test 2026-10-22). Only rows that change are written; the gate's cache is dropped
   * for them. Never throws: a failed sweep leaves the list as it was. Returns what it took off, for the log and tests.
   */
  async function dropUnofferedFeatures(): Promise<Array<{ companyId: string; dropped: string[] }>> {
    const out: Array<{ companyId: string; dropped: string[] }> = []
    try {
      const rows = await db.select({ id: company.id, enabledFeatures: company.enabledFeatures }).from(company)
      for (const r of rows as Array<{ id: string; enabledFeatures: unknown }>) {
        const was = Array.isArray(r.enabledFeatures) ? (r.enabledFeatures as unknown[]).filter((f): f is string => typeof f === 'string') : []
        const kept = withinOffer(vertical.featureSet, was)
        const dropped = was.filter((f) => !kept.includes(f))
        if (!dropped.length) continue
        await db.update(company).set({ enabledFeatures: kept, updatedAt: new Date() }).where(eq(company.id, r.id))
        deps.features.forgetFeatures(r.id)
        out.push({ companyId: r.id, dropped })
      }
    } catch { /* the list stays as it was; the next boot tries again */ }
    return out
  }

  return {
    /** Pull the subscription from the Factory (at boot), so the mirror is right even if a push was missed. */
    refreshSubscription: () => refreshSubscriptionFromFactory(billingDeps as any),
    dropUnofferedFeatures,
    mounts: [
      // POST /logo (Settings › Company's logo upload, ./companyLogo.ts) beside the shared company routes.
      { path: '/api/company', access: 'user' as const, router: new Hono().route('/', createCompanyLogoRoute({ db, store: deps.store, requireAdmin: isAdmin })).route('/', companyRoutes) },
      // Home care's /api/billing is also its visit invoicing (server/crm/homecare/billing), which composes these doors at
      // its root, as the template's billing router did — so it is mounted there, once.
      ...(vertical.crm?.homecare ? [] : [{ path: '/api/billing', access: 'user' as const, router: billing }]),
      { path: '/api/account', access: 'user' as const, router: account },
      { path: '/api/email-aliases', access: 'user' as const, router: emailAliases },
      // The business's own web address: buy one through the Factory or connect one it owns (modules/domain.ts, from the
      // store; the premium sites' Domain page used the same paths). Every tenant has the website, so every vertical.
      { path: '/api/admin/domain', access: 'user' as const, router: createDomainRoutes({ permissions, factoryApiClient }) },
      { path: '/api/audit', access: 'user' as const, router: auditLogRoutes },
      { path: '/api/leads', access: 'public' as const, router: leads },
      { path: '/api/internal/email-aliases', access: 'factory' as const, router: createEmailAliasesInternalRoute({ db, emailAliasesTable: emailAlias } as any) },
      { path: '/api/internal/sync-subscription', access: 'factory' as const, router: createSubscriptionSyncRoute(billingDeps as any) },
      { path: '/api/internal/sync-features', access: 'factory' as const, router: syncFeatures },
      // The Factory's first call: the business, its owner, features and starting website (modules/provision.ts).
      { path: '/api/internal/provision', access: 'factory' as const, router: createProvisionRoute({ db, vertical, forgetFeatures: () => deps.features.forgetFeatures() }) },
    ],
  }
}
