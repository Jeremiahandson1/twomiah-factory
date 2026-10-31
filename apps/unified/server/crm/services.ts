// The CRM's services, each built once from the shared code (packages/tenant-backend) with the app's database and
// tables — the wiring every CRM template carried in its own services/*.ts (templates/crm/backend/src/services). The
// routes (modules/crm.ts) and the background jobs (startJobs, run by server/index.ts) both use these.
import Stripe from 'stripe'
import { eq } from 'drizzle-orm'
import {
  createSmsService, createStripeService, createReviewsService, createMarketingService, createRecurringService,
  createAgreementsService, createInventoryService, createQuickBooksService, createFleetService, createWarrantiesService,
  createEquipmentService, createPricebookService, createTasksService, createCommissionEarner, createBulkService,
  createFileStorage, createEmailLogger, reportSmsUsage, walletSufficient, type JobHook,
} from '@twomiah/tenant-backend'
import {
  company, user, contact, job, project, quote, invoice, invoiceLineItem, payment, timeEntry, teamMember, location, emailLog,
  smsConversation, smsMessage, smsTemplate, reviewRequest, campaign, serviceAgreement, agreementVisit, agreementPlan,
  inventoryItem, inventoryLocation, stockLevel, inventoryTransaction, inventoryUsage, inventoryTransfer, purchaseOrder,
  purchaseOrderItem, qbIntegration, vehicle, vehicleMaintenance, fuelLog, warrantyTemplate, projectWarranty, warrantyClaim,
  activity, jobAssignment, equipment, equipmentCategory, equipmentMaintenance, pricebookCategory, pricebookItem,
  pricebookGoodBetterBest, commission, commissionPlan, vehicleTrip, locationLog, marketingAutomation, marketingAutomationSend,
} from '../db/schema/index.ts'
import { lastActivityFor, inCustomerGroup, customerGroupOptions } from '../data/marketingActivity.ts'
import { calculateDistance } from './field/geofencingService.ts'
import type { EmailService } from '../core/email.ts'
import type { CrmSettings } from '../core/vertical.ts'
import type { Vocabulary } from '../../../../packages/tenant-ui/src/labels/vocabulary.ts'
import type { Logger } from '../core/logger.ts'
import { crmEmail, crmTemplates } from './messages.ts'
import { createVisitSubject } from './salon/reviewSubject.ts'
import { createAppointmentReminders } from './salon/appointmentReminders.ts'
import { bookOnDeposit } from './restaurant/eventBooking.ts'
import { syncEventInvoiceDueDate, backfillEventInvoices } from './restaurant/eventLedger.ts'
import { recordConsent, withdrawConsent } from '../site/smsConsent.ts'
import { createInvoiceReminders } from './billing/invoiceReminders.ts'
import { createJobReminders } from './field/jobReminders.ts'
import { createQuickBooksAutoSync } from './office/quickbooksAutoSync.ts'
import { smsMediaLinks } from './comms/smsMedia.ts'
import { createScheduledTextRunner } from './comms/scheduledTexts.ts'
import { createInventoryLowStockDigest } from './inventory/lowStock.ts'
import { startLowStockDigest } from './lowStockDigest.ts'

/** A booking deposit Stripe says was paid (payments/stripe.ts onBookingDeposit). */
export type DepositPayment = { bookingId: string; companyId: string | null; paymentIntentId: string; amount: number }
export interface BookingDeposits {
  paid(p: DepositPayment): Promise<'done' | 'refund' | 'unknown'>
  refunded(p: DepositPayment): Promise<void>
}
/** A connected-account event claimed by its owner (payments/stripe.ts claimConnectedEvent): its result, or null = not ours. */
export type ConnectedEventClaim = (event: Stripe.Event, stripeAccount: string) => Promise<Record<string, unknown> | null>

