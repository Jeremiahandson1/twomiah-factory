/**
 * When is this client actually due back?
 *
 * The menu row carries a rebookIntervalDays — "a root touch-up is a six-week service" — and that is
 * the right answer for a client nobody knows yet. It is the wrong answer for a client who has been
 * coming every five weeks for two years: she gets chased seven days late, every time, and the list
 * quietly stops matching the salon's actual book.
 *
 * Phorest solves this by learning: a client's typical booking interval is calculated automatically
 * once they have had three appointments in the same Service Category, from the time between those
 * visits. This does the same, with one deliberate difference — see MEDIAN below.
 *
 * Two decisions worth stating:
 *
 * **Three visits, and by CATEGORY.** Two visits give one gap, and one gap is an anecdote. Three give
 * two gaps and the beginnings of a rhythm. Category rather than individual service because a client
 * who alternates between a gloss and a full colour is on one colour rhythm, not two — and because it
 * is what makes the recall list one row per client per rhythm rather than one per service they have
 * ever had.
 *
 * **MEDIAN, not mean.** Phorest averages. A mean is wrecked by exactly the thing a salon history is
 * full of: one interrupted year — a move, a baby, a lockdown — between otherwise regular visits. A
 * client on a steady 35 days with one 400-day gap averages out to something near 150 and drops off
 * the list entirely. The median ignores that one gap and keeps her on her real rhythm. With two to
 * four gaps it behaves the same as a mean when the history is regular, and better when it is not.
 */

export type IntervalBasis =
  /** Learned from this client's own visits. */
  | 'client'
  /** The service menu's figure — a client we do not know yet. */
  | 'menu'
  /** Neither: the menu has no interval and there is not enough history. */
  | 'none'

export interface RebookInterval {
  days: number | null
  basis: IntervalBasis
  /** How many visits the opinion is based on, when it is the client's own. */
  visits: number
}

/**
 * The key two service categories share when they are the same category.
 *
 * RR0929, the tester's judgement call — agreed, having argued the other way first. The FULL0929
 * brief said `colour` and `Color` were the salon's own data to fix, on the grounds that the two
 * are genuinely different words and the software should not decide they mean the same thing. That
 * is true of words in general and wrong about these two: a salon that has both spellings in its
 * menu does not have two rhythms, it has one rhythm and two typists, and the product was making
 * the front desk work one list twice and read two different recall templates for the same client.
 *
 * Deliberately a short, named list rather than a general en-GB/en-US dictionary. Every entry is a
 * spelling that actually turns up in a salon price list; nothing is inferred by rule, because a
 * rule that folds -our to -or would also fold words nobody meant it to. If a salon has a pair we
 * have not thought of, the answer is to add it here where it can be read, not to be clever.
 *
 * Case and spacing were already folded. This adds the spelling, in one place used by every caller
 * — the key was being recomputed inline at three sites, which is three chances to disagree.
 */
