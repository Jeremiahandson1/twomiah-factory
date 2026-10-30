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

  // Where each address stands on the connected domain. The Factory reconciles first (reads this CRM's
  // addresses, creates/updates/removes their Cloudflare rules), so asking is also "set them up now".
  getEmailAliasStatus?(): Promise<EmailAliasStatusReport>

  // Cloudflare sends a destination address a confirmation email; a rule forwarding to it stays off until
  // it is clicked. Sends it again.
  resendEmailAliasConfirmation?(destination: string): Promise<{ ok: boolean; error?: string }>
}

/** One address's state on the domain — the Factory's answer (apps/api/src/services/emailAliasSync.ts). */
export type EmailAliasState =
  | 'live'                    // the rule exists and its destination is confirmed: mail arrives
  | 'confirm_destination'     // the rule exists; Cloudflare is waiting for the destination to confirm
  | 'waiting_for_domain'      // no domain connected yet
  | 'waiting_for_nameservers' // the domain is connected; its nameservers do not point at Cloudflare yet
  | 'off'                     // turned off in the CRM
  | 'error'                   // the Factory could not set it up (detail says why)

export interface EmailAliasStatusReport {
  state: 'live' | 'action_needed' | 'waiting_for_domain' | 'waiting_for_nameservers' | 'crm_needs_update' | 'error'
  domain: string | null
  nameservers?: string[]
  detail?: string
  aliases: Array<{ localPart: string; address: string | null; state: EmailAliasState; destination?: string | null; detail?: string }>
}

export interface EmailAliasesDeps {
  db: any
  emailAliasesTable: any
  factoryApiClient: FactoryApiClient
  /**
   * The team, for an address that belongs to a team member (its table then has userId). Optional: a template without
   * it keeps typed forward-to inboxes only, exactly as before.
   */
  members?: () => Promise<AliasMember[]>
}

export interface AliasMember { id: string; name: string; email: string; active: boolean; owner: boolean }

export interface InboundParseDeps {
  /** Reply-from-branded-address: sends mail AS localPart@tenantDomain via the
   *  template's own email service. Absent → the reply endpoint returns 501. */
  sendReply?: (args: { fromLocalPart: string; to: string; subject: string; text: string }) => Promise<{ success: boolean }>
  db: any
  inboundMessageTable: any
}

export interface EmailDomainDeps {
  factoryApiClient: FactoryApiClient
}