export interface CrmServiceDeps {
  db: any
  email: EmailService
  audit: any
  logger: Logger
  isFeatureEnabled: (companyId: string, feature: string | string[]) => Promise<boolean>
  /** The vertical's switches (VerticalSettings.crm). */
  settings: CrmSettings
  /** The vertical's feature set ('crm-store'…): what "a customer coming back" means for marketing (data/marketingActivity.ts). */
  featureSet?: string
  /** What the business calls the people it serves (VerticalSettings.vocabulary): a marketing email's footer says it. */
  vocabulary?: Vocabulary
  /** Tests only: a fake Stripe client (TestSeams.stripe); otherwise one is made from STRIPE_SECRET_KEY. */
  stripe?: any
}

export function createCrmServices(deps: CrmServiceDeps) {
  const { db, email, audit, logger, isFeatureEnabled, settings } = deps
  const sites = !!settings.serviceSites
  email.register(crmTemplates)
  // Every message the app sends is recorded, so Settings › Integrations can count them (the CRMs' T14 M23).
  const recordEmail = createEmailLogger({ db, tables: { emailLog, company, user }, logger } as any)
  email.setRecorder(recordEmail)
  const emailService = crmEmail(email)

  const storage = createFileStorage()
  const usage = { reportSmsUsage, walletSufficient }

  const commissionEarner = createCommissionEarner({
    // The job an invoice names first (invoice.job_id, everyone's column now), then the job raised from its quote.
    db, tables: { commission, commissionPlan, user, job, invoice, company }, invoiceJobLink: 'jobId',
  } as any)
  // A paid booking deposit is the booking engine's (booking/engine.ts depositPaid); the booking module is made after
  // these services, so it is handed in with useBookingDeposits. Until then a deposit is no booking of ours.
  let bookingDeposits: BookingDeposits | null = null
  // The store's orders on the connected account (crm/store/checkout/paymentNotices.ts): its module mounts after these
  // services and hands its claim in with useConnectedEvents. Until then (and for every vertical without the store) an
  // event is the invoices' as before.
  let connectedEvents: ConnectedEventClaim | null = null
  const stripeService = createStripeService({
    db, tables: { contact, invoice, payment, company }, ...(deps.stripe !== undefined ? { stripe: deps.stripe } : {}),
    options: {
      bookingCalendarKind: 'job',
      onBookingDeposit: (p: DepositPayment) => (bookingDeposits ? bookingDeposits.paid(p) : Promise.resolve('unknown' as const)),
      onBookingDepositRefunded: async (p: DepositPayment) => { await bookingDeposits?.refunded(p) },
      claimConnectedEvent: (event: Stripe.Event, stripeAccount: string) => (connectedEvents ? connectedEvents(event, stripeAccount) : Promise.resolve(null)),
      afterInvoicePayment: async (invoiceId: string) => {
        await commissionEarner.earnForInvoice(invoiceId)
        // An event's invoice (CrmSettings.events): money arriving online books the date too — an enquiry becomes
        // confirmed; a held room is only logged, the money is already taken — then the due date moves to the next
        // unpaid installment (templates/crm-restaurant services/stripe.ts, T16 M8).
        if (settings.events) {
          await db.transaction(async (tx: any) => {
            const [inv] = await tx.select({ companyId: invoice.companyId, eventId: invoice.eventId }).from(invoice).where(eq(invoice.id, invoiceId)).limit(1)
            const refused = inv?.eventId ? await bookOnDeposit(tx, inv.companyId, inv.eventId) : null
            if (refused) logger.warn('[events] online deposit on an inquiry whose room is held', { refused })
          })
          await syncEventInvoiceDueDate(db, invoiceId)
        }
      },
    },
  } as any)
  const sms = createSmsService({
    db, tables: { smsConversation, smsMessage, smsTemplate, contact, company, job, user, teamMember }, usage,
    // A customer's own text: texting the business first is consent to be texted back; STOP withdraws it (site/smsConsent.ts).
    onConsent: (companyId: string, phone: string, change: 'given' | 'withdrawn') => change === 'given'
      ? recordConsent(db, companyId, { phone, source: 'texted_first' }).then(() => {})
      : withdrawConsent(db, companyId, phone),
    // Picture messages: files in the private store, handed to the carrier by short-lived signed links (comms/smsMedia.ts).
    media: smsMediaLinks,
  } as any)
  // Texts set to go later, sent by the timed work below (comms/scheduledTexts.ts).
  const scheduledTexts = createScheduledTextRunner({ db, sms, logger })
  const reviews = createReviewsService({
    db, tables: { reviewRequest, company, contact, job }, sendRaw: (m: any) => email.sendRaw(m), usage: { reportSmsUsage },
    // Review requests go out through sendRaw(), which records nothing by design, so they were invisible to the usage
    // counter; the same recorder as every other send (templates/crm-salon services/reviews.ts, Salon T30 L1 — for every
    // vertical).
    recordEmail,
    // A salon's request is about the visit that raised it, not a job (CrmSettings.reviews; Salon T30 L2).
    ...(settings.reviews?.subject === 'visit' ? { options: { subjectFor: createVisitSubject(db) } } : {}),
  } as any)
  // The drips keep sending with either Email Marketing or the dealership's Follow-Up switch; a scheduled campaign needs
  // Email Marketing itself (templates/crm-rv services/marketing.ts, RV T19 M6; only crm-rv is offered follow_up_sequences).
  const marketing = createMarketingService({
    db, tables: { campaign, contact, emailLog, automation: marketingAutomation, automationSend: marketingAutomationSend }, sendRaw: email.sendRaw, isFeatureEnabled,
    // Win-back and "not back in N days" read the trade's own idea of a visit (data/marketingActivity.ts); the store adds its
    // customer groups as an audience and a welcome on a first order.
    lastActivity: lastActivityFor(deps.featureSet),
    ...(deps.featureSet === 'crm-store' ? { welcome: true, audienceFilters: { customerGroupId: inCustomerGroup }, audienceOptions: async (companyId: string) => ({ groups: await customerGroupOptions(db, companyId) }) } : {}),
    sequencesEnabled: (companyId: string) => isFeatureEnabled(companyId, ['email_marketing', 'follow_up_sequences']),
    // "You are receiving this because you are a guest of ours" on a bar's email, not "a customer or contact" (salon
    // live test, 2026-10-25: the page's words come from the vocabulary; the email it sends says the same).
    recipientNoun: deps.vocabulary?.customer.one,
  } as any)
  const recurring = createRecurringService({ db, tables: { invoice, invoiceLineItem }, emailService } as any)
  const agreements = createAgreementsService({
    db,
    tables: { serviceAgreement, agreementVisit, agreementPlan, contact, job, invoice, invoiceLineItem, company },
    stripe: { listSavedPaymentMethods: stripeService.listSavedPaymentMethods, chargeInvoiceOffSession: stripeService.chargeInvoiceOffSession },
    audit,
    sendRenewalNotice: (to: string, data: Record<string, unknown>) => email.send(to, 'agreementRenewalNotice', data),
  } as any)
  const inventory = createInventoryService({
    db,
    tables: { inventoryItem, inventoryLocation, stockLevel, inventoryTransaction, inventoryUsage, inventoryTransfer, purchaseOrder, purchaseOrderItem, user, job, company, branch: location },
    emailService,
  } as any)
  // Low stock is ONE email a day, not one per movement (inventory/lowStock.ts → lowStockDigest.ts, the code the store shares).
  const inventoryLowStock = createInventoryLowStockDigest({ db, logger, features: { isFeatureEnabled } as any }, emailService)
  // QuickBooks customers are this vertical's paying contacts (CrmSettings.contacts.customerType: a dealership's
  // 'customer', templates/crm-rv services/quickbooks.ts).
  const quickbooks = createQuickBooksService({ db, tables: { contact, invoice, invoiceLineItem, payment, company, qbIntegration }, options: { customerType: settings.contacts?.customerType ?? 'client' } } as any)
  // The Auto-sync switch, made real (office/quickbooksAutoSync.ts): new and changed customers, invoices and payments every
  // 15 minutes where it is on, with retries and a log the Integrations card shows.
  const quickbooksSync = createQuickBooksAutoSync({ db, quickbooks, logger, isFeatureEnabled, customerType: settings.contacts?.customerType ?? 'client' })
  // Vehicles' locations and trips from the driver's phone pings where the vertical has GPS (CrmSettings.fleet; the
  // field-service and basic copies' services/fleet.ts); elsewhere those endpoints give the neutral answers.
  const fleet = createFleetService((settings.fleet?.gps
    ? { db, tables: { vehicle, vehicleMaintenance, fuelLog, vehicleTrip, locationLog, user }, calculateDistance, options: { gps: true } }
    : { db, tables: { vehicle, vehicleMaintenance, fuelLog } }) as any)
  const warranties = createWarrantiesService({
    db, tables: { warrantyTemplate, projectWarranty, warrantyClaim, activityLog: activity, jobAssignment, job, project, contact },
  } as any)
  // Customer-asset tracking: the shared service keeps contactId only when told the column exists (the CRMs' T32 H9).
  // Where the vertical has service sites, equipment records its site and the jobs done on it (field service et al).
  const equipmentService = createEquipmentService({
    db, tables: { equipment, equipmentCategory, equipmentMaintenance, contact, job, user },
    options: { contacts: true, sites, linkedJobs: sites },
  } as any)
  const pricebook = createPricebookService({ db, tables: { company, pricebookCategory, pricebookItem, pricebookGoodBetterBest } } as any)
  const tasks = createTasksService({ db } as any)
  const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null

  /**
   * A job's moments (the CRMs' services/jobHooks.ts): on the way, on site and done are texted to the customer where the
   * vertical says so; done asks for a review when the company has Google Reviews on, and makes the next visit of a
   * recurring service agreement.
   */
  const textArrival = !!settings.jobs?.textArrival
  const jobHooks: { onComplete: JobHook; onDispatch?: JobHook; onStart?: JobHook } = {
    ...(textArrival ? {
      onDispatch: async ({ job: j, companyId }) => { sms.sendJobUpdate(companyId, j.id, 'on_my_way').catch(() => {}) },
      onStart: async ({ job: j, companyId }) => { sms.sendJobUpdate(companyId, j.id, 'on_site').catch(() => {}) },
    } : {}),
    onComplete: async ({ job: done, companyId }) => {
      if (textArrival) sms.sendJobUpdate(companyId, done.id, 'completed').catch(() => {})
      const [co] = await db.select({ enabledFeatures: company.enabledFeatures }).from(company).where(eq(company.id, companyId)).limit(1)
      if (((co?.enabledFeatures || []) as string[]).includes('google_reviews')) {
        reviews.scheduleReviewRequest(done.id).catch((err: any) => logger.warn('[jobs] review request not scheduled', { error: err?.message }))
      }
      // A visit of a recurring agreement makes the next one (the screen reads nextServiceDate either way).
      if (!settings.agreements?.recurrence || !(done as any).serviceAgreementId) return { nextServiceDate: null }
      try {
        const next: any = await agreements.generateNextJob((done as any).serviceAgreementId, companyId)
        return { nextServiceDate: next?.nextServiceDate ?? null }
      } catch (err) {
        logger.info('[jobs] next agreement visit left to the daily scan', { error: (err as Error).message })
        return { nextServiceDate: null }
      }
    },
  }

  // Bulk status changes run the same moments as the job routes (packages/tenant-backend jobs.ts jobHookFor).
  const bulk = createBulkService({ db, tables: { contact, project, job, invoice, quote, timeEntry, payment }, jobHooks } as any)

  // Invoice reminders and the late fee, on each company's own switch and clock (billing/invoiceReminders.ts): every
  // vertical's invoices, and home care's Billing invoices where this is home care.
  const invoiceReminders = createInvoiceReminders({ db, email: emailService, audit, logger, isFeatureEnabled, homecare: !!settings.homecare })
  // The reminder before a job the office booked, on each business's own switch, hours and clock (field/jobReminders.ts).
  const jobReminders = createJobReminders({ db, sms, email: emailService, logger, isFeatureEnabled })

  /** A module's own timed work (home care's reminders and polls), registered when it mounts, started with the rest. */
  const moduleJobs: Array<() => void> = []

  return {
    /** Tests only: the fake Stripe client the shared service was handed, so home care's own checkout uses it too. */
    testStripeClient: deps.stripe as any,
    emailService, storage, stripeService, stripe, sms, reviews, marketing, recurring, agreements, inventory, quickbooks,
    fleet, warranties, equipment: equipmentService, pricebook, tasks, bulk, commissionEarner, jobHooks, invoiceReminders, jobReminders, quickbooksSync, scheduledTexts, inventoryLowStock,
    /** The private-events passes (reminders, card charges), put here when the events module mounts so a test can run one. */
    eventJobs: {} as Record<string, (...args: any[]) => Promise<number>>,
    /** Registers a module's timed work; startJobs starts it. Nothing starts at import or in tests. */
    addJob(start: () => void) { moduleJobs.push(start) },
    /** Where a paid booking deposit goes (the booking engine). */
    useBookingDeposits(d: BookingDeposits) { bookingDeposits = d },
    /** Who claims a connected-account event before the invoices see it (the store's orders). */
    useConnectedEvents(claim: ConnectedEventClaim) { connectedEvents = claim },
    /** The CRM's timed work, started once at boot (not in tests): what each template's index.ts started. */
    startJobs() {
      reviews.startReviewProcessor()
      marketing.startMarketingProcessor()
      agreements.startBillingProcessor()
      // A contract sold before its plan's visits were made has none: its term's visits go on the calendar, once, at boot
      // (agreements.scheduleMissingTermVisits — a term with any visit job is left alone). Never delays startup.
      void agreements.scheduleMissingTermVisits().then((made) => {
        for (const m of made) logger.info('[agreements] term visits made for an older contract', m)
      })
      recurring.startRecurringProcessor()
      commissionEarner.startCommissionEarner()
      // Recurring service agreements make their next visits: at boot, then every 6 hours (the field-service CRMs' index.ts).
      if (settings.agreements?.recurrence) {
        const scan = () => (agreements as any).scanAndGenerateJobs().catch((err: any) => logger.error('[agreements] next-visit scan failed', { error: err?.message }))
        setTimeout(scan, 60_000)
        setInterval(scan, 6 * 60 * 60 * 1000)
      }
      // Event payments recorded before the ledger lived on invoices move onto each event's invoice, once, at boot
      // (templates/crm-restaurant routes/events.ts ran it when the router loaded). Idempotent; never delays startup.
      if (settings.events) void backfillEventInvoices(db, logger).catch((err: any) => logger.error('[events] invoice backfill failed', { error: err?.message }))
      // Tomorrow's appointments get a reminder text, every 10 minutes (templates/crm-salon index.ts startAppointmentReminders).
      if (settings.appointmentReminders) createAppointmentReminders({ db, sms, logger }).startAppointmentReminders()
      // Due-soon and overdue invoice reminders, and the late fee, every hour (each company's own switch decides).
      invoiceReminders.start()
      // Reminders before the jobs the office booked, every 10 minutes (each business's own switch and hours decide).
      jobReminders.start()
      // QuickBooks auto-sync, every 15 minutes, for the companies whose switch is on.
      quickbooksSync.start()
      // Scheduled texts that are due, every minute.
      scheduledTexts.start()
      // The low-stock email for inventory items: hourly, sent once a day from 8am the shop's time.
      startLowStockDigest(inventoryLowStock)
      for (const start of moduleJobs) start()
    },
  }
}

export type CrmServices = ReturnType<typeof createCrmServices>
