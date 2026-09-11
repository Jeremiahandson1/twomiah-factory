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
