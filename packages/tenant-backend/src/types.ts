// Shared dependency interfaces for the route factories.
// `db` and table refs are typed as `any` here on purpose — each tenant's
// Drizzle schema has its own generated types that diverge by vertical, and
// we don't want the shared package to depend on a specific schema file.

export interface FactoryApiClient {
  // Tells the factory to add/update/remove a Cloudflare Email Routing rule
  // for this tenant's zone. Called whenever an alias's routing mode or
  // destination changes.
  syncEmailAlias(alias: {
    localPart: string
    routingMode: 'forward' | 'crm'
    forwardTo?: string | null
    enabled: boolean
  }): Promise<{ ok: boolean; error?: string }>

  // Returns SendGrid Domain Authentication status (pending, verified, failed).
  getEmailDomainStatus(): Promise<{
    status: 'pending' | 'verified' | 'failed' | 'unconfigured'
    records?: Array<{ type: string; host: string; value: string; valid?: boolean }>
  }>

  // Manually re-trigger SendGrid domain-auth polling.
  verifyEmailDomain(): Promise<{ ok: boolean; status?: string }>
}

export interface EmailAliasesDeps {
  db: any
  emailAliasesTable: any
  factoryApiClient: FactoryApiClient
}

export interface InboundParseDeps {
  db: any
  emailAliasesTable: any
  contactsTable: any
  conversationsTable: any
  attachmentsTable?: any
}

export interface EmailDomainDeps {
  factoryApiClient: FactoryApiClient
}
