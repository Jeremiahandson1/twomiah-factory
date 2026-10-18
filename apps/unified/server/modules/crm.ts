// The CRM's modules that are shared code (packages/tenant-backend), each wired once with the app's tables, sign-in,
// permissions and services — what templates/crm/backend/src/routes/*.ts did one file per module — and declared to the
// registry with the feature that switches it on (the gates the template's index.ts wrote out by hand). The CRM's own
// modules (construction, takeoffs, import/export and the rest) move in next, as their own files beside this one.
//
// Access: a module whose router signs people in itself AND answers a provider or a customer without a session
// (texting's and Stripe's webhooks, QuickBooks' callback, a review link, an unsubscribe link) is mounted public, as the
// template mounted it; every other one is mounted for signed-in users, and the registry signs them in first.
import { Hono } from 'hono'
import { z } from 'zod'
import {
  createContactRoutes, standardRelations, standardGuards, createJobRoutes, createQuoteRoutes, createInvoiceRoutes,
  companyTimeZone, createTimeRoutes, createExpenseRoutes, createTasksRoutes, createTeamRoutes, createJobsDashboardRoutes,
  createDocumentRoutes, createPhotoRoutes, createRecurringRoutes, createReportingRoutes, createSmsRoutes, createStripeRoutes,
  createTechRoutes, createCommissionRoutes, createLocationRoutes, createEquipmentRoutes, createPricebookRoutes,
  createInventoryRoutes, createFleetRoutes, createWarrantiesRoutes, createAgreementsRoutes, createMarketingRoutes,
  createQuickBooksRoutes, createIntegrationsRoutes, createReviewsRoutes, createAdsRoutes, createAdsPublicRoutes,
  createAdsConnector, createOnboardingRoutes, createMessagingBillingRoutes, createEmailDomainRoutes, createGbpAdminRoutes,
  createGbpInternalRoutes, createInboundParseRoute, createInboundMessagesRoutes, createFactoryApiClient,
} from '@twomiah/tenant-backend'
import {
  company, user, contact, project, quote, quoteLineItem, invoice, invoiceLineItem, payment, job, timeEntry, teamMember,
  location, expense, staffAccountEntry, lead, document, documentVersion, planMarkup, formSubmission, formTemplate,
  commission, commissionPlan, reviewRequest, emailLog, adsExperiment, adsExperimentAssignment, adsExperimentConversion,
  gbpConnection, inboundMessage,
} from '../db/schema/index.ts'
import type { Mount } from '../http/registry.ts'
import { fail } from '../http/reply.ts'
import type { Realtime } from '../core/realtime.ts'
import type { Logger } from '../core/logger.ts'
import { cleanText, escapeHtml } from '../core/sanitize.ts'
import type { CrmServices } from '../crm/services.ts'

export interface CrmModuleDeps {
  db: any
  audit: any
  logger: Logger
  authenticate: any
  permissions: any
  features: { requireEnabledFeature: (f: string | string[]) => any; isFeatureEnabled: any; enabledFeaturesFor: any }
  realtime: Realtime
  services: CrmServices
  /** Called when the owner or the Factory changes the switched-on features (the ads connector listens). */
  adsConnector: ReturnType<typeof createAdsConnector>
}

