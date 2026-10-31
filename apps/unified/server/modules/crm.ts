// The CRM's modules that are shared code (packages/tenant-backend), each wired once with the app's tables, sign-in,
// permissions and services — what templates/crm/backend/src/routes/*.ts did one file per module — and declared to the
// registry with the feature that switches it on (the gates the template's index.ts wrote out by hand). The CRM's own
// modules (construction, takeoffs, import/export and the rest) move in next, as their own files beside this one.
//
// Access: a module whose router signs people in itself AND answers a provider or a customer without a session
// (texting's and Stripe's webhooks, QuickBooks' callback, a review link, an unsubscribe link) is mounted public, as the
// template mounted it; every other one is mounted for signed-in users, and the registry signs them in first.
import { checkAvailability } from '../data/techAvailability.ts'
import { Hono } from 'hono'
import { z } from 'zod'
import {
  createContactRoutes, createContactDeleter, type ContactGuard, standardRelations, standardGuards, createJobRoutes, createQuoteRoutes, createInvoiceRoutes,
  companyTimeZone, createTimeRoutes, createExpenseRoutes, createTasksRoutes, createTeamRoutes, createJobsDashboardRoutes,
  createDocumentRoutes, createPhotoRoutes, createRecurringRoutes, createReportingRoutes, createSmsRoutes, createStripeRoutes,
  createTechRoutes, createCommissionRoutes, createLocationRoutes, createEquipmentRoutes, createPricebookRoutes,
  createInventoryRoutes, createFleetRoutes, createWarrantiesRoutes, createAgreementsRoutes, createMarketingRoutes,
  createQuickBooksRoutes, createIntegrationsRoutes, createStripeLinkInternalRoutes, createReviewsRoutes, createAdsRoutes, createAdsPublicRoutes,
  createAdsConnector, createOnboardingRoutes, createMessagingBillingRoutes, createEmailDomainRoutes, createGbpAdminRoutes,
  createGbpInternalRoutes, createInboundParseRoute, createInboundMessagesRoutes, createFactoryApiClient, createPortalRoutes,
  money, createAccountBalanceStore, documentLinkPath, readTeamOrder,
} from '@twomiah/tenant-backend'
import { asc, desc, eq as eqCol } from 'drizzle-orm'
import {
  company, user, contact, project, quote, quoteLineItem, invoice, invoiceLineItem, payment, job, timeEntry, teamMember,
  location, expense, staffAccountEntry, lead, document, documentVersion, planMarkup, formSubmission, formTemplate,
  commission, commissionPlan, reviewRequest, emailLog, adsExperiment, adsExperimentAssignment, adsExperimentConversion,
  gbpConnection, inboundMessage, message, auditLog, activity, changeOrder, changeOrderLineItem, lienWaiver, rfi, submittal,
  documentShare, equipment, serviceAgreement, agreementVisit, site, jobPhoto, jobSeries, jobAssignee, crewLogin,
  event,
  patient, vaccination, appointment, visit,
  repairOrder, salesLead,
  serviceRecord, membershipEnrollment, clientAccountEntry, quoteProposalOption, pricebookItem, pricebookGoodBetterBest, serviceMenu, booking,
} from '../db/schema/index.ts'
import { siteOrigin } from '../booking/happenings.ts'
import { createSalonDashboard } from '../crm/salon/index.ts'
import { salonTeamProductivity, notGiftCardSale } from '../data/salon.ts'
import { createSalonClock } from '../crm/salon/days.ts'
import { createSalonPayees, createSalonPlanClash } from '../crm/salon/commissionPlans.ts'
import { createDealershipDashboardRoutes } from '../crm/rv/index.ts'
import { createPracticeDashboardRoutes } from '../crm/vet/dashboard.ts'
import { createEventsDashboardRoutes } from '../crm/restaurant/eventsDashboard.ts'
import { createHomecareDashboardRoutes } from '../crm/homecare/planning/dashboard.ts'
import { createHomecareReportsRoutes } from '../crm/homecare/planning/reports.ts'
import { syncEventInvoiceDueDate } from '../crm/restaurant/eventLedger.ts'
import { bookOnDepositForInvoice } from '../crm/restaurant/eventBooking.ts'
import type { CrmSettings } from '../core/vertical.ts'
import { encrypt, decrypt } from '../core/crypto.ts'
import { googleLinkSharing } from '../booking/calendars.ts'
import type { Mount } from '../http/registry.ts'
import { fail } from '../http/reply.ts'
import type { Realtime } from '../core/realtime.ts'
import type { PhonePush } from '../core/phonePush.ts'
import type { Logger } from '../core/logger.ts'
import { cleanText, cleanLines, escapeHtml } from '../core/sanitize.ts'
import type { CrmServices } from '../crm/services.ts'
import type { CrmDeps } from '../crm/deps.ts'
import { siteRecordsMounts } from '../crm/siteRecords/index.ts'
import { projectMounts } from '../crm/projects/index.ts'
import { fieldMounts } from '../crm/field/index.ts'
import { createCompletionGate } from '../crm/field/checklistRoutes.ts'
import { commsMounts } from '../crm/comms/index.ts'
import { createTextingRoutes, createTextingInternalRoutes } from '../crm/comms/texting.ts'
import { createSmsMediaRoutes, SMS_MEDIA_PATH, pictureToken } from '../crm/comms/smsMedia.ts'
import { visitsForCustomer } from '../data/visitReports.ts'
import { createScheduledTextRoutes } from '../crm/comms/scheduledTexts.ts'
import { officeMounts } from '../crm/office/index.ts'
import { createInvoiceReminderRoutes } from '../crm/billing/invoiceReminderRoutes.ts'
import { createQuoteBilling } from '../crm/billing/quoteBilling.ts'
import { createQuoteBudget } from '../crm/billing/quoteBudget.ts'
import { createSelectionsService } from '../crm/field/selectionsService.ts'
import { basicMounts } from '../crm/basic/index.ts'
import { landscapingMounts } from '../crm/landscaping/index.ts'
import { propertyHolders } from '../crm/landscaping/inUse.ts'
import { ownContactsWhere } from '../crm/ownWork.ts'
import { removeVisitPhotoFiles, visitPhotoFilesOf } from '../crm/salon/visitPhotos.ts'
import { intakeFilesOf } from '../crm/salon/intakeForms.ts'
import { createTeamLoginRoutes } from '../crm/crewLogins.ts'
import { createTextActivityRoutes } from '../crm/textActivity.ts'
import { barMounts } from '../crm/bar/index.ts'
import { restaurantMounts } from '../crm/restaurant/index.ts'
import { rvMounts } from '../crm/rv/index.ts'
import { salonMounts } from '../crm/salon/index.ts'
import { vetMounts } from '../crm/vet/index.ts'
import { homecareMounts } from '../crm/homecare/index.ts'
import { createRoofJobRoutes, insertRoofJob } from '../crm/roof/jobs.ts'
import { syncJobValueFromProposal } from '../crm/roof/proposalValue.ts'
import { roofMounts } from '../crm/roof/index.ts'
import { roofPortalJobFiles } from '../crm/roof/portalFiles/index.ts'
import { storeMounts } from '../crm/store/index.ts'
import { storeOrder } from '../db/schema/store.ts'
import { createRoofDashboardRoutes } from '../crm/roof/field/dashboard.ts'
import { createMoneyStripRoutes } from '../crm/dashboard/moneyStrip.ts'
import { createHomecareCore } from '../crm/homecare/core/index.ts'
import { portalsInFront } from '../crm/homecare/portals/index.ts'
import { cardPaymentsFor } from '../crm/cardPayments.ts'
import type { PhotoStore } from '../site/admin.ts'

