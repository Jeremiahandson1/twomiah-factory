// THE CONDITIONS BEHIND THE HOME-SCREEN TILES — one definition for the count and for the list the tile opens.
//
// A tile on the phone's home screen says a number and opens a list. The number is the dashboard's (jobsDashboard.ts,
// the desktop's own figure); the list is the module's own list route asked for the same rows (`?tile=`). If the two were
// written twice they would drift: a tile reading 3 above a list of 4. So each condition is written ONCE, here, and the
// dashboard's count and the list route's filter both call it. A test (apps/unified/tests/mobile-home-tiles.test.ts) seeds
// rows that must NOT count (a cancelled job today, a paid invoice, an approved quote, a contacted lead) and requires every
// tile's list to equal its count — and fails if a condition is dropped.
import { and, inArray, sql } from 'drizzle-orm'
import { jobLocalDay, storeDayRange } from '../time/businessDay'
import { DEFAULT_OPEN_STATUSES } from '../invoicing/money'

/** The filters a list route accepts as `?tile=`, per list. A value outside the list is refused, never answered as "empty". */
export const JOB_TILES = ['today'] as const
export const QUOTE_TILES = ['pending'] as const
export const INVOICE_TILES = ['open'] as const

/** A quote nobody has answered: still a draft, or sent / viewed and waiting. Approved, declined and expired are not pending. */
export const PENDING_QUOTE_STATUSES = ['draft', 'sent', 'viewed'] as const
export const isPendingQuote = (status: unknown) => (PENDING_QUOTE_STATUSES as readonly string[]).includes(String(status))
export const pendingQuoteCondition = (quote: any) => inArray(quote.status, [...PENDING_QUOTE_STATUSES])

/** An invoice that is issued and not settled. Draft, void, refunded and paid are not "open". `open` is the template's own list. */
export const openInvoiceStatuses = (open?: readonly string[]) => [...(open && open.length ? open : DEFAULT_OPEN_STATUSES)]
export const openInvoiceCondition = (invoice: any, open?: readonly string[]) => inArray(invoice.status, openInvoiceStatuses(open))

/**
 * Work scheduled for the company's TODAY that is still live: the day is read per row (a booking's instant in the
 * company's zone, a day marker as the day it names — jobLocalDay), and a cancelled job is not on today's board.
 */
export function jobsTodayCondition(job: any, timeZone: string) {
  const { date } = storeDayRange(timeZone)
  return and(sql`${jobLocalDay(job.scheduledDate, job.source, timeZone)} = ${date}::date`, sql`${job.status} <> 'cancelled'`)!
}
