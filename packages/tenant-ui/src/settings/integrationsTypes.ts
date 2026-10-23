// Settings → Integrations / Import / Migrate and the Reviews page — the contract between a template and the shared pages.

/** The slice of the template's api client these pages use. */
export interface SettingsApi {
  get: (path: string, params?: Record<string, any>) => Promise<any>
  post: (path: string, body?: any) => Promise<any>
  put: (path: string, body?: any) => Promise<any>
  upload: (path: string, formData: FormData) => Promise<any>
  request: (path: string, options?: any) => Promise<any>
  baseUrl?: string
}
export interface SettingsToast { success: (msg: string) => void; error: (msg: string) => void }

export interface LeadSourceGuide {
  id: string
  title: string
  description: string
  steps: string[]
  /** Icon colour family for the card. */
  tone?: 'emerald' | 'blue' | 'indigo' | 'pink' | 'sky'
}
export interface IntegrationsConfig {
  /** Card copy per vertical (vocabulary only — behaviour is identical everywhere). */
  copy?: { quickbooks?: string; sms?: string; email?: string; intro?: string }
  /** Setup guides shown under "Lead Sources"; default = the trades set (Angi, Thumbtack, Google LSA). */
  leadSources?: LeadSourceGuide[]
  /**
   * Show the CallRail signing-key panel (CallTrackingSettings) here — for a template whose call tracking has no
   * page of its own. Rendered only when the tenant has the Call Tracking feature (the API's own switch) and the
   * person holds integrations:update (the API's own right). Templates WITH a Call Tracking page carry it there.
   */
  callTracking?: boolean
  /**
   * Where this app connects a web address (its Domain page, e.g. '/crm/domain'). Given → the Domain card sends the owner
   * there, in plain steps. Absent → the DNS guide (a template's CRM on its own subdomain).
   */
  domainPage?: string
  /**
   * Where this app turns texting on with a number registered in the business's name (e.g. '/crm/settings/texting'). Given →
   * the Twilio card says most businesses use that instead, and is for an owner who already has a Twilio account.
   */
  textingPage?: string
  /**
   * Whether this business takes cards on its invoices — the online_payments feature, which the server asks before it
   * offers Pay. 'on': the Stripe card as always. 'off': offered but switched off — the card says to switch it on under
   * Settings › Features first (connecting Stripe alone changes nothing). 'not-offered': the industry's system has no
   * invoice card payments (roofing; a shop takes its payments on its own Payments page) — no Stripe card. Absent: 'on'.
   */
  cardPayments?: 'on' | 'off' | 'not-offered'
}

export interface ImportTypeDef {
  id: string
  label: string
  description: string
  /** Offered only when the tenant has this feature (registry id). Omit = always. */
  feature?: string
}
export interface ImportConfig {
  intro?: string
  types?: ImportTypeDef[]
  contactTypes?: Array<{ value: string; label: string }>
  defaultContactType?: string
}

export interface MigrationConfig {
  /** Entity labels for the CSV picker, e.g. { jobs: 'Service Calls & Work Orders' }. */
  entityLabels?: Record<string, string>
}

export interface ReviewsConfig {
  subtitle?: string
  /** Column header for what the request was about — "Job" or "Visit". */
  subjectLabel?: string
  autoRequestHelp?: string
  emptyHelp?: string
}
