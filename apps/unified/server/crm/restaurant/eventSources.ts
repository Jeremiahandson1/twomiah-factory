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

// ── Marketing spend per source and month (restaurant-bar parity #6) ─────────────────────────────────────────────────────────
export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/
const daysInMonth = (month: string) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate()
/**
 * What a source's spend comes to over the days from..to (YYYY-MM-DD, both counted): each month's amount is spread evenly over that
 * month's days and the report takes the share of the days it covers — a whole month gives the whole amount, a week gives its days'.
 * Whole cents: the sum is rounded once.
 */
export function spendShare(rows: Array<{ month: string; amountCents: number }>, from: string, to: string): number {
  let total = 0
  for (const r of rows) {
    const n = daysInMonth(r.month)
    const lo = from > `${r.month}-01` ? from : `${r.month}-01`
    const monthEnd = `${r.month}-${String(n).padStart(2, '0')}`
    const hi = to < monthEnd ? to : monthEnd
    if (hi < lo) continue
    total += (r.amountCents * ((Date.parse(hi) - Date.parse(lo)) / 86400000 + 1)) / n
  }
  return Math.round(total)
}
