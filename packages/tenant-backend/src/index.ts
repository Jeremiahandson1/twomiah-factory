// @twomiah/tenant-backend — Hono route factories vendored into each tenant backend.
// The factory copies `packages/tenant-backend/src/**` into each tenant's
// `backend/src/shared/` at generation. Tenant route glue imports from
// '../shared/...' and passes its local Drizzle `db` + table references in,
// so the shared code stays schema-agnostic and vertical-specific columns
// never leak across verticals.

/** Timestamps leave this API with their zone — see instants.ts for the owner report behind it. */
export { asInstant, withInstants } from './instants'
export { partialOf } from './partialOf'

export { createEmailAliasesRoutes, createEmailAliasesInternalRoute } from './emailAliases'
export { resyncAliasesAfterTeamChange, deliversTo } from './emailAliases'
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
export { seatRefusal, seatLimitOf } from './company/seats'
// A dollar figure as a person reads it — grouped, two decimals, locale pinned. See money.ts.
export { money, amount } from './invoicing/money'
export type { PlanDef, TenantSubscription } from './plans'
export { createFactoryApiClient } from './factoryClient'
export type {
  EmailAliasesDeps,
  AliasMember,
  EmailAliasState,
  EmailAliasStatusReport,
  InboundParseDeps,
  EmailDomainDeps,
  FactoryApiClient,
} from './types'
export type { AccountDeps } from './account'

// The feature registry — the one feature vocabulary shared by the Factory and every tenant.
export {
  FEATURE_REGISTRY, FEATURE_MAP,
  getCategories, getFeaturesForTemplate, getDefaultFeaturesForTemplate,
  getAdvertisableFeatures, getAdvertisableFeaturesForTemplate, getFeaturesForPlan, withoutNotReady, withinOffer,
  notReadyWords, notReadyPattern, siteSectionFeature, isPaidAddOn,
} from './featureRegistry'
export type { FeatureDef } from './featureRegistry'

// Invoices + quotes — one implementation for every CRM; the template injects its tables and services.
export { createInvoiceRoutes, insertInvoice, retotalInvoice, replaceInvoiceLines, recordInvoicePayment, recordInvoiceRefund, applyInvoiceCredit } from './invoicing/invoices'
export type { InvoiceDeps, InvoiceOptions, InvoiceTables, InvoiceLine, RecordPaymentInput, RecordPaymentOutcome, RecordRefundInput, RecordRefundOutcome } from './invoicing/invoices'
// When a client is actually due back: their own rhythm once we have enough history, the menu's
// interval until then.
export { rebookInterval, describeInterval, categoryKey, preferredCategoryLabel, MIN_INTERVAL_DAYS, MAX_INTERVAL_DAYS, VISITS_TO_LEARN } from './retention/rebooking'
export type { RebookInterval, IntervalBasis } from './retention/rebooking'
// Money a client has ON ACCOUNT with the business — a ledger, spendable at checkout, never expiring.
export { createAccountBalanceStore, balanceFrom, describeBalance, ACCOUNT_BALANCE_METHOD } from './clients/accountBalance'
export type { AccountEntry, AccountEntrySource, AddEntryInput, SpendOutcome, AccountBalanceStore } from './clients/accountBalance'
// The same ledger, anchored on the user row: what a member of staff owes the business. (Salon RR9)
export {
  createStaffBalanceStore, owedFrom, describeOwed, SETTLE_ROUTES, SOURCE_FOR_ROUTE,
  PAYROLL_DEDUCTION_SETTING, payrollDeductionsAllowed,
} from './team/staffBalance'
export type { StaffEntrySource, SettleRoute, StaffBalanceStore } from './team/staffBalance'
export { createQuoteRoutes } from './invoicing/quotes'
export { isIncluded, includedLines, depositAmount, depositProblem, retotalQuote, chooseOptionalLine } from './invoicing/quoteOptions'
export { priceFromMarkup, applyMarkups, groupBySection, hasStructure, sectionSummary } from './invoicing/quoteSections'
export { SIGNING_EVIDENCE, withoutSigningEvidence } from './invoicing/signingEvidence'
export type { QuoteDeps, QuoteOptions, QuoteTables } from './invoicing/quotes'
// roundsToNothing: the one answer to "is this a real amount" — a positive value that stores as 0.00.
// The owner reported that twice on Events; thirteen more fields across salon, RV and the dispensary
// had the same hole. (T51 follow-up)
export { round2, roundsToNothing, calcTotals, isOverdue, deriveStatus, startOfUtcDay, overdueCutoff, DEFAULT_OPEN_STATUSES, defaultTaxRateFrom, paymentTermsDaysFrom, paymentTermsProblem, PAYMENT_TERMS_MAX_DAYS, dueDateFromTerms, quoteValidityDaysFrom, quoteExpiryFromTerms, normalizeDateInput, isRealCalendarDay, businessToday, nextNumber, invoiceBalance, recomputeStatus } from './invoicing/money'

