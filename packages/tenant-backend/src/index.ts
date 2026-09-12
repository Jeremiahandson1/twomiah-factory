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
export { createBookingRoutes } from './booking/routes'
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

// Boot-time additive schema reconcile (db/reconcile.ts in every CRM template).
export { reconcileSchema, buildCreateTable, buildAddColumn, buildCreateIndex } from './schemaReconcile'
export type { TableSpec, ColumnSpec, IndexSpec, ReconcileExecutor, ReconcileResult } from './schemaReconcile'

// Texting / AI usage wallet (read-only mirror of the Factory) — /api/messaging-billing in every CRM.
export { createMessagingBillingRoutes, fetchMessagingBillingStatus } from './messagingBilling'
export type { MessagingBillingStatus } from './messagingBilling'
