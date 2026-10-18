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
  createGbpInternalRoutes, createInboundParseRoute, createInboundMessagesRoutes, createFactoryApiClient, createPortalRoutes,
  money,
} from '@twomiah/tenant-backend'
import { asc } from 'drizzle-orm'
import {
  company, user, contact, project, quote, quoteLineItem, invoice, invoiceLineItem, payment, job, timeEntry, teamMember,
  location, expense, staffAccountEntry, lead, document, documentVersion, planMarkup, formSubmission, formTemplate,
  commission, commissionPlan, reviewRequest, emailLog, adsExperiment, adsExperimentAssignment, adsExperimentConversion,
  gbpConnection, inboundMessage, message, auditLog, activity, changeOrder, changeOrderLineItem, lienWaiver, rfi, submittal,
  documentShare, equipment, serviceAgreement, agreementVisit, site, jobPhoto,
} from '../db/schema/index.ts'
import type { CrmSettings } from '../core/vertical.ts'
import type { Mount } from '../http/registry.ts'
import { fail } from '../http/reply.ts'
import type { Realtime } from '../core/realtime.ts'
import type { Logger } from '../core/logger.ts'
import { cleanText, escapeHtml } from '../core/sanitize.ts'
import type { CrmServices } from '../crm/services.ts'
import type { CrmDeps } from '../crm/deps.ts'
import { siteRecordsMounts } from '../crm/siteRecords/index.ts'
import { projectMounts } from '../crm/projects/index.ts'
import { fieldMounts } from '../crm/field/index.ts'
import { commsMounts } from '../crm/comms/index.ts'
import { officeMounts } from '../crm/office/index.ts'
import { createSelectionsService } from '../crm/field/selectionsService.ts'
import { basicMounts } from '../crm/basic/index.ts'
import { landscapingMounts } from '../crm/landscaping/index.ts'
import { barMounts } from '../crm/bar/index.ts'
import { restaurantMounts } from '../crm/restaurant/index.ts'
import { rvMounts } from '../crm/rv/index.ts'
import { salonMounts } from '../crm/salon/index.ts'
import { vetMounts } from '../crm/vet/index.ts'

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
  /** The vertical's switches (VerticalSettings.crm). */
  settings: CrmSettings
}

