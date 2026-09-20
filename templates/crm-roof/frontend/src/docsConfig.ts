import type { DocumentsConfig } from './shared';

// What a roofer files. No `projects` — that is the contractor lineage; here a document hangs off a
// JOB. The types are the paperwork a roofing job actually generates.
export const DOCUMENTS: DocumentsConfig = {
  projects: false,
  types: ['general', 'contract', 'permit', 'warranty', 'insurance', 'scope', 'inspection', 'photo', 'invoice', 'receipt', 'other'],
};
