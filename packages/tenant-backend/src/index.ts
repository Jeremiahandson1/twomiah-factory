// @twomiah/tenant-backend — Hono route factories vendored into each tenant backend.
// The factory copies `packages/tenant-backend/src/**` into each tenant's
// `backend/src/shared/` at generation. Tenant route glue imports from
// '../shared/...' and passes its local Drizzle `db` + table references in,
// so the shared code stays schema-agnostic and vertical-specific columns
// never leak across verticals.

export { createEmailAliasesRoutes } from './emailAliases'
export { createInboundParseRoute } from './inboundParse'
export { createInboundMessagesRoutes } from './inboundMessages'
export { createGbpAdminRoutes, createGbpInternalRoutes } from './gbp'
export { createOnboardingRoutes } from './onboarding'
export { createEmailDomainRoutes } from './emailDomain'
export { createAccountRoutes } from './account'
// Read-only billing: the Factory owns plans + Stripe; the tenant mirrors the subscription summary.
export { createBillingRoutes, createSubscriptionSyncRoute, refreshSubscriptionFromFactory, applySubscriptionToCompany } from './billing'
export type { BillingDeps, BillingFactoryClient } from './billing'
export { PLANS, planFor, seatsForPlan } from './plans'
export type { PlanDef, TenantSubscription } from './plans'
export { createFactoryApiClient } from './factoryClient'
export type {
  EmailAliasesDeps,
  InboundParseDeps,
  EmailDomainDeps,
  FactoryApiClient,
} from './types'
export type { AccountDeps } from './account'

// The feature registry — the one feature vocabulary shared by the Factory and every tenant.
export {
  FEATURE_REGISTRY, FEATURE_MAP, PLAN_TIERS,
  getCategories, getFeaturesForTemplate, getDefaultFeaturesForTemplate,
  getAdvertisableFeatures, getAdvertisableFeaturesForTemplate, getFeaturesForPlan,
} from './featureRegistry'
export type { FeatureDef } from './featureRegistry'

// Invoices + quotes — one implementation for every CRM; the template injects its tables and services.
export { createInvoiceRoutes } from './invoicing/invoices'
export type { InvoiceDeps, InvoiceOptions, InvoiceTables } from './invoicing/invoices'
export { createQuoteRoutes } from './invoicing/quotes'
export type { QuoteDeps, QuoteOptions, QuoteTables } from './invoicing/quotes'
export { round2, calcTotals, isOverdue, deriveStatus, DEFAULT_OPEN_STATUSES, defaultTaxRateFrom, paymentTermsDaysFrom, dueDateFromTerms, normalizeDateInput, nextNumber } from './invoicing/money'

// Online booking — one implementation for every CRM; the template injects its tables + the calendar it books onto.
export { createBookingRoutes, externalBookingsProxy } from './booking/routes'
export { createBookingService } from './booking/service'
export type { BookingService } from './booking/service'
export { jobCalendar, appointmentCalendar } from './booking/calendars'
export { createWidgetCatalog, createMenuCatalog } from './booking/catalog'
export { BookingError } from './booking/types'
export type { BookingDeps, BookingOptions, BookingTables, BookingCalendar, BookingCatalog, CatalogService, BookingStatus } from './booking/types'
export { zonedWallTimeToUtc, tzParts, safeTz, isValidTz, formatWhen } from './booking/time'

// Reports + the jobs-family dashboard — one implementation for every CRM; the template injects its tables.
export { createReportingRoutes, createReportingService, parseRange, ReportError } from './reporting/reporting'
export type { ReportingDeps, ReportingOptions, ReportingTables, ReportingService, DateRange } from './reporting/reporting'
export { createJobsDashboardRoutes } from './reporting/jobsDashboard'
export type { JobsDashboardDeps, JobsDashboardTables } from './reporting/jobsDashboard'

// Files — private R2 storage + documents (with version history / markups) + photos, one implementation for every CRM.
export { createFileStorage, sniffType, baseMime, ALLOWED_MIMES, INLINE_IMAGE_TYPES } from './files/storage'
export type { FileStorage, UploadedFile, StoredObject, FileStorageOptions } from './files/storage'
export { createDocumentRoutes } from './files/documents'
export type { DocumentDeps, DocumentTables } from './files/documents'
export { createPhotoRoutes, PHOTO_CATEGORIES } from './files/photos'
export type { PhotoDeps, PhotoTables } from './files/photos'