// Online booking — one implementation for every CRM; the template injects its tables + the calendar it books onto.
export { createBookingRoutes, externalBookingsProxy } from './booking/routes'
export { createStripeService, createStripeRoutes } from './payments/stripe'
export { createBulkService } from './bulk/bulk'
export type { BulkService, BulkServiceDeps, BulkTables } from './bulk/bulk'
export type { StripeService, StripeServiceDeps, StripeServiceOptions, StripeRoutesDeps, StripeTables } from './payments/stripe'
export { createBookingService } from './booking/service'
export type { BookingService } from './booking/service'
export { jobCalendar, appointmentCalendar, normaliseSpecies } from './booking/calendars'
export { createWidgetCatalog, createMenuCatalog } from './booking/catalog'
export { BookingError } from './booking/types'
export type { BookingDeps, BookingOptions, BookingTables, BookingCalendar, BookingCatalog, CatalogService, BookingStatus } from './booking/types'
export { zonedWallTimeToUtc, tzParts, safeTz, isValidTz, formatWhen, addDays, isIsoDate, isRealDate, DAY_MS, minutesToHm } from './booking/time'
export { seriesDays, describeSeriesDays, cleanWeekdays, addMonthsClamped, MAX_SERIES, type SeriesDays, type SeriesFrequency } from './time/series'

// Reports + the jobs-family dashboard — one implementation for every CRM; the template injects its tables.
export { createReportingRoutes, createReportingService, parseRange, ReportError } from './reporting/reporting'
export type { ReportingDeps, ReportingOptions, ReportingTables, ReportingService, DateRange } from './reporting/reporting'
export { createJobsDashboardRoutes } from './reporting/jobsDashboard'
export { countNewLeads, listNewLeads } from './reporting/newLeads'
export type { NewLeads, NewLeadRow } from './reporting/newLeads'
export type { JobsDashboardDeps, JobsDashboardTables } from './reporting/jobsDashboard'

// Files — private R2 storage + documents (with version history / markups) + photos, one implementation for every CRM.
export { createFileStorage, sniffType, baseMime, ALLOWED_MIMES, INLINE_IMAGE_TYPES } from './files/storage'
export type { FileStorage, UploadedFile, StoredObject, FileStorageOptions } from './files/storage'
export { createDocumentRoutes } from './files/documents'
export type { DocumentDeps, DocumentTables } from './files/documents'
export { createPhotoRoutes, PHOTO_CATEGORIES } from './files/photos'
export type { PhotoDeps, PhotoTables } from './files/photos'

// Contacts — one implementation for every CRM; the template injects its tables, guards and related lists.
export { US_STATES, normaliseState, normaliseZip, zipField, STATE_ERROR, ZIP_ERROR } from './address'
export { createContactRoutes, ownContactScope, createContactDeleter, standardRelations, standardGuards, isValidPhone, DEFAULT_CONTACT_TYPES, withoutPortalCredential, withoutPaymentInternals, PAYMENT_INTERNAL_KEYS } from './contacts/contacts'
export type { ContactDeps, ContactOptions, ContactRelation, ContactGuard, ContactSitesTables, ContactDeleter, ContactDeleteOutcome } from './contacts/contacts'