export function createCrmModules(deps: CrmModuleDeps): Mount[] {
  const { db, audit, logger, authenticate, permissions, features, realtime, services: s, settings: v } = deps
  // A customer's service sites and the equipment at them (field service, landscaping, basic, bar).
  const sites = !!v.serviceSites
  const blankToUndefined = z.string().optional().transform((x) => (x === '' ? undefined : x))
  const { requirePermission, requireRole } = permissions
  const canSee = async (role: string, permission: string, userId?: string) =>
    permissions.hasPermission(role, permission, await permissions.getExtraPermissions(userId))
  const isAdmin = async (c: any, next: any) => {
    const u = c.get('user')
    if (!u || !['owner', 'admin'].includes(u.role)) return fail(c, 403, 'Insufficient permissions')
    await next()
  }
  const live = { emitToCompany: realtime.emitToCompany, EVENTS: realtime.EVENTS }
  const own: CrmDeps = { db, audit, logger, authenticate, permissions, features, realtime, services: s }
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
      relations: sites
        ? [
          ...standardRelations({ project, quote, invoice, job }),
          { key: 'equipment', table: equipment, column: equipment.contactId, columns: { id: equipment.id, name: equipment.name, manufacturer: equipment.manufacturer, model: equipment.model, serialNumber: equipment.serialNumber, status: equipment.status, location: equipment.location, purchaseDate: equipment.purchaseDate, warrantyExpiry: equipment.warrantyExpiry, siteId: equipment.siteId } },
          { key: 'sites', table: site, column: site.contactId, orderBy: asc(site.name) },
        ]
        : standardRelations({ project, quote, invoice, job }),
      guards: sites
        ? [...standardGuards({ invoice, quote, job, project }), { table: equipment, column: equipment.contactId, label: 'piece of equipment', plural: 'pieces of equipment' }]
        : standardGuards({ invoice, quote, job, project }),
      ...(sites ? { sites: { site, equipment, job } } : {}),
    },
  } as any)

  const jobs = createJobRoutes({
    db,
    tables: {
      job, project, contact, user, timeEntry, teamMember, location,
      ...(sites ? { equipment } : {}), ...(v.jobs?.photos ? { jobPhoto } : {}), ...(v.jobs?.billing ? { invoice, invoiceLineItem } : {}),
    },
    authenticate, requirePermission, canSee, ...live, cleanText,
    options: {
      // a job also points at a piece of equipment and a service site
      ...(sites ? { extraFields: { equipmentId: blankToUndefined, siteId: blankToUndefined } } : {}),
      // photos in the store, served at /media/photos/… (the website's media route serves the same prefix)
      ...(v.jobs?.photos ? { storage: s.storage } : {}),
      // a job billed on its own: POST /api/jobs/:id/invoice
      ...(v.jobs?.billing ? { billing: { numbering: { prefix: v.jobs.billing.prefix, pad: v.jobs.billing.pad }, termsDays: v.jobs.billing.termsDays } } : {}),
      ...(v.jobs?.defaultType ? { defaultJobType: v.jobs.defaultType } : {}),
      onComplete: s.jobHooks.onComplete, onDispatch: s.jobHooks.onDispatch, onStart: s.jobHooks.onStart,
    },
  } as any)

  const quotes = createQuoteRoutes({
    db, canSee, tables: { quote, quoteLineItem, contact, project, invoice, invoiceLineItem, company, job, ...(sites ? { equipment, site } : {}) },
    authenticate, audit, requirePermission, ...live,
    sendQuoteEmail: (to: string, data: Record<string, unknown>) => s.emailService.sendQuote(to, data),
    loadPdf: loadQuotePdf,
    options: {
      hasLineCost: true, timeZoneFor,
      // Every vertical's quote records when it was declined and which job it became (the columns are everyone's now;
      // the field-service copies had them, the base CRM didn't).
      hasDeclinedAt: true, hasConvertedToJobId: true,
      extraFields: sites ? ['siteId', 'equipmentId', 'customerMessage'] : ['customerMessage'],
      ...(sites ? { jobHasSiteAndEquipment: true } : {}),
      // Text the customer a link when a quote goes out.
      ...(v.quotes?.textOnSend ? {
        onSent: async ({ companyId, quote: q, contact: who, company: co }: any) => {
          if (!who?.phone) return
          const portalUrl = process.env.CUSTOMER_PORTAL_URL || process.env.FRONTEND_URL || ''
          const msg = `Hi ${who.name?.split(' ')[0] || 'there'}, ${co?.name || 'we'} just sent you a quote (#${q.number}) for ${money(Number(q.total || 0))}. View it here: ${portalUrl}/quotes/${q.id}`
          await s.sms.sendSMS(companyId, { contactId: who.id, message: msg })
        },
      } : {}),
    },
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
      db, tables: { job, contact, formSubmission, formTemplate, ...(sites ? { equipment } : {}) }, authenticate, requirePermission, ...live, hooks: s.jobHooks,
      checklistType: v.tech.checklistType, checklistTitle: v.tech.checklistTitle, legacyChecklistTypes: v.tech.legacyChecklistTypes,
    } as any) },
    { path: '/api/commissions', access: 'user', feature: 'commission_tracking', router: createCommissionRoutes({ db, tables: { commission, commissionPlan, user, job, invoice }, authenticate, requirePermission, canSee } as any) },
    { path: '/api/locations', access: 'user', feature: 'multi_location', router: createLocationRoutes({ db, tables: { location, user }, authenticate, requirePermission } as any) },
    { path: '/api/equipment', access: 'user', feature: 'equipment_tracking', router: createEquipmentRoutes({ service: s.equipment, authenticate, requirePermission } as any) },
    { path: '/api/inventory', access: 'user', feature: ['inventory', 'parts_tracking'], router: createInventoryRoutes({ service: s.inventory, authenticate, requirePermission, audit, canSee } as any) },
    { path: '/api/fleet', access: 'user', feature: 'fleet', router: createFleetRoutes({ service: s.fleet, authenticate, requirePermission } as any) },
    { path: '/api/warranties', access: 'user', feature: 'warranties', router: createWarrantiesRoutes({ service: s.warranties, authenticate, requirePermission } as any) },
    { path: '/api/agreements', access: 'user', feature: ['service_agreements', 'maintenance_contracts'], router: createAgreementsRoutes({ service: s.agreements, authenticate, requirePermission, canSee, recurrence: !!v.agreements?.recurrence } as any) },

    // Documents are the registry's optional 'documents' feature for every CRM; the base template never gated them (the
    // field-service copy did, on both sides). Cutover switches it on for every CRM business, which had it before.
    { path: '/api/documents', access: 'user', feature: 'documents', router: createDocumentRoutes({

      // planMarkup only where drawings are marked up (construction): the shared module registers /:id/markups only when
      // the table is passed.
      db, tables: { document, documentVersion, project, contact, user, ...(v.documents?.markup ? { planMarkup } : {}) }, storage: s.storage, authenticate, requirePermission, audit: fileAudit,
      options: { types: v.documents?.types ?? ['general', 'contract', 'permit', 'drawing', 'photo', 'invoice', 'receipt', 'other'] },
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
    // The customer portal: a customer's own pages by their private link (/p/:token), and the staff switches that hand
    // the link out, which sign people in themselves (portal:share).
    { path: '/api/portal', access: 'public', router: createPortalRoutes({
      db,
      tables: {
        contact, company, user, quote, quoteLineItem, invoice, invoiceLineItem, payment, message, auditLog, activity,
        project, job, changeOrder, changeOrderLineItem, lienWaiver, rfi, submittal, document, documentShare,
        equipment, serviceAgreement, agreementVisit, formSubmission,
      },
      authenticate, audit, requirePermission,
      sendEmail: (to: string, template: string, data: Record<string, unknown>) => s.emailService.send(to, template, data),
      loadInvoicePdf, loadQuotePdf,
      selections: createSelectionsService(own),
      fileService: s.storage,
      ...live, logger,
      // The owner's feature switches decide which sections the portal offers.
      enabledFeaturesFor: features.enabledFeaturesFor,
      // Endpoint groups this vertical doesn't offer its customers (the template's portal options).
      options: { disable: v.portal.disable },
    } as any) },
    // The website's A/B script: anonymous, from the site's own origin.
    { path: '/api/public/ads-experiments', access: 'public', router: createAdsPublicRoutes({ db, tables: { company, adsExperiment, adsExperimentAssignment, adsExperimentConversion } } as any) },

    // The Factory.
    { path: '/api/internal/gbp', access: 'factory', router: createGbpInternalRoutes({ db, gbpConnectionTable: gbpConnection } as any) },
    { path: '/api/internal/inbound-email', access: 'factory', router: createInboundParseRoute({ db, inboundMessageTable: inboundMessage } as any) },

    // The CRM's own modules (moved from the template, not shared code).
    ...siteRecordsMounts(own), ...projectMounts(own), ...fieldMounts(own), ...commsMounts(own), ...officeMounts(own),
    // The near-copy CRMs' own modules (step 3e), each behind its features.
    ...basicMounts(own), ...landscapingMounts(own), ...barMounts(own), ...restaurantMounts(own), ...rvMounts(own), ...salonMounts(own), ...vetMounts(own),
  ]
}

/** Ads: the connector registers the business with Twomiah Ads when paid_ads is switched on. */
export function createCrmAdsConnector() {
  const factory = createFactoryApiClient() as any
  return createAdsConnector({ registerWithFactory: () => factory.registerAds() } as any)
}

