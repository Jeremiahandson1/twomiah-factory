// What this vertical does differently in the shared Documents page (see ./shared).
import type { DocumentsConfig } from './shared'

// markup/projects: both are construction-only. Field service files documents against jobs and
// contacts, has no drawings to annotate, and is not offered the projects module at all.
export const DOCUMENTS: DocumentsConfig = { markup: false, projects: false, types: ['general', 'contract', 'permit', 'drawing', 'photo', 'invoice', 'receipt', 'other'] }