// Company settings + feature toggles + login users — one implementation for every CRM.
export { createCompanyRoutes, sanitizeCompany, redactCompanyCommercial, COMPANY_SECRETS, COMPANY_COMMERCIAL } from './company/company'
export type { CompanyDeps } from './company/company'
export { WEEK_DAYS, checkBusinessHours, businessHoursLines, businessHoursOf, businessHoursWindows } from './company/businessHours'
export type { BusinessHours, DayHours, WeekDay } from './company/businessHours'

// Jobs / service calls + the public media proxy for job photos — one implementation for every CRM.
export { createJobRoutes, createMediaRoutes, JOB_PRIORITIES, OPEN_JOB_STATUSES, JOB_STATUSES } from './jobs/jobs'
export type { JobDeps, JobOptions, JobTables, JobHook, JobPhotoStorage } from './jobs/jobs'
export { JOB_MONEY, jobMoneyWithheld, withoutJobMoney } from './jobs/jobMoney'
export { onJob, ownJobScope } from './jobs/onJob'
export { JOB_DISPATCH_PERMISSION, dispatchRefusal } from './jobs/dispatch'
export { travelMinutes, metresBetween } from './jobs/travel'
export type { CanSee } from './jobs/jobMoney'

// Boot-time additive schema reconcile (db/reconcile.ts in every CRM template).
export { reconcileSchema, buildCreateTable, buildAddColumn, buildCreateIndex } from './schemaReconcile'
export type { TableSpec, ColumnSpec, IndexSpec, ReconcileExecutor, ReconcileResult } from './schemaReconcile'

// Texting / AI usage wallet (read-only mirror of the Factory) — /api/messaging-billing in every CRM.
export { createMessagingBillingRoutes, fetchMessagingBillingStatus } from './messagingBilling'
export type { MessagingBillingStatus } from './messagingBilling'

// Auth — bearer middleware, the role → permission matrix, and the login/refresh/me/password routes, one implementation for every CRM.
export { createEnabledFeatureGate } from './enabledFeature'
// Every write leaves an audit row naming its record — unless the handler wrote its own. (T59)
export { createWriteAuditFloor } from './audit/writeFloor'
export type { WriteFloorDeps } from './audit/writeFloor'
export type { EnabledFeatureDeps, EnabledFeatureGate } from './enabledFeature'
export { createEmailLogger } from './emailLog'
export type { EmailLogDeps, EmailLogEntry, EmailRecorder } from './emailLog'
export { createAuthMiddleware, sessionEnded } from './auth/middleware'
export type { AuthMiddlewareDeps, AuthUserContext } from './auth/middleware'
export { accountLockOf, isLockOpenPath, refuseWhileLocked, currentAccountLock, forgetAccountLock, LOCK_OPEN_PREFIXES, ACCOUNT_LOCKED_MESSAGE } from './auth/accountLock'
export type { AccountLock } from './auth/accountLock'
export { createPermissions, ROLE_HIERARCHY, BASE_ROLE_PERMISSIONS } from './auth/permissions'
export type { PermissionsDeps, Permissions } from './auth/permissions'
export { createAuthRoutes, passwordSchema, PASSWORD_RULE_TEXT, generateTokens } from './auth/auth'
/**
 * Two-factor, shared. (T57)
 *
 * The engine moved here out of crm-dispensary, which had the only implementation in the fleet: the
 * verifier and the sign-in gate are not a dispensary concern, and two copies of a code verifier is
 * two verifiers that can disagree. A vertical with no mfa_devices table gets "no second factor"
 * rather than an error, so shared auth can ask the question everywhere.
 */
