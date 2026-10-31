// Where an enquiry came from — a short list to pick from, not free text, so the lead-source report (eventReports.ts)
// can count it (restaurant-bar-depth #7). The first five are the Lead Inbox's own platforms (verticals/restaurant
// settings leads.platforms), so an event raised from an inbox lead keeps its source.
export const EVENT_SOURCES = [
  { id: 'website', label: 'Website form' },
  { id: 'the_knot', label: 'The Knot' },
  { id: 'weddingwire', label: 'WeddingWire' },
  { id: 'google_business', label: 'Google Business Profile' },
  { id: 'instagram', label: 'Instagram / Facebook' },
  { id: 'phone', label: 'Phone call' },
  { id: 'walk_in', label: 'Walk-in' },
  { id: 'referral', label: 'Referral' },
  { id: 'repeat', label: 'Repeat client' },
  { id: 'other', label: 'Other' },
] as const
const IDS = new Set<string>(EVENT_SOURCES.map((s) => s.id))
const SYNONYMS: Array<[RegExp, string]> = [
  [/knot/i, 'the_knot'], [/wedding\s*wire/i, 'weddingwire'], [/google/i, 'google_business'], [/insta|facebook|meta|\bfb\b/i, 'instagram'],
  [/web|site|online|form/i, 'website'], [/phone|call/i, 'phone'], [/walk/i, 'walk_in'], [/refer|friend|word/i, 'referral'], [/repeat|return/i, 'repeat'],
]
/** A stored source as one of the list: an id as it is, older free text by its words, anything else 'other'; blank = none. */
export function sourceId(raw: unknown): string | null {
  const s = typeof raw === 'string' ? raw.trim() : ''
  if (!s) return null
  const key = s.toLowerCase().replace(/[\s-]+/g, '_')
  if (IDS.has(key)) return key
  return SYNONYMS.find(([re]) => re.test(s))?.[1] ?? 'other'
}
/** The refusal for a source typed into a form or the API; null when it is on the list or blank. */
export function sourceRefusal(raw: unknown): string | null {
  if (raw == null || raw === '') return null
  return typeof raw === 'string' && IDS.has(raw) ? null : `Source must be one of: ${EVENT_SOURCES.map((s) => s.id).join(', ')}.`
}
