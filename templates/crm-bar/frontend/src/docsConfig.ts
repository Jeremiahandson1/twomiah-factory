// What this vertical does differently in the shared Documents page (see ./shared).
import type { DocumentsConfig } from './shared'

// Permits and drawings are a builder's paperwork; this CRM serves gyms, studios, consultants and food trucks. (T43,
// Showcase: the filter offered "Permit" and "Drawing".) The route's options.types is the same list.
// markup/projects: both are construction-only. Field service files documents against jobs and
// contacts, has no drawings to annotate, and is not offered the projects module at all.
export const DOCUMENTS: DocumentsConfig = { markup: false, projects: false, types: ['general', 'contract', 'photo', 'invoice', 'receipt', 'other'] }