export { mfaGateFor, openLoginChallenge, verifyLoginChallenge, MAX_CODE_ATTEMPTS } from './auth/mfa'
export type { MfaGate, MfaCodeOutcome, MfaScope } from './auth/mfa'
export { verifyTOTP, generateTOTPCode, base32Encode, base32Decode } from './auth/totp'
export { createMfaRoutes } from './auth/mfaRoutes'
export type { MfaRoutesDeps } from './auth/mfaRoutes'
export { createActorName } from './auth/actorName'
export type { ActorNameDeps, ActorContext, ActorName } from './auth/actorName'
export type { AuthDeps, AuthOptions, AuthTables } from './auth/auth'

// Customer portal — token-link routes for customers / collaborators / service customers, one implementation for every CRM.
export { createPortalRoutes, PORTAL_QUOTE_HIDDEN, PORTAL_INVOICE_HIDDEN } from './portal/portal'
export { documentLinkToken, documentLinkPath, newDocumentToken, isDocumentToken } from './portal/documentLinks'

// Integrations — two-way SMS (Twilio, signature-checked webhooks), QuickBooks Online (signed OAuth state), Google review
// requests, and the messaging-usage wallet gate; one implementation for every CRM.
export { reportSmsUsage, reportAiUsage, walletSufficient } from './integrations/messagingUsage'
export { formatPhoneE164, parseTwilioBody, verifyTwilioRequest, twilioSignatureFor, twilioClient, twilioConfigFromEnv, twilioConfigFor, companyTwilioNumbers, twilioConfigured, TWIML_EMPTY } from './integrations/twilio'
// Provider webhook signatures (every /webhook/ POST must call one — scripts/check-provider-webhooks-signed.ts)
export { verifyCallRailSignature, callRailSignatureFor, mapCallRailPayload } from './integrations/callrail'
export { refuseUnverifiedWebhook, verifyWebhookSecret } from './integrations/webhookAuth'
export { aiRuleFields, aiRuleCreateSchema, aiRuleUpdateSchema, aiSettingsSchema, AI_RULE_TRIGGERS, AI_RULE_CHANNELS } from './integrations/aiReceptionistSchemas'
export { verifyPlaidWebhook, plaidKeyFetcher } from './integrations/plaid'
export type { PlaidKeyFetcher } from './integrations/plaid'
export { createIntegrationsRoutes } from './integrations/integrations'
export { createStripeLinkInternalRoutes } from './integrations/stripeLinkInternal'
export type { IntegrationsRoutesDeps } from './integrations/integrations'
export type { TwilioConfig } from './integrations/twilio'
export { createSmsService, createSmsRoutes, MAX_TEXT_PICTURES } from './integrations/sms'
export type { SmsService, SmsServiceDeps, SmsRoutesDeps, SmsTables, SmsUsage } from './integrations/sms'
export { createQuickBooksService, createQuickBooksRoutes } from './integrations/quickbooks'
export type { QuickBooksService, QuickBooksServiceDeps, QuickBooksRoutesDeps, QuickBooksTables, QuickBooksOptions } from './integrations/quickbooks'
// The signed OAuth state, also used by the crm-dispensary and crm-roof forks (carries the tenant's callback for the Factory relay).
export { signQboState, verifyQboState, QBO_STATE_TTL_MS } from './integrations/quickbooksState'
export type { QboStatePayload } from './integrations/quickbooksState'
export { createReviewsService, createReviewsRoutes, generateGoogleReviewLink } from './integrations/reviews'
export type { ReviewsService, ReviewsServiceDeps, ReviewsRoutesDeps, ReviewsTables } from './integrations/reviews'
export type { PortalDeps, PortalTables, PortalOptions, PortalSelectionsService, PortalFileService } from './portal/portal'

