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
  pricebookGoodBetterBest, commission, commissionPlan,
} from '../db/schema/index.ts'
import type { EmailService } from '../core/email.ts'
import type { Logger } from '../core/logger.ts'
import { crmEmail, crmTemplates } from './messages.ts'

export interface CrmServiceDeps {
  db: any
  email: EmailService
  audit: any
  logger: Logger
  isFeatureEnabled: (companyId: string, feature: string | string[]) => Promise<boolean>
}

export function createCrmServices(deps: CrmServiceDeps) {
  const { db, email, audit, logger, isFeatureEnabled } = deps
  email.register(crmTemplates)
  // Every message the app sends is recorded, so Settings › Integrations can count them (the CRMs' T14 M23).
  email.setRecorder(createEmailLogger({ db, tables: { emailLog, company, user }, logger } as any))
  const emailService = crmEmail(email)

  const storage = createFileStorage()
  const usage = { reportSmsUsage, walletSufficient }

  const commissionEarner = createCommissionEarner({
    db, tables: { commission, commissionPlan, user, job, invoice, company }, invoiceJobLink: 'quoteId',
  } as any)
  const stripeService = createStripeService({
    db, tables: { contact, invoice, payment, company },
    options: {
      bookingCalendarKind: 'job',
      afterInvoicePayment: async (invoiceId: string) => { await commissionEarner.earnForInvoice(invoiceId) },
    },
  } as any)
  const sms = createSmsService({ db, tables: { smsConversation, smsMessage, smsTemplate, contact, company, job, user, teamMember }, usage } as any)
  const reviews = createReviewsService({ db, tables: { reviewRequest, company, contact, job }, sendRaw: (m: any) => email.sendRaw(m), usage: { reportSmsUsage } } as any)
  const marketing = createMarketingService({ db, tables: { campaign, contact, emailLog }, sendRaw: email.sendRaw, isFeatureEnabled } as any)
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
  const quickbooks = createQuickBooksService({ db, tables: { contact, invoice, invoiceLineItem, payment, company, qbIntegration }, options: { customerType: 'client' } } as any)
  const fleet = createFleetService({ db, tables: { vehicle, vehicleMaintenance, fuelLog } } as any)
  const warranties = createWarrantiesService({
    db, tables: { warrantyTemplate, projectWarranty, warrantyClaim, activityLog: activity, jobAssignment, job, project, contact },
  } as any)
  // Customer-asset tracking: the shared service keeps contactId only when told the column exists (the CRMs' T32 H9).
  const equipmentService = createEquipmentService({ db, tables: { equipment, equipmentCategory, equipmentMaintenance, contact }, options: { contacts: true } } as any)
  const pricebook = createPricebookService({ db, tables: { company, pricebookCategory, pricebookItem, pricebookGoodBetterBest } } as any)
  const tasks = createTasksService({ db } as any)
  const bulk = createBulkService({ db, tables: { contact, project, job, invoice, quote, timeEntry, payment } } as any)
  const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null

  /** Completing a job: a review request when the company asks for them (the CRMs' services/jobHooks.ts). */
  const jobHooks: { onComplete: JobHook } = {
    onComplete: async ({ job: done, companyId }) => {
      const [co] = await db.select({ enabledFeatures: company.enabledFeatures }).from(company).where(eq(company.id, companyId)).limit(1)
      if (((co?.enabledFeatures || []) as string[]).includes('google_reviews')) {
        reviews.scheduleReviewRequest(done.id).catch((err: any) => logger.warn('[jobs] review request not scheduled', { error: err?.message }))
      }
    },
  }

  return {
    emailService, storage, stripeService, stripe, sms, reviews, marketing, recurring, agreements, inventory, quickbooks,
    fleet, warranties, equipment: equipmentService, pricebook, tasks, bulk, commissionEarner, jobHooks,
    /** The CRM's timed work, started once at boot (not in tests): what each template's index.ts started. */
    startJobs() {
      reviews.startReviewProcessor()
      marketing.startMarketingProcessor()
      agreements.startBillingProcessor()
      recurring.startRecurringProcessor()
      commissionEarner.startCommissionEarner()
    },
  }
}

export type CrmServices = ReturnType<typeof createCrmServices>
