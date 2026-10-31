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
import { billOnComplete } from '../data/routeBilling.ts'
import { stampVisitStart, recordVisitTime } from '../data/routeVisits.ts'
import { sendVisitReport, visitSendDeps } from '../data/visitReports.ts'

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

/** The moments of a job a module can act on. */
export type JobMomentKind = 'created' | 'dispatched' | 'started' | 'completed'
export type JobMoment = (kind: JobMomentKind, ctx: { job: any; companyId: string; userId: string }) => Promise<unknown> | unknown

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
  // Commissions a vertical earns in its own way beside the job-based engine (the salon pays the stylist of a visit): each module hands in
  // what it earns for a bill (and its sweep); every door that records money earns through earnCommission.
  const commissionHooks: Array<{ earn: (invoiceId: string) => Promise<unknown>; sweep?: () => Promise<unknown> }> = []
  const earnCommission = async (invoiceId: string) => {
    await commissionEarner.earnForInvoice(invoiceId)
    for (const h of commissionHooks) await h.earn(invoiceId).catch((e: any) => logger.warn('[commissions] earn failed', { invoiceId, error: e?.message || String(e) }))
  }
  // A way of paying that a refund puts back where it came from (the salon's gift card): the module hands in what puts the money back,
  // run inside the refund's own transaction (packages/tenant-backend InvoiceOptions.refundTender). Until one registers, a refund by it is refused.
  const tenderRefunds = new Map<string, (tx: any, invoice: any, amount: number) => Promise<string | null>>()
  // A paid booking deposit is the booking engine's (booking/engine.ts depositPaid); the booking module is made after
  // these services, so it is handed in with useBookingDeposits. Until then a deposit is no booking of ours.
  let bookingDeposits: BookingDeposits | null = null
  // The store's orders on the connected account (crm/store/checkout/paymentNotices.ts) and the salon's saved cards
  // (crm/salon/cardOnFile.ts): each module mounts after these services and hands its claim in with useConnectedEvents.
  // They are asked in turn; the first to answer owns the event. Until then (and for every vertical with neither) an
  // event is the invoices' as before.
  const connectedEvents: ConnectedEventClaim[] = []
  // What a module does once an invoice is paid in full-or-part (roofing collects the job): registered when the module
  // mounts, run by BOTH ways money arrives — a payment typed in on the screen (invoice routes' afterMoney) and a card or
  // bank payment on the business's Stripe (afterInvoicePayment below). One failing step never stops the others.
  const invoicePaidSteps: Array<(invoiceId: string) => Promise<unknown>> = []
  const afterInvoicePaid = async (invoiceId: string) => {
    for (const step of invoicePaidSteps) {
      try { await step(invoiceId) } catch (err) { logger.warn?.('[invoices] an after-payment step failed', { invoiceId, error: (err as Error)?.message }) }
    }
  }
  // The salon's card step at online booking: the salon module hands in its cards service, the app hands in the booking
  // engine's "card saved" (the booking module is made after these services).
  const bookingCard: { cards: any | null; confirm: ((companyId: string, token: string) => Promise<unknown>) | null } = { cards: null, confirm: null }
  const stripeService = createStripeService({
    db, tables: { contact, invoice, payment, company }, ...(deps.stripe !== undefined ? { stripe: deps.stripe } : {}),
    options: {
      bookingCalendarKind: 'job',
      onBookingDeposit: (p: DepositPayment) => (bookingDeposits ? bookingDeposits.paid(p) : Promise.resolve('unknown' as const)),
      onBookingDepositRefunded: async (p: DepositPayment) => { await bookingDeposits?.refunded(p) },
      claimConnectedEvent: async (event: Stripe.Event, stripeAccount: string) => {
        for (const claim of connectedEvents) { const answer = await claim(event, stripeAccount); if (answer) return answer }
        return null
      },
      afterInvoicePayment: async (invoiceId: string) => {
        await earnCommission(invoiceId)
        await afterInvoicePaid(invoiceId)
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
  // What a module does at a job's moments (made, on the way, started, done), registered when the module mounts — the way
  // invoicePaidSteps are. Run by every door a status is reached by (the job routes and bulk updates). One failing step never
  // stops the others, or the job.
  const jobMomentSteps: JobMoment[] = []
  const afterJobMoment = async (kind: JobMomentKind, ctx: { job: any; companyId: string; userId: string }) => {
    for (const step of jobMomentSteps) {
      try { await step(kind, ctx) } catch (err) { logger.warn?.('[jobs] a job-moment step failed', { kind, error: (err as Error)?.message }) }
    }
  }
  const jobHooks: { onComplete: JobHook; onDispatch?: JobHook; onStart?: JobHook; onCreate?: JobHook } = {
    onCreate: async (ctx) => { await afterJobMoment('created', ctx) },
    onDispatch: async (ctx) => {
      if (textArrival) sms.sendJobUpdate(ctx.companyId, ctx.job.id, 'on_my_way').catch(() => {})
      await afterJobMoment('dispatched', ctx)
    },
    // Start on a route visit keeps the time (data/routeVisits.ts); where the vertical texts arrivals it also says "on site".
    onStart: async (ctx) => {
      const { job: j, companyId } = ctx
      await afterJobMoment('started', ctx)
      if ((j as any).recurringRouteStopId) await stampVisitStart(db, companyId, j.id).catch((err: any) => logger.warn('[jobs] visit start not kept', { error: err?.message }))
      if (textArrival) sms.sendJobUpdate(companyId, j.id, 'on_site').catch(() => {})
    },
    onComplete: async (ctx) => {
      const { job: done, companyId } = ctx
      await afterJobMoment('completed', ctx)
      if (textArrival) sms.sendJobUpdate(companyId, done.id, 'completed').catch(() => {})
      // A route billed per visit gets its draft invoice as the crew finishes the visit (data/routeBilling.ts); a failure here
      // never holds up completing the job.
      if ((done as any).recurringRouteStopId) {
        await recordVisitTime(db, companyId, done as any).catch((err: any) => logger.warn('[jobs] visit time not kept', { error: err?.message }))
        await billOnComplete(db, companyId, done as any).catch((err: any) => logger.warn('[jobs] route visit not billed', { error: err?.message }))
      }
      const [co] = await db.select({ enabledFeatures: company.enabledFeatures }).from(company).where(eq(company.id, companyId)).limit(1)
      if (((co?.enabledFeatures || []) as string[]).includes('google_reviews')) {
        reviews.scheduleReviewRequest(done.id).catch((err: any) => logger.warn('[jobs] review request not scheduled', { error: err?.message }))
      }
      // The customer is told the visit is done, with the crew's note and after-photos, where the business has turned that on
      // (feature visit_reports, data/visitReports.ts). Never holds up completing the job.
      if (await isFeatureEnabled(companyId, 'visit_reports').catch(() => false)) {
        await sendVisitReport(db, visitSendDeps((m) => email.sendRaw(m)), companyId, done.id).catch((err: any) => logger.warn('[jobs] visit message not sent', { error: err?.message }))
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
  const bulk = createBulkService({ db, tables: { contact, project, job, invoice, quote, timeEntry, payment }, jobHooks, afterInvoicePaid } as any)

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
    fleet, warranties, equipment: equipmentService, pricebook, tasks, bulk, commissionEarner, jobHooks, onJobMoment: (step: JobMoment) => { jobMomentSteps.push(step) }, invoiceReminders, jobReminders, quickbooksSync, scheduledTexts, inventoryLowStock,
    /** The private-events passes (reminders, card charges), put here when the events module mounts so a test can run one. */
    eventJobs: {} as Record<string, (...args: any[]) => Promise<number>>,
    /** Registers a module's timed work; startJobs starts it. Nothing starts at import or in tests. */
    addJob(start: () => void) { moduleJobs.push(start) },
    /** Where a paid booking deposit goes (the booking engine). */
    useBookingDeposits(d: BookingDeposits) { bookingDeposits = d },
    /** A step to run after money lands on an invoice, by either way it arrives (roofing's: collect the job). */
    onInvoicePaid(step: (invoiceId: string) => Promise<unknown>) { invoicePaidSteps.push(step) },
    /** Runs those steps: commissions' sibling for a payment typed in on the screen. */
    afterInvoicePaid,
    /** The salon's card step at online booking (crm/salon/onlineBooking.ts, booking/engine.ts cardSaved). */
    bookingCard,
    /** Who claims a connected-account event before the invoices see it (the store's orders, the salon's saved cards). */
    useConnectedEvents(claim: ConnectedEventClaim) { connectedEvents.push(claim) },
    /** A vertical's own way of earning commission on a paid bill (the salon's stylist commissions). */
    useCommissionEarner(h: { earn: (invoiceId: string) => Promise<unknown>; sweep?: () => Promise<unknown> }) { commissionHooks.push(h) },
    earnCommission,
    /** A refund by a way of paying that holds money (a gift card) puts it back; the owning module registers the doer. */
    useTenderRefund(method: string, doer: (tx: any, invoice: any, amount: number) => Promise<string | null>) { tenderRefunds.set(method, doer) },
    creditTender: async (method: string, tx: any, invoice: any, amount: number) => {
      const doer = tenderRefunds.get(method)
      return doer ? doer(tx, invoice, amount) : 'This way of paying cannot be refunded here.'
    },
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
      for (const h of commissionHooks) if (h.sweep) { setTimeout(() => { void h.sweep!() }, 120_000); setInterval(() => { void h.sweep!() }, 5 * 60_000) }
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