const SPELLINGS: Array<[RegExp, string]> = [
  [/colour/g, 'color'],
  [/grey/g, 'gray'],
  [/moustache/g, 'mustache'],
]
export function categoryKey(raw: unknown): string {
  let s = String(raw ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
  if (!s) return 'other'
  for (const [re, to] of SPELLINGS) s = s.replace(re, to)
  return s
}

/**
 * Which of several spellings to SHOW for a merged category: the one the salon uses most, and the
 * first one seen when they are level. Showing the folded key instead would print "color" at a
 * salon whose entire menu says colour.
 */
export function preferredCategoryLabel(seen: string[]): string {
  const counts = new Map<string, number>()
  for (const s of seen) {
    const label = String(s ?? '').trim()
    if (!label) continue
    counts.set(label, (counts.get(label) || 0) + 1)
  }
  let best = ''
  let bestN = -1
  for (const [label, n] of counts) if (n > bestN) { best = label; bestN = n }
  return best || 'other'
}

/** Nobody is due back in three days, and nobody on a recall list is due back in three years. */
export const MIN_INTERVAL_DAYS = 7
export const MAX_INTERVAL_DAYS = 365

/** The number of visits before a client's own rhythm is trusted over the menu. Phorest uses three. */
export const VISITS_TO_LEARN = 3

const DAY = 86400000

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/**
 * The interval to use for one client in one category.
 *
 * `visitDates` is every visit that client has had in the category, in any order. `menuDays` is the
 * service menu's figure, used until there is enough history to know better.
 */
export function rebookInterval(visitDates: Array<Date | string | number>, menuDays: number | null | undefined): RebookInterval {
  const times = visitDates
    .map((d) => new Date(d as any).getTime())
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b)

  const fallback: RebookInterval = Number(menuDays) > 0
    ? { days: clamp(Number(menuDays)), basis: 'menu', visits: times.length }
    : { days: null, basis: 'none', visits: times.length }

  const gaps: number[] = []
  for (let i = 1; i < times.length; i++) {
    const days = Math.round((times[i] - times[i - 1]) / DAY)
    // Two visits in the same day are one visit as far as a rhythm is concerned — a cut and a colour
    // on the same afternoon say nothing about how often she comes.
    if (days >= 1) gaps.push(days)
  }

  // The rule — three visits before we have an opinion — is enforced HERE and only here, counted in
  // GAPS rather than in rows. Three visits give two gaps. An earlier version also checked
  // times.length up front; the two checks enforced the same rule, so neither could be falsified on
  // its own (mutation testing found it: breaking either one left every assertion green, and only
  // breaking both went red). Two guards for one rule is one guard and a place for them to disagree.
  //
  // Counting gaps rather than rows is also the stricter reading: three visits that all happened on
  // the same afternoon are one visit, and say nothing about anybody's rhythm.
  if (gaps.length < VISITS_TO_LEARN - 1) return fallback

  // TWO gaps that disagree are not a rhythm. (RR0929, the tester's judgement call — agreed)
  //
  // Three visits is Phorest's threshold and it stays, but three visits give exactly two gaps, and
  // a median of two numbers is just their midpoint: 7 days and 90 days reads as "every 7 weeks —
  // their own rhythm, from 3 visits", which describes neither visit and is said with more
  // confidence than the menu figure it replaced. With three or more gaps a median survives one
  // outlier; with two there is no majority for it to find.
  //
  // So two gaps have to roughly agree before they are trusted. Beyond a factor of two they are two
  // unrelated visits and the menu's interval is the better answer — it is at least what the salon
  // meant to happen. A client who really does come every 7 weeks reaches three gaps soon enough,
  // and then her own rhythm takes over whatever the spread.
  if (gaps.length === 2) {
    const lo = Math.min(gaps[0], gaps[1])
    const hi = Math.max(gaps[0], gaps[1])
    if (lo <= 0 || hi > lo * 2) return fallback
  }

  return { days: clamp(median(gaps)), basis: 'client', visits: times.length }
}

function clamp(days: number): number {
  return Math.min(MAX_INTERVAL_DAYS, Math.max(MIN_INTERVAL_DAYS, Math.round(days)))
}

/**
 * Said in words, for the screen. A front desk ringing a client is helped by knowing whether "due
 * today" comes from her own habit or from the price list.
 */
export function describeInterval(i: RebookInterval): string {
  if (!i.days) return 'No rebooking interval set'
  const weeks = i.days % 7 === 0 ? `${i.days / 7} week${i.days === 7 ? '' : 's'}` : `${i.days} days`
  // "their", not "her". The first draft said her, and the live list promptly printed "her own
  // rhythm" next to James Carter. A salon's clients are not all women and the product has no idea
  // which any of them are — it has a name and nothing else. Guessing from a name is how you
  // misgender a real person on a screen their stylist reads out loud.
  return i.basis === 'client'
    ? `every ${weeks} — their own rhythm, from ${i.visits} visits`
    : `every ${weeks} — the menu's interval`
}
