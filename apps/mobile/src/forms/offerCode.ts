// An offer code at the sale on the phone (server crm/salon/offers.ts, POST /api/retention-offers/redeem). Pure rules for the invoice
// screen; the server decides everything else (whose code, unspent, in date, how much).
/** The sale statuses a code cannot go on (the server refuses them too; the screen just does not offer it). */
export const OFFER_CLOSED = ['paid', 'void', 'refunded']

/** What was typed, as a code to send — or null when there is nothing to send. Codes are upper case; spaces are not part of one. */
export const offerCodeTyped = (typed: string): string | null => {
  const c = String(typed ?? '').replace(/\s+/g, '').toUpperCase()
  return c.length >= 3 ? c : null
}

/** Whether the screen offers the box: the salon's feature on, a seat that may change the sale, a sale still open. */
export const canOfferCode = (o: { feature: boolean; mayUpdate: boolean; status: string }) => o.feature && o.mayUpdate && !OFFER_CLOSED.includes(o.status)

const money = (v: number) => `$${v.toFixed(2)}`
/** The question put to the stylist before the code is spent: what it is and what it takes off. */
export const offerQuestion = (q: { words: string; discount: number; cappedAtSale?: boolean }) =>
  `${q.words}: ${money(q.discount)} comes off this sale${q.cappedAtSale ? ' (all that is left on it)' : ''}. A code can only be used once.`