// Contacts — one implementation for every CRM; the template injects its tables, guards and related lists.
export { createContactRoutes, standardRelations, standardGuards, isValidPhone, DEFAULT_CONTACT_TYPES } from './contacts/contacts'
export type { ContactDeps, ContactOptions, ContactRelation, ContactGuard, ContactSitesTables } from './contacts/contacts'

// Company settings + feature toggles + login users — one implementation for every CRM.
export { createCompanyRoutes, sanitizeCompany, COMPANY_SECRETS } from './company/company'
export type { CompanyDeps } from './company/company'

// Jobs / service calls + the public media proxy for job photos — one implementation for every CRM.
export { createJobRoutes, createMediaRoutes, JOB_PRIORITIES, OPEN_JOB_STATUSES } from './jobs/jobs'
export type { JobDeps, JobOptions, JobTables, JobHook, JobPhotoStorage } from './jobs/jobs'

// Boot-time additive schema reconcile (db/reconcile.ts in every CRM template).
export { reconcileSchema, buildCreateTable, buildAddColumn, buildCreateIndex } from './schemaReconcile'
export type { TableSpec, ColumnSpec, IndexSpec, ReconcileExecutor, ReconcileResult } from './schemaReconcile'

// Texting / AI usage wallet (read-only mirror of the Factory) — /api/messaging-billing in every CRM.
export { createMessagingBillingRoutes, fetchMessagingBillingStatus } from './messagingBilling'
export type { MessagingBillingStatus } from './messagingBilling'

// Auth — bearer middleware, the role → permission matrix, and the login/refresh/me/password routes, one implementation for every CRM.
export { createAuthMiddleware } from './auth/middleware'
export type { AuthMiddlewareDeps, AuthUserContext } from './auth/middleware'
export { createPermissions, ROLE_HIERARCHY, BASE_ROLE_PERMISSIONS } from './auth/permissions'
export type { PermissionsDeps, Permissions } from './auth/permissions'
export { createAuthRoutes, passwordSchema, PASSWORD_RULE_TEXT, generateTokens } from './auth/auth'
export type { AuthDeps, AuthOptions, AuthTables } from './auth/auth'

// Customer portal — token-link routes for customers / collaborators / service customers, one implementation for every CRM.
export { createPortalRoutes, PORTAL_QUOTE_HIDDEN, PORTAL_INVOICE_HIDDEN } from './portal/portal'

// Integrations — two-way SMS (Twilio, signature-checked webhooks), QuickBooks Online (signed OAuth state), Google review
// requests, and the messaging-usage wallet gate; one implementation for every CRM.
export { reportSmsUsage, walletSufficient } from './integrations/messagingUsage'
export { formatPhoneE164, parseTwilioBody, verifyTwilioRequest, twilioSignatureFor, twilioClient, twilioConfigFromEnv, twilioConfigFor, companyTwilioNumbers, twilioConfigured, TWIML_EMPTY } from './integrations/twilio'
export { createIntegrationsRoutes } from './integrations/integrations'
export type { IntegrationsRoutesDeps } from './integrations/integrations'
export type { TwilioConfig } from './integrations/twilio'
export { createSmsService, createSmsRoutes } from './integrations/sms'
export type { SmsService, SmsServiceDeps, SmsRoutesDeps, SmsTables, SmsUsage } from './integrations/sms'
export { createQuickBooksService, createQuickBooksRoutes } from './integrations/quickbooks'
export type { QuickBooksService, QuickBooksServiceDeps, QuickBooksRoutesDeps, QuickBooksTables, QuickBooksOptions } from './integrations/quickbooks'
export { createReviewsService, createReviewsRoutes, generateGoogleReviewLink } from './integrations/reviews'
export type { ReviewsService, ReviewsServiceDeps, ReviewsRoutesDeps, ReviewsTables } from './integrations/reviews'
export type { PortalDeps, PortalTables, PortalOptions, PortalSelectionsService, PortalFileService } from './portal/portal'

// Team roster, time tracking (hours + clock-in/out + weekly + approvals) and expenses — one implementation each; the template injects its tables.
export { createTeamRoutes, teamMemberSchema } from './team/team'
export type { TeamDeps, TeamTables } from './team/team'
export { createTimeRoutes, getWeekStart } from './time/time'
export type { TimeDeps, TimeTables } from './time/time'
export { createExpenseRoutes, DEFAULT_EXPENSE_CATEGORIES } from './expenses/expenses'
export type { ExpenseDeps, ExpenseTables } from './expenses/expenses'

