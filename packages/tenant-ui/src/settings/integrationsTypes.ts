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
  copy?: { quickbooks?: string; sms?: string; email?: string; intro?: string; quickbooksAutoSync?: string }
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
  /** The business's switches: the QuickBooks card shows with quickbooks on, the Stripe card with online_payments. Absent: both show. */
  hasFeature?: (id: string) => boolean
  /** An app's own cards under Payments (the unified app's lender account). Absent: nothing more. */
  paymentsExtra?: import('react').ReactNode
  /**
   * Where Sync Now posts, when the app records its syncs (the unified app's '/api/qb-sync/run', whose run is in its sync
   * log). Absent: the shared /api/integrations/quickbooks/sync, as before.
   */
  quickbooksSyncPath?: string
  /**
   * An app's own panel inside the connected QuickBooks card (the unified app's sync log), drawn again with the card's
   * last sync time and switch so it shows what a sync just did. Absent: nothing more.
   */
  quickbooksExtra?: (state: { lastSync: string | null; syncEnabled: boolean }) => import('react').ReactNode
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

/**
 * The Reviews page builds its sentences from the business's vocabulary (labels/vocabulary.ts). These are a template's
 * own sentences, which win; the unified app passes none, only `hasFeature` (whether a job's page has the button).
 */
export interface ReviewsConfig {
  hasFeature?: (feature: string) => boolean
  subtitle?: string
  /** Column header for what the request was about — "Job" or "Visit". */
  subjectLabel?: string
  autoRequestHelp?: string
  emptyHelp?: string
  /**
   * Where this vertical asks one customer by hand (the Send review request button), as the end of a sentence:
   * "on a job or a customer's page". Empty: the vertical has no such button, and the page does not claim one.
   */
  manualHelp?: string
}
