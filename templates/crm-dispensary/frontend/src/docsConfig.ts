// What a dispensary files.
//
// Unlike the other verticals this template does NOT use the shared documents module — its `document`
// table is its own shape (an `orderId` link and `tags`, no filename/path/mimeType and no version
// table), so it keeps its own API and its own page. The list below is held identical to
// backend/src/routes/documents.ts by check-document-types-match-the-picker.ts, because a picker is a
// convenience and the API is what decides what gets stored. (roof T18 D4)
//
// These are the papers a licensed cannabis retailer actually keeps: the state licence, a lab COA per
// batch, METRC transport manifests, written SOPs and inspection reports.
export const DOCUMENTS = {
  types: ['general', 'license', 'coa', 'manifest', 'sop', 'compliance', 'contract', 'invoice', 'receipt', 'other'],
};

/** Human labels for the type picker and the filter. */
export const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  general: 'General',
  license: 'Licence',
  coa: 'Lab COA',
  manifest: 'Transport Manifest',
  sop: 'SOP',
  compliance: 'Compliance',
  contract: 'Contract',
  invoice: 'Invoice',
  receipt: 'Receipt',
  other: 'Other',
};