// Email marketing — templates, campaigns (audience preview, send, schedule, tracking, unsubscribe), drip sequences + the worker.
export { createMarketingService, createMarketingRoutes, MarketingError, SEQUENCE_TRIGGERS, AUDIENCE_TYPES } from './marketing/marketing'
export type { MarketingService, MarketingServiceDeps, MarketingRoutesDeps, MarketingTables, MailMessage } from './marketing/marketing'

// Lead Inbox — inbound leads (Factory-forwarded email + secret-locked webhooks), lead sources, convert-to-contact; one implementation for every CRM.
export { createLeadsRoutes, parseLeadEmail, parseWebhookPayload, readInboundBody, TRADES_LEAD_PLATFORMS, LEAD_STATUSES } from './leads/leads'
export type { LeadsDeps, LeadsOptions, LeadsTables, ParsedLead } from './leads/leads'

// Twomiah Ads — pass-through to the Twomiah Ads service with the tenant's key (spend-guarded), plus A/B landing-page tests
// and the premium website's public assign/convert endpoints.
export { createAdsRoutes, createAdsPublicRoutes, createAdsClient, createAdsConnector, normaliseVariants, AdsUpstreamError, ADS_PLATFORMS, ADS_OBJECTIVES, ADS_CONNECT_PLATFORMS, EXPERIMENT_STATUSES, DEFAULT_ADS_URL } from './ads/ads'
export type { AdsDeps, AdsPublicDeps, AdsTables, AdsConnector, AdsConnectorDeps } from './ads/ads'

// Pricebook — flat-rate catalog: validated items/categories, Good-Better-Best tiers (schema-backed), feature-gated.
export { createPricebookService, createPricebookRoutes, PricebookError, PRICEBOOK_TIERS, itemCreateSchema, itemUpdateSchema, optionsSchema } from './pricebook/pricebook'
export type { PricebookService, PricebookServiceDeps, PricebookRoutesDeps, PricebookTables } from './pricebook/pricebook'

// Tasks — to-do list with checklist, due dates, stats (crm, crm-vet). Parameterized raw SQL; template wires db + authenticate.
export { createTasksService, createTasksRoutes } from './tasks/tasks'
export type { TasksService, TasksServiceDeps, TasksRoutesDeps } from './tasks/tasks'

// Equipment tracking — assets, warranty, maintenance history, reports (crm, crm-fieldservice, crm-landscaping).
// fs/landscaping link equipment to contact/site/location/jobs via options.
export { createEquipmentService, createEquipmentRoutes } from './equipment/equipment'
export type { EquipmentService, EquipmentServiceDeps, EquipmentRoutesDeps, EquipmentTables, EquipmentOptions } from './equipment/equipment'

// Service Agreements / memberships — plans, agreements, visits, autopay billing, recurrence job-generation
// (crm, crm-fieldservice, crm-landscaping). fs/landscaping enable the recurrence endpoints via routes' `recurrence`.
export { createAgreementsService, createAgreementsRoutes } from './agreements/agreements'
export type { AgreementsService, AgreementsServiceDeps, AgreementsRoutesDeps, AgreementsTables, AgreementsStripe } from './agreements/agreements'

// Recurring invoices — templates that generate invoices on a schedule (crm, crm-fieldservice, crm-landscaping).
// Parameterized raw SQL (recurring_invoice tables aren't in schema.ts); emailService injected via deps.
export { createRecurringService, createRecurringRoutes, FREQUENCIES, calculateNextDate } from './recurring/recurring'
export type { RecurringService, RecurringServiceDeps, RecurringRoutesDeps, RecurringTables, RecurringEmail, RecurringAudit } from './recurring/recurring'

// Fleet / vehicle tracking — vehicles, maintenance, fuel, stats (crm, crm-fieldservice, crm-landscaping).
// Live GPS + trips (location_log / vehicle_trip) gated behind options.gps (fs/landscaping).
export { createFleetService, createFleetRoutes } from './fleet/fleet'
export type { FleetService, FleetServiceDeps, FleetRoutesDeps, FleetTables } from './fleet/fleet'

// Warranties — post-construction warranty tracking, claims, service scheduling (crm, crm-fieldservice, crm-landscaping, crm-rv).
// Activity-log table injected via tables.activityLog (crm/rv pass `activity`; fs/lnd pass `activityLog`).
export { createWarrantiesService, createWarrantiesRoutes } from './warranties/warranties'
export type { WarrantiesService, WarrantiesServiceDeps, WarrantiesRoutesDeps, WarrantiesTables } from './warranties/warranties'
