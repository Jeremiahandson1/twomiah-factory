// @twomiah/tenant-backend — Hono route factories vendored into each tenant backend.
// The factory copies `packages/tenant-backend/src/**` into each tenant's
// `backend/src/shared/` at generation. Tenant route glue imports from
// '../shared/...' and passes its local Drizzle `db` + table references in,
// so the shared code stays schema-agnostic and vertical-specific columns
// never leak across verticals.

export { createEmailAliasesRoutes } from './emailAliases'
export { createInboundParseRoute } from './inboundParse'
export { createEmailDomainRoutes } from './emailDomain'
export { createAccountRoutes } from './account'
export type {
  EmailAliasesDeps,
  InboundParseDeps,
  EmailDomainDeps,
  FactoryApiClient,
} from './types'
export type { AccountDeps } from './account'
