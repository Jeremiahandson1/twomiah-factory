// THE WORDS FOR A STORED CODE — one rule for every screen that shows a status, stage, type, kind, priority, source,
// role, tier, frequency, method or outcome.
//
// Codes are stored as codes ('in_production', 'final_inspection', 'percent_of_invoice'). Live tests (2026-10-22) found
// them printed as they are — "in_production" on a roofing job, "invoiced → collected" on its timeline, lowercase codes
// on badges and filters. What a person reads is, in order:
//   1. the vertical's own word for the code (VerticalSettings.screens.codeLabels, registered once by the app);
//   2. the shared word, where making the code readable would get it wrong (COMMON_WORDS);
//   3. the code made readable: underscores to spaces, the first letter capitalised ("in_production" → "In production").
// Only a CODE is rewritten — lowercase letters, digits and underscores. Anything else (a name somebody typed, "CNAME",
// "Mowing") is shown exactly as it is, so the rule is safe on any value.
// scripts/check-unified-raw-codes.ts fails a screen that prints a code without it.

export const COMMON_WORDS: Record<string, string> = {
  no_show: 'No-show',
  // The events stage is stored as 'enquiry' (the template's British word); it reads in American English everywhere.
  enquiry: 'Inquiry',
  in_progress: 'In progress',
  on_hold: 'On hold',
  past_due: 'Past due',
  sms: 'SMS',
  pdf: 'PDF',
  csv: 'CSV',
  ach: 'ACH',
  evv: 'EVV',
  hvac: 'HVAC',
  qa: 'QA',
  rfi: 'RFI',
  po: 'PO',
  w2: 'W-2',
  '1099': '1099',
  percent_of_invoice: '% of invoice',
  percent_of_margin: '% of margin',
  flat_rate: 'Flat rate',
  job_assignee: 'Person assigned the job',
  job_creator: 'Person who booked the job',
  google_lsa: 'Google Local Services',
  google_business: 'Google Business Profile',
  bi_weekly: 'Every two weeks',
  biweekly: 'Every two weeks',
  semi_annual: 'Twice a year',
  semiannual: 'Twice a year',
  per_visit: 'Per visit',
}

let verticalWords: Record<string, string> = {}

/** The vertical's own words for its codes (the app calls this once, from VerticalSettings.screens.codeLabels). */
export function registerCodeWords(words: Record<string, string> | null | undefined) {
  verticalWords = words && typeof words === 'object' ? { ...words } : {}
}

const IS_CODE = /^[a-z0-9]+(_[a-z0-9]+)*$/

/** The words for one code: the vertical's, then the shared, then the code made readable. Not a code: as it is. */
export function codeLabel(value: unknown, words?: Record<string, string>): string {
  if (value === null || value === undefined) return ''
  const s = String(value)
  if (words && words[s]) return words[s]
  if (verticalWords[s]) return verticalWords[s]
  if (COMMON_WORDS[s]) return COMMON_WORDS[s]
  if (!IS_CODE.test(s)) return s
  const spaced = s.replace(/_/g, ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

/**
 * A line the server wrote with codes in it, made readable: "Status changed: invoiced → collected" (roofing's job notes,
 * kept as written) reads "Status changed: Invoiced → Collected".
 */
export function codesInText(text: unknown, words?: Record<string, string>): string {
  const s = String(text ?? '')
  const m = /^(Status changed: )([a-z0-9_]+) → ([a-z0-9_]+)$/.exec(s)
  return m ? `${m[1]}${codeLabel(m[2], words)} → ${codeLabel(m[3], words)}` : s
}
