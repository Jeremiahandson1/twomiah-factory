// Customer portal — the contract between a template and the vendored portal pages.

export type PortalSection =
  | 'projects' | 'quotes' | 'invoices' | 'paymentMethods' | 'changeOrders' | 'selections' | 'messages'
  | 'myJobs' | 'lienWaivers' | 'submittals' | 'rfis' | 'sharedDocuments'
  | 'equipment' | 'agreements' | 'serviceRequest'

/** Contact types that get the collaborator (sub/vendor) portal instead of the customer one. */
export const COLLABORATOR_TYPES = ['subcontractor', 'vendor', 'supplier']
/** Contact types that get the reviewer (design professional) portal. */
export const REVIEWER_TYPES = ['architect', 'consultant', 'inspector']
export type PortalRole = 'client' | 'collaborator' | 'reviewer'

export interface PortalConfig {
  /** Word for the business in customer-facing copy ("Communicate with your contractor"). Default 'contractor'. */
  providerNoun?: string
  /** Sections a customer sees, in nav order. Intersected with what the backend actually mounts. */
  clientNav?: PortalSection[]
  /** Sections a subcontractor / vendor / supplier sees. */
  collaboratorNav?: PortalSection[]
  /** Sections an architect / consultant / inspector sees. */
  reviewerNav?: PortalSection[]
  /** Nav / page title overrides per section, e.g. { myJobs: 'Service', agreements: 'Maintenance Plans' }. */
  labels?: Partial<Record<PortalSection, string>>
  /** Document type → label for the shared-documents and file-room pages (vertical vocabulary). */
  docTypeLabels?: Record<string, string>
  /** Contact type → portal title shown under the company name. */
  roleLabels?: Record<string, string>
}

export const DEFAULT_CLIENT_NAV: PortalSection[] = ['projects', 'quotes', 'invoices', 'paymentMethods', 'changeOrders', 'selections', 'messages']
export const DEFAULT_COLLABORATOR_NAV: PortalSection[] = ['myJobs', 'lienWaivers', 'sharedDocuments', 'messages']
export const DEFAULT_REVIEWER_NAV: PortalSection[] = ['rfis', 'submittals', 'changeOrders', 'sharedDocuments', 'messages']

export const DEFAULT_LABELS: Record<PortalSection, string> = {
  projects: 'Projects', quotes: 'Quotes', invoices: 'Invoices', paymentMethods: 'Payment Method', changeOrders: 'Change Orders',
  selections: 'Selections', messages: 'Messages', myJobs: 'My Jobs', lienWaivers: 'Lien Waivers', submittals: 'Submittals',
  rfis: 'RFIs', sharedDocuments: 'Documents', equipment: 'Equipment', agreements: 'Service Plans', serviceRequest: 'Request Service',
}

/** URL path segment under /portal/:token for each section. */
export const SECTION_PATH: Record<PortalSection, string> = {
  projects: 'projects', quotes: 'quotes', invoices: 'invoices', paymentMethods: 'payment-methods', changeOrders: 'change-orders',
  selections: 'selections', messages: 'messages', myJobs: 'my-jobs', lienWaivers: 'lien-waivers', submittals: 'submittal-review',
  rfis: 'rfis-assigned', sharedDocuments: 'shared-documents', equipment: 'equipment', agreements: 'agreements', serviceRequest: 'service-request',
}

/** What the backend reports it mounted (GET /p/:token → sections). */
export type PortalBackendSections = Partial<Record<'projects' | 'changeOrders' | 'selections' | 'myJobs' | 'lienWaivers' | 'submittals' | 'rfis' | 'sharedDocuments' | 'projectFiles' | 'equipment' | 'agreements' | 'serviceRequest', boolean>>

export const DEFAULT_ROLE_LABELS: Record<string, string> = {
  client: 'Customer Portal', customer: 'Customer Portal', lead: 'Customer Portal', owner: 'Customer Portal',
  vendor: 'Vendor Portal', subcontractor: 'Subcontractor Portal', supplier: 'Supplier Portal',
  architect: 'Architect Portal', consultant: 'Consultant Portal', inspector: 'Inspector Portal',
}

export const DEFAULT_DOC_TYPE_LABELS: Record<string, string> = {
  general: 'General', plans: 'Plans & Drawings', permit: 'Permit', contract: 'Contract', insurance: 'Insurance Cert',
  lien_waiver: 'Lien Waiver', photo: 'Photo', submittal: 'Submittal', change_order: 'Change Order', inspection: 'Inspection',
}

export function roleFor(contactType: string | undefined | null): PortalRole {
  const t = (contactType || 'client').toLowerCase()
  if (COLLABORATOR_TYPES.includes(t)) return 'collaborator'
  if (REVIEWER_TYPES.includes(t)) return 'reviewer'
  return 'client'
}

export function resolvePortalConfig(c?: PortalConfig) {
  const cfg = c || {}
  return {
    providerNoun: cfg.providerNoun || 'contractor',
    clientNav: cfg.clientNav || DEFAULT_CLIENT_NAV,
    collaboratorNav: cfg.collaboratorNav || DEFAULT_COLLABORATOR_NAV,
    reviewerNav: cfg.reviewerNav || DEFAULT_REVIEWER_NAV,
    labels: { ...DEFAULT_LABELS, ...(cfg.labels || {}) } as Record<PortalSection, string>,
    docTypeLabels: { ...DEFAULT_DOC_TYPE_LABELS, ...(cfg.docTypeLabels || {}) },
    roleLabels: { ...DEFAULT_ROLE_LABELS, ...(cfg.roleLabels || {}) },
  }
}
export type ResolvedPortalConfig = ReturnType<typeof resolvePortalConfig>

/** A section is available when the backend mounts it (sections always mounted: quotes, invoices, paymentMethods, messages). */
export function sectionAvailable(section: PortalSection, backend: PortalBackendSections | undefined): boolean {
  if (section === 'quotes' || section === 'invoices' || section === 'paymentMethods' || section === 'messages') return true
  if (!backend) return false
  return !!backend[section as keyof PortalBackendSections]
}