// Team roster, time tracking (hours + clock-in/out + weekly + approvals) and expenses — one implementation each; the template injects its tables.
export { createTeamRoutes, teamMemberSchema } from './team/team'
export { NOT_GIVEN_WORK_ROLES, mayBeGivenWork } from './team/work'
export { resolveCustomer, VENDOR_NOT_CUSTOMER } from './contacts/customer'
export type { TeamDeps, TeamTables } from './team/team'
export { companyTimeZone, companyRowTimeZone, storeDayRange, storeDayStart, storeDateString, dayMarker, markerDay, markerDayIsOver, markerDayHasBegun, daysUntilMarker, isValidTimeZone, jobLocalDay, DEFAULT_BUSINESS_ZONE } from './time/businessDay'
export { createTimeRoutes, createTimeClock, getWeekStart } from './time/time'
export type { TimeDeps, TimeTables, ClockResult } from './time/time'
export { createExpenseRoutes, DEFAULT_EXPENSE_CATEGORIES } from './expenses/expenses'
export type { ExpenseDeps, ExpenseTables } from './expenses/expenses'

// Email marketing — templates, campaigns (audience preview, send, schedule, tracking, unsubscribe), drip sequences + the worker.
export { createMarketingService, createMarketingRoutes, MarketingError, SEQUENCE_TRIGGERS, AUDIENCE_TYPES, MERGE_FIELDS, unknownMergeFields, personalize } from './marketing/marketing'
export type { MarketingService, MarketingServiceDeps, MarketingRoutesDeps, MarketingTables, MailMessage } from './marketing/marketing'
export { sanitizeEmailHtml, isSafeCss } from './marketing/emailHtml'

// Lead Inbox — inbound leads (Factory-forwarded email + secret-locked webhooks), lead sources, convert-to-contact; one implementation for every CRM.
export { moveLegacyWebsiteLeadsToInbox } from './leads/legacyWebsiteLeads'
export { createLeadsRoutes, insertLead, parseLeadEmail, parseWebhookPayload, readInboundBody, verifyFactoryKey, leadInboundAddress, TRADES_LEAD_PLATFORMS, LEAD_STATUSES } from './leads/leads'
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
export { createRecurringService, createRecurringRoutes, FREQUENCIES, calculateNextDate, RecurringPeriodTaken, nextRunAfterResume } from './recurring/recurring'
export type { RecurringService, RecurringServiceDeps, RecurringRoutesDeps, RecurringTables, RecurringEmail, RecurringAudit } from './recurring/recurring'

// Fleet / vehicle tracking — vehicles, maintenance, fuel, stats (crm, crm-fieldservice, crm-landscaping).
// Live GPS + trips (location_log / vehicle_trip) gated behind options.gps (fs/landscaping).
export { createFleetService, createFleetRoutes } from './fleet/fleet'
export type { FleetService, FleetServiceDeps, FleetRoutesDeps, FleetTables } from './fleet/fleet'

// Commissions — plans + earnings, the amount worked out server-side from the plan (crm, crm-fieldservice, crm-landscaping, crm-basic).
export { createCommissionRoutes, createCommissionEarner, commissionFor, planPaysPerson, planPeople, COMMISSION_PLAN_TYPES, COMMISSION_ROLES, COMMISSION_STATUSES, COMMISSION_AUTO_EARN } from './commissions/commissions'
export type { CommissionRoutesDeps, CommissionTables, CommissionEarner, CommissionEarnerDeps, CommissionEarnerTables } from './commissions/commissions'

// Locations — a company's branches (crm, crm-fieldservice, crm-landscaping, crm-basic). crm-dispensary keeps its own stock-per-store system.
export { createLocationRoutes } from './locations/locations'
export type { LocationRoutesDeps, LocationTables } from './locations/locations'

// The technician's day — /api/tech, own assigned jobs only, the template's job hooks on every move (crm, crm-fieldservice, crm-landscaping).
export { createTechRoutes, TECH_MOVES } from './tech/tech'
export type { TechRoutesDeps, TechTables, TechHooks } from './tech/tech'

// Warranties — post-construction warranty tracking, claims, service scheduling (crm, crm-fieldservice, crm-landscaping, crm-rv).
// Activity-log table injected via tables.activityLog (crm/rv pass `activity`; fs/lnd pass `activityLog`).
export { createWarrantiesService, createWarrantiesRoutes } from './warranties/warranties'
export type { WarrantiesService, WarrantiesServiceDeps, WarrantiesRoutesDeps, WarrantiesTables } from './warranties/warranties'

