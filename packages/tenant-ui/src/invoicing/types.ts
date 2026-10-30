// Shared invoices + quotes UI — the contract between a template and the vendored pages.
// The template passes its own api client (so token refresh keeps working), its toast, the company
// settings, and a config describing what its vertical has. Everything else is the same product.

export interface InvoicingApi {
  get: (path: string, params?: Record<string, any>) => Promise<any>
  post: (path: string, body?: any) => Promise<any>
  put: (path: string, body?: any) => Promise<any>
  delete: (path: string, id?: string) => Promise<any>
}

export interface InvoicingToast {
  success: (msg: string) => void
  error: (msg: string) => void
}

export interface InvoicingConfig {
  /** Noun used for the customer column and pickers: "Client", "Customer", "Owner" … */
  clientLabel?: string
  /** Where a client row links to. Default /crm/contacts/:id */
  clientPath?: (id: string) => string
  /** Vertical has projects (Project picker + links). */
  projects?: boolean
  /** Vertical has jobs (Convert to Job, job links). */
  jobs?: boolean
  /** Path for a job id. Default /crm/jobs/:id */
  jobPath?: (id: string) => string
  /** Payments carry a gratuity (salon). */
  tips?: boolean
  /** Field-service quote extras: per-customer sites + equipment, customer message, decline with timestamp. */
  quoteSites?: boolean
  /** What the trade calls a service site on a quote (a landscaper's Property). Default Location. */
  siteLabels?: { singular: string; plural: string }
  quoteEquipment?: boolean
  quoteCustomerMessage?: boolean
  quoteDecline?: boolean
  /**
   * A quote is for one of the customer's jobs (roofing: a proposal belongs to its job — quote.job_id): the form offers
   * the chosen customer's jobs and sends jobId; /crm/quotes?new=1&contactId=&jobId= opens it filled in.
   */
  quoteJobs?: boolean
  /** Extra invoice statuses this vertical stores (salon adds 'open'). */
  extraInvoiceStatuses?: string[]
  /** Placeholder for the quote name field. */
  quoteNamePlaceholder?: string
  /** Show the QuickBooks sync block on the invoice detail (field service, landscaping). */
  quickbooks?: boolean
  /**
   * Offer the PRICEBOOK when building a quote, and record each line's cost. (T41)
   *
   * Only for a vertical whose quote_line_item carries unit_cost + pricebook_item_id (migration
   * 0024 in crm-fieldservice) AND whose backend passes options.hasLineCost — otherwise the fields
   * are sent and silently dropped, which is worse than not offering them. Off by default.
   *
   * Why it matters: job costing reported a 100% margin on quoted work because a quote line had no
   * cost to report. The pricebook already knows what each item costs; this is the way that figure
   * gets onto the quote instead of being retyped or guessed.
   */
  pricebook?: boolean
  /**
   * Does THIS TENANT have the feature?  above says the VERTICAL is sold QuickBooks,
   * which is not the same question — the invoice detail offered "Sync to QuickBooks" to a tenant
   * without it. Defaults to allowing everything, so a template that does not pass it is unchanged.
   * (Field Service T29 M1)
   */
  hasFeature?: (feature: string) => boolean
  /**
   * May this person do that? Threaded in from the template's own auth context, the way hasFeature is.
   * Absent means "do not ask", so a template that has not been rewired keeps every control it has.
   * (T30 debt: the QuickBooks sync button)
   */
  can?: (permission: string) => boolean
  /**
   * An app's own panel at the top of the quote's or invoice's side column (the unified app's customer financing), given
   * the record as loaded. Absent: nothing.
   */
  aside?: (doc: { kind: 'quote' | 'invoice'; record: Record<string, any>; /** Load the document again (after the aside changed it, e.g. a gift card was applied). */ reload?: () => void }) => import('react').ReactNode
  /**
   * A quote line may be OPTIONAL (offered, counted only once ticked — tenant-backend invoicing/quoteOptions.ts) and a quote
   * may ask a DEPOSIT on approval. Only for an app whose quote tables have the columns (the unified app); absent, the
   * editor and the quote page are as they were.
   */
  quoteOptions?: boolean
  quoteDeposit?: boolean
}

export interface InvoicingPageProps {
  api: InvoicingApi
  toast: InvoicingToast
  /** company.settings from the auth context: defaultTaxRate, paymentTermsDays */
  settings?: Record<string, any> | null
  config?: InvoicingConfig
}

export const defaultConfig: Required<Pick<InvoicingConfig, 'clientLabel' | 'clientPath' | 'jobPath' | 'projects' | 'jobs' | 'tips' | 'quoteSites' | 'quoteEquipment' | 'quoteCustomerMessage' | 'quoteDecline' | 'quoteJobs' | 'extraInvoiceStatuses' | 'quoteNamePlaceholder' | 'quickbooks'>> = {
  clientLabel: 'Client',
  clientPath: (id) => `/crm/contacts/${id}`,
  jobPath: (id) => `/crm/jobs/${id}`,
  projects: true,
  jobs: true,
  tips: false,
  quoteSites: false,
  quoteEquipment: false,
  quoteCustomerMessage: false,
  quoteDecline: false,
  quoteJobs: false,
  extraInvoiceStatuses: [],
  quoteNamePlaceholder: 'e.g. Spring service package',
  quickbooks: false,
}

export const resolveConfig = (c?: InvoicingConfig) => ({ ...defaultConfig, ...(c || {}) })

export interface LineItemInput {
  description: string
  quantity: number
  unitPrice: number
  /**
   * The three fields a pricebook line carries, all optional and all ignored by a template that does
   * not enable `pricebook`. (T41)
   *
   * `type` is the one that was load-bearing and missing: job costing splits its estimate on it, and
   * nothing had ever sent it, so every quote line was NULL and the estimate was zero.
   */
  type?: 'labor' | 'material' | 'part' | 'service' | 'other'
  /** What the line costs US per unit, as against unitPrice which is what the customer pays. */
  unitCost?: number
  /** Which catalogue item it was priced from. */
  pricebookItemId?: string
  /** An optional line, and whether it is ticked (InvoicingConfig.quoteOptions). An optional line counts once ticked. */
  optional?: boolean
  selected?: boolean
}

/** The lines a quote's price counts: every line not optional, and the optional ones ticked. */
export const countedLines = <T extends { optional?: boolean; selected?: boolean }>(items: T[]): T[] => items.filter((li) => !li.optional || !!li.selected)

/** A pricebook entry as the quote editor needs it. `cost` is absent when the caller may not see it. */
export interface PricebookPick {
  id: string
  name: string
  code?: string | null
  type?: string | null
  price: number | string
  cost?: number | string | null
  unit?: string | null
}