export function createCrmModules(deps: CrmModuleDeps): Mount[] {
  const { db, audit, logger, authenticate, permissions, features, realtime, services: s } = deps
  const { requirePermission, requireRole } = permissions
  const canSee = async (role: string, permission: string, userId?: string) =>
    permissions.hasPermission(role, permission, await permissions.getExtraPermissions(userId))
  const isAdmin = async (c: any, next: any) => {
    const u = c.get('user')
    if (!u || !['owner', 'admin'].includes(u.role)) return fail(c, 403, 'Insufficient permissions')
    await next()
  }
  const live = { emitToCompany: realtime.emitToCompany, EVENTS: realtime.EVENTS }
  const timeZoneFor = (companyId: string) => companyTimeZone(db, companyId)
  const loadInvoicePdf = () => import('../crm/pdf.ts').then((m) => m.generateInvoicePDF)
  const loadQuotePdf = () => import('../crm/pdf.ts').then((m) => m.generateQuotePDF)
  const fileAudit = (event: string, actor: any, meta: any) => logger.info(`[audit] ${event}`, { userId: actor.userId, companyId: actor.companyId, ...meta })
  const factoryApiClient = createFactoryApiClient() as any

  const contacts = createContactRoutes({
    db, tables: { contact, company }, authenticate, requirePermission, canSee, ...live, audit, cleanText,
    options: {
      // SMS opt-out lives on the contact row; the shared sender refuses to text a contact carrying it (T35 N1).
      extraFields: { optedOutSms: z.boolean().optional() },
      relations: standardRelations({ project, quote, invoice, job }),
      guards: standardGuards({ invoice, quote, job, project }),
    },
  } as any)

  const jobs = createJobRoutes({
    db, tables: { job, project, contact, user, timeEntry, teamMember, location }, authenticate, requirePermission, canSee, ...live, cleanText,
    options: { onComplete: s.jobHooks.onComplete },
  } as any)

  const quotes = createQuoteRoutes({
    db, canSee, tables: { quote, quoteLineItem, contact, project, invoice, invoiceLineItem, company, job }, authenticate, audit, requirePermission, ...live,
    sendQuoteEmail: (to: string, data: Record<string, unknown>) => s.emailService.sendQuote(to, data),
    loadPdf: loadQuotePdf,
    options: { hasLineCost: true, timeZoneFor },
  } as any)

  const invoices = createInvoiceRoutes({
    db, tables: { invoice, invoiceLineItem, payment, contact, project, quote, company }, authenticate, requirePermission, canSee, ...live,
    sendInvoiceEmail: (to: string, data: Record<string, unknown>) => s.emailService.sendInvoice(to, data),
    loadPdf: loadInvoicePdf, audit,
    options: { timeZoneFor, minLineItems: 1, afterMoney: (invoiceId: string) => s.commissionEarner.earnForInvoice(invoiceId) },
  } as any)

  const ads = createAdsRoutes({ db, tables: { company, adsExperiment, adsExperimentAssignment, adsExperimentConversion }, authenticate, requirePermission, connector: deps.adsConnector } as any)

  const signedInAdmin = (router: any) => new Hono().use('*', authenticate, isAdmin).route('/', router)

  const messagingBilling = new Hono()
    .use('*', authenticate)
    .use('/portal-link', isAdmin)
    .route('/', createMessagingBillingRoutes({
      mayReadWallet: async (c: any) => { const u = c.get('user'); return permissions.hasPermission(u?.role, 'company:update', await permissions.getExtraPermissions(u?.userId)) },
    } as any))

  const tenantDomain = () => (process.env.FROM_EMAIL || 'noreply@localhost').split('@')[1]
  const inboundMessages = signedInAdmin(createInboundMessagesRoutes({
    db, inboundMessageTable: inboundMessage,
    sendReply: async ({ fromLocalPart, to, subject, text }: { fromLocalPart: string; to: string; subject: string; text: string }) => {
      const address = fromLocalPart + '@' + tenantDomain()
      const r: any = await s.emailService.send(to, 'raw', { subject, text }, { from: { name: address, address } })
      return { success: !!r?.success }
    },
  } as any))

  return [
    // The core CRM: on for a business with the CRM, off for a website-only one.
    { path: '/api/contacts', access: 'user', feature: 'contacts', router: contacts },
    { path: '/api/jobs', access: 'user', feature: 'jobs', router: jobs },
    { path: '/api/quotes', access: 'user', feature: 'quotes', router: quotes },
    { path: '/api/invoices', access: 'user', feature: 'invoices', router: invoices },
    { path: '/api/team', access: 'user', feature: 'team', router: createTeamRoutes({ db, tables: { teamMember, user, job, location }, authenticate, requirePermission, canSee } as any) },
    { path: '/api/dashboard', access: 'user', feature: 'dashboard', router: createJobsDashboardRoutes({ db, tables: { contact, project, job, quote, invoice, lead }, authenticate, featuresFor: features.enabledFeaturesFor, canSee } as any) },

    // Optional modules, each behind its feature (the template's index.ts gates).
    { path: '/api/time', access: 'user', feature: 'time_tracking', router: createTimeRoutes({ db, tables: { timeEntry, user, job, project, teamMember }, authenticate, requirePermission, audit } as any) },
    { path: '/api/expenses', access: 'user', feature: 'expense_tracking', router: createExpenseRoutes({ db, tables: { expense, project, job, staffAccountEntry, user, company }, authenticate, requirePermission, audit } as any) },
    { path: '/api/tasks', access: 'user', feature: 'projects', router: createTasksRoutes({ service: s.tasks, authenticate, requirePermission } as any) },
    { path: '/api/photos', access: 'user', feature: 'photo_capture', router: createPhotoRoutes({ db, tables: { document, user, project, job }, storage: s.storage, authenticate, requirePermission, audit: fileAudit } as any) },
    { path: '/api/recurring', access: 'user', feature: 'recurring_jobs', router: createRecurringRoutes({ service: s.recurring, authenticate, requirePermission, audit } as any) },
    { path: '/api/tech', access: 'user', feature: 'tech_mobile_view', router: createTechRoutes({
      db, tables: { job, contact, formSubmission, formTemplate }, authenticate, requirePermission, ...live, hooks: s.jobHooks,
      checklistType: 'site_checklist', checklistTitle: 'Site checklist',
    } as any) },
    { path: '/api/commissions', access: 'user', feature: 'commission_tracking', router: createCommissionRoutes({ db, tables: { commission, commissionPlan, user, job, invoice }, authenticate, requirePermission, canSee } as any) },
    { path: '/api/locations', access: 'user', feature: 'multi_location', router: createLocationRoutes({ db, tables: { location, user }, authenticate, requirePermission } as any) },
    { path: '/api/equipment', access: 'user', feature: 'equipment_tracking', router: createEquipmentRoutes({ service: s.equipment, authenticate, requirePermission } as any) },
    { path: '/api/inventory', access: 'user', feature: 'inventory', router: createInventoryRoutes({ service: s.inventory, authenticate, requirePermission, audit, canSee } as any) },
    { path: '/api/fleet', access: 'user', feature: 'fleet', router: createFleetRoutes({ service: s.fleet, authenticate, requirePermission } as any) },
    { path: '/api/warranties', access: 'user', feature: 'warranties', router: createWarrantiesRoutes({ service: s.warranties, authenticate, requirePermission } as any) },
    { path: '/api/agreements', access: 'user', feature: 'service_agreements', router: createAgreementsRoutes({ service: s.agreements, authenticate, requirePermission, canSee } as any) },

    // Always on with the CRM, as in the template (their screens are reached from Settings and the record pages).
    { path: '/api/documents', access: 'user', router: createDocumentRoutes({
      db, tables: { document, documentVersion, project, contact, user, planMarkup }, storage: s.storage, authenticate, requirePermission, audit: fileAudit,
      options: { types: ['general', 'contract', 'permit', 'drawing', 'photo', 'invoice', 'receipt', 'other'] },
    } as any) },
    { path: '/api/reports', access: 'user', router: createReportingRoutes({
      db, tables: { invoice, payment, job, project, quote, timeEntry, user, contact, teamMember, location }, authenticate, requirePermission,
      options: { featuresFor: features.enabledFeaturesFor },
    } as any) },
    { path: '/api/pricebook', access: 'user', router: createPricebookRoutes({ service: s.pricebook, db, tables: { company }, authenticate, requirePermission, canSee } as any) },
    { path: '/api/ads', access: 'user', router: ads },
    { path: '/api/onboarding', access: 'user', router: signedInAdmin(createOnboardingRoutes({ db, companyTable: company } as any)) },
    { path: '/api/messaging-billing', access: 'user', router: messagingBilling },
    { path: '/api/email-domain', access: 'user', router: signedInAdmin(createEmailDomainRoutes({ factoryApiClient } as any)) },
    { path: '/api/gbp', access: 'user', router: signedInAdmin(createGbpAdminRoutes({ db, gbpConnectionTable: gbpConnection } as any)) },
    { path: '/api/inbound-messages', access: 'user', router: inboundMessages },

    // Public doors inside: each router signs people in itself after them.
    { path: '/api/sms', access: 'public', router: createSmsRoutes({ service: s.sms, authenticate, requirePermission, requireAdmin: isAdmin } as any) },
    { path: '/api/stripe', access: 'public', router: createStripeRoutes({ db, tables: { invoice, contact, payment, company }, stripeService: s.stripeService, authenticate, requirePermission, audit } as any) },
    { path: '/api/marketing', access: 'public', router: createMarketingRoutes({ service: s.marketing, authenticate, requirePermission, escapeHtml, featureGate: features.requireEnabledFeature('email_marketing') } as any) },
    { path: '/api/quickbooks', access: 'public', router: createQuickBooksRoutes({ service: s.quickbooks, db, tables: { contact, invoice, invoiceLineItem, payment }, authenticate, requirePermission, audit } as any) },
    { path: '/api/reviews', access: 'public', router: createReviewsRoutes({ service: s.reviews, db, tables: { reviewRequest }, authenticate, requireRole, requirePermission, audit, requireEnabledFeature: features.requireEnabledFeature } as any) },
    { path: '/api/integrations', access: 'public', router: createIntegrationsRoutes({ db, tables: { company, emailLog }, authenticate, requireAdmin: isAdmin, quickbooks: s.quickbooks, stripe: s.stripe, factoryApiClient } as any) },
    // The website's A/B script: anonymous, from the site's own origin.
    { path: '/api/public/ads-experiments', access: 'public', router: createAdsPublicRoutes({ db, tables: { company, adsExperiment, adsExperimentAssignment, adsExperimentConversion } } as any) },

    // The Factory.
    { path: '/api/internal/gbp', access: 'factory', router: createGbpInternalRoutes({ db, gbpConnectionTable: gbpConnection } as any) },
    { path: '/api/internal/inbound-email', access: 'factory', router: createInboundParseRoute({ db, inboundMessageTable: inboundMessage } as any) },
  ]
}

/** Ads: the connector registers the business with Twomiah Ads when paid_ads is switched on. */
export function createCrmAdsConnector() {
  const factory = createFactoryApiClient() as any
  return createAdsConnector({ registerWithFactory: () => factory.registerAds() } as any)
}

