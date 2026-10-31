// Where an enquiry came from — a short list to pick from, not free text, so the lead-source report (eventReports.ts)
// can count it (restaurant-bar-depth #7). The first five are the Lead Inbox's own platforms (verticals/restaurant
// settings leads.platforms), so an event raised from an inbox lead keeps its source.
import { and, eq } from 'drizzle-orm'
import { eventFormCampaign } from '../../db/schema/index.ts'
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

// ── Website-form campaigns (restaurant-bar parity #4) ───────────────────────────────────────────────────────────────────
// A campaign is one embeddable enquiry form with its own link; every enquiry it brings in is tagged with the campaign's lead source,
// so the source report counts it without anyone choosing a source by hand. A token that matches no live campaign is ignored (the
// enquiry is still taken, with the source 'website' as before) — a stale embed never loses a lead.

/** The live campaign a form was posted through, by the token in its address. */
export async function campaignByToken(exec: any, companyId: string, token: unknown): Promise<{ id: string; name: string; source: string } | null> {
  const t = typeof token === 'string' ? token.trim() : ''
  if (!/^[0-9a-f]{24}$/.test(t)) return null
  const [row] = await exec.select({ id: eventFormCampaign.id, name: eventFormCampaign.name, source: eventFormCampaign.source }).from(eventFormCampaign)
    .where(and(eq(eventFormCampaign.companyId, companyId), eq(eventFormCampaign.token, t), eq(eventFormCampaign.active, true))).limit(1)
  return row ?? null
}