// Inventory — parts/materials across locations, stock ops, transfers, job usage, purchase orders (crm, crm-fieldservice, crm-landscaping, crm-rv).
// emailService (low-stock alerts) and audit are injected via deps; company table needed for the alert.
export { createInventoryService, createInventoryRoutes, InventoryError } from './inventory/inventory'
export type { InventoryService, InventoryServiceDeps, InventoryRoutesDeps, InventoryTables, InventoryEmail, InventoryAudit } from './inventory/inventory'

// Refusing a list filter whose value is outside the vocabulary (invoice/job/quote status, contact type, expense
// category), instead of answering with an empty list that reads like "nothing here". (Contractor T29 N2)
export { checkFilter, invalidFilter, filterGiven } from './listFilter'
// Reading raw-SQL rows without silently changing a module's response shape. (T32 L7)
export { rowsOf, camelRow, camelRows, camelFirst } from './sqlRows'

// What a date is allowed to be. A thing that HAPPENED cannot be dated into the future; a thing that is
// PLANNED cannot be centuries out. Used by expenses and time entries here, and re-exported so a
// template can hold its own records to the same rule. (Contractor T29; salon T20 M4)
export { hasHappened, withinHorizon, horizonMessage, MAX_PLAN_YEARS, FUTURE_SLACK_MS } from './dateInput'

// Loyalty — the RULES of a points/punch-card programme, with no storage attached. Shared because
// crm-salon and crm-store both run one and their tables agree about almost nothing: salon is
// multi-tenant with contacts and decimal dollars, store is single-tenant with uuid keys, no contacts
// and integer cents. Copying the folder is what let crm-dispensary's forked permission matrix drift
// until a guard caught a shipped regression, so the second and third verticals share the arithmetic
// and keep their own tables. Money is in CENTS throughout.
export { loyaltyConfig, loyaltyConfigResponse, cleanTiers, MAX_TIERS, MAX_TIER_MULTIPLIER, DEFAULT_REWARD_NAME, LOYALTY_SETTING_KEYS, DEFAULT_POINTS_PER_DOLLAR, DEFAULT_WELCOME_POINTS, DEFAULT_BIRTHDAY_BONUS, DEFAULT_PUNCH_VISITS } from './loyalty/config'
export type { LoyaltyConfig, PunchCardConfig, LoyaltyDefaults, LoyaltyTier } from './loyalty/config'
export { pointsForSale, pointsForSaleAtTier, tierFor, punchCardProgress, visitQualifies, inBirthdayMonth, rewardDiscountCents, canRedeem } from './loyalty/engine'
export type { TierStanding, Reward, RewardType, BasketLine, PunchCardState, PunchCardProgress, RedeemCheck, RedeemVocabulary } from './loyalty/engine'
export { redactCompanySettings, isPrivilegedRole, SECRET_SETTING_PATHS, PRIVATE_SETTING_KEYS } from './auth/redactSettings'
export { AUTH_MODE_HEADER, ACCESS_COOKIE, REFRESH_COOKIE, VIEW_AS_COOKIE, wantsCookieSession, withSession, setSessionCookies, clearSessionCookies, setViewAsCookie, clearViewAsCookie, viewAsCookie, requestToken } from './auth/cookieSession'
// This tenant's own public address (texts' delivery reports, review clicks, a lender's webhook callback).
export { publicApiBase } from './publicOrigin'
// A not-ready feature's words taken out of copy a customer reads (notReadyCopy.ts).
export { mentionsNotReady, withoutNotReadySentences, withoutNotReadyCopy } from './notReadyCopy'
export { JOB_TILES, QUOTE_TILES, INVOICE_TILES, PENDING_QUOTE_STATUSES, isPendingQuote, pendingQuoteCondition, openInvoiceCondition, openInvoiceStatuses, jobsTodayCondition } from './reporting/tileConditions'
