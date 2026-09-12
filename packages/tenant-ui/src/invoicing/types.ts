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
  quoteEquipment?: boolean
  quoteCustomerMessage?: boolean
  quoteDecline?: boolean
  /** Extra invoice statuses this vertical stores (salon adds 'open'). */
  extraInvoiceStatuses?: string[]
  /** Placeholder for the quote name field. */
  quoteNamePlaceholder?: string
  /** Show the QuickBooks sync block on the invoice detail (field service, landscaping). */
  quickbooks?: boolean
}

export interface InvoicingPageProps {
  api: InvoicingApi
  toast: InvoicingToast
  /** company.settings from the auth context: defaultTaxRate, paymentTermsDays */
  settings?: Record<string, any> | null
  config?: InvoicingConfig
}

export const defaultConfig: Required<Pick<InvoicingConfig, 'clientLabel' | 'clientPath' | 'jobPath' | 'projects' | 'jobs' | 'tips' | 'quoteSites' | 'quoteEquipment' | 'quoteCustomerMessage' | 'quoteDecline' | 'extraInvoiceStatuses' | 'quoteNamePlaceholder' | 'quickbooks'>> = {
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
  extraInvoiceStatuses: [],
  quoteNamePlaceholder: 'e.g. Spring service package',
  quickbooks: false,
}

export const resolveConfig = (c?: InvoicingConfig) => ({ ...defaultConfig, ...(c || {}) })

export interface LineItemInput { description: string; quantity: number; unitPrice: number }