export interface CrmModuleDeps {
  db: any
  audit: any
  logger: Logger
  authenticate: any
  permissions: any
  features: { requireEnabledFeature: (f: string | string[]) => any; isFeatureEnabled: any; enabledFeaturesFor: any }
  realtime: Realtime
  phonePush: PhonePush
  services: CrmServices
  /** Called when the owner or the Factory changes the switched-on features (the ads connector listens). */
  adsConnector: ReturnType<typeof createAdsConnector>
  /** The vertical's switches (VerticalSettings.crm). */
  settings: CrmSettings
  /** What the vertical calls its customer (its vocabulary), for the words a refusal uses. Absent → "customer". */
  customerWord?: string
  /** The website's photo store (served at /media): a menu item's photo goes into the site's library. */
  store?: PhotoStore
}

/** Google Business Profile's tokens, sealed at rest with the tenant's own key — as people's calendar tokens are. */
const gbpSecrets = { seal: encrypt, open: decrypt }

export function createCrmModules(deps: CrmModuleDeps): Mount[] {
  const { db, audit, logger, authenticate, permissions, features, realtime, phonePush, services: s, settings: v, customerWord } = deps
  const gbpDeps = { db, gbpConnectionTable: gbpConnection, secrets: gbpSecrets, googleStillUsedBy: (email: string | null) => googleLinkSharing(db, email, { reviews: true }) }
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
  const own: CrmDeps = { db, audit, logger, authenticate, permissions, features, realtime, phonePush, services: s, settings: v, store: deps.store }
  // A job is not completed with a required checklist unfinished (crm/field/checklistRoutes.ts); in front of the jobs mount below.
  const completionGate = createCompletionGate(own)
  // Home care's own routers on two paths the CRM also serves — its client portal (/api/portal) and its texting screen
  // (/api/sms) — answer first, composed in front of the CRM's router: one mount per path (RULEBOOK §6), the CRM's
  // customer portal (/p/:token/…) and Twilio's webhooks still reached (server/crm/homecare/portals/index.ts).
  const homecareFront: Record<string, Hono<any>> = v.homecare ? portalsInFront(createHomecareCore(own), own) : {}
  const inFront = (path: string, router: Hono<any>) => (homecareFront[path] ? new Hono().route('/', homecareFront[path]).route('/', router) : router)
  const timeZoneFor = (companyId: string) => companyTimeZone(db, companyId)
  const loadInvoicePdf = () => import('../crm/pdf.ts').then((m) => m.generateInvoicePDF)
  const loadQuotePdf = () => import('../crm/pdf.ts').then((m) => m.generateQuotePDF)
  const fileAudit = (event: string, actor: any, meta: any) => logger.info(`[audit] ${event}`, { userId: actor.userId, companyId: actor.companyId, ...meta })
  const factoryApiClient = createFactoryApiClient() as any
  /**
   * Can this business take a card from its customer right now (crm/cardPayments.ts — one answer, home care's Billing
   * included). The invoice page offers Pay only then, and the payment route refuses otherwise (portal.ts,
   * payments/stripe.ts). The invoice email's link opened onto a Pay button whatever the answer (2026-10-22).
   */
  const canTakeCardPayments = cardPaymentsFor({ features, services: s })
  // A quote billed in parts: its deposit on approval, progress invoices, the final invoice crediting them (crm/billing).
  const quoteBilling = createQuoteBilling(own, { canTakeCardPayments })
  // Approving a quote sets up the work: its budget by cost code and its allowances on Selections (crm/billing/quoteBudget.ts), and —
  // for a quote with Good / Better / Best options approved for one — the job it was written for is worth that option
  // (roof/proposalValue.ts). One hook for both doors (the office marking it approved, the customer approving on their link); a
  // failure here is logged and never undoes the approval or the deposit.
  const quoteBudget = createQuoteBudget(own)
  const afterApproval = async (companyId: string, quoteId: string) => {
    await syncJobValueFromProposal(db, companyId, quoteId).catch((err: Error) => logger.error('[quotes] job value not updated from the chosen option', { quote: quoteId, error: err?.message }))
    const deposit = await quoteBilling.raiseDeposit(companyId, quoteId)
    try { await quoteBudget.carryOver(companyId, quoteId) } catch (err: any) { logger.error?.('[quotes] budget not set up after approval', { quote: quoteId, error: err?.message }) }
    return deposit
  }

  /**
   * What keeps a contact from being deleted, and the delete itself: ONE rule (tenant-backend createContactDeleter) for
   * both doors that delete a contact — its own DELETE (the contact routes below) and the bulk delete (crm/office/bulk.ts,
   * via CrmDeps.contactDeleter). The bulk door ran no guard at all and deleted a salon client with appointments, visits
   * and a membership, which the single delete refuses (salon live test, 2026-10-25).
   */
  const contactGuards: ContactGuard[] = [
    // A client owns patients, and every patient's visits, vaccinations, prescriptions and lab results cascade with
    // them: medical history under statutory retention, so the client is not deleted while any remain (vet).
    ...(v.patients ? [
      { table: patient, column: patient.ownerId, label: 'patient', message: (n: number) => `This client has ${n} patient${n === 1 ? '' : 's'} with medical history. Reassign or remove their patients before deleting the client.` },
      { table: appointment, column: appointment.ownerId, label: 'appointment' },
    ] : []),
    ...(sites
      ? [
        ...standardGuards({ invoice, quote, job, project }), { table: equipment, column: equipment.contactId, label: 'piece of equipment', plural: 'pieces of equipment' },
        // …and their properties' route stops and snow contracts, which the customer's delete would cascade away.
        ...propertyHolders(db).byContact,
      ]
      : standardGuards({ invoice, quote, job, project })),
    // …and keeps them: a client with events is not deleted while any remain.
    ...(v.events ? [{ table: event, column: event.contactId, label: 'event' }] : []),
    // A dealership's customer with a repair order or a sales lead is kept (templates/crm-rv routes/contacts.ts).
    ...(v.contacts?.guards?.includes('repairOrder') ? [{ table: repairOrder, column: repairOrder.customerId, label: 'repair order' }] : []),
    ...(v.contacts?.guards?.includes('salesLead') ? [{ table: salesLead, column: salesLead.contactId, label: 'sales lead' }] : []),
    // A salon's client with an appointment, a visit on record or a membership is kept (templates/crm-salon routes/contacts.ts).
    ...(v.contacts?.guards?.includes('appointment') ? [{ table: appointment, column: appointment.contactId, label: 'appointment' }] : []),
    ...(v.contacts?.guards?.includes('serviceRecord') ? [{ table: serviceRecord, column: serviceRecord.contactId, label: 'service record' }] : []),
    ...(v.contacts?.guards?.includes('membershipEnrollment') ? [{ table: membershipEnrollment, column: membershipEnrollment.contactId, label: 'membership' }] : []),
    // A shop's customer with an order is kept: the order keeps its own copy of who bought it, but the customer's
    // history is the record of what they bought (docs/UNIFIED_STORE_PLAN.md decision 2).
    ...(v.contacts?.guards?.includes('storeOrder') ? [{ table: storeOrder, column: storeOrder.contactId, label: 'order' }] : []),
  ]
  const contactDeleter = createContactDeleter({
    db, contact, guards: contactGuards,
    // A contact's visits go with it by the cascade, and their photo files with them (crm/salon/visitPhotos.ts — the one
    // rule every visit deletion path calls). Any vertical: service records are served wherever their features are on.
    beforeDelete: async (companyId: string, contactId: string) => {
      // Their forms' photos, files and drawn signatures too (crm/salon/intakeForms.ts): health and consent records go with the client.
      const files = [...await visitPhotoFilesOf(db, companyId, { contactIds: [contactId] }), ...await intakeFilesOf(db, companyId, [contactId])]
      return () => removeVisitPhotoFiles(s.storage, files)
    },
  })
  own.contactDeleter = contactDeleter

  const contacts = createContactRoutes({
    db, tables: { contact, company }, authenticate, requirePermission, canSee, ...live, audit, cleanText, cleanLines,
    // A seat without contacts:read-all (every job vertical's field seat) reads the customers on its own jobs — led, an
    // assignee, the sales rep or its crew's (crm/ownWork.ts over tenant-backend jobs/onJob.ts, the one rule).
    ownContacts: (userId: string) => ownContactsWhere(db, userId),
    options: {
      // SMS opt-out lives on the contact row; the shared sender refuses to text a contact carrying it (T35 N1).
      extraFields: { optedOutSms: z.boolean().optional() },
      // The one contact-delete rule, with its guards and its photo-file clean-up (contactDeleter above).
      deleter: contactDeleter,
      // The vertical's contact types, and what a converted lead becomes (CrmSettings.contacts; a dealership sells to
      // customers — templates/crm-rv routes/contacts.ts). Absent: the shared four, and 'client'.
      ...(v.contacts?.types ? { types: v.contacts.types } : {}),
      ...(v.contacts?.customerType ? { convertTo: v.contacts.customerType } : {}),
      relations: [
        ...(sites
          ? [
            ...standardRelations({ project, quote, invoice, job }),
            { key: 'equipment', table: equipment, column: equipment.contactId, columns: { id: equipment.id, name: equipment.name, manufacturer: equipment.manufacturer, model: equipment.model, serialNumber: equipment.serialNumber, status: equipment.status, location: equipment.location, purchaseDate: equipment.purchaseDate, warrantyExpiry: equipment.warrantyExpiry, siteId: equipment.siteId } },
            { key: 'sites', table: site, column: site.contactId, orderBy: asc(site.name) },
          ]
          : standardRelations({ project, quote, invoice, job })),
        // A venue's client lists their events (templates/crm-restaurant routes/contacts.ts H-02; CrmSettings.events).
        ...(v.events ? [{ key: 'events', table: event, column: event.contactId, columns: { id: event.id, name: event.name, status: event.status, eventDate: event.eventDate } }] : []),
        // An owner's page lists their pets (templates/crm-vet routes/contacts.ts; CrmSettings.patients).
        ...(v.patients ? [{ key: 'patients', table: patient, column: patient.ownerId, columns: { id: patient.id, name: patient.name, species: patient.species, breed: patient.breed, deceased: patient.deceased }, orderBy: asc(patient.name) }] : []),
        // A shopper's page lists their store orders, newest first (docs/UNIFIED_STORE_PLAN.md decision 2: a shopper is a
        // contact). Only to a seat that may open the orders (orders:read), as each row links to /crm/orders/:id.
        ...(v.store ? [{ key: 'orders', table: storeOrder, column: storeOrder.contactId, columns: { id: storeOrder.id, orderNumber: storeOrder.orderNumber, status: storeOrder.status, totalCents: storeOrder.totalCents, createdAt: storeOrder.createdAt }, orderBy: desc(storeOrder.createdAt), permission: 'orders:read' }] : []),
      ],
      // A property's route stops and snow contracts hold it (crm/landscaping/inUse.ts).
      ...(sites ? { sites: { site, equipment, job, guards: propertyHolders(db).bySite } } : {}),
    },
  } as any)

  const jobs = createJobRoutes({
    db,
    tables: {
      job, project, contact, user, timeEntry, teamMember, location, jobSeries, jobAssignee, crewLogin,
      ...(sites ? { equipment } : {}), ...(v.jobs?.photos ? { jobPhoto } : {}), ...(v.jobs?.billing ? { invoice, invoiceLineItem } : {}),
    },
    // jobAssignee + crewLogin: a seat without jobs:read-all reads the jobs it leads, is on, sells or crews (onJob).
    authenticate, requirePermission, canSee, ...live, cleanText, cleanLines, audit,
    options: {
      // a job also points at a piece of equipment and a service site
      // A business's own kinds of job ("Furnace install"), for its checklists (crm/field/checklistRoutes.ts); the job form offers them only with Job Checklists on.
      extraFields: { ...(sites ? { equipmentId: blankToUndefined, siteId: blankToUndefined } : {}), jobType: z.string().trim().max(40, 'A job type is at most 40 characters').optional().transform((v) => v || undefined) },
      // photos in the store, served at /media/photos/… (the website's media route serves the same prefix)
      ...(v.jobs?.photos ? { storage: s.storage } : {}),
      // a job billed on its own: POST /api/jobs/:id/invoice
      ...(v.jobs?.billing ? { billing: { numbering: { prefix: v.jobs.billing.prefix, pad: v.jobs.billing.pad }, termsDays: v.jobs.billing.termsDays } } : {}),
      ...(v.jobs?.defaultType ? { defaultJobType: v.jobs.defaultType } : {}),
      ...(v.jobs?.requireCustomer ? { requireCustomer: { word: customerWord || 'customer' } } : {}),
      ...(v.jobs?.repeatWeekdays ? { repeatWeekdays: true } : {}),
      onComplete: s.jobHooks.onComplete, onDispatch: s.jobHooks.onDispatch, onStart: s.jobHooks.onStart,
      // Working hours and time off: a job given to someone who is off warns the office (server/data/techAvailability.ts).
      // Only for a business that has switched Tech Availability on.
      availability: async (companyId: string, people: any[], date: unknown, time: string | null | undefined, hours: unknown, exec: any) =>
        (await features.isFeatureEnabled(companyId, 'tech_availability')) ? checkAvailability(exec, companyId, people, date, time, hours) : null,
    },
  } as any)

  const quotes = createQuoteRoutes({
    db, canSee, tables: { quote, quoteLineItem, contact, project, invoice, invoiceLineItem, company, job, quoteProposalOption, pricebookItem, pricebookGoodBetterBest, ...(sites ? { equipment, site } : {}) },
    authenticate, audit, requirePermission, ...live,
    sendQuoteEmail: (to: string, data: Record<string, unknown>) => s.emailService.sendQuote(to, data),
    loadPdf: loadQuotePdf,
    options: {
      hasLineCost: true, timeZoneFor,
      // The deposit a quote asks is raised when the office marks it approved; convert-to-invoice is the final invoice
      // once part of the quote was billed, crediting the deposit and progress invoices (crm/billing/quoteBilling.ts).
      onApproved: ({ companyId, quote: q }: any) => afterApproval(companyId, q.id),
      // Good / Better / Best: a business sees, builds and answers options only with the feature on (quoteOptions.ts proposalsLive).
      proposalsEnabled: (companyId: string) => features.isFeatureEnabled(companyId, 'quote_proposals'),
      billedBefore: (tx: any, q: any) => quoteBilling.billedBefore(tx, q),
      // Every vertical's quote records when it was declined and which job it became (the columns are everyone's now;
      // the field-service copies had them, the base CRM didn't).
      hasDeclinedAt: true, hasConvertedToJobId: true,
      // A converted quote's invoice is numbered as every invoice is (CrmSettings.invoices.numbering; templates/crm-rv routes/quotes.ts).
      ...(v.invoices?.numbering ? { numbering: { invoice: v.invoices.numbering } } : {}),
      // A roofing proposal belongs to its job (quote.job_id; CrmSettings.roof).
      extraFields: [...(sites ? ['siteId', 'equipmentId'] : []), 'customerMessage', ...(v.roof ? ['jobId'] : [])],
      // An approved roofing proposal converts to a roofing job, made the one way a roofing job is made (ROOF-0001, titled
      // by the property address — server/crm/roof/jobs.ts insertRoofJob), at `signed`: an approved quote is the signed
      // contract. The CRM's default made a JOB-00001 at `pending`, a status no roofing screen has a column for.
      ...(v.roof ? {
        makeJob: (tx: any, f: any) => insertRoofJob(tx, f.companyId, f.userId, {
          contactId: f.quote.contactId, quoteId: f.quote.id, jobType: 'retail', status: 'signed', source: 'quote',
          address: f.address || f.quote.name, city: f.city || null, state: f.state || null, zip: f.zip || null,
          estimatedValue: f.estimatedValue, notes: `Converted from Quote ${f.quote.number}`,
        }),
      } : {}),
      ...(sites ? { jobHasSiteAndEquipment: true } : {}),
      // Text the customer a link when a quote goes out.
      ...(v.quotes?.textOnSend ? {
        onSent: async ({ companyId, quote: q, contact: who, company: co }: any) => {
          if (!who?.phone) return
          // The quote's own link, as in the email (portal/documentLinks.ts). It pointed at /quotes/<id> — the office's
          // screen, behind a sign-in the customer does not have (2026-10-22).
          if (!q.publicToken) return
          const base = (process.env.FRONTEND_URL || '').replace(/\/+$/, '')
          const msg = `Hi ${who.name?.split(' ')[0] || 'there'}, ${co?.name || 'we'} just sent you a quote (#${q.number}) for ${money(Number(q.total || 0))}. View it here: ${base}${documentLinkPath(q.publicToken)}`
          await s.sms.sendSMS(companyId, { contactId: who.id, message: msg })
        },
      } : {}),
    },
  } as any)

  // The salon's clock (the booking calendar's zone) and its clients' account ledger (CrmSettings.invoices).
  const salonClock = createSalonClock(db)
  const clientAccounts = createAccountBalanceStore(clientAccountEntry)

  const invoices = createInvoiceRoutes({
    db, tables: { invoice, invoiceLineItem, payment, contact, project, quote, company }, authenticate, requirePermission, canSee, ...live,
    // An event's invoice (CrmSettings.events): a payment, refund, void or edit on it moves its due date to the next
    // installment not yet covered — a no-op for an invoice that isn't an event's (templates/crm-restaurant routes/invoices.ts).
    ...(v.events ? {
      emitToCompany: (companyId: string, name: string, data: any) => {
        realtime.emitToCompany(companyId, name, data)
        const invoiceId = name === realtime.EVENTS.PAYMENT_RECEIVED ? data?.invoiceId : name === realtime.EVENTS.INVOICE_UPDATED ? data?.id : null
        if (invoiceId) void syncEventInvoiceDueDate(db, invoiceId).catch((err: any) => logger.error('[events] invoice due-date sync failed', { error: err?.message }))
      },
    } : {}),
    sendInvoiceEmail: (to: string, data: Record<string, unknown>) => s.emailService.sendInvoice(to, data),
    loadPdf: loadInvoicePdf, audit,
    options: {
      timeZoneFor, minLineItems: 1, afterMoney: async (invoiceId: string) => { await s.earnCommission(invoiceId); await s.afterInvoicePaid(invoiceId) },
      // A deposit, progress or final invoice is never edited above what is left of its quote (crm/billing/quoteBilling.ts).
      checkTotal: (existing: any, total: number) => quoteBilling.checkTotal(existing, total),
      // The vertical's invoice numbers (CrmSettings.invoices.numbering: a dealership's INV-1001, templates/crm-rv routes/invoices.ts).
      ...(v.invoices?.numbering ? { numbering: v.invoices.numbering } : {}),
      // The owner pays, but the bill is for an animal: an invoice names its patient (templates/crm-vet routes/invoices.ts T12 M6).
      ...(v.patients ? { links: { patientId: patient } } : {}),
      // A roofing invoice is a job's bill (invoice.job_id): listed by ?jobId=, set on create and edit, checked to be this
      // business's job. The job page's Invoice card reads it.
      ...(v.roof ? { links: { jobId: job } } : {}),
      // Money books the date: a deposit on an enquiry confirms it (refused while its room is held), inside the payment's
      // own transaction (templates/crm-restaurant routes/invoices.ts, T16 M8).
      ...(v.events ? { onPayment: bookOnDepositForInvoice } : {}),
      // The salon's: a tip line; the client's account balance as a way to pay and a place to refund to; the day on the
      // salon's own clock (templates/crm-salon routes/invoices.ts, Salon T27 H1).
      ...(v.invoices?.tips ? { tips: true } : {}),
      ...(v.invoices?.clock === 'booking' ? { timeZoneFor: (companyId: string) => salonClock.salonTimezone(companyId) } : {}),
      // A refund by gift card goes back onto the card, inside the refund's own transaction (crm/salon/giftCards.ts registers the doer).
      // A gift card's sale is not revenue (data/salon.ts notGiftCardSale): the list's money totals leave it out, as Reports do.
      ...(v.invoices?.giftCardSalesAreLiability ? { revenueOnly: notGiftCardSale } : {}),
      // The salon's retail product link survives a general invoice edit (crm/salon/retail.ts lineEdit).
      ...(v.invoices?.giftCardTender ? { lineEdit: s.lineEdit } : {}),
      ...(v.invoices?.giftCardTender ? { refundTender: { method: 'gift_card', credit: (tx: any, inv: any, amount: number) => s.creditTender('gift_card', tx, inv, amount) } } : {}),
      ...(v.invoices?.accountBalance ? { accountBalance: {
        // A bill with no client on it cannot be paid from a client's account — said, not a failure on a null. Both run
        // inside the invoice's own transaction.
        async spend(tx: any, inv: any, amount: number) {
          const contactId = inv.contact_id ?? inv.contactId
          if (!contactId) return 'This invoice is not attached to a client, so there is no account to take it from.'
          const out = await clientAccounts.spend(tx, { companyId: inv.company_id ?? inv.companyId, contactId, amount, invoiceId: inv.id, reason: `Paid against ${inv.number}` })
          return out.ok ? null : out.error
        },
        async credit(tx: any, inv: any, amount: number) {
          const contactId = inv.contact_id ?? inv.contactId
          if (!contactId) return 'This invoice is not attached to a client, so there is no account to refund it to.'
          await clientAccounts.add(tx, { companyId: inv.company_id ?? inv.companyId, contactId, amount, source: 'refund_to_account', reason: `Refunded from ${inv.number} and kept on account`, invoiceId: inv.id })
          return null
        },
        balanceOf: (companyId: string, contactId: string) => clientAccounts.balance(db, companyId, contactId),
      } } : {}),
    },
  } as any)

  const ads =createAdsRoutes({ db, tables: { company, adsExperiment, adsExperimentAssignment, adsExperimentConversion }, authenticate, requirePermission, connector: deps.adsConnector } as any)

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
    // "Text opened on your phone — not confirmed sent": the Text button's record, and the contact's activity rows (crm/textActivity.ts).
    { path: '/api/text-activity', access: 'user', feature: 'contacts', router: createTextActivityRoutes({ db, requirePermission, canSee, ownContacts: (userId: string) => ownContactsWhere(db, userId) }) },
    // A job's photos are photo_capture's, as the field-service and basic copies' index.ts gated /api/jobs/:id/photos.
    // Roofing's own job module over the same table (CrmSettings.roof; server/crm/roof/jobs.ts) — one mount, never two.
    { path: '/api/jobs', access: 'user', feature: 'jobs', router: new Hono().use('/', completionGate).use('/:id/complete', completionGate).use('/:id', completionGate).route('/', v.roof
      ? new Hono().use('/:id/photos', features.requireEnabledFeature('photo_capture')).use('/:id/photos/*', features.requireEnabledFeature('photo_capture')).route('/', createRoofJobRoutes(own))
      : v.jobs?.photos
      ? new Hono().use('/:id/photos', features.requireEnabledFeature('photo_capture')).use('/:id/photos/*', features.requireEnabledFeature('photo_capture')).route('/', jobs)
      : jobs) },
    { path: '/api/quotes', access: 'user', feature: 'quotes', router: quotes },
    { path: '/api/invoices', access: 'user', feature: 'invoices', router: invoices },
    // A quote's deposit and progress invoices, billed against what is left (crm/billing/quoteBilling.ts).
    { path: '/api/quote-billing', access: 'user', feature: 'invoices', router: quoteBilling.routes() },
    // Automatic invoice reminders and the late fee (crm/billing): the CRM's invoices and home care's Billing invoices, so
    // no one feature; each action asks its permission.
    { path: '/api/invoice-reminders', access: 'user', router: createInvoiceReminderRoutes(own, s.invoiceReminders) },
    // The logins on each roster crew (crm/crewLogins.ts: GET /logins, PUT /:id/logins) ahead of the shared roster routes.
    { path: '/api/team', access: 'user', feature: 'team', router: new Hono().route('/', createTeamLoginRoutes({ db, requirePermission })).route('/', createTeamRoutes({
      db, tables: { teamMember, user, job, location }, authenticate, requirePermission, canSee,
      // The order the salon dragged its team into (Settings › The Book › Team order) — every picker that reads this follows it.
      teamOrder: async (companyId: string) => readTeamOrder((await db.select({ settings: company.settings }).from(company).where(eqCol(company.id, companyId)).limit(1))[0]?.settings),
      // A stylist holds appointments: removing one unassigns their chair (templates/crm-salon routes/team.ts, Salon T27 N14).
      // The unified job table carries assigned_to_member_id for every vertical, so jobs are counted too (the salon copy's
      // job table had no such column); the appointment comes first, so the reply speaks of appointments.
      ...(v.team?.assignedWork?.includes('appointment') ? { options: { assignedWork: [
        { table: appointment, field: 'stylistMemberId', one: 'appointment', many: 'appointments' },
        { table: job, field: 'assignedToMemberId', one: 'job', many: 'jobs' },
      ] } } : {}),
    } as any)) },
    { path: '/api/dashboard', access: 'user', feature: 'dashboard', router: v.dashboard === 'events'
      // The private-events dashboard (CrmSettings.dashboard; templates/crm-restaurant and crm-bar routes/dashboard.ts).
      ? createEventsDashboardRoutes(own)
      // The veterinary practice's (templates/crm-vet routes/dashboard.ts).
      : v.dashboard === 'practice' ? createPracticeDashboardRoutes(own)
      // The dealership's (templates/crm-rv routes/dashboard.ts).
      : v.dashboard === 'dealership' ? createDealershipDashboardRoutes(own)
      // The salon's (templates/crm-salon routes/dashboard.ts).
      : v.dashboard === 'salon' ? createSalonDashboard(own)
      // The home-care agency's (templates/crm-homecare routes/dashboard.ts).
      : v.dashboard === 'homecare' ? createHomecareDashboardRoutes(own)
      // The roofer's (templates/crm-roof routes/dashboard.ts).
      : v.dashboard === 'roof' ? createRoofDashboardRoutes(own)
      : createJobsDashboardRoutes({ db, tables: { contact, project, job, quote, invoice, lead, jobAssignee, crewLogin }, authenticate, featuresFor: features.enabledFeaturesFor, canSee } as any) },
    // Cash in, what is owed and who is waiting, under every trade's own dashboard (crm/dashboard/moneyStrip.ts). Each half
    // asks its own permission and is sent only where the trade has it.
    { path: '/api/dashboard-strip', access: 'user', feature: 'dashboard', router: createMoneyStripRoutes(own) },

    // Optional modules, each behind its feature (the template's index.ts gates).
    { path: '/api/time', access: 'user', feature: 'time_tracking', router: createTimeRoutes({ db, tables: { timeEntry, user, job, project, teamMember }, authenticate, requirePermission, audit } as any) },
    // Home care's /api/expenses is its own expense book (server/crm/homecare/payroll/expenses.ts), so the shared one stands aside there.
    ...(v.homecare ? [] : [{ path: '/api/expenses', access: 'user' as const, feature: 'expense_tracking', router: createExpenseRoutes({
      db, tables: { expense, project, job, staffAccountEntry, user, company }, authenticate, requirePermission, audit,
      // A receipt's photo, kept in the company's private store (POST/GET /api/expenses/:id/receipt).
      storage: s.storage,
      // The trade's own categories, refused outside the list as the shared ones are (templates/crm-salon routes/expenses.ts).
      ...(v.expenses ? { options: { categories: v.expenses.categories, categoryLabels: v.expenses.categoryLabels } } : {}),
    } as any) }]),
    // Tasks: a construction business's with projects (the base CRM's gate); a clinic's always (templates/crm-vet
    // mounted tasks ungated and put Tasks on every menu, and a clinic has no projects) — the union, on both sides.
    { path: '/api/tasks', access: 'user', feature: ['projects', 'patient_records'], router: createTasksRoutes({ service: s.tasks, authenticate, requirePermission } as any) },
    { path: '/api/photos', access: 'user', feature: 'photo_capture', router: createPhotoRoutes({ db, tables: { document, user, project, job }, storage: s.storage, authenticate, requirePermission, audit: fileAudit } as any) },
    { path: '/api/recurring', access: 'user', feature: 'recurring_jobs', router: createRecurringRoutes({ service: s.recurring, authenticate, requirePermission, audit } as any) },
    { path: '/api/tech', access: 'user', feature: 'tech_mobile_view', router: createTechRoutes({
      // canSee: a job's money by the one rule (packages/tenant-backend jobs/jobMoney.ts); without it the module withholds all of it.
      // The phone's day is the login's own jobs — led, an assignee, the sales rep or its crew's (tenant-backend onJob).
      db, tables: { job, jobAssignee, crewLogin, contact, formSubmission, formTemplate, ...(sites ? { equipment } : {}) }, authenticate, requirePermission, canSee, ...live, hooks: s.jobHooks,
      checklistType: v.tech.checklistType, checklistTitle: v.tech.checklistTitle, legacyChecklistTypes: v.tech.legacyChecklistTypes,
    } as any) },
    // A salon's stylist commissions are their own feature (salon_commissions, not ready); every other vertical's stay behind commission_tracking.
    { path: '/api/commissions', access: 'user', feature: v.dashboard === 'salon' ? 'salon_commissions' : 'commission_tracking', router: createCommissionRoutes({ db, tables: { commission, commissionPlan, user, job, invoice }, authenticate, requirePermission, canSee, audit, salesRepAutoEarn: !!v.roof, ...(v.dashboard === 'salon' ? { salesKinds: true, payees: createSalonPayees(db), planClash: createSalonPlanClash(db) } : {}) } as any) },
    { path: '/api/locations', access: 'user', feature: 'multi_location', router: createLocationRoutes({ db, tables: { location, user }, authenticate, requirePermission } as any) },
    { path: '/api/equipment', access: 'user', feature: 'equipment_tracking', router: createEquipmentRoutes({ service: s.equipment, authenticate, requirePermission, canSee } as any) },
    { path: '/api/inventory', access: 'user', feature: ['inventory', 'parts_tracking'], router: createInventoryRoutes({ service: s.inventory, authenticate, requirePermission, audit, canSee } as any) },
    { path: '/api/fleet', access: 'user', feature: 'fleet', router: createFleetRoutes({ service: s.fleet, authenticate, requirePermission, canSee } as any) },
    { path: '/api/warranties', access: 'user', feature: 'warranties', router: createWarrantiesRoutes({ service: s.warranties, authenticate, requirePermission } as any) },
    { path: '/api/agreements', access: 'user', feature: ['service_agreements', 'maintenance_contracts'], router: createAgreementsRoutes({ service: s.agreements, authenticate, requirePermission, canSee, recurrence: !!v.agreements?.recurrence } as any) },

    // Documents are the registry's optional 'documents' feature for every CRM; the base template never gated them (the
    // field-service copy did, on both sides). Cutover switches it on for every CRM business, which had it before.
    // Home care has its own document store at the same path (documents / document_signatures: files against a client,
    // a caregiver or the company, and the caregivers' e-signature queue — server/crm/homecare/clients/documents.ts),
    // so the shared module is not mounted for it.
    ...(v.homecare ? [] : [{ path: '/api/documents', access: 'user' as const, feature: 'documents', router: createDocumentRoutes({

      // planMarkup only where drawings are marked up (construction): the shared module registers /:id/markups only when
      // the table is passed.
      db, tables: { document, documentVersion, project, contact, user, ...(v.documents?.markup ? { planMarkup } : {}) }, storage: s.storage, authenticate, requirePermission, audit: fileAudit,
      options: {
        types: v.documents?.types ?? ['general', 'contract', 'permit', 'drawing', 'photo', 'invoice', 'receipt', 'other'],
        // A clinic files against the animal, not only the owner (templates/crm-vet routes/documents.ts T12 M6).
        ...(v.patients ? { links: { patientId: patient } } : {}),
      },
    } as any) }]),
    // The home-care agency's own reports (CrmSettings.reports.module; templates/crm-homecare routes/reports.ts).
    { path: '/api/reports', access: 'user', router: v.reports?.module === 'homecare' ? createHomecareReportsRoutes(own) : createReportingRoutes({
      db, tables: { invoice, payment, job, project, quote, timeEntry, user, contact, teamMember, location }, authenticate, requirePermission,
      options: {
        featuresFor: features.enabledFeaturesFor,
        // The same condition the invoice list's totals use: the sale of a gift card is a liability, not revenue.
        ...(v.invoices?.giftCardSalesAreLiability ? { revenueOnly: notGiftCardSale } : {}),
        // A chair is measured by the services it performed and what they took (templates/crm-salon routes/reporting.ts, Salon T28 M6).
        ...(v.reports?.teamProductivity === 'serviceRecords' ? { teamProductivity: (companyId: string, range: { gte?: Date; lte?: Date }) => salonTeamProductivity(db, companyId, range) } : {}),
      },
    } as any) },
    { path: '/api/pricebook', access: 'user', router: createPricebookRoutes({ service: s.pricebook, db, tables: { company }, authenticate, requirePermission, requireFeature: features.requireEnabledFeature(['pricebook', 'flat_rate_pricebook']), canSee } as any) },
    { path: '/api/ads', access: 'user', router: ads },
    { path: '/api/onboarding', access: 'user', router: signedInAdmin(createOnboardingRoutes({ db, companyTable: company } as any)) },
    { path: '/api/messaging-billing', access: 'user', router: messagingBilling },
    // Texting from the business's own registered number (crm/comms/texting.ts).
    { path: '/api/texting', access: 'user', router: createTextingRoutes(own, factoryApiClient) },
    // Pictures in texts (crm/comms/smsMedia.ts): the signed-link door is public (the carrier has no sign-in); its router
    // signs everyone else in and asks Two-Way Texting itself. Scheduled texts are Two-Way Texting's (comms/scheduledTexts.ts).
    { path: SMS_MEDIA_PATH, access: 'public', router: createSmsMediaRoutes(own) },
    { path: '/api/sms-scheduled', access: 'user', feature: 'two_way_texting', router: createScheduledTextRoutes(own) },
    { path: '/api/internal/texting', access: 'factory', router: createTextingInternalRoutes(own) },
    { path: '/api/email-domain', access: 'user', router: signedInAdmin(createEmailDomainRoutes({ factoryApiClient } as any)) },
    { path: '/api/gbp', access: 'user', router: signedInAdmin(createGbpAdminRoutes(gbpDeps as any)) },
    { path: '/api/inbound-messages', access: 'user', router: inboundMessages },

    // Public doors inside: each router signs people in itself after them.
    { path: '/api/sms', access: 'public', router: inFront('/api/sms', createSmsRoutes({ service: s.sms, authenticate, requirePermission, requireAdmin: isAdmin, requireFeature: features.requireEnabledFeature('two_way_texting') } as any)) },
    // Home care's /api/stripe pays its visit invoices (server/crm/homecare/billing/stripe.ts), so the shared one — which
    // pays the CRM's invoice — stands aside there.
    ...(v.homecare ? [] : [{ path: '/api/stripe', access: 'public' as const, router: createStripeRoutes({ db, tables: { invoice, contact, payment, company }, stripeService: s.stripeService, authenticate, requirePermission, audit, canTakeCardPayments, requireFeature: features.requireEnabledFeature('online_payments'), requireTapToPay: features.requireEnabledFeature('tap_to_pay') } as any) }]),
    // The drips are also the dealership's Follow-Up product (follow_up_sequences): either switch keeps the follow-up parts
    // open, while campaigns and templates need Email Marketing itself — the union the RV copy gated (RV T19 M6); only
    // crm-rv is offered follow_up_sequences, so everyone else's gate is what it was.
    { path: '/api/marketing', access: 'public', router: createMarketingRoutes({
      service: s.marketing, authenticate, requirePermission, escapeHtml,
      featureGate: features.requireEnabledFeature(['email_marketing', 'follow_up_sequences']),
      campaignsGate: features.requireEnabledFeature('email_marketing'),
    } as any) },
    { path: '/api/quickbooks', access: 'public', router: createQuickBooksRoutes({ service: s.quickbooks, db, tables: { contact, invoice, invoiceLineItem, payment }, authenticate, requirePermission, audit, requireFeature: features.requireEnabledFeature('quickbooks') } as any) },
    { path: '/api/reviews', access: 'public', router: createReviewsRoutes({ service: s.reviews, db, tables: { reviewRequest }, authenticate, requireRole, requirePermission, audit, requireEnabledFeature: features.requireEnabledFeature } as any) },
    // The Stripe doors open for a business that takes cards: Online Payments, or a store, which always does and has no
    // feature switches at all (crm/store: everything is core). The store
    // was refused its own Connect button — "This module is not enabled" (store live test, 2026-10-26).
    // stripeLink: "I already have a Stripe account" — offered when the Factory has Stripe's client id; the Factory hands the
    // linked account to /api/internal/stripe-link below. (A test's fake Stripe stands in for the SDK, as for payments.)
    { path: '/api/integrations', access: 'public', router: createIntegrationsRoutes({ db, tables: { company, emailLog }, authenticate, requireAdmin: isAdmin, quickbooks: s.quickbooks, stripe: s.testStripeClient ?? s.stripe, factoryApiClient, stripeLink: true, requireQuickbooks: features.requireEnabledFeature('quickbooks'), requireOnlinePayments: v.store ? undefined : features.requireEnabledFeature('online_payments'), audit } as any) },
    { path: '/api/internal/stripe-link', access: 'factory', router: createStripeLinkInternalRoutes({ db, tables: { company, user }, audit }) },
    // The customer portal: a customer's own pages by their private link (/p/:token), and the staff switches that hand
    // the link out, which sign people in themselves (portal:share).
    // Home care's client portal answers first on the same path (inFront above).
    { path: '/api/portal', access: 'public', router: inFront('/api/portal', createPortalRoutes({
      db,
      tables: {
        contact, company, user, quote, quoteLineItem, quoteProposalOption, invoice, invoiceLineItem, payment, message, auditLog, activity,
        project, job, changeOrder, changeOrderLineItem, lienWaiver, rfi, submittal, document, documentShare,
        equipment, serviceAgreement, agreementVisit, formSubmission,
        // The owner's animals: the portal's Pets section (templates/crm-vet routes/portal.ts T12 H6).
        ...(v.patients ? { patient, vaccination, appointment, visit } : {}),
      },
      authenticate, audit, requirePermission,
      sendEmail: (to: string, template: string, data: Record<string, unknown>) => s.emailService.send(to, template, data),
      loadInvoicePdf, loadQuotePdf,
      selections: createSelectionsService(own),
      fileService: s.storage,
      // Roofing: the photos and documents the roofer chose to show a homeowner (crm/roof/portalFiles).
      ...(v.roof ? { jobFiles: roofPortalJobFiles(own) } : {}),
      ...live, logger,
      // The owner's feature switches decide which sections the portal offers.
      enabledFeaturesFor: features.enabledFeaturesFor,
      // Landscaping: finished visits with the crew's note and after-photos (feature visit_reports; null = not on, so a 404).
      ...(v.visitReports ? { visits: async ({ companyId, contactId }: { companyId: string; contactId: string }) =>
        (await features.enabledFeaturesFor(companyId)).includes('visit_reports')
          ? visitsForCustomer(db, companyId, contactId, (k, s) => `${SMS_MEDIA_PATH}/file/${pictureToken(k, s)}`)
          : null } : {}),
      canTakeCardPayments,
      // The deposit a quote asks: raised when the customer approves, shown on the quote's own page (crm/billing).
      quoteDeposit: { onApproved: (companyId: string, q: any) => afterApproval(companyId, q.id), depositFor: quoteBilling.depositFor },
      // Good / Better / Best on the customer's pages and pick: the same switch the office's quote routes ask (quoteOptions.ts proposalsLive).
      proposalsEnabled: (companyId: string) => features.isFeatureEnabled(companyId, 'quote_proposals'),
      // Endpoint groups this vertical doesn't offer its customers (the template's portal options).
      options: { disable: v.portal.disable, ...(v.portal.appointments ? { appointments: { appointment, service: serviceMenu, stylist: user, booking, manageUrl: (token: string) => `${siteOrigin()}/booking/${token}` } } : {}) },
    } as any)) },
    // The website's A/B script: anonymous, from the site's own origin.
    { path: '/api/public/ads-experiments', access: 'public', router: createAdsPublicRoutes({ db, tables: { company, adsExperiment, adsExperimentAssignment, adsExperimentConversion } } as any) },

    // The Factory.
    { path: '/api/internal/gbp', access: 'factory', router: createGbpInternalRoutes(gbpDeps as any) },
    { path: '/api/internal/inbound-email', access: 'factory', router: createInboundParseRoute({ db, inboundMessageTable: inboundMessage } as any) },

    // The CRM's own modules (moved from the template, not shared code).
    ...siteRecordsMounts(own), ...projectMounts(own), ...fieldMounts(own), ...commsMounts(own), ...officeMounts(own),
    // The near-copy CRMs' own modules (step 3e), each behind its features.
    ...basicMounts(own), ...landscapingMounts(own), ...barMounts(own), ...restaurantMounts(own), ...rvMounts(own), ...salonMounts(own, v), ...vetMounts(own, v),
    // Home care's add-on (docs/UNIFIED_HOMECARE_PLAN.md).
    ...homecareMounts(own),
    ...roofMounts(own),
    ...storeMounts(own),
  ]
}

/** Ads: the connector registers the business with Twomiah Ads when paid_ads is switched on. */
export function createCrmAdsConnector() {
  const factory = createFactoryApiClient() as any
  return createAdsConnector({ registerWithFactory: () => factory.registerAds() } as any)
}

