// What a business calls the people it serves, the work it does for them and its own people — ONE vocabulary per
// vertical (apps/unified VerticalSettings.vocabulary), registered once at startup (apps/unified web/src/main.tsx), the
// way the trade's code words are (labels/codes.ts). Every screen shared between businesses builds its sentences from it
// instead of carrying a contractor's ("Their jobs and records stay", "customers and crew members") or taking a whole
// sentence per screen from each vertical, which left a bar's Reviews page promising requests "when jobs are
// completed" (bar live test, 2026-10-25).
//
// No DOM here: the unified server reads the same vocabulary for the public Privacy and Terms (server/site/legal.ts).
// The templates never register one, so they read JOB_TRADE — the words they were written in.

export interface Noun { one: string; many: string }

export interface Vocabulary {
  /** Who the business serves: customer, client, guest. */
  customer: Noun
  /**
   * The work the business records for a customer, where it has its own record: job, service call, visit,
   * appointment. null: none (a bar, a restaurant or a store sells and books; it keeps no work record per customer).
   */
  work: Noun | null
  /** The people who do the work: crew, technicians, caregivers, staff. */
  team: Noun
  /**
   * What sends a Google review request by itself, as the end of "automatically after …": "a job is completed",
   * "a visit". It must be what the server does (services.ts and the roof's jobs.ts on a finished job, the salon on a
   * visit): null where nothing does, and the Reviews page then offers asking by hand only.
   */
  reviewAfter: string | null
  /** The website's page of photos: Portfolio for a trade that shows finished work, Gallery elsewhere. */
  gallery: string
}

/** The words the shared screens were written in: a contractor's. */
export const JOB_TRADE: Vocabulary = {
  customer: { one: 'customer', many: 'customers' },
  work: { one: 'job', many: 'jobs' },
  team: { one: 'crew member', many: 'crew' },
  reviewAfter: 'a job is completed',
  gallery: 'Portfolio',
}

let current: Vocabulary = JOB_TRADE

/** The vertical's vocabulary, for every shared screen. Nothing (a template, a test): JOB_TRADE. */
export function registerVocabulary(v: Partial<Vocabulary> | null | undefined) {
  current = v && typeof v === 'object' ? { ...JOB_TRADE, ...v } : JOB_TRADE
}

export function vocabulary(): Vocabulary {
  return current
}

/** "Customer", "Guest" — a noun at the start of a sentence or as a heading. */
export const capital = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s)
